const FIREBASE_RTDB_BASE_URL = 'https://appttour-default-rtdb.firebaseio.com';
const FIREBASE_RTDB_AUTH_TOKEN = 'lt5kKHnJGZMrT0pL2ZxokPLk8zFzu22G9VlmQ8ws';

function publishPartidosToFirebase() {
  return publishPartidosSnapshotToFirebase();
}

function publishRealtimeSnapshotToFirebase() {
  const attemptAt = nowIso();
  setConfigValue('clock_publish_last_run_at', attemptAt, 'Ultimo intento de publish realtime');

  try {
    const snapshot = buildRealtimeSnapshotPayload_();
    const publicResponse = writeFirebaseNode_('partidos', snapshot.partidos);
    const systemResponse = writeFirebaseNode_('system', snapshot.system);

    setConfigValue('clock_publish_last_status', 'ok', 'Estado del ultimo publish realtime');
    setConfigValue('clock_publish_last_error', '', 'Ultimo error del publish realtime');
    setConfigValue('clock_publish_last_snapshot_version', snapshot.system.snapshotVersion, 'Ultima version publicada en realtime');

    return {
      ok: true,
      generatedAt: snapshot.system.lastPublishedAt,
      snapshotVersion: snapshot.system.snapshotVersion,
      tournamentStatus: snapshot.system.tournamentStatus,
      currentBlockId: snapshot.system.currentBlock ? snapshot.system.currentBlock.id : '',
      publishedMatches: snapshot.partidos.matches.length,
      statusCodes: {
        partidos: publicResponse.statusCode,
        system: systemResponse.statusCode,
      },
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    setConfigValue('clock_publish_last_status', 'error', 'Estado del ultimo publish realtime');
    setConfigValue('clock_publish_last_error', message, 'Ultimo error del publish realtime');
    throw error;
  }
}

function publishPartidosSnapshotToFirebase() {
  const snapshot = buildRealtimeSnapshotPayload_();
  const publicResponse = writeFirebaseNode_('partidos', snapshot.partidos);

  return {
    ok: true,
    generatedAt: snapshot.partidos.generatedAt,
    snapshotVersion: snapshot.partidos.snapshotVersion,
    tournamentStatus: snapshot.partidos.tournamentStatus,
    currentBlockId: snapshot.partidos.currentBlock ? snapshot.partidos.currentBlock.id : '',
    publishedMatches: snapshot.partidos.matches.length,
    statusCodes: {
      partidos: publicResponse.statusCode,
    },
  };
}

function publishPublicTimeStateToFirebase() {
  const currentBlock = getCurrentBlock();
  const timeState = buildPublicTimeState_(currentBlock);
  const partidosTimeStateResponse = writeFirebaseNode_('partidos/timeState', sanitizePublicTimeStateForFirebase_(timeState));
  const systemTimeStateResponse = writeFirebaseNode_('system/timeState', sanitizePublicTimeStateForFirebase_(timeState));

  return {
    ok: true,
    timerStatus: String(timeState.timerStatus || '').trim(),
    currentPhase: String(timeState.currentPhase || '').trim(),
    tournamentNowTs: String(timeState.tournamentNowTs || '').trim(),
    currentBlockId: String(timeState.currentBlockId || '').trim(),
    statusCodes: {
      partidosTimeState: partidosTimeStateResponse.statusCode,
      systemTimeState: systemTimeStateResponse.statusCode,
    },
  };
}

function buildRealtimeSnapshotPayload_() {
  const publicVm = getPublicViewModel();
  const generatedAt = String(publicVm.generatedAt || nowIso()).trim();
  const snapshotVersion = String(publicVm.snapshotVersion || Date.now());
  const clock = buildTournamentClockPayload_();

  return {
    partidos: buildPartidosFirebasePayload_(publicVm),
    system: {
      tournamentStatus: String(publicVm.tournamentStatus || '').trim(),
      currentBlock: publicVm.currentBlock || null,
      clock: clock,
      snapshotVersion: snapshotVersion,
      lastPublishedAt: generatedAt,
      processedAtInternal: String(clock.lastProcessedInternalTs || clock.internalNowTs || '').trim(),
      source: 'gas',
    },
  };
}

function publishMyDayViewModelToFirebase(playerId) {
  const normalizedPlayerId = normalizeRealtimePlayerId_(playerId);
  const vm = getMyDayViewModel(normalizedPlayerId);

  writeFirebaseNode_(`players/${normalizedPlayerId}/myDay`, vm);
  writeFirebaseNode_(`players/${normalizedPlayerId}/meta`, {
    playerId: normalizedPlayerId,
    updatedAt: nowIso(),
    source: 'gas',
  });

  return {
    ok: true,
    playerId: normalizedPlayerId,
    generatedAt: String(vm.generatedAt || '').trim(),
  };
}

function publishDoublesViewModelToFirebase(playerId) {
  const normalizedPlayerId = normalizeRealtimePlayerId_(playerId);
  const vm = getDoublesConfigViewModel(normalizedPlayerId);

  writeFirebaseNode_(`doubles/viewModels/${normalizedPlayerId}`, vm);

  return {
    ok: true,
    playerId: normalizedPlayerId,
    generatedAt: String(vm.generatedAt || '').trim(),
  };
}

function publishPlayerRealtimeViewsToFirebase(playerIds) {
  const ids = Array.isArray(playerIds) ? playerIds : [playerIds];
  const normalizedIds = ids
    .map(normalizeRealtimePlayerIdSafe_)
    .filter(Boolean)
    .filter(onlyUnique_);

  return normalizedIds.map(function (playerId) {
    const myDayResult = publishMyDayViewModelToFirebase(playerId);
    const doublesResult = publishDoublesViewModelToFirebase(playerId);
    return {
      playerId: playerId,
      myDayGeneratedAt: myDayResult.generatedAt,
      doublesGeneratedAt: doublesResult.generatedAt,
    };
  });
}

function publishPlayerSelectorOptionsToFirebase() {
  const options = getCheckedInPlayersForSelector();
  const payload = {
    options: options,
    generatedAt: nowIso(),
    snapshotVersion: String(Date.now()),
    source: 'gas',
  };

  writeFirebaseNode_('players/selectorOptions', payload);

  return {
    ok: true,
    count: options.length,
    generatedAt: payload.generatedAt,
    snapshotVersion: payload.snapshotVersion,
  };
}

function publishAllMyDayViewModelsToFirebase() {
  const normalizedIds = getCheckedInPlayersForSelector()
    .map(function (player) {
      return normalizeRealtimePlayerIdSafe_(player && player.id);
    })
    .filter(Boolean)
    .filter(onlyUnique_);

  return normalizedIds.map(function (playerId) {
    return publishMyDayViewModelToFirebase(playerId);
  });
}

function publishRealtimeDebugForPlayer(playerId) {
  const normalizedPlayerId = normalizeRealtimePlayerId_(playerId);
  const snapshotResult = publishRealtimeSnapshotToFirebase();
  const selectorResult = publishPlayerSelectorOptionsToFirebase();
  const playerResults = publishPlayerRealtimeViewsToFirebase([normalizedPlayerId]);

  return {
    ok: true,
    debugPlayerId: normalizedPlayerId,
    snapshot: snapshotResult,
    selector: selectorResult,
    playerViews: playerResults,
  };
}

function publishRealtimeDebugForFirstCheckedInPlayer() {
  const players = getCheckedInPlayersForSelector();
  if (!players || !players.length) {
    throw new Error('No hay jugadores checked-in para publicar un snapshot realtime de debug.');
  }

  const firstPlayerId = String(players[0] && players[0].id || '').trim();
  if (!firstPlayerId) {
    throw new Error('El primer jugador checked-in no tiene playerId valido.');
  }

  return publishRealtimeDebugForPlayer(firstPlayerId);
}

function diagnoseRealtimePublicLag(blockId) {
  const resolvedBlock = resolveDiagnosticBlock_(blockId);
  const resolvedBlockId = String(resolvedBlock && resolvedBlock.block_id || '').trim();
  const rawMatches = resolvedBlockId ? getMatchesByBlock(resolvedBlockId) : [];
  const publicVm = getPublicViewModel();
  const publicPayload = buildPartidosFirebasePayload_(publicVm);
  const publicMatchLookup = {};

  (publicPayload.matches || []).forEach(function (match) {
    const matchId = String(match && match.matchId || '').trim();
    if (!matchId) return;
    publicMatchLookup[matchId] = match;
  });

  return {
    capturedAt: nowIso(),
    tournamentStatus: String(getConfigValue('tournament_status') || '').trim(),
    clock: buildTournamentClockPayload_(),
    currentBlock: publicVm.currentBlock || null,
    inspectedBlock: resolvedBlock
      ? {
          id: String(resolvedBlock.block_id || '').trim(),
          phaseType: String(resolvedBlock.phase_type || '').trim(),
          phaseLabel: String(resolvedBlock.phase_label || '').trim(),
          status: String(resolvedBlock.status || '').trim(),
          startTs: serializeDateForClient(resolvedBlock.start_ts),
          closeSignalTs: serializeDateForClient(resolvedBlock.close_signal_ts),
          hardCloseTs: serializeDateForClient(resolvedBlock.hard_close_ts),
          endTs: serializeDateForClient(resolvedBlock.end_ts),
        }
      : null,
    publicPayload: {
      generatedAt: publicPayload.generatedAt,
      currentBlock: publicPayload.currentBlock || null,
      matchCount: Array.isArray(publicPayload.matches) ? publicPayload.matches.length : 0,
    },
    matches: rawMatches.map(function (match) {
      const matchId = String(match && match.match_id || '').trim();
      const publicMatch = publicMatchLookup[matchId] || null;

      return {
        matchId: matchId,
        tableNo: valueForClient(match.table_no),
        rawStatus: String(match.status || '').trim(),
        rawResultMode: String(match.result_mode || '').trim(),
        rawClosingState: String(match.closing_state || '').trim(),
        rawSetsA: valueForClient(match.sets_a),
        rawSetsB: valueForClient(match.sets_b),
        publicStatus: publicMatch ? String(publicMatch.status || '').trim() : '',
        publicResultMode: publicMatch ? String(publicMatch.resultMode || '').trim() : '',
        publicClosingState: publicMatch ? String(publicMatch.closingState || '').trim() : '',
        appearsInPublicPayload: !!publicMatch,
      };
    }),
  };
}

function diagnoseCurrentBlockRealtimePublicLag() {
  return diagnoseRealtimePublicLag('');
}

function logCurrentBlockRealtimePublicLag() {
  const diagnostic = diagnoseCurrentBlockRealtimePublicLag();
  Logger.log(JSON.stringify(diagnostic, null, 2));
  return diagnostic;
}

function logRealtimePublicLag(blockId) {
  const diagnostic = diagnoseRealtimePublicLag(blockId);
  Logger.log(JSON.stringify(diagnostic, null, 2));
  return diagnostic;
}

function buildPartidosFirebasePayload_(publicVm) {
  const vm = publicVm || {};
  const matches = Array.isArray(vm.matches) ? vm.matches : [];

  return {
    tournamentStatus: String(vm.tournamentStatus || '').trim(),
    currentBlock: sanitizePublicCurrentBlockForFirebase_(vm.currentBlock),
    timeState: sanitizePublicTimeStateForFirebase_(vm.timeState),
    clock: vm.clock || null,
    generatedAt: String(vm.generatedAt || '').trim(),
    snapshotVersion: String(vm.snapshotVersion || vm.generatedAt || '').trim(),
    source: 'gas',
    matches: matches.map(function (match) {
      return {
        matchId: String(match && match.matchId || '').trim(),
        tableNo: match && Object.prototype.hasOwnProperty.call(match, 'tableNo') ? match.tableNo : '',
        phaseType: String(match && match.phaseType || '').trim(),
        phaseLabel: String(match && match.phaseLabel || '').trim(),
        leftLabel: String(match && match.leftLabel || '').trim(),
        rightLabel: String(match && match.rightLabel || '').trim(),
        matchupLabel: String(match && match.matchupLabel || '').trim(),
        refereeLabel: String(match && match.refereeLabel || '').trim(),
        playerAId: String(match && match.playerAId || '').trim(),
        playerBId: String(match && match.playerBId || '').trim(),
        refereePlayerId: String(match && match.refereePlayerId || '').trim(),
        playerAPlayerIds: Array.isArray(match && match.playerAPlayerIds) ? match.playerAPlayerIds.map(function (value) {
          return String(value || '').trim();
        }).filter(Boolean) : [],
        playerBPlayerIds: Array.isArray(match && match.playerBPlayerIds) ? match.playerBPlayerIds.map(function (value) {
          return String(value || '').trim();
        }).filter(Boolean) : [],
        eventState: sanitizePublicMatchEventStateForFirebase_(match && match.eventState),
        setsA: match && Object.prototype.hasOwnProperty.call(match, 'setsA') ? match.setsA : '',
        setsB: match && Object.prototype.hasOwnProperty.call(match, 'setsB') ? match.setsB : '',
      };
    }),
  };
}

function sanitizePublicTimeStateForFirebase_(timeState) {
  const source = timeState && typeof timeState === 'object' ? timeState : {};
  const phases = source.phases && typeof source.phases === 'object' ? source.phases : {};

  return {
    timerStatus: String(source.timerStatus || '').trim(),
    serverNowTs: String(source.serverNowTs || '').trim(),
    serverNowMs: Number(source.serverNowMs || 0),
    tournamentStartTs: String(source.tournamentStartTs || '').trim(),
    tournamentStartMs: Number(source.tournamentStartMs || 0),
    tournamentNowTs: String(source.tournamentNowTs || '').trim(),
    tournamentNowMs: Number(source.tournamentNowMs || 0),
    tournamentElapsedMs: Number(source.tournamentElapsedMs || 0),
    pausedAccumulatedMs: Number(source.pausedAccumulatedMs || 0),
    currentBlockId: String(source.currentBlockId || '').trim(),
    currentPhase: String(source.currentPhase || '').trim(),
    phaseRemainingMs: Number(source.phaseRemainingMs || 0),
    phaseSequence: Array.isArray(source.phaseSequence) ? source.phaseSequence.map(function (value) {
      return String(value || '').trim();
    }).filter(Boolean) : ['scheduled', 'live', 'closing', 'transition'],
    phases: {
      scheduled: { durationMs: Number(phases.scheduled && phases.scheduled.durationMs || 0) },
      live: { durationMs: Number(phases.live && phases.live.durationMs || 0) },
      closing: { durationMs: Number(phases.closing && phases.closing.durationMs || 0) },
      transition: { durationMs: Number(phases.transition && phases.transition.durationMs || 0) },
    },
  };
}

function sanitizePublicCurrentBlockForFirebase_(currentBlock) {
  if (!currentBlock) return null;

  return {
    id: currentBlock.id,
    phaseType: String(currentBlock.phaseType || '').trim(),
    phaseLabel: String(currentBlock.phaseLabel || '').trim(),
    startTs: String(currentBlock.startTs || '').trim(),
    closeSignalTs: String(currentBlock.closeSignalTs || '').trim(),
    hardCloseTs: String(currentBlock.hardCloseTs || '').trim(),
    endTs: String(currentBlock.endTs || '').trim(),
  };
}

function sanitizePublicMatchEventStateForFirebase_(eventState) {
  const source = eventState && typeof eventState === 'object' ? eventState : {};

  return {
    resultSubmitted: !!source.resultSubmitted,
    autoClosed: !!source.autoClosed,
    walkover: !!source.walkover,
    tableBlocked: !!source.tableBlocked,
    needsReview: !!source.needsReview,
    resultMode: String(source.resultMode || '').trim(),
    closingState: String(source.closingState || '').trim(),
  };
}

function resolveDiagnosticBlock_(blockId) {
  const normalizedBlockId = String(blockId || '').trim();
  if (normalizedBlockId) {
    const explicitBlock = getBlockById(normalizedBlockId);
    if (!explicitBlock) {
      throw new Error(`No existe block_id=${normalizedBlockId}`);
    }
    return explicitBlock;
  }

  return getCurrentBlock();
}

function writeFirebaseNode_(path, payload) {
  const response = UrlFetchApp.fetch(buildFirebaseUrl_(path), {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  const body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Firebase publish failed for ${path} (${statusCode}): ${body}`);
  }

  return {
    statusCode: statusCode,
    body: body,
  };
}

function buildFirebaseUrl_(path) {
  const normalizedPath = String(path || '').trim().replace(/^\/+/, '');
  const suffix = normalizedPath ? `/${normalizedPath}` : '';
  return `${FIREBASE_RTDB_BASE_URL}${suffix}.json?auth=${encodeURIComponent(FIREBASE_RTDB_AUTH_TOKEN)}`;
}

function normalizeRealtimePlayerId_(playerId) {
  const normalizedPlayerId = normalizeRealtimePlayerIdSafe_(playerId);
  if (!normalizedPlayerId) {
    throw new Error('playerId requerido para publicar snapshot realtime.');
  }
  return normalizedPlayerId;
}

function normalizeRealtimePlayerIdSafe_(playerId) {
  return String(playerId || '').trim();
}

function onlyUnique_(value, index, array) {
  return array.indexOf(value) === index;
}
