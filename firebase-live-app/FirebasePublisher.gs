const FIREBASE_RTDB_BASE_URL = 'https://appttour-default-rtdb.firebaseio.com';
const FIREBASE_RTDB_AUTH_TOKEN = 'lt5kKHnJGZMrT0pL2ZxokPLk8zFzu22G9VlmQ8ws';

function publishPartidosToFirebase() {
  return publishRealtimeSnapshotToFirebase();
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

function publishRealtimeDebugForPlayer(playerId) {
  const normalizedPlayerId = normalizeRealtimePlayerId_(playerId);
  const snapshotResult = publishRealtimeSnapshotToFirebase();
  const playerResults = publishPlayerRealtimeViewsToFirebase([normalizedPlayerId]);

  return {
    ok: true,
    debugPlayerId: normalizedPlayerId,
    snapshot: snapshotResult,
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
    currentBlock: vm.currentBlock || null,
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
        status: String(match && match.status || '').trim(),
        resultMode: String(match && match.resultMode || '').trim(),
        closingState: String(match && match.closingState || '').trim(),
        setsA: match && Object.prototype.hasOwnProperty.call(match, 'setsA') ? match.setsA : '',
        setsB: match && Object.prototype.hasOwnProperty.call(match, 'setsB') ? match.setsB : '',
      };
    }),
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
