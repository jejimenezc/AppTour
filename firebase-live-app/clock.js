/**
 * Tick principal del torneo.
 */
function tickTournamentClock() {
  const clockState = getTournamentClockState_();
  const nowText = String(clockState.internalNowTs || '').trim();
  if (!nowText) {
    Logger.log(`Clock tick omitido: reloj interno invalido (${clockState.health || 'unknown'}).`);
    return {
      ok: false,
      skipped: true,
      reason: 'invalid_clock',
      processedInternalTs: '',
      actions: [],
    };
  }

  return reconcileTournamentFlowFromClock_(nowText);
}

const CLOCK_TRIGGER_HANDLER = 'runTournamentClockTick';
const CLOCK_TRIGGER_ALLOWED_MINUTES = [1, 5, 10, 15, 30];
const CLOCK_TRIGGER_DEFAULT_MINUTES = 1;

/**
 * Wrapper del reloj para ejecucion automatica.
 * Aplica lock para evitar solapamientos y solo corre si el trigger esta habilitado.
 */
function runTournamentClockTick() {
  return runTournamentClockTickWithOptions_({
    requireEnabled: true,
    auditNote: 'Ultima ejecucion automatica del reloj',
    publishRealtime: true,
  });
}

/**
 * Ejecuta el tick manual compartiendo lock y auditoria con el trigger automatico.
 */
function runTournamentClockManualTick() {
  return runTournamentClockTickWithOptions_({
    requireEnabled: false,
    auditNote: 'Ultima ejecucion manual del reloj',
    publishRealtime: false,
  });
}

function runTickAndPublishRealtime() {
  return runTournamentClockTickWithOptions_({
    requireEnabled: false,
    auditNote: 'Ultima ejecucion manual del reloj',
    publishRealtime: true,
  });
}

/**
 * Nucleo compartido de ejecucion del reloj.
 *
 * @param {{requireEnabled:boolean, auditNote:string, publishRealtime:boolean}} options
 */
function runTournamentClockTickWithOptions_(options) {
  const opts = options || {};
  const clockState = getTournamentClockState_();

  if (opts.requireEnabled && !toBoolean(getConfigValue('clock_trigger_enabled'))) {
    Logger.log('Clock trigger omitido: clock_trigger_enabled=false');
    return {
      ok: false,
      skipped: true,
      reason: 'trigger_disabled',
      tickResult: null,
      publishResult: null,
    };
  }

  if (clockState.health === 'missing_start_ts') {
    Logger.log('Clock trigger omitido: falta tournament_start_ts.');
    return {
      ok: false,
      skipped: true,
      reason: 'missing_start_ts',
      tickResult: null,
      publishResult: null,
    };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('Clock trigger omitido: existe otra ejecucion en curso.');
    return {
      ok: false,
      skipped: true,
      reason: 'lock_unavailable',
      tickResult: null,
      publishResult: null,
    };
  }

  try {
    const previousCurrentBlock = getCurrentBlock();
    const previousCurrentBlockId = String(previousCurrentBlock && previousCurrentBlock.block_id || '').trim();
    const tickResult = tickTournamentClock();
    setConfigValue('clock_trigger_last_run_at', nowIso(), opts.auditNote || 'Ultima ejecucion del reloj');
    setConfigValue(
      'clock_last_processed_internal_ts',
      tickResult && tickResult.processedInternalTs ? tickResult.processedInternalTs : '',
      'Ultimo tiempo interno procesado por el motor'
    );
    setConfigValue('clock_trigger_last_error', '', 'Ultimo error del reloj');
    const currentBlockAfterTick = getCurrentBlock();
    const currentBlockAfterTickId = String(currentBlockAfterTick && currentBlockAfterTick.block_id || '').trim();
    const shouldPublishRealtime = opts.publishRealtime !== false ||
      shouldPublishPublicSnapshotAfterTick_(previousCurrentBlockId, currentBlockAfterTickId);
    const publishResult = shouldPublishRealtime
      ? publishRealtimeSnapshotToFirebase()
      : null;

    return {
      ok: true,
      skipped: false,
      tickResult: tickResult,
      publishResult: publishResult,
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    setConfigValue('clock_trigger_last_error', message, 'Ultimo error del reloj');
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function shouldPublishPublicSnapshotAfterTick_(previousCurrentBlockId, nextCurrentBlockId) {
  return String(previousCurrentBlockId || '').trim() !== String(nextCurrentBlockId || '').trim();
}

/**
 * Devuelve el "ahora" interno del torneo ya saneado.
 *
 * @returns {string}
 */
function getTournamentClockNowText() {
  return String(getTournamentClockState_().internalNowTs || '').trim();
}

/**
 * Devuelve el estado del cronometro del torneo.
 * `tournament_start_ts` fija el origen del calendario y el cronometro
 * acumulado define el ahora interno del torneo.
 *
 * @returns {{
 *   startTs:string,
 *   realNowTs:string,
 *   internalNowTs:string,
 *   elapsedMs:number,
 *   isRunning:boolean,
 *   lastResumeRealTs:string,
 *   health:string,
 *   healthMessage:string
 * }}
 */
function getTournamentClockState_() {
  const startTs = normalizeDateTimeText(getConfigValue('tournament_start_ts'));
  const realNowTs = normalizeDateTimeText(nowIso());
  const storedRunning = getConfigValue('clock_is_running');
  const isRunning = storedRunning === null || storedRunning === ''
    ? toBoolean(getConfigValue('clock_trigger_enabled'))
    : toBoolean(storedRunning);

  if (!startTs) {
    return {
      startTs: '',
      realNowTs,
      internalNowTs: '',
      elapsedMs: 0,
      isRunning: false,
      lastResumeRealTs: '',
      health: 'missing_start_ts',
      healthMessage: 'Falta tournament_start_ts.',
    };
  }

  const startDate = parseBlockDate(startTs);
  const realNowDate = parseBlockDate(realNowTs);
  if (!startDate || !realNowDate) {
    return {
      startTs,
      realNowTs,
      internalNowTs: startTs,
      elapsedMs: 0,
      isRunning: false,
      lastResumeRealTs: '',
      health: 'invalid_anchor',
      healthMessage: 'No se pudo interpretar la base temporal del torneo.',
    };
  }

  let elapsedMs = getStoredTournamentClockElapsedMs_();
  let lastResumeRealTs = normalizeDateTimeText(getConfigValue('clock_last_resume_real_ts'));
  let health = 'ok';
  let healthMessage = '';
  let needsPersist = false;
  let resolvedIsRunning = isRunning;

  if (elapsedMs === null) {
    const migrated = migrateLegacyTournamentClockState_(startTs, realNowTs, resolvedIsRunning);
    if (migrated) {
      elapsedMs = migrated.elapsedMs;
      lastResumeRealTs = migrated.lastResumeRealTs;
      resolvedIsRunning = migrated.isRunning;
      health = 'autocorrected';
      healthMessage = 'Se migro el reloj legacy al nuevo cronometro.';
      needsPersist = true;
    } else {
      elapsedMs = 0;
      health = 'autocorrected';
      healthMessage = 'Se inicializo clock_elapsed_ms en 0.';
      needsPersist = true;
    }
  }

  if (elapsedMs < 0) {
    elapsedMs = 0;
    health = 'autocorrected';
    healthMessage = 'clock_elapsed_ms era invalido; se reseteo a 0.';
    needsPersist = true;
  }

  let visibleElapsedMs = elapsedMs;
  if (resolvedIsRunning) {
    const lastResumeDate = parseBlockDate(lastResumeRealTs);
    if (!lastResumeDate) {
      lastResumeRealTs = realNowTs;
      health = 'autocorrected';
      healthMessage = 'Se recreo clock_last_resume_real_ts.';
      needsPersist = true;
    } else {
      visibleElapsedMs += Math.max(0, realNowDate.getTime() - lastResumeDate.getTime());
    }
  }

  const internalNowTs = formatParsedBlockDate(new Date(startDate.getTime() + visibleElapsedMs));

  if (needsPersist) {
    setConfigValue('clock_elapsed_ms', elapsedMs, 'Cronometro acumulado del torneo en ms');
    setConfigValue('clock_last_resume_real_ts', lastResumeRealTs, 'Ultima reanudacion real del cronometro');
    setConfigValue('clock_is_running', resolvedIsRunning, 'Estado del cronometro del torneo');
  }

  return {
    startTs,
    realNowTs,
    internalNowTs,
    elapsedMs: visibleElapsedMs,
    isRunning: resolvedIsRunning,
    lastResumeRealTs,
    health,
    healthMessage,
  };
}

function getStoredTournamentClockElapsedMs_() {
  const raw = getConfigValue('clock_elapsed_ms');
  if (raw === null || raw === '') {
    return null;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function migrateLegacyTournamentClockState_(startTs, realNowTs, isRunning) {
  const internalAnchorTs = normalizeDateTimeText(getConfigValue('clock_internal_anchor_ts'));
  const realAnchorTs = normalizeDateTimeText(getConfigValue('clock_real_anchor_ts'));
  if (!internalAnchorTs) {
    return null;
  }

  const startDate = parseBlockDate(startTs);
  const internalAnchorDate = parseBlockDate(internalAnchorTs);
  const realAnchorDate = parseBlockDate(realAnchorTs || realNowTs);
  const realNowDate = parseBlockDate(realNowTs);
  if (!startDate || !internalAnchorDate || !realNowDate) {
    return null;
  }

  let elapsedMs = Math.max(0, internalAnchorDate.getTime() - startDate.getTime());
  if (isRunning && realAnchorDate) {
    elapsedMs += Math.max(0, realNowDate.getTime() - realAnchorDate.getTime());
  }

  return {
    elapsedMs: elapsedMs,
    lastResumeRealTs: isRunning ? realNowTs : '',
    isRunning: isRunning,
  };
}

function reconcileTournamentFlowFromClock_(internalNowTs) {
  const nowText = normalizeDateTimeText(internalNowTs);
  const actions = [];
  let changed = false;

  if (!nowText) {
    return {
      ok: false,
      changed: false,
      actions: actions,
      processedInternalTs: '',
      currentBlockId: '',
      currentBlockStatus: '',
    };
  }

  for (let step = 0; step < 50; step += 1) {
    const currentBlock = getCurrentBlock();
    if (!currentBlock) {
      return {
        ok: true,
        changed: changed,
        actions: actions,
        processedInternalTs: nowText,
        currentBlockId: '',
        currentBlockStatus: '',
      };
    }

    const startTs = normalizeDateTimeText(currentBlock.start_ts);
    const closeSignalTs = normalizeDateTimeText(currentBlock.close_signal_ts);
    const hardCloseTs = normalizeDateTimeText(currentBlock.hard_close_ts);
    const endTs = normalizeDateTimeText(currentBlock.end_ts);
    const status = String(currentBlock.status || '').trim();

    if (status === 'scheduled' && startTs && nowText >= startTs) {
      startCurrentBlock(currentBlock.block_id);
      actions.push(`Bloque ${currentBlock.block_id} => live`);
      changed = true;
      continue;
    }

    if (status === 'live' && closeSignalTs && nowText >= closeSignalTs) {
      enterClosingState(currentBlock.block_id);
      actions.push(`Bloque ${currentBlock.block_id} => closing`);
      changed = true;
      continue;
    }

    if ((status === 'live' || status === 'closing') && hardCloseTs && nowText >= hardCloseTs) {
      enterTransitionState(currentBlock.block_id);
      actions.push(`Bloque ${currentBlock.block_id} => transition`);
      changed = true;
      continue;
    }

    if (status === 'transition' && endTs && nowText >= endTs) {
      finishCurrentBlockAndMoveNext(currentBlock.block_id);
      actions.push(`Bloque ${currentBlock.block_id} => closed`);
      changed = true;
      continue;
    }

    return {
      ok: true,
      changed: changed,
      actions: actions,
      processedInternalTs: nowText,
      currentBlockId: String(currentBlock.block_id || '').trim(),
      currentBlockStatus: status,
    };
  }

  throw new Error('El reconciliador del cronometro supero el maximo de pasos permitidos.');
}

/**
 * Reinicia el reloj interno y lo vuelve a alinear con tournament_start_ts.
 *
 * @param {string=} startTs
 */
function resetTournamentInternalClock(startTs) {
  const normalizedStart = normalizeDateTimeText(startTs || getConfigValue('tournament_start_ts'));
  if (!normalizedStart) return;

  const keepRunning = toBoolean(getConfigValue('clock_is_running'));
  setConfigValue('clock_elapsed_ms', 0, 'Cronometro acumulado del torneo en ms');
  setConfigValue('clock_last_resume_real_ts', keepRunning ? nowIso() : '', 'Ultima reanudacion real del cronometro');
  setConfigValue('clock_is_running', keepRunning, 'Estado del cronometro del torneo');
}

/**
 * Congela el reloj interno en su valor actual.
 */
function pauseTournamentInternalClock() {
  const state = getTournamentClockState_();
  if (!state.startTs) return;

  setConfigValue('clock_elapsed_ms', state.elapsedMs, 'Cronometro acumulado del torneo en ms');
  setConfigValue('clock_last_resume_real_ts', '', 'Ultima reanudacion real del cronometro');
  setConfigValue('clock_is_running', false, 'Estado del cronometro del torneo');
}

/**
 * Reanuda el reloj interno desde su valor congelado actual.
 */
function resumeTournamentInternalClock() {
  const state = getTournamentClockState_();
  if (!state.startTs) return;

  setConfigValue('clock_elapsed_ms', state.elapsedMs, 'Cronometro acumulado del torneo en ms');
  setConfigValue('clock_last_resume_real_ts', nowIso(), 'Ultima reanudacion real del cronometro');
  setConfigValue('clock_is_running', true, 'Estado del cronometro del torneo');
}

/**
 * Instala un trigger time-driven para el reloj del torneo.
 * Elimina triggers previos del mismo handler para evitar duplicados.
 *
 * @param {number=} intervalMinutes
 * @returns {Object}
 */
function installTournamentClockTrigger(intervalMinutes) {
  const minutes = normalizeClockTriggerInterval(intervalMinutes);

  removeProjectTriggersByHandler_(CLOCK_TRIGGER_HANDLER);

  ScriptApp.newTrigger(CLOCK_TRIGGER_HANDLER)
    .timeBased()
    .everyMinutes(minutes)
    .create();

  setConfigValue('clock_trigger_enabled', true, 'Habilita el trigger automatico del reloj');
  setConfigValue('clock_trigger_interval_minutes', minutes, 'Frecuencia del trigger automatico del reloj');
  setConfigValue('clock_trigger_installed_at', nowIso(), 'Instalacion del trigger automatico del reloj');

  return getTournamentClockTriggerStatus();
}

/**
 * Remueve todos los triggers del reloj y deshabilita su ejecucion automatica.
 *
 * @returns {Object}
 */
function removeTournamentClockTriggers() {
  const removedCount = removeProjectTriggersByHandler_(CLOCK_TRIGGER_HANDLER);

  setConfigValue('clock_trigger_enabled', false, 'Habilita el trigger automatico del reloj');
  setConfigValue('clock_trigger_removed_at', nowIso(), 'Ultima remocion del trigger automatico del reloj');

  const status = getTournamentClockTriggerStatus();
  status.removedCount = removedCount;
  return status;
}

/**
 * Devuelve el estado del trigger del reloj para auditoria rapida.
 *
 * @returns {Object}
 */
function getTournamentClockTriggerStatus() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === CLOCK_TRIGGER_HANDLER)
    .map(trigger => ({
      handler: trigger.getHandlerFunction(),
      eventType: String(trigger.getEventType()),
      triggerSource: String(trigger.getTriggerSource()),
      uniqueId: typeof trigger.getUniqueId === 'function' ? trigger.getUniqueId() : '',
    }));

  return {
    handler: CLOCK_TRIGGER_HANDLER,
    enabled: toBoolean(getConfigValue('clock_trigger_enabled')),
    configuredIntervalMinutes: Number(getConfigValue('clock_trigger_interval_minutes') || ''),
    installedAt: getConfigValue('clock_trigger_installed_at') || '',
    removedAt: getConfigValue('clock_trigger_removed_at') || '',
    lastRunAt: getConfigValue('clock_trigger_last_run_at') || '',
    lastError: getConfigValue('clock_trigger_last_error') || '',
    triggerCount: triggers.length,
    triggers: triggers,
  };
}

/**
 * Loguea el estado del trigger del reloj en formato legible.
 *
 * @returns {Object}
 */
function logTournamentClockTriggerStatus() {
  const status = getTournamentClockTriggerStatus();
  Logger.log(JSON.stringify(status, null, 2));
  return status;
}

/**
 * Normaliza la frecuencia permitida para el trigger.
 *
 * @param {number=} intervalMinutes
 * @returns {number}
 */
function normalizeClockTriggerInterval(intervalMinutes) {
  const raw = typeof intervalMinutes === 'undefined' || intervalMinutes === null || intervalMinutes === ''
    ? getConfigValue('clock_trigger_interval_minutes')
    : intervalMinutes;
  const minutes = Number(raw || CLOCK_TRIGGER_DEFAULT_MINUTES);

  if (!CLOCK_TRIGGER_ALLOWED_MINUTES.includes(minutes)) {
    throw new Error(`clock trigger interval invalido: ${raw}. Usa uno de: ${CLOCK_TRIGGER_ALLOWED_MINUTES.join(', ')}`);
  }

  return minutes;
}

/**
 * Elimina triggers del proyecto por nombre de handler.
 *
 * @param {string} handlerName
 * @returns {number}
 */
function removeProjectTriggersByHandler_(handlerName) {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === handlerName);

  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  return triggers.length;
}

/**
 * Inicia un bloque.
 * @param {string|number} blockId
 */
function startCurrentBlock(blockId) {
  updateBlock(blockId, {
    status: 'live',
    published_at: nowIso(),
  });

  markMatchesAsLive(blockId);
  syncPlayerRolesForBlock(blockId);
}

/**
 * Entra a estado de cierre.
 * @param {string|number} blockId
 */
function enterClosingState(blockId) {
  updateBlock(blockId, {
    status: 'closing',
  });
}

/**
 * Entra a transición.
 * @param {string|number} blockId
 */
function enterTransitionState(blockId) {
  const block = getBlockById(blockId);
  if (!block) throw new Error(`No existe block_id=${blockId}`);

  finalizePendingMatchesAtHardClose(blockId);

  if (String(block.phase_type) === 'groups') {
    recomputeGroupStandings();
  }

  updateBlock(blockId, {
    status: 'transition',
    advance_done: true,
  });

  syncPlayerRolesForNoActiveBlock();
}

/**
 * Cierra el bloque actual y mueve el flujo a la siguiente fase/bloque.
 *
 * 8C + fix:
 * - limpia current_block_id al entrar a ventanas sin bloque activo
 * - evita dejar apuntando al último bloque cerrado
 *
 * @param {string|number} blockId
 */
function finishCurrentBlockAndMoveNext(blockId) {
  const currentBlock = getBlockById(blockId);
  if (!currentBlock) throw new Error(`No existe block_id=${blockId}`);

  closeBlock(blockId);

  let next = activateNextBlock();

  if (next) {
    maybeStartActivatedBlock_(next);

    if (String(next.phase_type) === 'doubles') {
      setConfigValue('tournament_status', 'running_doubles', 'Dobles en curso');
    } else if (String(next.phase_type) === 'groups') {
      setConfigValue('tournament_status', 'running_groups', 'Fase de grupos en curso');
    } else if (String(next.phase_type) === 'singles') {
      setConfigValue('tournament_status', 'running_singles_knockout', 'Llaves de singles en curso');
    }
    return;
  }

  if (String(currentBlock.phase_type) === 'doubles' && !isDoublesFinalBlock(currentBlock)) {
    const progressed = progressDoublesOneRound();

    if (progressed.newBlockId) {
      setConfigValue('current_block_id', progressed.newBlockId, 'Bloque actual');
      setConfigValue('tournament_status', 'running_doubles', 'Dobles en curso');
      return;
    }

    if (isDoublesFinalReserved()) {
      setConfigValue('current_block_id', '', 'Sin bloque activo durante ventana de grupos');
      setConfigValue('tournament_status', 'awaiting_doubles_final', 'Final de dobles reservada');

      openSinglesGroupConfirmationWindow();
      // openSinglesGroupConfirmationWindow ya deja status=awaiting_singles_group_confirmation
      return;
    }

    setConfigValue('current_block_id', '', 'Sin bloque activo');
    setConfigValue('tournament_status', 'awaiting_next_phase', 'Dobles sin siguiente bloque disponible');
    return;
  }

  if (String(currentBlock.phase_type) === 'groups') {
    if (areAllGroupMatchesResolved()) {
      setupSinglesEliminationStage();

      const latestSinglesBlock = getBlocksSorted()
        .filter(b => String(b.phase_type) === 'singles')
        .slice(-1)[0];

      if (latestSinglesBlock) {
        setConfigValue('current_block_id', latestSinglesBlock.block_id, 'Bloque actual');
        setConfigValue('tournament_status', 'running_singles_knockout', 'Llaves de singles en curso');
      } else {
        setConfigValue('current_block_id', '', 'Sin bloque activo');
      }
    }
    return;
  }

  if (String(currentBlock.phase_type) === 'singles' && !isSinglesFinalsBlock(currentBlock)) {
    markGoldFinalistsIfApplicable();

    const progressed = progressSinglesBracketsOneRound();

    if (progressed.newBlockId) {
      setConfigValue('current_block_id', progressed.newBlockId, 'Bloque actual');
      setConfigValue('tournament_status', 'running_singles_knockout', 'Llaves de singles en curso');
      return;
    }

    if (areAllSinglesFinalsReserved()) {
      setConfigValue('current_block_id', '', 'Sin bloque activo esperando finales de singles');
      setConfigValue('tournament_status', 'awaiting_singles_final', 'Finales de singles reservadas');
      return;
    }

    setConfigValue('current_block_id', '', 'Sin bloque activo');
    setConfigValue('tournament_status', 'awaiting_next_phase', 'Singles sin siguiente bloque disponible');
    return;
  }

  // Cierre de la final de dobles -> crear bloque de finales de singles
  if (isDoublesFinalBlock(currentBlock)) {
    if (isDoublesFinalResolved()) {
      const singlesFinalsBlockId = createSinglesFinalsBlockIfNeeded();
      if (singlesFinalsBlockId) {
        return;
      }

      setConfigValue('current_block_id', '', 'Sin bloque activo');
      setConfigValue('tournament_status', 'awaiting_singles_final', 'Final de dobles resuelta; pendientes finales de singles');
      return;
    }

    setConfigValue('current_block_id', '', 'Sin bloque activo');
    setConfigValue('tournament_status', 'awaiting_doubles_final', 'Final de dobles aún no resuelta');
    return;
  }

  // Cierre del bloque final de singles -> torneo terminado
  if (isSinglesFinalsBlock(currentBlock)) {
    if (areAllSinglesFinalsResolved()) {
      setConfigValue('current_block_id', '', 'Torneo finalizado');
      setConfigValue('tournament_status', 'finished', 'Torneo finalizado');
      return;
    }

    setConfigValue('current_block_id', '', 'Sin bloque activo');
    setConfigValue('tournament_status', 'running_finals', 'Finales de singles aún no resueltas');
    return;
  }

  setConfigValue('current_block_id', '', 'Sin bloque activo');
  setConfigValue('tournament_status', 'awaiting_next_phase', 'Sin siguiente bloque disponible');
}

/**
 * Si el bloque activado ya debio partir, lo arranca inmediatamente.
 * Esto evita dejarlo en scheduled hasta el proximo tick.
 *
 * @param {Object} block
 */
function maybeStartActivatedBlock_(block) {
  if (!block) return;

  const status = String(block.status || '').trim();
  const startTs = normalizeDateTimeText(block.start_ts);
  const nowText = String(getTournamentClockState_().internalNowTs || '').trim();

  if (status === 'scheduled' && startTs && nowText >= startTs) {
    startCurrentBlock(block.block_id);
  }
}

/**
 * Sincroniza roles de jugadores para un bloque activo.
 * @param {string|number} blockId
 */
function syncPlayerRolesForBlock(blockId) {
  const allPlayers = getPlayers();
  const matches = getMatchesByBlock(blockId);

  const roleMap = {};

  allPlayers.forEach(player => {
    roleMap[player.player_id] = {
      current_role: 'idle',
      current_block_id: blockId,
    };
  });

  matches.forEach(match => {
    const phaseType = String(match.phase_type || '').trim();
    const a = String(match.player_a_id || '').trim();
    const b = String(match.player_b_id || '').trim();
    const r = String(match.referee_player_id || '').trim();

    applyPlayerRoleFromMatchSide_(roleMap, a, phaseType, blockId);
    applyPlayerRoleFromMatchSide_(roleMap, b, phaseType, blockId);

    if (r) {
      roleMap[r] = {
        current_role: 'referee',
        current_block_id: blockId,
      };
    }
  });

  Object.keys(roleMap).forEach(playerId => {
    updatePlayer(playerId, roleMap[playerId]);
  });
}

function applyPlayerRoleFromMatchSide_(roleMap, sideId, phaseType, blockId) {
  const normalizedId = String(sideId || '').trim();
  if (!normalizedId) return;

  if (phaseType === 'doubles') {
    const team = getDoublesTeamById(normalizedId);
    if (!team) return;

    [team.player_1_id, team.player_2_id].forEach(function (playerId) {
      const normalizedPlayerId = String(playerId || '').trim();
      if (!normalizedPlayerId) return;

      roleMap[normalizedPlayerId] = {
        current_role: 'play',
        current_block_id: blockId,
      };
    });
    return;
  }

  roleMap[normalizedId] = {
    current_role: 'play',
    current_block_id: blockId,
  };
}

/**
 * Deja a todos los jugadores en idle cuando no hay bloque activo.
 */
function syncPlayerRolesForNoActiveBlock() {
  const players = getPlayers();

  players.forEach(player => {
    updatePlayer(player.player_id, {
      current_role: 'idle',
    });
  });
}

/**
 * Debug extendido de condiciones de tick.
 */
function debugTickConditionsFull() {
  const currentBlock = getCurrentBlock();
  if (!currentBlock) throw new Error('No hay bloque actual.');

  const nowText = getTournamentClockNowText();
  const startTs = normalizeDateTimeText(currentBlock.start_ts);
  const closeSignalTs = normalizeDateTimeText(currentBlock.close_signal_ts);
  const hardCloseTs = normalizeDateTimeText(currentBlock.hard_close_ts);
  const endTs = normalizeDateTimeText(currentBlock.end_ts);
  const status = String(currentBlock.status || '').trim();

  Logger.log('status: %s', status);
  Logger.log('now: %s', nowText);
  Logger.log('startTs: %s', startTs);
  Logger.log('closeSignalTs: %s', closeSignalTs);
  Logger.log('hardCloseTs: %s', hardCloseTs);
  Logger.log('endTs: %s', endTs);

  Logger.log(
    'cond scheduled->live: %s',
    status === 'scheduled' && startTs && nowText >= startTs && nowText < closeSignalTs
  );

  Logger.log(
    'cond live->closing: %s',
    status === 'live' && closeSignalTs && nowText >= closeSignalTs && nowText < hardCloseTs
  );

  Logger.log(
    'cond closing/live->transition: %s',
    (status === 'live' || status === 'closing') && hardCloseTs && nowText >= hardCloseTs && nowText < endTs
  );

  Logger.log(
    'cond transition->closed: %s',
    status === 'transition' && endTs && nowText >= endTs
  );
}
