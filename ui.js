function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
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
      fullName: resolvePlayerFullName(player.player_id),
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
          matchupLabel: buildMatchupLabel(currentMatch),
          isReferee: playerContext.isReferee,
          isPlayerA: playerContext.isPlayerA,
          isPlayerB: playerContext.isPlayerB,
          matchStatus: String(currentMatch.status || ''),
          resultMode: String(currentMatch.result_mode || ''),
          closingState: String(currentMatch.closing_state || ''),
          isByeAdvance: isByeAdvanceMatch(currentMatch),
          allowedCaptureActions: getAllowedCaptureActions(currentMatch, playerId),
        }
      : null,
    timeline: buildMyDayTimeline(playerId, currentBlock),
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
      name: resolvePlayerFullName(p.player_id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getSinglesGroupsViewModel(selectedPlayerId) {
  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const checkedInPlayers = getPlayersSortedBySeed().filter(player => toBoolean(player.checked_in));
  const actorId = String(selectedPlayerId || '').trim();
  const actor = actorId ? getPlayerById(actorId) : null;
  const proposedPlayers = checkedInPlayers.filter(player =>
    String(player.proposed_group_id || '').trim() !== ''
  );
  const groupArtifactsExist = hasConfirmedSinglesGroupsArtifacts_();
  const validation = proposedPlayers.length
    ? validateSinglesGroupCheckpoint()
    : { ok: false, errors: [] };

  return {
    tournamentStatus,
    summary: {
      checkedIn: checkedInPlayers.length,
      proposedGroups: buildProposedGroupIds_(checkedInPlayers).length,
      assigned: proposedPlayers.length,
      confirmedGroups: buildConfirmedGroupIds_().length,
      issues: validation.errors.length,
    },
    capabilities: {
      canPrepareWindow: !groupArtifactsExist && checkedInPlayers.length > 0 && proposedPlayers.length === 0,
      canRecalculate: !groupArtifactsExist && proposedPlayers.length > 0,
      canMovePlayers: !groupArtifactsExist && proposedPlayers.length > 0,
      canConfirm: !groupArtifactsExist &&
        tournamentStatus === 'awaiting_singles_group_confirmation' &&
        proposedPlayers.length === checkedInPlayers.length &&
        validation.ok,
    },
    playerOptions: checkedInPlayers
      .map(player => ({
        id: String(player.player_id || ''),
        name: resolvePlayerFullName(player.player_id),
        placementLabel: buildSinglesPlacementLabel_(player),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    actor: actor && toBoolean(actor.checked_in) ? buildSinglesGroupsActorViewModel_(actor) : null,
    groups: buildSinglesGroupsGrid_(checkedInPlayers, actorId, !groupArtifactsExist && proposedPlayers.length > 0),
    validation: validation,
    statusNote: buildSinglesGroupsStatusNote_(tournamentStatus, checkedInPlayers, proposedPlayers, groupArtifactsExist, validation),
    generatedAt: nowIso(),
  };
}

function applySinglesGroupsActionFromUi(payload) {
  const data = payload || {};
  const action = String(data.action || '').trim();
  const selectedPlayerId = String(data.selectedPlayerId || data.playerId || '').trim();
  const playerId = String(data.playerId || '').trim();
  const targetGroupId = String(data.targetGroupId || '').trim();
  const targetSlot = String(data.targetSlot || '').trim();

  if (!action) throw new Error('action requerida');

  if (action === 'open_window') {
    openSinglesGroupConfirmationWindow();
    return getSinglesGroupsViewModel(selectedPlayerId);
  }

  if (action === 'recalculate') {
    recalculateProposedSinglesGroups();
    return getSinglesGroupsViewModel(selectedPlayerId);
  }

  if (action === 'move_player') {
    if (!playerId || !targetGroupId || !targetSlot) {
      throw new Error('Debes elegir jugador y destino.');
    }
    movePlayerToProposedGroup(playerId, targetGroupId, targetSlot);
    return getSinglesGroupsViewModel(selectedPlayerId || playerId);
  }

  if (action === 'confirm_groups') {
    confirmSinglesGroupsAndStartGroupStage();
    return getSinglesGroupsViewModel(selectedPlayerId);
  }

  throw new Error(`Accion de grupos no soportada: ${action}`);
}

function getDoublesConfigViewModel(selectedPlayerId) {
  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const players = getPlayers();
  const actorId = String(selectedPlayerId || '').trim();
  const actor = actorId ? getPlayerById(actorId) : null;
  const summary = getDoublesStatusSummary();
  const validation = validateDoublesCut();

  return {
    tournamentStatus,
    summary: {
      eligible: Number(summary.eligible || 0),
      pool: Number(summary.pool || 0),
      pending: Number(summary.partner_pending || 0),
      confirmed: Number(summary.partner_confirmed || 0),
    },
    playerOptions: players
      .filter(player => isPlayerAvailableForDoublesWindow(player))
      .map(player => ({
        id: String(player.player_id || ''),
        name: resolvePlayerFullName(player.player_id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    actor: actor ? buildDoublesActorViewModel_(actor) : null,
    rows: players
      .filter(player => isPlayerAvailableForDoublesWindow(player))
      .map(buildDoublesPlayerRowViewModel_)
      .sort(compareDoublesRows_),
    statusNote: buildDoublesStatusNote_(tournamentStatus, validation),
    generatedAt: nowIso(),
  };
}

function applyDoublesConfigActionFromUi(payload) {
  const data = payload || {};
  const action = String(data.action || '').trim();
  const playerId = String(data.playerId || '').trim();
  const targetPlayerId = String(data.targetPlayerId || '').trim();

  if (!action) throw new Error('action requerida');

  if (action === 'propose_partner') {
    if (!playerId || !targetPlayerId) {
      throw new Error('Debes elegir jugador y partner.');
    }
    proposePartner(playerId, targetPlayerId);
    return getDoublesConfigViewModel(playerId);
  }

  if (!playerId) {
    throw new Error('playerId requerido');
  }

  if (action === 'opt_into_pool') {
    optIntoPool(playerId);
    return getDoublesConfigViewModel(playerId);
  }

  if (action === 'decline_doubles') {
    declineDoubles(playerId);
    return getDoublesConfigViewModel(playerId);
  }

  if (action === 'confirm_partner') {
    confirmPartner(playerId);
    return getDoublesConfigViewModel(playerId);
  }

  if (action === 'reject_partner') {
    rejectPartner(playerId);
    return getDoublesConfigViewModel(playerId);
  }

  if (action === 'back_to_eligible') {
    clearPlayerDoublesConfig(playerId, 'eligible');
    return getDoublesConfigViewModel(playerId);
  }

  throw new Error(`Accion de dobles no soportada: ${action}`);
}

function buildDoublesActorViewModel_(player) {
  const playerId = String(player.player_id || '').trim();
  const status = String(player.doubles_status || '').trim();
  const partnerId = String(player.doubles_partner_id || '').trim();
  const requestTo = String(player.doubles_request_to || '').trim();
  const requestFrom = String(player.doubles_request_from || '').trim();

  return {
    id: playerId,
    name: resolvePlayerFullName(playerId),
    status: status,
    statusLabel: getDoublesStatusLabel_(status),
    partnerLabel: partnerId ? resolvePlayerFullName(partnerId) : '',
    partnerId: partnerId,
    requestToLabel: requestTo ? resolvePlayerFullName(requestTo) : '',
    requestToId: requestTo,
    requestFromLabel: requestFrom ? resolvePlayerFullName(requestFrom) : '',
    requestFromId: requestFrom,
    partnerOptions: getPartnerCandidateOptions_(playerId),
    availableActions: {
      canChoosePartner: status === 'eligible' || status === 'pool' || (status === 'partner_pending' && !!requestTo),
      canOptIntoPool: status === 'eligible' || status === 'partner_pending',
      canDecline: status !== 'blocked' && status !== 'partner_confirmed' && status !== 'opted_out',
      canConfirmPartner: status === 'partner_pending' && !!requestFrom,
      canRejectPartner: status === 'partner_pending' && !!requestFrom,
      canResetToEligible: status === 'pool' || status === 'opted_out' || (status === 'partner_pending' && !!requestTo),
    },
  };
}

function hasConfirmedSinglesGroupsArtifacts_() {
  const players = getPlayers().some(player => String(player.group_id || '').trim() !== '');
  const groups = getRows('Groups').length > 0;
  const groupMatches = getRows('Matches').some(match => String(match.phase_type || '').trim() === 'groups');
  const groupBlocks = getRows('Blocks').some(block => String(block.phase_type || '').trim() === 'groups');

  return players || groups || groupMatches || groupBlocks;
}

function buildProposedGroupIds_(players) {
  const seen = {};

  players.forEach(player => {
    const groupId = String(player.proposed_group_id || '').trim();
    if (groupId) seen[groupId] = true;
  });

  return Object.keys(seen).sort();
}

function buildConfirmedGroupIds_() {
  const seen = {};

  getRows('Groups').forEach(row => {
    const groupId = String(row.group_id || '').trim();
    if (groupId) seen[groupId] = true;
  });

  return Object.keys(seen).sort();
}

function buildSinglesPlacementLabel_(player) {
  const proposedGroupId = String(player.proposed_group_id || '').trim();
  const proposedSlot = String(player.proposed_group_slot || '').trim().toUpperCase();
  if (proposedGroupId && proposedSlot) {
    return `${proposedGroupId} ${proposedSlot}`;
  }

  const groupId = String(player.group_id || '').trim();
  const groupSlot = String(player.group_slot || '').trim().toUpperCase();
  if (groupId && groupSlot) {
    return `${groupId} ${groupSlot} confirmado`;
  }

  return 'Sin propuesta';
}

function buildSinglesGroupsActorViewModel_(player) {
  return {
    id: String(player.player_id || '').trim(),
    name: resolvePlayerFullName(player.player_id),
    seed: String(player.seed || '').trim(),
    placementLabel: buildSinglesPlacementLabel_(player),
    proposedGroupId: String(player.proposed_group_id || '').trim(),
    proposedSlot: String(player.proposed_group_slot || '').trim().toUpperCase(),
  };
}

function buildSinglesGroupsGrid_(players, actorId, canMovePlayers) {
  const grouped = {};

  players.forEach(player => {
    const proposedGroupId = String(player.proposed_group_id || '').trim();
    const groupId = proposedGroupId || String(player.group_id || '').trim();
    const slot = String(player.proposed_group_slot || player.group_slot || '').trim().toUpperCase();

    if (!groupId) return;
    if (!grouped[groupId]) grouped[groupId] = {};
    grouped[groupId][slot] = player;
  });

  return Object.keys(grouped)
    .sort()
    .map(groupId => ({
      groupId,
      slots: ['A', 'B', 'C'].map(slot => {
        const player = grouped[groupId][slot] || null;
        return {
          slot,
          playerId: player ? String(player.player_id || '').trim() : '',
          playerName: player ? resolvePlayerFullName(player.player_id) : '',
          seed: player ? String(player.seed || '').trim() : '',
          detail: player ? `ID ${player.player_id}` : 'Sin jugador asignado',
          isActorHere: !!player && String(player.player_id || '').trim() === actorId,
          canMoveHere: canMovePlayers && !!actorId && (!player || String(player.player_id || '').trim() !== actorId),
        };
      }),
    }));
}

function buildSinglesGroupsStatusNote_(tournamentStatus, checkedInPlayers, proposedPlayers, groupArtifactsExist, validation) {
  if (groupArtifactsExist) {
    return 'La fase de grupos ya fue confirmada. Esta pantalla queda en modo lectura para no reabrir el checkpoint.';
  }

  if (!checkedInPlayers.length) {
    return 'No hay jugadores checked-in para proponer grupos.';
  }

  if (!proposedPlayers.length) {
    return 'Genera la propuesta inicial para editar grupos de singles antes de confirmarlos.';
  }

  if (tournamentStatus !== 'awaiting_singles_group_confirmation') {
    return 'La propuesta existe, pero el torneo aun no esta en la ventana formal de confirmacion de grupos.';
  }

  if (!validation.ok) {
    return 'La propuesta tiene observaciones. Corrigelas antes de confirmar.';
  }

  return 'Checkpoint listo. Puedes revisar cambios finos y confirmar los grupos para iniciar la fase.';
}

function buildDoublesPlayerRowViewModel_(player) {
  const playerId = String(player.player_id || '').trim();
  const status = String(player.doubles_status || '').trim();
  const partnerId = String(player.doubles_partner_id || '').trim();
  const requestTo = String(player.doubles_request_to || '').trim();
  const requestFrom = String(player.doubles_request_from || '').trim();

  let detail = 'Sin partner aun';
  if (status === 'pool') detail = 'Asignacion automatica';
  if (status === 'opted_out') detail = 'Declino competir en dobles';
  if (status === 'partner_confirmed') detail = partnerId ? `Partner confirmado: ${resolvePlayerFullName(partnerId)}` : 'Partner confirmado';
  if (status === 'partner_pending' && requestTo) detail = `Solicitud enviada a ${resolvePlayerFullName(requestTo)}`;
  if (status === 'partner_pending' && requestFrom) detail = `Solicitud recibida de ${resolvePlayerFullName(requestFrom)}`;
  if (status === 'blocked') detail = 'Fuera de la ventana de dobles';

  return {
    id: playerId,
    name: resolvePlayerFullName(playerId),
    status,
    statusLabel: getDoublesStatusLabel_(status),
    detail,
  };
}

function getPartnerCandidateOptions_(playerId) {
  return getPlayers()
    .filter(player => {
      const candidateId = String(player.player_id || '').trim();
      const status = String(player.doubles_status || '').trim();

      if (!candidateId || candidateId === String(playerId)) return false;
      if (!isPlayerAvailableForDoublesWindow(player)) return false;
      return status !== 'partner_confirmed' && status !== 'opted_out';
    })
    .map(player => ({
      id: String(player.player_id || ''),
      name: resolvePlayerFullName(player.player_id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getDoublesStatusLabel_(status) {
  if (status === 'eligible') return 'Disponible';
  if (status === 'pool') return 'Pool';
  if (status === 'partner_pending') return 'Esperando confirmacion';
  if (status === 'partner_confirmed') return 'Confirmado';
  if (status === 'opted_out') return 'Declino';
  if (status === 'blocked') return 'Bloqueado';
  return status || 'Sin estado';
}

function buildDoublesStatusNote_(tournamentStatus, validation) {
  if (tournamentStatus !== 'awaiting_doubles_confirmation') {
    return 'La ventana de dobles aun no esta abierta. Puedes revisar el estado, pero algunas acciones podrian no estar disponibles segun el flujo.';
  }

  if (!validation.ok) {
    return validation.errors.join(' ');
  }

  return 'El cuadro se genera al corte usando parejas confirmadas y jugadores en pool. Si el pool es impar, no se puede generar dobles.';
}

function compareDoublesRows_(a, b) {
  const priority = {
    partner_confirmed: 0,
    partner_pending: 1,
    pool: 2,
    eligible: 3,
    opted_out: 4,
    blocked: 5,
  };

  const priorityA = Object.prototype.hasOwnProperty.call(priority, a.status) ? priority[a.status] : 99;
  const priorityB = Object.prototype.hasOwnProperty.call(priority, b.status) ? priority[b.status] : 99;

  if (priorityA !== priorityB) return priorityA - priorityB;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function buildMyDayTimeline(playerId, currentBlock) {
  const currentBlockId = currentBlock ? Number(currentBlock.block_id || 0) : 0;
  const blocks = getBlocksSorted();
  const upcomingBlocks = blocks.filter(block => {
    const blockId = Number(block.block_id || 0);
    if (currentBlockId) return blockId >= currentBlockId;
    return String(block.status || '').trim() !== 'closed';
  });

  const blockEntries = upcomingBlocks
    .slice(0, 4)
    .map(block => buildMyDayBlockTimelineEntry(block, playerId));

  const timeline = [...blockEntries];
  const syntheticEntries = buildMyDaySyntheticTimelineEntries(blocks);

  syntheticEntries.forEach(entry => {
    if (timeline.length < 6) timeline.push(entry);
  });

  return timeline.slice(0, 6);
}

function buildMyDayBlockTimelineEntry(block, playerId) {
  const blockId = String(block.block_id || '').trim();
  const matches = getMatchesByBlock(blockId);
  const match = matches.find(item => isPlayerInMatch(item, playerId));

  if (!match) {
    return {
      kind: 'block',
      title: `Bloque ${blockId} · Espera`,
      primary: 'Sin asignación aún',
      secondary: String(block.phase_label || ''),
      tone: 'idle',
    };
  }

  const context = buildPlayerMatchContext(match, playerId);
  const isBye = isByeAdvanceMatch(match);
  const roleLabel = isBye
    ? 'Libre'
    : context.isReferee
      ? 'Árbitro'
      : 'Juega';

  return {
    kind: 'block',
    title: `Bloque ${blockId} · ${roleLabel}`,
    primary: buildTimelinePrimaryLabel_(match),
    secondary: String(block.phase_label || ''),
    tone: isBye ? 'idle' : context.isReferee ? 'referee' : 'play',
  };
}

function buildMyDaySyntheticTimelineEntries(blocks) {
  const entries = [];
  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const hasGroupsBlocks = blocks.some(block => String(block.phase_type || '').trim() === 'groups');
  const hasSinglesBlocks = blocks.some(block => String(block.phase_type || '').trim() === 'singles');

  if (!hasGroupsBlocks) {
    entries.push({
      kind: 'checkpoint',
      title: 'Checkpoint · Grupos singles',
      primary: 'Pendiente confirmación',
      secondary: 'Se asignará tras confirmar grupos',
      tone: 'checkpoint',
    });
  }

  if (!hasSinglesBlocks) {
    entries.push({
      kind: 'checkpoint',
      title: 'Fase singles · Por definir',
      primary: 'Sin bloque asignado aún',
      secondary: hasGroupsBlocks
        ? 'Se asignará tras cerrar grupos'
        : 'Se asignará tras confirmar grupos',
      tone: 'checkpoint',
    });
  }

  if (isReservedDoublesFinalPendingBlock() || tournamentStatus === 'awaiting_doubles_final') {
    entries.push({
      kind: 'checkpoint',
      title: 'Final de dobles · Por definir',
      primary: 'Pendiente programación',
      secondary: 'Se programará después de semifinales de singles',
      tone: 'checkpoint',
    });
  }

  if (areReservedSinglesFinalsPendingBlock() || tournamentStatus === 'awaiting_singles_final') {
    entries.push({
      kind: 'checkpoint',
      title: 'Finales de singles · Por definir',
      primary: 'Pendiente programación',
      secondary: 'Se asignarán tras resolver final de dobles',
      tone: 'checkpoint',
    });
  }

  return entries;
}

function buildTimelinePrimaryLabel_(match) {
  const matchupLabel = buildMatchupLabel(match);
  const tableNo = String(match.table_no || '').trim();

  if (tableNo) {
    return `Mesa ${tableNo} · ${matchupLabel}`;
  }

  return matchupLabel;
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
    matchupLabel: buildMatchupLabel(match),
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
  return members.join(' + ');
}

function buildMatchupLabel(match) {
  const leftLabel = resolveCompetitorLabel(match.player_a_id, match.phase_type);
  const rightLabel = resolveCompetitorLabel(match.player_b_id, match.phase_type);

  if (isByeAdvanceMatch(match)) {
    const advancingLabel = leftLabel !== 'BYE' ? leftLabel : rightLabel;
    return `${advancingLabel} > ✨ Pasan a la siguiente ronda`;
  }

  return `${leftLabel} vs ${rightLabel}`;
}

function isPlayerInMatch(match, playerId) {
  const context = buildPlayerMatchContext(match, playerId);
  return context.isReferee || context.isPlayerA || context.isPlayerB;
}

function isByeAdvanceMatch(match) {
  const left = String(match.player_a_id || '').trim();
  const right = String(match.player_b_id || '').trim();
  const status = String(match.status || '').trim();

  return (!!left && !right || !left && !!right) && status === 'auto_closed';
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

function resolvePlayerFullName(playerId) {
  const player = getPlayerById(String(playerId || '').trim());
  if (!player) return '';

  return String(player.full_name || player.display_name || player.player_id || '').trim();
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
