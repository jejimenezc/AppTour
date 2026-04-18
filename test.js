function testSubmitFinalResult() {
  submitMatchResult('M001', {
    mode: 'final',
    sets_a: 2,
    sets_b: 1,
    submitted_by: 'P001',
    submitted_by_role: 'player',
  });

  Logger.log(JSON.stringify(getMatchById('M001')));
}

function testSubmitClosingState() {
  submitMatchResult('M001', {
    mode: 'closing_state',
    closing_state: 'A_1_0',
    submitted_by: 'P003',
    submitted_by_role: 'referee',
  });

  Logger.log(JSON.stringify(getMatchById('M001')));
}

function testFinalizeHardClose() {
  finalizeMatchAtHardClose('M001');
  Logger.log(JSON.stringify(getMatchById('M001')));
}

/**
 * Ejecuta setup completo de fase de grupos.
 */
function testSetupGroupStage() {
  setupGroupStage();

  Logger.log('Players after grouping:');
  getPlayers().slice(0, 10).forEach(p => Logger.log(JSON.stringify(p)));

  Logger.log('Groups count: %s', getGroupRows().length);
  Logger.log('Matches count: %s', getMatches().length);
  Logger.log('Blocks count: %s', getBlocks().length);
}

/**
 * Muestra resumen de grupos.
 */
function testGroupAssignmentsSummary() {
  const players = getPlayers().filter(p => String(p.group_id || '').trim() !== '');
  const grouped = {};

  players.forEach(player => {
    const groupId = String(player.group_id);
    if (!grouped[groupId]) grouped[groupId] = [];
    grouped[groupId].push(`${player.group_slot}:${player.player_id}`);
  });

  Object.keys(grouped).sort().forEach(groupId => {
    Logger.log('%s => %s', groupId, grouped[groupId].join(', '));
  });
}

/**
 * Muestra resumen de partidos por bloque.
 */
function testGroupMatchesSummary() {
  const matches = getMatches();

  [1, 2, 3].forEach(blockId => {
    const blockMatches = matches.filter(m => String(m.block_id) === String(blockId));
    Logger.log(`=== Bloque ${blockId} ===`);
    blockMatches.forEach(m => {
      Logger.log(
        'Mesa %s | %s | %s vs %s | árbitro %s',
        m.table_no,
        m.group_id,
        m.player_a_id,
        m.player_b_id,
        m.referee_player_id
      );
    });
  });
}

/**
 * Fuerza que el bloque actual esté en ventana de inicio
 * y ejecuta tick.
 */
function testTickStartCurrentBlock() {
  const current = getCurrentBlock();
  if (!current) throw new Error('No hay current_block_id configurado.');

  const now = new Date();
  const start = addMinutes(now, -1);
  const close = addMinutes(now, 14);
  const hard = addMinutes(now, 17);
  const end = addMinutes(now, 19);

  updateBlock(current.block_id, {
    status: 'scheduled',
    start_ts: start,
    close_signal_ts: close,
    hard_close_ts: hard,
    end_ts: end,
  });

  tickTournamentClock();

  Logger.log(JSON.stringify(getBlockById(current.block_id)));
  Logger.log(JSON.stringify(getMatchSummaryByBlock(current.block_id)));
}

/**
 * Fuerza que el bloque actual entre en closing
 * y ejecuta tick.
 */
function testTickEnterClosing() {
  const current = getCurrentBlock();
  if (!current) throw new Error('No hay current_block_id configurado.');

  const now = new Date();
  const start = addMinutes(now, -16);
  const close = addMinutes(now, -1);
  const hard = addMinutes(now, 2);
  const end = addMinutes(now, 4);

  updateBlock(current.block_id, {
    status: 'live',
    start_ts: start,
    close_signal_ts: close,
    hard_close_ts: hard,
    end_ts: end,
  });

  tickTournamentClock();

  Logger.log(JSON.stringify(getBlockById(current.block_id)));
}

/**
 * Fuerza que el bloque actual entre en transition.
 * Si hay partidos pendientes, los cierra automáticamente.
 */
function testTickEnterTransition() {
  const current = getCurrentBlock();
  if (!current) throw new Error('No hay current_block_id configurado.');

  const now = new Date();
  const start = addMinutes(now, -19);
  const close = addMinutes(now, -4);
  const hard = addMinutes(now, -1);
  const end = addMinutes(now, 1);

  updateBlock(current.block_id, {
    status: 'closing',
    start_ts: start,
    close_signal_ts: close,
    hard_close_ts: hard,
    end_ts: end,
  });

  tickTournamentClock();

  Logger.log(JSON.stringify(getBlockById(current.block_id)));
  Logger.log(JSON.stringify(getMatchSummaryByBlock(current.block_id)));
}

/**
 * Fuerza cierre del bloque y avance al siguiente.
 */
function testTickFinishAndActivateNext() {
  const current = getCurrentBlock();
  if (!current) throw new Error('No hay current_block_id configurado.');

  const now = new Date();
  const start = addMinutes(now, -21);
  const close = addMinutes(now, -6);
  const hard = addMinutes(now, -3);
  const end = addMinutes(now, -1);

  updateBlock(current.block_id, {
    status: 'transition',
    start_ts: start,
    close_signal_ts: close,
    hard_close_ts: hard,
    end_ts: end,
  });

  tickTournamentClock();

  Logger.log('Bloque cerrado: %s', JSON.stringify(getBlockById(current.block_id)));
  Logger.log('Nuevo current_block_id: %s', getConfigValue('current_block_id'));
  Logger.log('Siguiente bloque: %s', JSON.stringify(getCurrentBlock()));
}

/**
 * Ejecuta la secuencia completa de smoke test del reloj.
 */
function runClockSmokeTests() {
  testTickStartCurrentBlock();
  testTickEnterClosing();
  testTickEnterTransition();
  testTickFinishAndActivateNext();
}

function debugCurrentBlock() {
  Logger.log('current_block_id (Config): %s', getConfigValue('current_block_id'));

  const current = getCurrentBlock();
  Logger.log('current block object: %s', JSON.stringify(current));
}

function debugTickConditions() {
  const currentBlock = getCurrentBlock();
  if (!currentBlock) throw new Error('No hay bloque actual.');

  const now = new Date();
  const startTs = parseBlockDate(currentBlock.start_ts);
  const closeSignalTs = parseBlockDate(currentBlock.close_signal_ts);
  const hardCloseTs = parseBlockDate(currentBlock.hard_close_ts);
  const endTs = parseBlockDate(currentBlock.end_ts);

  Logger.log('status: %s', currentBlock.status);
  Logger.log('now: %s', now);
  Logger.log('startTs: %s', startTs);
  Logger.log('closeSignalTs: %s', closeSignalTs);
  Logger.log('hardCloseTs: %s', hardCloseTs);
  Logger.log('endTs: %s', endTs);

  Logger.log('cond scheduled->live: %s',
    String(currentBlock.status) === 'scheduled' &&
    startTs && now >= startTs && now < closeSignalTs
  );
}

/**
 * Carga resultados de ejemplo para un grupo y recalcula standings.
 * Útil para validar la lógica sin esperar el reloj.
 */
function testRecomputeGroupStandingsSimple() {
  // Requiere haber ejecutado antes testSetupGroupStage()
  const matches = getMatches().filter(m => String(m.group_id) === 'G01');

  if (matches.length !== 3) {
    throw new Error('No se encontraron 3 partidos para G01');
  }

  // G01-R1: A vence a B 2-0
  submitMatchResult(matches[0].match_id, {
    mode: 'final',
    sets_a: 2,
    sets_b: 0,
    submitted_by: matches[0].referee_player_id || 'system',
    submitted_by_role: 'referee',
  });

  // G01-R2: B vence a C 2-1
  submitMatchResult(matches[1].match_id, {
    mode: 'final',
    sets_a: 2,
    sets_b: 1,
    submitted_by: matches[1].referee_player_id || 'system',
    submitted_by_role: 'referee',
  });

  // G01-R3: A vence a C 2-1
  submitMatchResult(matches[2].match_id, {
    mode: 'final',
    sets_a: 2,
    sets_b: 1,
    submitted_by: matches[2].referee_player_id || 'system',
    submitted_by_role: 'referee',
  });

  recomputeGroupStandings();

  const groupRows = getGroupRows().filter(r => String(r.group_id) === 'G01');
  groupRows.forEach(r => Logger.log(JSON.stringify(r)));
}

/**
 * Fuerza un triple empate en G01:
 * A vence a B 2-0
 * B vence a C 2-0
 * C vence a A 2-0
 *
 * Todos quedan con 1 victoria y sets_diff 0.
 */
function testRecomputeGroupStandingsTripleTie() {
  const matches = getMatches().filter(m => String(m.group_id) === 'G01');

  if (matches.length !== 3) {
    throw new Error('No se encontraron 3 partidos para G01');
  }

  // Reset mínimo en esos matches
  matches.forEach(m => {
    updateMatch(m.match_id, {
      status: 'live',
      result_mode: '',
      sets_a: '',
      sets_b: '',
      closing_state: '',
      closing_state_resolved_from: '',
      winner_id: '',
      loser_id: '',
      result_source: '',
      submitted_by: '',
      submitted_at: '',
      auto_closed: false,
      needs_review: false,
      admin_note: '',
    });
  });

  // R1: A vs B => A 2-0
  submitMatchResult(matches[0].match_id, {
    mode: 'final',
    sets_a: 2,
    sets_b: 0,
    submitted_by: matches[0].referee_player_id || 'system',
    submitted_by_role: 'referee',
  });

  // R2: B vs C => B 2-0
  submitMatchResult(matches[1].match_id, {
    mode: 'final',
    sets_a: 2,
    sets_b: 0,
    submitted_by: matches[1].referee_player_id || 'system',
    submitted_by_role: 'referee',
  });

  // R3: A vs C => C 2-0, o sea A 0-2
  submitMatchResult(matches[2].match_id, {
    mode: 'final',
    sets_a: 0,
    sets_b: 2,
    submitted_by: matches[2].referee_player_id || 'system',
    submitted_by_role: 'referee',
  });

  recomputeGroupStandings();

  const groupRows = getGroupRows().filter(r => String(r.group_id) === 'G01');
  groupRows.forEach(r => Logger.log(JSON.stringify(r)));
}

/**
 * Prueba integración con reloj:
 * - setup grupos
 * - activa bloque 1
 * - cierra resultados del bloque 1
 * - fuerza transition
 * - recalcula standings
 */
function testBlockTransitionRecomputesStandings() {
  testSetupGroupStage();

  const current = getCurrentBlock();
  const blockMatches = getMatchesByBlock(current.block_id);

  // Cargamos resultados rápidos a todos los partidos del bloque actual
  blockMatches.forEach((match, idx) => {
    const even = idx % 2 === 0;

    submitMatchResult(match.match_id, {
      mode: 'final',
      sets_a: even ? 2 : 1,
      sets_b: even ? 0 : 2,
      submitted_by: match.referee_player_id || 'system',
      submitted_by_role: 'referee',
    });
  });

  // Forzar transition
  const now = new Date();
  updateBlock(current.block_id, {
    status: 'closing',
    start_ts: addMinutes(now, -19),
    close_signal_ts: addMinutes(now, -4),
    hard_close_ts: addMinutes(now, -1),
    end_ts: addMinutes(now, 1),
  });

  tickTournamentClock();

  Logger.log('Block after transition: %s', JSON.stringify(getBlockById(current.block_id)));

  const g1 = getGroupRows().filter(r => String(r.group_id) === 'G01');
  Logger.log('G01 rows after recompute:');
  g1.forEach(r => Logger.log(JSON.stringify(r)));
}