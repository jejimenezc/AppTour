function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Torneo Tenis de Mesa')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Payload inicial mínimo para la pantalla pública.
 * IMPORTANTE: no devolver Date al cliente; serializar a string.
 */
function getPublicViewModel() {
  const status = String(getConfigValue('tournament_status') || '').trim();
  const currentBlock = getCurrentBlock();
  const currentBlockId = currentBlock ? currentBlock.block_id : '';
  const currentMatches = currentBlockId ? getMatchesByBlock(currentBlockId) : [];

  const matches = currentMatches
    .filter(match => {
      const phase = String(match.phase_type || '').trim();
      return phase === 'doubles' || phase === 'groups' || phase === 'singles';
    })
    .sort((a, b) => Number(a.table_no || 999) - Number(b.table_no || 999))
    .map(match => mapMatchForPublicView(match));

  return {
    tournamentStatus: status,
    currentBlock: currentBlock
      ? {
          id: currentBlock.block_id,
          phaseType: currentBlock.phase_type,
          phaseLabel: currentBlock.phase_label,
          status: currentBlock.status,
          startTs: serializeDateForClient(currentBlock.start_ts),
          closeSignalTs: serializeDateForClient(currentBlock.close_signal_ts),
          hardCloseTs: serializeDateForClient(currentBlock.hard_close_ts),
          endTs: serializeDateForClient(currentBlock.end_ts),
        }
      : null,
    matches,
    generatedAt: nowIso(),
  };
}

function getMyDayViewModel(playerId) {
  const player = getPlayerById(playerId);
  if (!player) {
    throw new Error(`No existe player_id=${playerId}`);
  }

  const currentBlock = getCurrentBlock();
  const currentBlockId = currentBlock ? currentBlock.block_id : '';

  let currentMatch = null;

  if (currentBlockId) {
    const matches = getMatchesByBlock(currentBlockId);

    currentMatch = matches.find(match =>
      String(match.player_a_id) === playerId ||
      String(match.player_b_id) === playerId ||
      String(match.referee_player_id) === playerId
    );
  }

  return {
    player: {
      id: player.player_id,
      name: String(player.display_name || player.player_id),
      role: String(player.current_role || 'idle'),
    },
    currentBlock: currentBlock
      ? {
          id: currentBlock.block_id,
          phaseLabel: currentBlock.phase_label,
          status: currentBlock.status,
        }
      : null,
    currentMatch: currentMatch
      ? {
          matchId: currentMatch.match_id,
          tableNo: currentMatch.table_no,
          phaseLabel: buildPublicPhaseLabel(currentMatch),
          leftLabel: resolveCompetitorLabel(currentMatch.player_a_id, currentMatch.phase_type),
          rightLabel: resolveCompetitorLabel(currentMatch.player_b_id, currentMatch.phase_type),
          isReferee: String(currentMatch.referee_player_id) === playerId,
          isPlayerA: String(currentMatch.player_a_id) === playerId,
          isPlayerB: String(currentMatch.player_b_id) === playerId,
          matchStatus: String(currentMatch.status || ''),
          resultMode: String(currentMatch.result_mode || ''),
          closingState: String(currentMatch.closing_state || ''),
          allowedCaptureActions: getAllowedCaptureActions(currentMatch, playerId),
        }
      : null,
    generatedAt: nowIso(),
  };
}

function getAllowedCaptureActions(match, playerId) {
  const actorId = String(playerId || '').trim();
  const block = getCurrentBlock();
  const blockStatus = String(block && block.status || '').trim();
  const isBlockCapturable = blockStatus === 'live' || blockStatus === 'closing';
  const isReferee = String(match.referee_player_id || '').trim() === actorId;
  const isPlayer =
    String(match.player_a_id || '').trim() === actorId ||
    String(match.player_b_id || '').trim() === actorId;

  return {
    canOpen: isBlockCapturable && (isReferee || isPlayer),
    canSubmitFinal: isBlockCapturable && (isReferee || isPlayer),
    canSubmitClosingState: isBlockCapturable && (isReferee || isPlayer),
    canViewOnly: false,
  };
}

function getCheckedInPlayersForSelector() {
  const players = getPlayers();

  return players
    .filter(p => String(p.checked_in) === 'TRUE' || p.checked_in === true)
    .map(p => ({
      id: String(p.player_id),
      name: String(p.display_name || p.player_id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Wrapper UI -> motor real
 *
 * payload.mode:
 * - 'final'
 * - 'closing_state'
 */
function submitMatchResultFromUi(payload) {
  const data = payload || {};
  const matchId = String(data.matchId || '').trim();
  const mode = String(data.mode || '').trim();
  const actorPlayerId = String(data.actorPlayerId || '').trim();
  const actorRole = String(data.actorRole || '').trim();
  const match = getMatchById(matchId);

  if (!matchId) {
    throw new Error('matchId requerido');
  }

  if (!mode) {
    throw new Error('mode requerido');
  }

  if (!actorPlayerId) {
    throw new Error('actorPlayerId requerido');
  }

  if (!match) {
    throw new Error(`No existe el match_id=${matchId}`);
  }

  validateUiMatchSubmissionContext(match, actorPlayerId, actorRole, mode);

  if (mode === 'final') {
    const setsA = Number(data.setsA);
    const setsB = Number(data.setsB);

    if (Number.isNaN(setsA) || Number.isNaN(setsB)) {
      throw new Error('Sets inválidos para resultado final.');
    }

    submitMatchResult(matchId, {
      mode: 'final',
      sets_a: setsA,
      sets_b: setsB,
      submitted_by: actorPlayerId || 'ui-user',
      submitted_by_role: actorRole || 'player',
    });

    return { ok: true };
  }

  if (mode === 'closing_state') {
    const closingState = String(data.closingState || '').trim();

    submitMatchResult(matchId, {
      mode: 'closing_state',
      closing_state: closingState,
      submitted_by: actorPlayerId || 'ui-user',
      submitted_by_role: actorRole || 'player',
    });

    return { ok: true };
  }

  throw new Error(`mode no soportado: ${mode}`);
}

function validateUiMatchSubmissionContext(match, actorPlayerId, actorRole, mode) {
  const block = getCurrentBlock();
  const blockId = String(block && block.block_id || '').trim();
  const blockStatus = String(block && block.status || '').trim();
  const matchBlockId = String(match.block_id || '').trim();
  const playerId = String(actorPlayerId || '').trim();
  const role = String(actorRole || '').trim();
  const isReferee = String(match.referee_player_id || '').trim() === playerId;
  const isPlayer =
    String(match.player_a_id || '').trim() === playerId ||
    String(match.player_b_id || '').trim() === playerId;

  if (!blockId || matchBlockId !== blockId) {
    throw new Error('El partido no pertenece al bloque actual.');
  }

  if (blockStatus !== 'live' && blockStatus !== 'closing') {
    throw new Error('La captura solo esta disponible cuando el bloque esta en juego o en cierre.');
  }

  if (!isReferee && !isPlayer) {
    throw new Error('El jugador seleccionado no participa en este partido.');
  }

  if (mode !== 'final' && mode !== 'closing_state') {
    throw new Error(`mode no soportado: ${mode}`);
  }

  if (role !== 'player' && role !== 'referee' && role !== 'admin') {
    throw new Error(`Rol no soportado para captura: ${role}`);
  }

  if (role === 'referee' && !isReferee) {
    throw new Error('Solo el arbitro asignado puede capturar con rol de arbitro.');
  }
}

function mapMatchForPublicView(match) {
  const phaseType = String(match.phase_type || '').trim();
  const leftLabel = resolveCompetitorLabel(match.player_a_id, phaseType);
  const rightLabel = resolveCompetitorLabel(match.player_b_id, phaseType);
  const refereeLabel = resolvePlayerDisplayName(match.referee_player_id);

  return {
    matchId: String(match.match_id || ''),
    tableNo: match.table_no,
    phaseType,
    phaseLabel: buildPublicPhaseLabel(match),
    leftLabel,
    rightLabel,
    refereeLabel: refereeLabel ? `Árbitro: ${refereeLabel}` : '',
    status: mapMatchStatusLabel(match.status),
    resultMode: String(match.result_mode || ''),
    closingState: String(match.closing_state || ''),
    setsA: valueForClient(match.sets_a),
    setsB: valueForClient(match.sets_b),
  };
}

function buildPublicPhaseLabel(match) {
  const phaseType = String(match.phase_type || '').trim();
  const bracketType = String(match.bracket_type || '').trim();
  const roundNo = Number(match.round_no || 0);

  if (phaseType === 'doubles') {
    return `Dobles · Ronda ${roundNo || '-'}`;
  }

  if (phaseType === 'groups') {
    return `Singles · Grupos · R${roundNo || '-'}`;
  }

  if (phaseType === 'singles') {
    const name = bracketType ? capitalize(bracketType) : 'Singles';
    return `${name} · Ronda ${roundNo || '-'}`;
  }

  return 'Partido';
}

function resolveCompetitorLabel(id, phaseType) {
  const raw = String(id || '').trim();
  if (!raw) return 'BYE';

  if (phaseType === 'doubles') {
    return raw;
  }

  return resolvePlayerDisplayName(raw) || raw;
}

function resolvePlayerDisplayName(playerId) {
  const player = getPlayerById(String(playerId || '').trim());
  if (!player) return '';
  return String(player.display_name || player.player_id || '').trim();
}

function mapMatchStatusLabel(status) {
  const value = String(status || '').trim();

  if (value === 'live') return 'En juego';
  if (value === 'result_submitted') return 'Resultado ingresado';
  if (value === 'scheduled') return 'Pendiente';
  if (value === 'auto_closed') return 'Cerrado';
  return value || 'Pendiente';
}

function capitalize(value) {
  const str = String(value || '').trim();
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function serializeDateForClient(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  return String(value);
}

function valueForClient(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !Number.isNaN(value.getTime())) {
    return serializeDateForClient(value);
  }
  return value;
}
