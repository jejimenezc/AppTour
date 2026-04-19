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

    currentMatch = matches.find(match => isPlayerInMatch(match, playerId));
  }

  const playerContext = currentMatch ? buildPlayerMatchContext(currentMatch, playerId) : null;

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
          isReferee: playerContext.isReferee,
          isPlayerA: playerContext.isPlayerA,
          isPlayerB: playerContext.isPlayerB,
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
  const block = getCurrentBlock();
  const blockStatus = String(block && block.status || '').trim();
  const isBlockCapturable = blockStatus === 'live' || blockStatus === 'closing';
  const playerContext = buildPlayerMatchContext(match, playerId);
  const isReferee = playerContext.isReferee;
  const isPlayer = playerContext.isPlayerA || playerContext.isPlayerB;

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

function getAdminControlViewModel() {
  const currentBlock = getCurrentBlock();
  const triggerStatus = getTournamentClockTriggerStatus();
  const doublesSummary = getDoublesStatusSummary();
  const matches = getRows('Matches');
  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const timing = getBlockTimingConfig();
  const canConfirmGroups = tournamentStatus === 'awaiting_singles_group_confirmation';
  const canScheduleDoublesFinal = isReservedDoublesFinalPendingBlock();

  return {
    tournamentStatus: tournamentStatus,
    tournamentStartTs: String(getConfigValue('tournament_start_ts') || '').trim(),
    timeZone: getTimeZoneDiagnostics(),
    currentBlock: currentBlock
      ? {
          id: currentBlock.block_id,
          phaseType: String(currentBlock.phase_type || ''),
          phaseLabel: String(currentBlock.phase_label || ''),
          status: String(currentBlock.status || ''),
          startTs: serializeDateForClient(currentBlock.start_ts),
          closeSignalTs: serializeDateForClient(currentBlock.close_signal_ts),
          hardCloseTs: serializeDateForClient(currentBlock.hard_close_ts),
          endTs: serializeDateForClient(currentBlock.end_ts),
          publishedAt: String(currentBlock.published_at || ''),
          closedAt: String(currentBlock.closed_at || ''),
        }
      : null,
    counts: {
      players: getRows('Players').length,
      groups: getRows('Groups').length,
      matches: matches.length,
      doublesTeams: getRows('DoublesTeams').length,
      blocks: getRows('Blocks').length,
      scheduledMatches: matches.filter(match => String(match.status || '') === 'scheduled').length,
      liveMatches: matches.filter(match => String(match.status || '') === 'live').length,
      finalMatches: matches.filter(match => String(match.result_mode || '') === 'final').length,
    },
    timing: {
      playMinutes: timing.playMinutes,
      closeMinutes: timing.closeMinutes,
      transitionMinutes: timing.transitionMinutes,
      totalMinutes: getBlockTotalMinutes(),
    },
    doublesSummary: doublesSummary,
    trigger: triggerStatus,
    checkpoints: {
      canConfirmGroups: canConfirmGroups,
      canScheduleDoublesFinal: canScheduleDoublesFinal,
    },
    generatedAt: nowIso(),
  };
}

function setTournamentStartTsFromUi(rawValue) {
  const normalized = normalizeTournamentStartInput_(rawValue);
  setConfigValue('tournament_start_ts', normalized, 'Hora base del torneo');
  return getAdminControlViewModel();
}

function setTournamentStartNowFromUi() {
  const value = nowIso();
  setConfigValue('tournament_start_ts', value, 'Hora base del torneo');
  return getAdminControlViewModel();
}

function initializeTournamentFlowV2FromUi() {
  initializeTournamentFlowV2();
  return getAdminControlViewModel();
}

function seedDemoDoublesConfigFromUi() {
  seedDemoDoublesConfiguration_();
  return getAdminControlViewModel();
}

function setupDoublesStageFromUi() {
  const validation = validateDoublesCut();
  if (!validation.ok) {
    throw new Error(validation.errors.join(' '));
  }

  const blockId = setupDoublesStageFromCut();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = blockId
    ? `Bloque inicial de dobles generado: ${blockId}`
    : 'No se genero un bloque de dobles.';
  return vm;
}

function runTournamentClockNowFromUi() {
  tickTournamentClock();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = 'Tick ejecutado manualmente.';
  return vm;
}

function setClockTriggerEnabledFromUi(enabled) {
  const nextValue = !!enabled;
  setConfigValue('clock_trigger_enabled', nextValue, 'Habilita el trigger automatico del reloj');
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = nextValue ? 'Reloj automatico reanudado.' : 'Reloj automatico pausado.';
  return vm;
}

function confirmSinglesGroupsFromUi() {
  confirmSinglesGroupsAndStartGroupStage();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = 'Grupos confirmados. Fase de grupos iniciada.';
  return vm;
}

function scheduleDoublesFinalFromUi() {
  const blockId = createDoublesFinalBlockIfNeeded();
  if (!blockId) {
    throw new Error('No hay final de dobles reservada pendiente de bloque.');
  }

  const vm = getAdminControlViewModel();
  vm.lastActionMessage = `Final de dobles programada en bloque ${blockId}.`;
  return vm;
}

function startDemoTournamentNowFromUi() {
  const startTs = nowIso();
  setConfigValue('tournament_start_ts', startTs, 'Hora base del torneo');
  initializeTournamentFlowV2();
  seedDemoDoublesConfiguration_();

  const validation = validateDoublesCut();
  if (!validation.ok) {
    throw new Error(validation.errors.join(' '));
  }

  const blockId = setupDoublesStageFromCut();
  tickTournamentClock();

  const vm = getAdminControlViewModel();
  vm.lastActionMessage = blockId
    ? `Simulacion iniciada. Bloque de dobles ${blockId} listo y reloj ejecutado.`
    : 'Simulacion iniciada sin bloque de dobles.';
  return vm;
}

function normalizeTournamentStartInput_(rawValue) {
  const value = String(rawValue || '').trim().replace('T', ' ');
  if (!value) {
    throw new Error('Ingresa tournament_start_ts antes de guardar.');
  }

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
    ? `${value}:00`
    : value;

  const canonical = normalizeDateTimeText(normalized);
  if (!canonical) {
    throw new Error(`tournament_start_ts invalido: "${value}". Usa yyyy-mm-dd hh:mm:ss.`);
  }

  return canonical;
}

function seedDemoDoublesConfiguration_() {
  openDoublesConfirmationWindow();

  const eligible = getPlayers().filter(player =>
    (player.checked_in === true || String(player.checked_in) === 'TRUE') &&
    String(player.doubles_status || '') === 'eligible'
  );

  if (eligible.length < 6) {
    throw new Error('No hay suficientes jugadores elegibles para armar el helper de dobles demo.');
  }

  proposePartner(eligible[0].player_id, eligible[1].player_id);
  confirmPartner(eligible[1].player_id);

  proposePartner(eligible[2].player_id, eligible[3].player_id);
  confirmPartner(eligible[3].player_id);

  for (let i = 4; i < eligible.length; i++) {
    optIntoPool(eligible[i].player_id);
  }
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
  const playerContext = buildPlayerMatchContext(match, playerId);
  const isReferee = playerContext.isReferee;
  const isPlayer = playerContext.isPlayerA || playerContext.isPlayerB;

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
    return resolveDoublesTeamLabel(raw) || raw;
  }

  return resolvePlayerDisplayName(raw) || raw;
}

function resolveDoublesTeamLabel(teamId) {
  const team = getDoublesTeamById(teamId);
  if (!team) return '';

  const player1 = resolvePlayerDisplayName(team.player_1_id);
  const player2 = resolvePlayerDisplayName(team.player_2_id);
  const members = [player1, player2].filter(Boolean);

  if (!members.length) return String(team.team_id || '').trim();
  return members.join(' / ');
}

function isPlayerInMatch(match, playerId) {
  const context = buildPlayerMatchContext(match, playerId);
  return context.isReferee || context.isPlayerA || context.isPlayerB;
}

function buildPlayerMatchContext(match, playerId) {
  const actorId = String(playerId || '').trim();
  const phaseType = String(match.phase_type || '').trim();
  const isReferee = String(match.referee_player_id || '').trim() === actorId;

  if (phaseType === 'doubles') {
    const teamA = getDoublesTeamById(match.player_a_id);
    const teamB = getDoublesTeamById(match.player_b_id);

    return {
      isReferee: isReferee,
      isPlayerA: isPlayerInDoublesTeam_(teamA, actorId),
      isPlayerB: isPlayerInDoublesTeam_(teamB, actorId),
    };
  }

  return {
    isReferee: isReferee,
    isPlayerA: String(match.player_a_id || '').trim() === actorId,
    isPlayerB: String(match.player_b_id || '').trim() === actorId,
  };
}

function isPlayerInDoublesTeam_(team, playerId) {
  if (!team) return false;
  const actorId = String(playerId || '').trim();

  return String(team.player_1_id || '').trim() === actorId ||
    String(team.player_2_id || '').trim() === actorId;
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
    return Utilities.formatDate(value, getAppTimeZone(), 'yyyy-MM-dd HH:mm:ss');
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
