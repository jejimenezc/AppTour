/**
 * Lanza error si la condición es falsa.
 *
 * @param {boolean} condition
 * @param {string} message
 */
function assertV2(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT V2 FAILED: ${message}`);
  }
}

/**
 * Devuelve string status actual del torneo.
 * @returns {string}
 */
function getTournamentStatus() {
  return String(getConfigValue('tournament_status') || '').trim();
}

/**
 * Verifica estado esperado del torneo.
 *
 * @param {string} expected
 */
function assertTournamentStatus(expected) {
  const actual = getTournamentStatus();
  assertV2(actual === expected, `Esperado tournament_status=${expected}, actual=${actual}`);
}

/**
 * Cuenta matches por phase_type.
 *
 * @returns {{groups:number,singles:number,doubles:number,total:number}}
 */
function getMatchPhaseSummary() {
  const matches = getMatches();
  const summary = {
    groups: 0,
    singles: 0,
    doubles: 0,
    total: matches.length,
  };

  matches.forEach(match => {
    const phase = String(match.phase_type || '').trim();
    if (phase === 'groups') summary.groups++;
    if (phase === 'singles') summary.singles++;
    if (phase === 'doubles') summary.doubles++;
  });

  return summary;
}

/**
 * Resuelve todos los matches scheduled de un bloque.
 *
 * @param {string|number} blockId
 */
function resolveAllScheduledMatchesInBlock(blockId) {
  const matches = getMatchesByBlock(blockId).filter(match => String(match.status) === 'scheduled');

  matches.forEach((match, idx) => {
    submitMatchResult(match.match_id, {
      mode: 'final',
      sets_a: idx % 2 === 0 ? 2 : 1,
      sets_b: idx % 2 === 0 ? 0 : 2,
      submitted_by: match.referee_player_id || 'system-ref',
      submitted_by_role: 'referee',
    });
  });
}

/**
 * Fuerza el cierre de un bloque ya resuelto.
 *
 * @param {string|number} blockId
 */
function forceCloseResolvedBlock(blockId) {
  const now = new Date();

  // Primero: dejarlo en ventana de hard close para que entre a transition
  updateBlock(blockId, {
    status: 'closing',
    start_ts: addMinutes(now, -19),
    close_signal_ts: addMinutes(now, -4),
    hard_close_ts: addMinutes(now, -1),
    end_ts: addMinutes(now, 1),
  });

  tickTournamentClock();

  const blockAfterTransition = getBlockById(blockId);
  assertV2(
    String(blockAfterTransition.status) === 'transition',
    `El bloque ${blockId} no entró a transition como se esperaba. Estado actual=${blockAfterTransition.status}`
  );

  // Segundo: dejarlo vencido para que cierre realmente
  updateBlock(blockId, {
    status: 'transition',
    start_ts: addMinutes(now, -21),
    close_signal_ts: addMinutes(now, -6),
    hard_close_ts: addMinutes(now, -3),
    end_ts: addMinutes(now, -1),
  });

  tickTournamentClock();
}

/**
 * Configuración mínima de dobles para V2.
 */
function configureBasicDoublesCutV2() {
  const eligible = getPlayers().filter(p => String(p.doubles_status) === 'eligible');
  assertV2(eligible.length >= 8, 'Se requieren al menos 8 jugadores elegibles para configurar dobles.');

  // 2 parejas manuales
  proposePartner(eligible[0].player_id, eligible[1].player_id);
  confirmPartner(eligible[1].player_id);

  proposePartner(eligible[2].player_id, eligible[3].player_id);
  confirmPartner(eligible[3].player_id);

  // 4 al pool
  optIntoPool(eligible[4].player_id);
  optIntoPool(eligible[5].player_id);
  optIntoPool(eligible[6].player_id);
  optIntoPool(eligible[7].player_id);

  const validation = validateDoublesCut();
  assertV2(validation.ok, `La configuración de dobles no pasó validación: ${validation.errors.join(' | ')}`);
}

/**
 * Devuelve el bloque actual o lanza error.
 * @returns {Object}
 */
function getCurrentBlockOrThrow() {
  const block = getCurrentBlock();
  if (!block) {
    throw new Error('No existe current_block_id o no se encontró el bloque actual.');
  }
  return block;
}

/**
 * Juega dobles preliminar hasta abrir la ventana de grupos.
 *
 * Condición terminal V2:
 * - final de dobles reservada
 * - tournament_status = awaiting_singles_group_confirmation
 * - sin bloque activo
 */
function playDoublesPreFinalUntilGroupsWindow() {
  for (let guard = 0; guard < 20; guard++) {
    const status = getTournamentStatus();

    if (status === 'awaiting_singles_group_confirmation') {
      assertV2(isDoublesFinalReserved(), 'La final de dobles debería estar reservada al abrir la ventana de grupos.');
      assertV2(!getCurrentBlock(), 'No debería haber bloque activo durante la ventana de grupos.');
      return;
    }

    const currentBlock = getCurrentBlockOrThrow();
    const currentPhase = String(currentBlock.phase_type || '').trim();

    if (currentPhase !== 'doubles') {
      throw new Error(`Se esperaba bloque actual de doubles, pero se encontró ${currentPhase} (block_id=${currentBlock.block_id}).`);
    }

    resolveAllScheduledMatchesInBlock(currentBlock.block_id);
    forceCloseResolvedBlock(currentBlock.block_id);
  }

  throw new Error('No se alcanzó la ventana de grupos dentro del límite de iteraciones.');
}

/**
 * Juega todos los bloques de groups hasta terminar esa fase
 * y arrancar singles knockout.
 */
function playGroupsUntilSinglesKnockout() {
  for (let guard = 0; guard < 10; guard++) {
    const status = getTournamentStatus();
    if (status === 'running_singles_knockout') return;

    const currentBlock = getCurrentBlockOrThrow();
    const currentPhase = String(currentBlock.phase_type || '').trim();

    if (currentPhase !== 'groups') {
      throw new Error(`Se esperaba bloque de groups, pero se encontró ${currentPhase} (block_id=${currentBlock.block_id}).`);
    }

    resolveAllScheduledMatchesInBlock(currentBlock.block_id);
    forceCloseResolvedBlock(currentBlock.block_id);
  }

  throw new Error('No se logró transitar de groups a singles knockout dentro del límite esperado.');
}

/**
 * Juega singles preliminar hasta awaiting_singles_final.
 */
function playSinglesPreFinalUntilAwaiting() {
  for (let guard = 0; guard < 20; guard++) {
    const status = getTournamentStatus();
    if (status === 'awaiting_singles_final') {
      assertV2(areAllSinglesFinalsReserved(), 'Las tres finales de singles deberían estar reservadas.');
      assertV2(!getCurrentBlock(), 'No debería haber bloque activo esperando las finales de singles.');
      return;
    }

    const currentBlock = getCurrentBlockOrThrow();
    const currentPhase = String(currentBlock.phase_type || '').trim();

    if (currentPhase !== 'singles') {
      throw new Error(`Se esperaba bloque actual de singles, pero se encontró ${currentPhase} (block_id=${currentBlock.block_id}).`);
    }

    resolveAllScheduledMatchesInBlock(currentBlock.block_id);
    forceCloseResolvedBlock(currentBlock.block_id);
  }

  throw new Error('No se alcanzó awaiting_singles_final dentro del límite de iteraciones.');
}

/**
 * Programa y juega la final de dobles.
 */
function runReservedDoublesFinalV2() {
  const blockId = createDoublesFinalBlockIfNeeded();
  assertV2(!!blockId, 'No se pudo crear el bloque de final de dobles.');

  const finalMatch = getDoublesFinalMatch();
  assertV2(!!finalMatch, 'No existe doubles_final reservada.');
  assertV2(String(finalMatch.block_id) === String(blockId), 'La final de dobles no quedó asignada al bloque final.');

  submitMatchResult(finalMatch.match_id, {
    mode: 'final',
    sets_a: 2,
    sets_b: 1,
    submitted_by: 'system-ref',
    submitted_by_role: 'referee',
  });

  forceCloseResolvedBlock(blockId);
}

/**
 * Programa y juega las tres finales de singles.
 */
function runReservedSinglesFinalsV2() {
  const blockId = createSinglesFinalsBlockIfNeeded();
  assertV2(!!blockId, 'No se pudo crear el bloque de finales de singles.');

  const currentBlock = getCurrentBlockOrThrow();
  assertV2(isSinglesFinalsBlock(currentBlock), 'El bloque actual no corresponde a las finales de singles.');

  const finalMatches = getMatchesByBlock(currentBlock.block_id).filter(m => String(m.phase_type) === 'singles');
  assertV2(finalMatches.length === 3, `Se esperaban 3 finales de singles, se encontraron ${finalMatches.length}.`);

  finalMatches.forEach((match, idx) => {
    submitMatchResult(match.match_id, {
      mode: 'final',
      sets_a: idx % 2 === 0 ? 2 : 1,
      sets_b: idx % 2 === 0 ? 0 : 2,
      submitted_by: 'system-ref',
      submitted_by_role: 'referee',
    });
  });

  forceCloseResolvedBlock(currentBlock.block_id);
}

/**
 * Test integral del itinerario V2 completo.
 */
function testFullTournamentFlowV2() {
  Logger.log('=== V2 FULL FLOW START ===');

  // 1) reset + ventana dobles
  initializeTournamentFlowV2();
  assertTournamentStatus('awaiting_doubles_confirmation');

  // 2) configurar dobles y generar cuadro
  configureBasicDoublesCutV2();
  const doublesBlockId = setupDoublesStageFromCut();
  assertV2(!!doublesBlockId, 'No se pudo generar el primer bloque de dobles.');
  assertTournamentStatus('running_doubles');

  let summary = getMatchPhaseSummary();
  Logger.log(`After doubles setup: ${JSON.stringify(summary)}`);
  assertV2(summary.doubles > 0, 'No se generaron matches de dobles.');

  // 3) jugar dobles preliminar hasta ventana de groups
  playDoublesPreFinalUntilGroupsWindow();
  assertTournamentStatus('awaiting_singles_group_confirmation');
  assertV2(isDoublesFinalReserved(), 'La final de dobles debería estar reservada.');

  // 4) confirmar groups
  const checkpoint = validateSinglesGroupCheckpoint();
  assertV2(checkpoint.ok, `Checkpoint de grupos inválido: ${checkpoint.errors.join(' | ')}`);

  confirmSinglesGroupsAndStartGroupStage();
  assertTournamentStatus('running_groups');

  summary = getMatchPhaseSummary();
  Logger.log(`After groups setup: ${JSON.stringify(summary)}`);
  assertV2(summary.groups > 0, 'No se generaron matches de groups.');

  // 5) jugar groups hasta singles knockout
  playGroupsUntilSinglesKnockout();
  assertTournamentStatus('running_singles_knockout');

  summary = getMatchPhaseSummary();
  Logger.log(`After singles setup: ${JSON.stringify(summary)}`);
  assertV2(summary.singles > 0, 'No se generaron matches de singles.');

  // 6) jugar singles preliminar hasta awaiting_singles_final
  playSinglesPreFinalUntilAwaiting();
  assertTournamentStatus('awaiting_singles_final');
  assertV2(areAllSinglesFinalsReserved(), 'Las tres finales de singles deberían estar reservadas.');

  // 7) jugar final de dobles
  runReservedDoublesFinalV2();

  const statusAfterDoublesFinal = getTournamentStatus();
  Logger.log(`Status after doubles final: ${statusAfterDoublesFinal}`);
  assertV2(
    statusAfterDoublesFinal === 'running_finals' || statusAfterDoublesFinal === 'awaiting_singles_final',
    `Estado inesperado tras final de dobles: ${statusAfterDoublesFinal}`
  );

  // 8) jugar finales singles
  if (getTournamentStatus() !== 'awaiting_singles_final') {
    const currentBlock = getCurrentBlock();
    if (!currentBlock || !isSinglesFinalsBlock(currentBlock)) {
      setConfigValue('current_block_id', '', 'Reajuste de estado para test integral');
      setConfigValue('tournament_status', 'awaiting_singles_final', 'Reajuste de estado para test integral');
    }
  }

  runReservedSinglesFinalsV2();

  // 9) finished
  assertTournamentStatus('finished');

  summary = getMatchPhaseSummary();
  Logger.log(`Final summary: ${JSON.stringify(summary)}`);
  Logger.log('=== V2 FULL FLOW END ===');
}