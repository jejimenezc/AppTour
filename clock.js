/**
 * Tick principal del torneo.
 */
function tickTournamentClock() {
  const currentBlock = getCurrentBlock();
  if (!currentBlock) {
    Logger.log('No hay bloque actual.');
    return;
  }

  const now = new Date();

  const startTs = parseBlockDate(currentBlock.start_ts);
  const closeSignalTs = parseBlockDate(currentBlock.close_signal_ts);
  const hardCloseTs = parseBlockDate(currentBlock.hard_close_ts);
  const endTs = parseBlockDate(currentBlock.end_ts);

  const status = String(currentBlock.status || '').trim();

  if (status === 'scheduled' && startTs && now >= startTs && now < closeSignalTs) {
    startCurrentBlock(currentBlock.block_id);
    Logger.log(`Bloque ${currentBlock.block_id} => live`);
    return;
  }

  if (status === 'live' && closeSignalTs && now >= closeSignalTs && now < hardCloseTs) {
    enterClosingState(currentBlock.block_id);
    Logger.log(`Bloque ${currentBlock.block_id} => closing`);
    return;
  }

  if ((status === 'live' || status === 'closing') && hardCloseTs && now >= hardCloseTs && now < endTs) {
    enterTransitionState(currentBlock.block_id);
    Logger.log(`Bloque ${currentBlock.block_id} => transition`);
    return;
  }

  if (status === 'transition' && endTs && now >= endTs) {
    finishCurrentBlockAndMoveNext(currentBlock.block_id);
    Logger.log(`Bloque ${currentBlock.block_id} => closed`);
    return;
  }

  Logger.log(`Sin cambios para bloque ${currentBlock.block_id}. Estado actual: ${status}`);
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
    const a = String(match.player_a_id || '').trim();
    const b = String(match.player_b_id || '').trim();
    const r = String(match.referee_player_id || '').trim();

    if (a) {
      roleMap[a] = {
        current_role: 'play',
        current_block_id: blockId,
      };
    }

    if (b) {
      roleMap[b] = {
        current_role: 'play',
        current_block_id: blockId,
      };
    }

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

  const now = new Date();
  const startTs = parseBlockDate(currentBlock.start_ts);
  const closeSignalTs = parseBlockDate(currentBlock.close_signal_ts);
  const hardCloseTs = parseBlockDate(currentBlock.hard_close_ts);
  const endTs = parseBlockDate(currentBlock.end_ts);
  const status = String(currentBlock.status || '').trim();

  Logger.log('status: %s', status);
  Logger.log('now: %s', now);
  Logger.log('startTs: %s', startTs);
  Logger.log('closeSignalTs: %s', closeSignalTs);
  Logger.log('hardCloseTs: %s', hardCloseTs);
  Logger.log('endTs: %s', endTs);

  Logger.log(
    'cond scheduled->live: %s',
    status === 'scheduled' && startTs && now >= startTs && now < closeSignalTs
  );

  Logger.log(
    'cond live->closing: %s',
    status === 'live' && closeSignalTs && now >= closeSignalTs && now < hardCloseTs
  );

  Logger.log(
    'cond closing/live->transition: %s',
    (status === 'live' || status === 'closing') && hardCloseTs && now >= hardCloseTs && now < endTs
  );

  Logger.log(
    'cond transition->closed: %s',
    status === 'transition' && endTs && now >= endTs
  );
}