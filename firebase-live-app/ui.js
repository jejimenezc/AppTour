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
  const generatedAt = nowIso();
  const snapshotVersion = String(Date.now());

  const matches = currentMatches
    .filter(match => {
      const phase = String(match.phase_type || '').trim();
      return phase === 'doubles' || phase === 'groups' || phase === 'singles';
    })
    .sort((a, b) => Number(a.table_no || 999) - Number(b.table_no || 999))
    .map(match => mapMatchForPublicView(match, currentBlock));

  return {
    tournamentStatus: status,
    clock: buildTournamentClockPayload_(),
    timeState: buildPublicTimeState_(currentBlock),
    currentBlock: currentBlock
      ? {
          id: currentBlock.block_id,
          phaseType: currentBlock.phase_type,
          phaseLabel: currentBlock.phase_label,
          startTs: serializeDateForClient(currentBlock.start_ts),
          closeSignalTs: serializeDateForClient(currentBlock.close_signal_ts),
          hardCloseTs: serializeDateForClient(currentBlock.hard_close_ts),
          endTs: serializeDateForClient(currentBlock.end_ts),
        }
      : null,
    matches,
    generatedAt: generatedAt,
    snapshotVersion: snapshotVersion,
  };
}

function buildTournamentClockPayload_() {
  const clockState = getTournamentClockState_();

  return {
    tournamentStartTs: normalizeDateTimeText(clockState.startTs),
    internalNowTs: normalizeDateTimeText(clockState.internalNowTs),
    realNowTs: normalizeDateTimeText(clockState.realNowTs || nowIso()),
    elapsedMs: Number(clockState.elapsedMs || 0),
    isRunning: !!clockState.isRunning,
    lastResumeRealTs: normalizeDateTimeText(clockState.lastResumeRealTs),
    triggerLastRunAt: normalizeDateTimeText(getConfigValue('clock_trigger_last_run_at')),
    lastProcessedInternalTs: normalizeDateTimeText(getConfigValue('clock_last_processed_internal_ts')),
    clockHealth: String(clockState.health || 'ok'),
    clockHealthMessage: String(clockState.healthMessage || ''),
  };
}

function getMyDayViewModel(playerId) {
  const player = getPlayerById(playerId);
  if (!player) {
    throw new Error(`No existe player_id=${playerId}`);
  }

  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const currentBlock = getCurrentBlock();
  const currentBlockId = currentBlock ? currentBlock.block_id : '';

  let currentMatch = null;

  if (currentBlockId) {
    const matches = getMatchesByBlock(currentBlockId);

    currentMatch = matches.find(match => isPlayerInMatch(match, playerId));
  }

  const playerContext = currentMatch ? buildPlayerMatchContext(currentMatch, playerId) : null;
  const itinerary = buildMyDayItinerary(playerId, currentBlock);

  return {
    tournamentStatus: tournamentStatus,
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
          startTs: serializeDateForClient(currentBlock.start_ts),
          closeSignalTs: serializeDateForClient(currentBlock.close_signal_ts),
          hardCloseTs: serializeDateForClient(currentBlock.hard_close_ts),
          endTs: serializeDateForClient(currentBlock.end_ts),
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
          eventState: buildPublicMatchEventState_(currentMatch),
          isByeAdvance: isByeAdvanceMatch(currentMatch),
        }
      : null,
    activeBlockId: String(currentBlockId || '').trim(),
    itinerary: itinerary,
    timeline: itinerary,
    snapshotVersion: String(Date.now()),
    generatedAt: nowIso(),
    source: 'gas',
  };
}

function getMyDayViewModelFromUi(playerId) {
  const vm = getMyDayViewModel(playerId);
  publishMyDayViewModelToFirebase(playerId);
  publishDoublesViewModelToFirebase(playerId);
  return vm;
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

function getResultsHistoryViewModel() {
  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const resolvedMatches = getMatches()
    .filter(function (match) {
      return isMatchResolved(match) && !isByeAdvanceMatch(match);
    })
    .sort(function (left, right) {
      const leftTs = String(left.submitted_at || '').trim();
      const rightTs = String(right.submitted_at || '').trim();
      if (leftTs !== rightTs) return leftTs.localeCompare(rightTs);
      return String(left.match_id || '').localeCompare(String(right.match_id || ''));
    });

  const items = resolvedMatches.map(function (match) {
    const winnerLabel = resolveCompetitorLabel(match.winner_id, match.phase_type);
    return {
      matchId: String(match.match_id || '').trim(),
      phaseType: String(match.phase_type || '').trim(),
      submittedAt: normalizeDateTimeText(match.submitted_at),
      phaseLabel: buildPublicPhaseLabel(match),
      matchupLabel: buildMatchupLabel(match),
      winnerLabel: winnerLabel,
      resultLabel: buildHistoricalResultLabel_(match),
      tableLabel: String(match.table_no || '').trim() ? `Mesa ${match.table_no}` : '',
      blockLabel: String(match.block_id || '').trim() ? `Bloque ${match.block_id}` : '',
      sourceLabel: String(match.result_source || '').trim() || 'manual',
    };
  });

  return {
    tournamentStatus: tournamentStatus,
    summary: {
      total: items.length,
      groups: items.filter(function (item) { return item.phaseType === 'groups'; }).length,
      doubles: items.filter(function (item) { return item.phaseType === 'doubles'; }).length,
      singles: items.filter(function (item) { return item.phaseType === 'singles'; }).length,
    },
    items: items,
    generatedAt: nowIso(),
    snapshotVersion: String(Date.now()),
    statusNote: items.length
      ? 'Vista historica de resultados ya cerrados. El orden sigue el momento de registro del resultado.'
      : 'Aun no hay resultados finales registrados para mostrar.',
  };
}

function getResultsHistoryViewModelFromUi() {
  const vm = getResultsHistoryViewModel();
  publishResultsHistoryViewToFirebase();
  return vm;
}

function buildHistoricalResultLabel_(match) {
  const mode = String(match.result_mode || '').trim();
  if (mode === 'final' && isValidFinalSets(match.sets_a, match.sets_b)) {
    return `${match.sets_a}-${match.sets_b}`;
  }
  if (mode === 'wo') return 'WO';
  return 'Resultado cerrado';
}

function getRankingPointRules_() {
  return {
    groups: {
      1: 120,
      2: 80,
      3: 50,
    },
    doubles: {
      R16: 35,
      QF: 60,
      SF: 100,
      FINALIST: 140,
      CHAMPION: 200,
    },
    singles: {
      oro: { R16: 50, QF: 90, SF: 140, FINALIST: 200, CHAMPION: 280 },
      plata: { R16: 40, QF: 70, SF: 110, FINALIST: 160, CHAMPION: 220 },
      cobre: { R16: 30, QF: 55, SF: 85, FINALIST: 125, CHAMPION: 180 },
      default: { R16: 30, QF: 55, SF: 85, FINALIST: 125, CHAMPION: 180 },
    },
  };
}

function getRankingLeaderboardViewModel() {
  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const tournamentPlayers = getTournamentPlayers();
  const rules = getRankingPointRules_();
  const rowMap = {};

  tournamentPlayers.forEach(function (player) {
    const playerId = String(player.player_id || '').trim();
    if (!playerId) return;
    rowMap[playerId] = {
      playerId: playerId,
      playerName: resolvePlayerFullName(playerId),
      totalPoints: 0,
      breakdown: [],
    };
  });

  tournamentPlayers.forEach(function (player) {
    const playerId = String(player.player_id || '').trim();
    const rank = Number(player.group_rank || 0);
    const points = Number(rules.groups[rank] || 0);
    if (!playerId || !points || !rowMap[playerId]) return;
    appendRankingPoints_(rowMap[playerId], 'Groups', `Grupo ${rank}`, points);
  });

  const awardedStageKeys = {};
  getMatches()
    .filter(function (match) {
      return isMatchResolved(match) && !isByeAdvanceMatch(match);
    })
    .forEach(function (match) {
      const phaseType = String(match.phase_type || '').trim();
      const roundLabel = getVisibleRoundLabel_(String(match.round_label || '').trim()) || String(match.round_label || '').trim().toUpperCase();
      const winnerIds = resolveMatchParticipantPlayerIds_(match.winner_id, phaseType);
      const loserIds = buildResolvedMatchLoserPlayerIds_(match);

      if (phaseType === 'doubles') {
        if (String(roundLabel || '').toUpperCase() === 'FINAL') {
          awardStagePointsToPlayers_(rowMap, awardedStageKeys, winnerIds, 'doubles_champion', 'Dobles', 'Campeon dobles', rules.doubles.CHAMPION);
          awardStagePointsToPlayers_(rowMap, awardedStageKeys, loserIds, 'doubles_finalist', 'Dobles', 'Final dobles', rules.doubles.FINALIST);
        } else {
          const stageKey = String(roundLabel || '').toUpperCase();
          const points = Number(rules.doubles[stageKey] || 0);
          if (points) {
            awardStagePointsToPlayers_(rowMap, awardedStageKeys, loserIds, `doubles_${stageKey}`, 'Dobles', `Dobles ${stageKey}`, points);
          }
        }
        return;
      }

      if (phaseType === 'singles') {
        const bracketType = String(match.bracket_type || 'default').trim().toLowerCase();
        const bracketRules = rules.singles[bracketType] || rules.singles.default;
        if (String(roundLabel || '').toUpperCase() === 'FINAL') {
          awardStagePointsToPlayers_(rowMap, awardedStageKeys, winnerIds, `singles_${bracketType}_champion`, 'Singles', `${capitalizeStageLabel_(bracketType)} campeon`, Number(bracketRules.CHAMPION || 0));
          awardStagePointsToPlayers_(rowMap, awardedStageKeys, loserIds, `singles_${bracketType}_finalist`, 'Singles', `${capitalizeStageLabel_(bracketType)} final`, Number(bracketRules.FINALIST || 0));
        } else {
          const stageKey = String(roundLabel || '').toUpperCase();
          const points = Number(bracketRules[stageKey] || 0);
          if (points) {
            awardStagePointsToPlayers_(rowMap, awardedStageKeys, loserIds, `singles_${bracketType}_${stageKey}`, 'Singles', `${capitalizeStageLabel_(bracketType)} ${stageKey}`, points);
          }
        }
      }
    });

  const rows = Object.keys(rowMap)
    .map(function (playerId) { return rowMap[playerId]; })
    .sort(function (left, right) {
      if (right.totalPoints !== left.totalPoints) return right.totalPoints - left.totalPoints;
      return String(left.playerName || '').localeCompare(String(right.playerName || ''));
    })
    .map(function (row, index) {
      return Object.assign({}, row, { position: index + 1 });
    });

  return {
    tournamentStatus: tournamentStatus,
    rulesNote: 'Modelo V1 informativo: suma puntos asegurados por grupo y por eliminacion cerrada. La tabla se puede afinar luego.',
    summary: {
      players: rows.length,
      scoredPlayers: rows.filter(function (row) { return Number(row.totalPoints || 0) > 0; }).length,
    },
    rows: rows,
    generatedAt: nowIso(),
    snapshotVersion: String(Date.now()),
  };
}

function getRankingLeaderboardViewModelFromUi() {
  const vm = getRankingLeaderboardViewModel();
  publishRankingLeaderboardViewToFirebase();
  return vm;
}

function buildResolvedMatchLoserPlayerIds_(match) {
  const winnerId = String(match.winner_id || '').trim();
  const leftId = String(match.player_a_id || '').trim();
  const rightId = String(match.player_b_id || '').trim();
  const losingEntryId = winnerId === leftId ? rightId : winnerId === rightId ? leftId : '';
  return resolveMatchParticipantPlayerIds_(losingEntryId, match.phase_type);
}

function awardStagePointsToPlayers_(rowMap, awardedStageKeys, playerIds, stageKey, phaseLabel, stageLabel, points) {
  const ids = Array.isArray(playerIds) ? playerIds : [];
  ids.forEach(function (playerId) {
    const normalizedPlayerId = String(playerId || '').trim();
    if (!normalizedPlayerId || !rowMap[normalizedPlayerId]) return;
    const key = `${normalizedPlayerId}::${stageKey}`;
    if (awardedStageKeys[key]) return;
    awardedStageKeys[key] = true;
    appendRankingPoints_(rowMap[normalizedPlayerId], phaseLabel, stageLabel, points);
  });
}

function appendRankingPoints_(row, phaseLabel, stageLabel, points) {
  const value = Number(points || 0);
  if (!row || !value) return;
  row.totalPoints += value;
  row.breakdown.push({
    phaseLabel: String(phaseLabel || '').trim(),
    stageLabel: String(stageLabel || '').trim(),
    points: value,
  });
}

function capitalizeStageLabel_(value) {
  const text = String(value || '').trim();
  if (!text) return 'Etapa';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getSinglesGroupsViewModel(selectedPlayerId) {
  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const checkedInPlayers = getTournamentPlayers();
  const tournamentPlayerLookup = getTournamentPlayerIdLookup();
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
    actor: actor && tournamentPlayerLookup[String(actor.player_id)] ? buildSinglesGroupsActorViewModel_(actor) : null,
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
    return publishRealtimeSnapshotAfterMutation_(getSinglesGroupsViewModel(selectedPlayerId));
  }

  if (action === 'recalculate') {
    recalculateProposedSinglesGroups();
    return publishRealtimeSnapshotAfterMutation_(getSinglesGroupsViewModel(selectedPlayerId));
  }

  if (action === 'move_player') {
    if (!playerId || !targetGroupId || !targetSlot) {
      throw new Error('Debes elegir jugador y destino.');
    }
    movePlayerToProposedGroup(playerId, targetGroupId, targetSlot);
    return publishRealtimeSnapshotAfterMutation_(getSinglesGroupsViewModel(selectedPlayerId || playerId));
  }

  if (action === 'confirm_groups') {
    confirmSinglesGroupsAndStartGroupStage();
    return publishRealtimeSnapshotAfterMutation_(getSinglesGroupsViewModel(selectedPlayerId));
  }

  throw new Error(`Accion de grupos no soportada: ${action}`);
}

function getDoublesConfigViewModel(selectedPlayerId) {
  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const players = getTournamentPlayers();
  const tournamentPlayerLookup = getTournamentPlayerIdLookup();
  const actorId = String(selectedPlayerId || '').trim();
  const actor = actorId ? getPlayerById(actorId) : null;
  const activeProposals = getActiveDoublesProposalIntents_();
  const confirmedSnapshot = getDoublesConfirmedPairsSnapshot_();
  const checkinMap = getDoublesCheckinStateMap_();
  const proposalContext = buildDoublesProposalContext_(activeProposals);
  const doublesVmContext = {
    confirmedPartnerMap: confirmedSnapshot.partnerMap || {},
    proposalPlayerIds: proposalContext.proposalPlayerIds,
    proposalIncomingByPlayer: proposalContext.incomingByPlayer,
    proposalOutgoingByPlayer: proposalContext.outgoingByPlayer,
    checkinMap: checkinMap,
  };
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
    actor: actor && tournamentPlayerLookup[String(actor.player_id)] ? buildDoublesActorViewModel_(actor, doublesVmContext) : null,
    rows: players
      .filter(player => isPlayerAvailableForDoublesWindow(player))
      .map(function (player) {
        return buildDoublesPlayerRowViewModel_(player, doublesVmContext);
      })
      .sort(compareDoublesRows_),
    statusNote: buildDoublesStatusNote_(tournamentStatus, validation),
    generatedAt: nowIso(),
  };
}

function getDoublesConfigViewModelFromUi(selectedPlayerId) {
  const vm = getDoublesConfigViewModel(selectedPlayerId);
  if (String(selectedPlayerId || '').trim()) {
    publishDoublesViewModelToFirebase(selectedPlayerId);
  }
  return vm;
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
    return publishRealtimeAfterDoublesMutation_(getDoublesConfigViewModel(playerId));
  }

  if (!playerId) {
    throw new Error('playerId requerido');
  }

  if (action === 'opt_into_pool') {
    optIntoPool(playerId);
    return publishRealtimeAfterDoublesMutation_(getDoublesConfigViewModel(playerId));
  }

  if (action === 'decline_doubles') {
    declineDoubles(playerId);
    return publishRealtimeAfterDoublesMutation_(getDoublesConfigViewModel(playerId));
  }

  if (action === 'confirm_partner') {
    confirmPartner(playerId);
    return publishRealtimeAfterDoublesMutation_(getDoublesConfigViewModel(playerId));
  }

  if (action === 'reject_partner') {
    rejectPartner(playerId);
    return publishRealtimeAfterDoublesMutation_(getDoublesConfigViewModel(playerId));
  }

  if (action === 'back_to_eligible') {
    clearPlayerDoublesConfig(playerId, 'eligible');
    return publishRealtimeAfterDoublesMutation_(getDoublesConfigViewModel(playerId));
  }

  throw new Error(`Accion de dobles no soportada: ${action}`);
}

function buildDoublesProposalContext_(activeProposals) {
  const proposalPlayerIds = {};
  const incomingByPlayer = {};
  const outgoingByPlayer = {};

  (activeProposals || []).forEach(function (intent) {
    const fromPlayerId = String(intent && intent.fromPlayerId || '').trim();
    const toPlayerId = String(intent && intent.toPlayerId || '').trim();
    if (!fromPlayerId || !toPlayerId) return;

    proposalPlayerIds[fromPlayerId] = true;
    proposalPlayerIds[toPlayerId] = true;

    if (!outgoingByPlayer[fromPlayerId]) outgoingByPlayer[fromPlayerId] = toPlayerId;
    if (!incomingByPlayer[toPlayerId]) incomingByPlayer[toPlayerId] = fromPlayerId;
  });

  return {
    proposalPlayerIds: proposalPlayerIds,
    incomingByPlayer: incomingByPlayer,
    outgoingByPlayer: outgoingByPlayer,
  };
}

function buildDoublesActorViewModel_(player, context) {
  const playerId = String(player.player_id || '').trim();
  const status = getEffectiveDoublesStatusForPlayer_(player, context);
  const confirmedPartnerMap = context && context.confirmedPartnerMap || {};
  const requestToMap = context && context.proposalOutgoingByPlayer || {};
  const requestFromMap = context && context.proposalIncomingByPlayer || {};
  const partnerId = String(confirmedPartnerMap[playerId] || player.doubles_partner_id || '').trim();
  const requestTo = String(requestToMap[playerId] || player.doubles_request_to || '').trim();
  const requestFrom = String(requestFromMap[playerId] || player.doubles_request_from || '').trim();

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

function buildDoublesPlayerRowViewModel_(player, context) {
  const playerId = String(player.player_id || '').trim();
  const status = getEffectiveDoublesStatusForPlayer_(player, context);
  const confirmedPartnerMap = context && context.confirmedPartnerMap || {};
  const requestToMap = context && context.proposalOutgoingByPlayer || {};
  const requestFromMap = context && context.proposalIncomingByPlayer || {};
  const partnerId = String(confirmedPartnerMap[playerId] || player.doubles_partner_id || '').trim();
  const requestTo = String(requestToMap[playerId] || player.doubles_request_to || '').trim();
  const requestFrom = String(requestFromMap[playerId] || player.doubles_request_from || '').trim();

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
  return getTournamentPlayers()
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
  if (tournamentStatus === 'doubles_fixture_ready') {
    return 'El fixture inicial ya esta montado. El siguiente paso es programar el torneo con el cronometro pausado en 00:00:00.';
  }

  if (tournamentStatus === 'doubles_scheduled') {
    return 'Los bloques iniciales ya estan programados y en scheduled. Inicia el cronometro para comenzar el torneo.';
  }

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

function buildMyDayItinerary(playerId, currentBlock) {
  const currentBlockId = currentBlock ? Number(currentBlock.block_id || 0) : 0;
  const blocks = getBlocksSorted();
  const upcomingBlocks = blocks.filter(block => {
    const blockId = Number(block.block_id || 0);
    if (currentBlockId) return blockId > currentBlockId;
    return String(block.status || '').trim() !== 'closed';
  });

  const blockEntries = upcomingBlocks
    .slice(0, 4)
    .map(block => buildMyDayItineraryBlockEntry_(block, playerId));

  const timeline = [...blockEntries];
  const syntheticEntries = buildMyDaySyntheticItineraryEntries_(blocks);

  syntheticEntries.forEach(entry => {
    if (timeline.length < 6) timeline.push(entry);
  });

  return timeline.slice(0, 6);
}

function buildMyDayBlockTimelineEntry(block, playerId) {
  return buildMyDayItineraryBlockEntry_(block, playerId);
}

function buildMyDayItineraryBlockEntry_(block, playerId) {
  const blockId = String(block.block_id || '').trim();
  const matches = getMatchesByBlock(blockId);
  const match = matches.find(item => isPlayerInMatch(item, playerId));

  if (!match) {
    return {
      kind: 'future_block',
      status: 'future',
      blockId: blockId,
      phaseType: String(block.phase_type || '').trim(),
      phaseLabel: String(block.phase_label || '').trim(),
      matchId: '',
      placeholder: buildMyDayBlockPlaceholder_(block),
      title: `Bloque ${blockId} · Espera`,
      primary: buildMyDayBlockPlaceholder_(block),
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
    kind: 'future_block',
    status: 'future',
    blockId: blockId,
    phaseType: String(block.phase_type || '').trim(),
    phaseLabel: String(block.phase_label || '').trim(),
    matchId: String(match.match_id || '').trim(),
    placeholder: '',
    role: isBye ? 'bye' : context.isReferee ? 'referee' : 'player',
    title: `Bloque ${blockId} · ${roleLabel}`,
    primary: buildTimelinePrimaryLabel_(match),
    secondary: String(block.phase_label || ''),
    tone: isBye ? 'idle' : context.isReferee ? 'referee' : 'play',
  };
}

function buildMyDaySyntheticTimelineEntries(blocks) {
  return buildMyDaySyntheticItineraryEntries_(blocks);
}

function buildMyDaySyntheticItineraryEntries_(blocks) {
  const entries = [];
  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const hasGroupsBlocks = blocks.some(block => String(block.phase_type || '').trim() === 'groups');
  const hasSinglesBlocks = blocks.some(block => String(block.phase_type || '').trim() === 'singles');

  if (!hasGroupsBlocks) {
    entries.push({
      kind: 'checkpoint',
      status: 'future',
      blockId: '',
      phaseType: 'groups',
      phaseLabel: 'Singles - Grupos',
      matchId: '',
      placeholder: 'Pendiente confirmacion',
      title: 'Checkpoint · Grupos singles',
      primary: 'Pendiente confirmación',
      secondary: 'Se asignará tras confirmar grupos',
      tone: 'checkpoint',
    });
  }

  if (!hasSinglesBlocks) {
    entries.push({
      kind: 'checkpoint',
      status: 'future',
      blockId: '',
      phaseType: 'singles',
      phaseLabel: 'Singles - Llaves',
      matchId: '',
      placeholder: 'Cruce por definir',
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
      status: 'future',
      blockId: '',
      phaseType: 'doubles',
      phaseLabel: 'Dobles - Final',
      matchId: '',
      placeholder: 'Final de dobles por definir',
      title: 'Final de dobles · Por definir',
      primary: 'Pendiente programación',
      secondary: 'Se programará después de semifinales de singles',
      tone: 'checkpoint',
    });
  }

  if (areReservedSinglesFinalsPendingBlock() || tournamentStatus === 'awaiting_singles_final') {
    entries.push({
      kind: 'checkpoint',
      status: 'future',
      blockId: '',
      phaseType: 'singles',
      phaseLabel: 'Finales de singles',
      matchId: '',
      placeholder: 'Finales por definir',
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

function buildMyDayBlockPlaceholder_(block) {
  const phaseType = String(block.phase_type || '').trim().toLowerCase();
  const phaseLabel = String(block.phase_label || '').trim();

  if (phaseType === 'groups') return 'Partido de grupos por definir';
  if (phaseType === 'singles') return `Cruce por definir${phaseLabel ? ` · ${phaseLabel}` : ''}`;
  if (phaseType === 'doubles') return `Partido por definir${phaseLabel ? ` · ${phaseLabel}` : ''}`;
  return phaseLabel || 'Compromiso por definir';
}

function getAdminControlViewModel() {
  const currentBlock = getCurrentBlock();
  const triggerStatus = getTournamentClockTriggerStatus();
  const clock = buildTournamentClockPayload_();
  const timeState = buildPublicTimeState_(currentBlock);
  const doublesSummary = getDoublesStatusSummary();
  const matches = getRows('Matches');
  const tournamentStatus = String(getConfigValue('tournament_status') || '').trim();
  const timing = getBlockTimingConfig();
  const canConfirmGroups = tournamentStatus === 'awaiting_singles_group_confirmation';
  const canScheduleDoublesFinal = isReservedDoublesFinalPendingBlock();

  return {
    tournamentStatus: tournamentStatus,
    timeState: timeState,
    tournamentStartTs: clock.tournamentStartTs,
    internalClockNowTs: clock.internalNowTs,
    realNowTs: clock.realNowTs,
    clockElapsedMs: Number(clock.elapsedMs || 0),
    clockIsRunning: !!clock.isRunning,
    clockLastResumeRealTs: clock.lastResumeRealTs,
    clockLastProcessedInternalTs: clock.lastProcessedInternalTs,
    clockHealth: clock.clockHealth,
    clockHealthMessage: clock.clockHealthMessage,
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
      scheduledMinutes: timing.scheduledMinutes,
      playMinutes: timing.playMinutes,
      closeMinutes: timing.closeMinutes,
      transitionMinutes: timing.transitionMinutes,
      totalMinutes: getBlockTotalMinutes(),
    },
    doublesSummary: doublesSummary,
    trigger: triggerStatus,
    publish: {
      lastRunAt: normalizeDateTimeText(getConfigValue('clock_publish_last_run_at')),
      lastStatus: String(getConfigValue('clock_publish_last_status') || '').trim(),
      lastError: String(getConfigValue('clock_publish_last_error') || '').trim(),
      lastSnapshotVersion: String(getConfigValue('clock_publish_last_snapshot_version') || '').trim(),
    },
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
  resetTournamentInternalClock(normalized);
  return publishStructuralRealtimeAfterMutation_(getAdminControlViewModel());
}

function setTournamentStartNowFromUi() {
  const value = nowIso();
  setConfigValue('tournament_start_ts', value, 'Hora base del torneo');
  resetTournamentInternalClock(value);
  return publishStructuralRealtimeAfterMutation_(getAdminControlViewModel());
}

function initializeTournamentFlowV2FromUi() {
  initializeTournamentFlowV2();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = 'Reset V2 aplicado. Base limpia, ventana de dobles abierta y cronometro pausado en 00:00:00.';
  // Reset V2 reabre la ventana de dobles; republish inmediato evita que la UI
  // siga montada sobre view models previos mientras Firebase ya limpio check-in/intents.
  publishAllDoublesViewModelsToFirebase();
  return publishStructuralRealtimeAfterMutation_(vm);
}

function resetTournamentSheetsPhaseFromUi() {
  prepareTournamentFlowV2ResetClockState_();
  resetTournamentFlowV2();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = 'Fase 1/3 completada. Sheets quedó limpia y el cronometro pausado en 00:00:00.';
  return vm;
}

function resetTournamentFirebasePhaseFromUi() {
  clearTournamentRealtimeStateForReset_();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = 'Fase 2/3 completada. Firebase quedó limpio para reiniciar la ventana operativa.';
  return vm;
}

function bootstrapTournamentResetPhaseFromUi() {
  openDoublesConfirmationWindow();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = 'Fase 3/3 completada. La ventana de dobles quedó reabierta y operativa.';
  publishTournamentResetBootstrapRealtime_();
  return vm;
}

function seedDemoDoublesConfigFromUi() {
  seedDemoDoublesConfiguration_();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = 'Parejas demo generadas. El siguiente paso es montar el fixture de dobles.';
  return publishRealtimeSnapshotAfterMutation_(vm);
}

function generateDoublesFixtureFromUi() {
  const validation = validateDoublesCut();
  if (!validation.ok) {
    throw new Error(validation.errors.join(' '));
  }

  const matchCount = generateDoublesFixtureFromCut();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = matchCount
    ? `Fixture de dobles generado con ${matchCount} partidos. Ahora puedes programar el torneo.`
    : 'El fixture de dobles ya estaba generado.';
  return publishStructuralRealtimeAfterMutation_(vm);
}

function programDoublesTournamentFromUi() {
  const blockId = scheduleInitialDoublesTournament();
  if (!blockId) {
    throw new Error('No hay fixture de dobles pendiente para programar.');
  }

  removeTournamentClockTriggers();
  resetTournamentInternalClock();
  pauseTournamentInternalClock();
  setConfigValue('clock_trigger_last_run_at', '', 'Ultima ejecucion del reloj');
  setConfigValue('clock_trigger_last_error', '', 'Ultimo error del reloj');
  setConfigValue('clock_last_processed_internal_ts', '', 'Ultimo tiempo interno procesado por el motor');
  setConfigValue('clock_publish_last_run_at', '', 'Ultimo intento de publish realtime');
  setConfigValue('clock_publish_last_status', '', 'Estado del ultimo publish realtime');
  setConfigValue('clock_publish_last_error', '', 'Ultimo error del publish realtime');
  setConfigValue('clock_publish_last_snapshot_version', '', 'Ultima version publicada en realtime');

  const vm = getAdminControlViewModel();
  vm.lastActionMessage = `Torneo programado. Bloque ${blockId} queda scheduled con cronometro en 00:00:00 y pausado.`;
  return publishStructuralRealtimeAfterMutation_(vm);
}

function runTournamentClockNowFromUi() {
  runTournamentClockManualTick();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = 'Tick silencioso ejecutado manualmente. El motor avanzo sin publicar snapshot publico.';
  return vm;
}

function runControlHeartbeatFromUi() {
  const result = runTournamentClockManualTick();
  return {
    ok: !!(result && result.ok),
    tickResult: result ? result.tickResult || null : null,
    publishResult: result ? result.publishResult || null : null,
    timeState: buildPublicTimeState_(getCurrentBlock()),
    clock: buildTournamentClockPayload_(),
    generatedAt: nowIso(),
  };
}

function buildPublicTimeState_(currentBlock) {
  const clockState = getTournamentClockState_();
  const serverNowTs = normalizeDateTimeText(clockState.realNowTs || nowIso());
  const tournamentStartTs = normalizeDateTimeText(clockState.startTs);
  const tournamentNowTs = normalizeDateTimeText(clockState.internalNowTs);
  const serverNowDate = parseBlockDate(serverNowTs);
  const tournamentNowDate = parseBlockDate(tournamentNowTs);
  const tournamentStartDate = parseBlockDate(tournamentStartTs);
  const serverNowMs = serverNowDate ? serverNowDate.getTime() : 0;
  const tournamentStartMs = tournamentStartDate ? tournamentStartDate.getTime() : 0;
  const tournamentNowMs = tournamentNowDate ? tournamentNowDate.getTime() : 0;
  const currentPhase = getPublicCurrentPhaseCode_(currentBlock, tournamentNowMs);
  const tournamentElapsedMs = Number(clockState.elapsedMs || 0);
  const pausedAccumulatedMs = serverNowMs && tournamentStartMs
    ? Math.max(0, serverNowMs - tournamentStartMs - tournamentElapsedMs)
    : 0;

  return {
    timerStatus: clockState.isRunning ? 'running' : 'paused',
    serverNowTs: serverNowTs,
    serverNowMs: serverNowMs,
    tournamentStartTs: tournamentStartTs,
    tournamentStartMs: tournamentStartMs,
    tournamentNowTs: tournamentNowTs,
    tournamentNowMs: tournamentNowMs,
    tournamentElapsedMs: tournamentElapsedMs,
    pausedAccumulatedMs: pausedAccumulatedMs,
    currentBlockId: currentBlock ? String(currentBlock.block_id || '').trim() : '',
    currentPhase: currentPhase,
    phaseRemainingMs: getPublicPhaseRemainingMs_(currentBlock, tournamentNowMs, currentPhase),
    phaseSequence: ['scheduled', 'live', 'closing', 'transition'],
    phases: buildPublicPhaseMap_(currentBlock),
  };
}

function buildPublicPhaseMap_(currentBlock) {
  if (!currentBlock) return {};

  const timing = getBlockTimingConfig();

  const startMs = getBlockTimestampMs_(currentBlock.start_ts);
  const closeMs = getBlockTimestampMs_(currentBlock.close_signal_ts);
  const hardMs = getBlockTimestampMs_(currentBlock.hard_close_ts);
  const endMs = getBlockTimestampMs_(currentBlock.end_ts);

  return {
    scheduled: { durationMs: Math.max(0, Number(timing.scheduledMinutes || 0) * 60 * 1000) },
    live: { durationMs: startMs && closeMs ? Math.max(0, closeMs - startMs) : 0 },
    closing: { durationMs: closeMs && hardMs ? Math.max(0, hardMs - closeMs) : 0 },
    transition: { durationMs: hardMs && endMs ? Math.max(0, endMs - hardMs) : 0 },
  };
}

function getPublicCurrentPhaseCode_(currentBlock, tournamentNowMs) {
  if (!currentBlock || !tournamentNowMs) return '';

  const startMs = getBlockTimestampMs_(currentBlock.start_ts);
  const closeMs = getBlockTimestampMs_(currentBlock.close_signal_ts);
  const hardMs = getBlockTimestampMs_(currentBlock.hard_close_ts);
  const endMs = getBlockTimestampMs_(currentBlock.end_ts);

  if (!startMs || tournamentNowMs < startMs) return 'scheduled';
  if (closeMs && tournamentNowMs < closeMs) return 'live';
  if (hardMs && tournamentNowMs < hardMs) return 'closing';
  if (endMs && tournamentNowMs < endMs) return 'transition';
  if (endMs && tournamentNowMs >= endMs) return 'closed';
  return '';
}

function getPublicPhaseRemainingMs_(currentBlock, tournamentNowMs, phaseCode) {
  if (!currentBlock || !tournamentNowMs || !phaseCode) return 0;

  const startMs = getBlockTimestampMs_(currentBlock.start_ts);
  const closeMs = getBlockTimestampMs_(currentBlock.close_signal_ts);
  const hardMs = getBlockTimestampMs_(currentBlock.hard_close_ts);
  const endMs = getBlockTimestampMs_(currentBlock.end_ts);

  if (phaseCode === 'scheduled' && startMs) return Math.max(0, startMs - tournamentNowMs);
  if (phaseCode === 'live' && closeMs) return Math.max(0, closeMs - tournamentNowMs);
  if (phaseCode === 'closing' && hardMs) return Math.max(0, hardMs - tournamentNowMs);
  if (phaseCode === 'transition' && endMs) return Math.max(0, endMs - tournamentNowMs);
  return 0;
}

function getBlockTimestampMs_(value) {
  const parsed = parseBlockDate(value);
  return parsed ? parsed.getTime() : 0;
}

function syncTournamentClockHeartbeatFromUi() {
  return buildTournamentClockPayload_();
}

function setClockTriggerEnabledFromUi(enabled) {
  const nextValue = !!enabled;

  if (nextValue) {
    resumeTournamentInternalClock();
  } else {
    pauseTournamentInternalClock();
  }

  const vm = getAdminControlViewModel();
  vm.lastActionMessage = nextValue
    ? 'Cronometro iniciado. El reloj logico ya corre y se publico el estado de tiempo.'
    : 'Cronometro pausado. El reloj logico queda congelado y se publico el estado de tiempo.';
  publishPublicTimeStateToFirebase();
  return vm;
}

function setAutoTriggerForTestFromUi(enabled) {
  const nextValue = !!enabled;

  if (nextValue) {
    const triggerStatus = getTournamentClockTriggerStatus();
    if (Number(triggerStatus.triggerCount || 0) === 0) {
      installTournamentClockTrigger();
    } else {
      setConfigValue('clock_trigger_enabled', true, 'Habilita el trigger automatico del reloj');
    }
  } else {
    removeTournamentClockTriggers();
  }

  const vm = getAdminControlViewModel();
  vm.lastActionMessage = nextValue ? 'Trigger automatico restaurado.' : 'Trigger automatico desactivado.';
  return publishRealtimeSnapshotAfterMutation_(vm);
}

function confirmSinglesGroupsFromUi() {
  confirmSinglesGroupsAndStartGroupStage();
  const vm = getAdminControlViewModel();
  vm.lastActionMessage = 'Grupos confirmados. Fase de grupos iniciada.';
  return publishStructuralRealtimeAfterMutation_(vm);
}

function scheduleDoublesFinalFromUi() {
  const blockId = createDoublesFinalBlockIfNeeded();
  if (!blockId) {
    throw new Error('No hay final de dobles reservada pendiente de bloque.');
  }

  const vm = getAdminControlViewModel();
  vm.lastActionMessage = `Final de dobles programada en bloque ${blockId}.`;
  return publishStructuralRealtimeAfterMutation_(vm);
}

function startDemoTournamentNowFromUi() {
  const startTs = nowIso();
  setConfigValue('tournament_start_ts', startTs, 'Hora base del torneo');
  resetTournamentInternalClock(startTs);
  initializeTournamentFlowV2();
  seedDemoDoublesConfiguration_();

  const validation = validateDoublesCut();
  if (!validation.ok) {
    throw new Error(validation.errors.join(' '));
  }

  const blockId = setupDoublesStageFromCut();
  runTickAndPublishRealtime();
  publishAllMyDayViewModelsToFirebase();

  const vm = getAdminControlViewModel();
  vm.lastActionMessage = blockId
    ? `Simulacion iniciada. Bloque de dobles ${blockId} listo y reloj ejecutado.`
    : 'Simulacion iniciada sin bloque de dobles.';
  return vm;
}

function publishRealtimeSnapshotAfterMutation_(result, playerIds) {
  publishRealtimeSnapshotToFirebase();
  publishPlayerSelectorOptionsToFirebase();
  publishInformationalViewsToFirebase();
  if (playerIds && playerIds.length) {
    publishPlayerRealtimeViewsToFirebase(playerIds);
  }
  return result;
}

function publishStructuralRealtimeAfterMutation_(result) {
  publishRealtimeSnapshotToFirebase();
  publishPlayerSelectorOptionsToFirebase();
  publishInformationalViewsToFirebase();
  publishAllMyDayViewModelsToFirebase();
  return result;
}

function publishRealtimeAfterDoublesMutation_(result) {
  publishRealtimeSnapshotToFirebase();
  publishPlayerSelectorOptionsToFirebase();
  publishInformationalViewsToFirebase();
  publishAllDoublesViewModelsToFirebase();
  return result;
}

function clearTournamentRealtimeStateForReset_() {
  return patchFirebaseNodes_({
    partidos: null,
    system: null,
    players: null,
    doubles: null,
    views: null,
    submissions: null,
    'control/heartbeatLease': null,
  });
}

function publishTournamentResetBootstrapRealtime_() {
  publishRealtimeSnapshotToFirebase();
  publishPlayerSelectorOptionsToFirebase();
  publishInformationalViewsToFirebase();
}

function processPendingDoublesConfigIntents_() {
  const cleanupResult = cleanupExpiredDoublesProposalIntents_();
  return {
    processedCount: Number(cleanupResult && cleanupResult.removedCount || 0),
    impactedPlayerIds: Array.isArray(cleanupResult && cleanupResult.impactedPlayerIds)
      ? cleanupResult.impactedPlayerIds
      : [],
    results: [],
  };
}

function processPendingMatchSubmissions_() {
  const pending = readFirebaseNode_('submissions/pending');
  if (!pending || typeof pending !== 'object') {
    return {
      processedCount: 0,
      impactedPlayerIds: [],
      results: [],
    };
  }

  const entries = Object.keys(pending)
    .map(function (submissionId) {
      const payload = pending[submissionId] && typeof pending[submissionId] === 'object'
        ? pending[submissionId]
        : {};
      return {
        submissionId: submissionId,
        payload: payload,
        createdAtMs: Number(payload.createdAtMs || 0),
      };
    })
    .sort(function (left, right) {
      const leftTime = Number(left.createdAtMs || 0);
      const rightTime = Number(right.createdAtMs || 0);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.submissionId || '').localeCompare(String(right.submissionId || ''));
    });

  const impactedPlayerIds = [];
  const results = [];

  entries.forEach(function (entry) {
    const result = processSinglePendingMatchSubmission_(entry.submissionId, entry.payload);
    results.push(result);
    (result.impactedPlayerIds || []).forEach(function (playerId) {
      const normalizedPlayerId = normalizeRealtimePlayerIdSafe_(playerId);
      if (normalizedPlayerId) impactedPlayerIds.push(normalizedPlayerId);
    });
  });

  return {
    processedCount: results.length,
    impactedPlayerIds: impactedPlayerIds.filter(onlyUnique_),
    results: results,
  };
}

function processSinglePendingMatchSubmission_(submissionId, payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const matchId = String(data.matchId || '').trim();
  const mode = String(data.mode || '').trim();
  const actorPlayerId = String(data.actorPlayerId || '').trim();
  const actorRole = String(data.actorRole || '').trim();
  const result = {
    submissionId: String(submissionId || '').trim(),
    matchId: matchId,
    mode: mode,
    actorPlayerId: actorPlayerId,
    actorRole: actorRole,
    createdAt: String(data.createdAt || '').trim(),
    createdAtMs: Number(data.createdAtMs || 0),
    status: 'rejected',
    error: '',
    processedAt: nowIso(),
    impactedPlayerIds: [],
  };

  try {
    writeFirebaseNode_(`submissions/status/${result.submissionId}`, {
      submissionId: result.submissionId,
      matchId: matchId,
      mode: mode,
      status: 'processing',
      actorPlayerId: actorPlayerId,
      actorRole: actorRole,
      updatedAt: nowIso(),
    });
    writeFirebaseNode_(`submissions/byMatch/${matchId}/${result.submissionId}`, {
      submissionId: result.submissionId,
      matchId: matchId,
      mode: mode,
      status: 'processing',
      actorPlayerId: actorPlayerId,
      actorRole: actorRole,
      createdAt: result.createdAt,
      createdAtMs: result.createdAtMs,
      updatedAt: nowIso(),
    });

    const match = getMatchById(matchId);
    if (!match) {
      throw new Error(`No existe el match_id=${matchId}`);
    }

    const impactedPlayerIds = [
      match.player_a_id,
      match.player_b_id,
      match.referee_player_id,
    ]
      .map(function (playerId) {
        return normalizeRealtimePlayerIdSafe_(playerId);
      })
      .filter(Boolean)
      .filter(onlyUnique_);

    validateQueuedMatchSubmissionContext_(match, data);

    if (mode === 'final') {
      const setsA = Number(data.setsA);
      const setsB = Number(data.setsB);

      if (Number.isNaN(setsA) || Number.isNaN(setsB)) {
        throw new Error('Sets invalidos para resultado final.');
      }

      submitMatchResult(matchId, {
        mode: 'final',
        sets_a: setsA,
        sets_b: setsB,
        submitted_by: actorPlayerId || 'ui-user',
        submitted_by_role: actorRole || 'player',
      });
    } else if (mode === 'closing_state') {
      const closingState = String(data.closingState || '').trim();

      submitMatchResult(matchId, {
        mode: 'closing_state',
        closing_state: closingState,
        submitted_by: actorPlayerId || 'ui-user',
        submitted_by_role: actorRole || 'player',
      });
    } else {
      throw new Error(`mode no soportado: ${mode}`);
    }

    result.status = 'processed';
    result.impactedPlayerIds = impactedPlayerIds;
  } catch (error) {
    result.status = 'rejected';
    result.error = error && error.message ? error.message : String(error);
  } finally {
    writeFirebaseNode_(`submissions/status/${result.submissionId}`, {
      submissionId: result.submissionId,
      matchId: result.matchId,
      mode: result.mode,
      status: result.status,
      error: result.error,
      actorPlayerId: result.actorPlayerId,
      actorRole: result.actorRole,
      impactedPlayerIds: result.impactedPlayerIds,
      updatedAt: nowIso(),
      processedAt: result.processedAt,
    });
    writeFirebaseNode_(`submissions/history/${result.submissionId}`, result);
    deleteFirebaseNode_(`submissions/byMatch/${result.matchId}/${result.submissionId}`);
    deleteFirebaseNode_(`submissions/pending/${result.submissionId}`);
  }

  return result;
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

  const eligible = getBaseEligiblePlayersForDoubles().filter(player =>
    String(player.doubles_status || '') === 'eligible'
  );

  if (!eligible.length) {
    throw new Error('No hay jugadores elegibles para armar el helper de dobles demo.');
  }

  eligible.forEach(function (player) {
    optIntoPool(player.player_id);
  });
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
  const impactedPlayerIds = match
    ? [
        match.player_a_id,
        match.player_b_id,
        match.referee_player_id,
      ]
    : [];

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

    return publishRealtimeSnapshotAfterMutation_({ ok: true }, impactedPlayerIds);
  }

  if (mode === 'closing_state') {
    const closingState = String(data.closingState || '').trim();

    submitMatchResult(matchId, {
      mode: 'closing_state',
      closing_state: closingState,
      submitted_by: actorPlayerId || 'ui-user',
      submitted_by_role: actorRole || 'player',
    });

    return publishRealtimeSnapshotAfterMutation_({ ok: true }, impactedPlayerIds);
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

function validateQueuedMatchSubmissionContext_(match, payload) {
  const data = payload || {};
  const mode = String(data.mode || '').trim();
  const actorPlayerId = String(data.actorPlayerId || '').trim();
  const actorRole = String(data.actorRole || '').trim();
  const submittedBlockId = String(data.blockId || '').trim();
  const submittedVisualStatus = String(data.visualStatusAtSubmit || '').trim();
  const submittedInternalTs = normalizeDateTimeText(data.submittedAtInternalTs);
  const matchBlockId = String(match && match.block_id || '').trim();
  const playerContext = buildPlayerMatchContext(match, actorPlayerId);
  const isReferee = playerContext.isReferee;
  const isPlayer = playerContext.isPlayerA || playerContext.isPlayerB;
  const role = String(actorRole || '').trim();
  const block = matchBlockId ? getBlockById(matchBlockId) : null;
  const hardCloseTs = normalizeDateTimeText(block && block.hard_close_ts);

  if (!submittedBlockId || submittedBlockId !== matchBlockId) {
    throw new Error('La submission no corresponde al bloque del partido.');
  }

  if (submittedVisualStatus !== 'En juego' && submittedVisualStatus !== 'Cierre en curso') {
    throw new Error('La submission fue creada fuera de una ventana valida de captura.');
  }

  if (submittedInternalTs && hardCloseTs && submittedInternalTs > hardCloseTs) {
    throw new Error('La submission fue creada despues del hard close del bloque.');
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

function mapMatchForPublicView(match, currentBlock) {
  const phaseType = String(match.phase_type || '').trim();
  const leftLabel = resolveCompetitorLabel(match.player_a_id, phaseType);
  const rightLabel = resolveCompetitorLabel(match.player_b_id, phaseType);
  const refereeLabel = resolvePlayerDisplayName(match.referee_player_id);
  const playerAPlayerIds = resolveMatchParticipantPlayerIds_(match.player_a_id, phaseType);
  const playerBPlayerIds = resolveMatchParticipantPlayerIds_(match.player_b_id, phaseType);

  return {
    matchId: String(match.match_id || ''),
    tableNo: match.table_no,
    phaseType,
    phaseLabel: buildPublicPhaseLabel(match),
    leftLabel,
    rightLabel,
    matchupLabel: buildMatchupLabel(match),
    refereeLabel: refereeLabel ? `Árbitro: ${refereeLabel}` : '',
    playerAId: String(match.player_a_id || '').trim(),
    playerBId: String(match.player_b_id || '').trim(),
    refereePlayerId: String(match.referee_player_id || '').trim(),
    playerAPlayerIds: playerAPlayerIds,
    playerBPlayerIds: playerBPlayerIds,
    eventState: buildPublicMatchEventState_(match),
    setsA: valueForClient(match.sets_a),
    setsB: valueForClient(match.sets_b),
  };
}

function resolveMatchParticipantPlayerIds_(entryId, phaseType) {
  const normalizedId = String(entryId || '').trim();
  if (!normalizedId) return [];

  if (String(phaseType || '').trim() === 'doubles') {
    const team = getDoublesTeamById(normalizedId);
    if (!team) return [];

    return [team.player_1_id, team.player_2_id]
      .map(function (playerId) {
        return String(playerId || '').trim();
      })
      .filter(Boolean);
  }

  return [normalizedId];
}

function buildPublicMatchEventState_(match) {
  const rawStatus = String(match && match.status || '').trim();
  const resultMode = String(match && match.result_mode || '').trim();
  const closingState = String(match && match.closing_state || '').trim();

  return {
    resultSubmitted: rawStatus === 'result_submitted',
    autoClosed: rawStatus === 'auto_closed',
    walkover: resultMode === 'wo' || closingState === 'wo',
    tableBlocked: resultMode === 'table_blocked' || closingState === 'table_blocked',
    needsReview: !!(match && match.needs_review),
    resultMode: resultMode,
    closingState: closingState,
  };
}

function buildPublicPhaseLabel(match) {
  const phaseType = String(match.phase_type || '').trim();
  const bracketType = String(match.bracket_type || '').trim();
  const roundNo = Number(match.round_no || 0);
  const stage = String(match.stage || '').trim().toLowerCase();
  const stageRoundLabel = (
    stage === 'doubles_final' ||
    stage === 'oro_final' ||
    stage === 'plata_final' ||
    stage === 'cobre_final'
  ) ? 'Final' : '';
  const roundLabel = getVisibleRoundLabel_(String(match.round_label || '').trim()) || stageRoundLabel;

  if (phaseType === 'doubles') {
    return roundLabel ? `Dobles - ${roundLabel}` : `Dobles - Ronda ${roundNo || '-'}`;
  }

  if (phaseType === 'groups') {
    return `Singles - Grupos - R${roundNo || '-'}`;
  }

  if (phaseType === 'singles') {
    const name = bracketType ? capitalize(bracketType) : 'Singles';
    return roundLabel ? `${name} - ${roundLabel}` : `${name} - Ronda ${roundNo || '-'}`;
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

function mapMatchStatusLabel(status, currentBlock) {
  const value = String(status || '').trim();
  const blockStatus = String(currentBlock && currentBlock.status || '').trim();

  if (blockStatus === 'scheduled') return 'Programado';
  if (blockStatus === 'closing' && value === 'live') return 'Cierre en curso';
  if (blockStatus === 'transition') return 'Cerrado/Terminado';
  if (blockStatus === 'closed') return 'Bloque cerrado';

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
