/**
 * Punto de entrada básico.
 * Ajusta SPREADSHEET_ID si el script no está vinculado al archivo.
 *
 * Si el script está vinculado al spreadsheet, puedes dejarlo vacío.
 */
const SPREADSHEET_ID = '';

/**
 * Prueba general rápida.
 */
function runSmokeTests() {
  Logger.log('=== Smoke tests ===');
  testReadConfig();
  testReadPlayers();
  testReadMatches();
  testReadBlocks();
  Logger.log('=== Fin smoke tests ===');
}

/**
 * Prueba de lectura de Config.
 */
function testReadConfig() {
  const config = getConfig();
  Logger.log('Config keys: %s', Object.keys(config).join(', '));
  Logger.log('tournament_mode: %s', getConfigValue('tournament_mode'));
}

/**
 * Prueba de lectura de Players.
 */
function testReadPlayers() {
  const players = getPlayers();
  Logger.log('Players count: %s', players.length);

  const checkedIn = getCheckedInPlayers();
  Logger.log('Checked-in players count: %s', checkedIn.length);

  if (players.length > 0) {
    Logger.log('First player: %s', JSON.stringify(players[0]));
  }
}

/**
 * Prueba de lectura de Matches.
 */
function testReadMatches() {
  const matches = getMatches();
  Logger.log('Matches count: %s', matches.length);

  if (matches.length > 0) {
    Logger.log('First match: %s', JSON.stringify(matches[0]));
  }
}

/**
 * Prueba de lectura de Blocks.
 */
function testReadBlocks() {
  const blocks = getBlocks();
  Logger.log('Blocks count: %s', blocks.length);

  if (blocks.length > 0) {
    Logger.log('First block: %s', JSON.stringify(blocks[0]));
  }
}

function testInitializeTournamentFlowV2() {
  initializeTournamentFlowV2();
  Logger.log('tournament_status=%s', getConfigValue('tournament_status'));

  getPlayers().forEach(p => {
    Logger.log(JSON.stringify({
      player_id: p.player_id,
      doubles_status: p.doubles_status,
      proposed_group_id: p.proposed_group_id,
      proposed_group_slot: p.proposed_group_slot,
    }));
  });
}

function testOpenSinglesGroupConfirmationWindow() {
  openSinglesGroupConfirmationWindow();

  Logger.log('tournament_status=%s', getConfigValue('tournament_status'));

  getPlayers().forEach(p => {
    Logger.log(JSON.stringify({
      player_id: p.player_id,
      proposed_group_id: p.proposed_group_id,
      proposed_group_slot: p.proposed_group_slot,
    }));
  });

  Logger.log(JSON.stringify(validateSinglesGroupCheckpoint()));
}

function testMovePlayerToProposedGroup() {
  openSinglesGroupConfirmationWindow();

  const players = getPlayersWithProposedGroups();
  if (players.length < 2) throw new Error('No hay suficientes jugadores con propuesta.');

  const player = players[0];
  const target = players[1];

  movePlayerToProposedGroup(player.player_id, target.proposed_group_id, target.proposed_group_slot);

  Logger.log('Player moved.');
  Logger.log(JSON.stringify(getPlayerById(player.player_id)));
  Logger.log(JSON.stringify(getPlayerById(target.player_id)));
  Logger.log(JSON.stringify(validateSinglesGroupCheckpoint()));
}

function testConfirmSinglesGroupsAndStartGroupStage() {
  openSinglesGroupConfirmationWindow();
  confirmSinglesGroupsAndStartGroupStage();

  Logger.log('tournament_status=%s', getConfigValue('tournament_status'));
  Logger.log('current_block_id=%s', getConfigValue('current_block_id'));
  Logger.log('Blocks count=%s', getBlocks().length);
  Logger.log('Groups count=%s', getGroupRows().length);

  const groupMatches = getMatches().filter(m => String(m.phase_type) === 'groups');
  Logger.log('Group matches count=%s', groupMatches.length);
}

function testReserveDoublesFinal() {
  testGenerateDoublesFromCut();

  for (let step = 0; step < 5; step++) {
    const scheduled = getDoublesMatches().filter(m => String(m.status) === 'scheduled');
    if (!scheduled.length) break;

    scheduled.forEach((match, idx) => {
      submitMatchResult(match.match_id, {
        mode: 'final',
        sets_a: idx % 2 === 0 ? 2 : 1,
        sets_b: idx % 2 === 0 ? 0 : 2,
        submitted_by: 'system-ref',
        submitted_by_role: 'referee',
      });
    });

    const result = progressDoublesOneRound();
    Logger.log(`step=${step} result=${JSON.stringify(result)}`);

    if (isDoublesFinalReserved()) break;
  }

  Logger.log('isDoublesFinalReserved=%s', isDoublesFinalReserved());
  Logger.log('doublesFinal=%s', JSON.stringify(getDoublesFinalMatch()));
}

function testReserveSinglesFinals() {
  // 1. Reset completo del flujo
  resetTournamentFlowV2();

  // 2. Abrir ventana de grupos y confirmar grupos
  openSinglesGroupConfirmationWindow();

  const validation = validateSinglesGroupCheckpoint();
  if (!validation.ok) {
    throw new Error(`Checkpoint de grupos inválido:\n- ${validation.errors.join('\n- ')}`);
  }

  confirmSinglesGroupsAndStartGroupStage();

  Logger.log('Después de confirmar grupos:');
  Logger.log('tournament_status=%s', getConfigValue('tournament_status'));
  Logger.log('current_block_id=%s', getConfigValue('current_block_id'));

  // 3. Resolver todos los matches de groups
  const groupMatches = getMatches().filter(m => String(m.phase_type) === 'groups');

  if (!groupMatches.length) {
    throw new Error('No se generaron matches de groups.');
  }

  groupMatches.forEach((match, idx) => {
    submitMatchResult(match.match_id, {
      mode: 'final',
      sets_a: idx % 2 === 0 ? 2 : 1,
      sets_b: idx % 2 === 0 ? 0 : 2,
      submitted_by: match.referee_player_id || 'system-ref',
      submitted_by_role: 'referee',
    });
  });

  recomputeGroupStandings();

  Logger.log('Groups recomputados.');

  // 4. Generar singles knockout
  setupSinglesEliminationStage();

  Logger.log('Singles knockout generado.');
  Logger.log('current_block_id antes de ajustar=%s', getConfigValue('current_block_id'));

  const firstSinglesBlock = getBlocksSorted()
    .filter(b => String(b.phase_type) === 'singles')
    .sort((a, b) => Number(a.block_id) - Number(b.block_id))[0];

  if (!firstSinglesBlock) {
    throw new Error('No se encontró bloque inicial de singles.');
  }

  setConfigValue('current_block_id', firstSinglesBlock.block_id, 'Bloque actual');
  setConfigValue('tournament_status', 'running_singles_knockout', 'Llaves de singles en curso');

  Logger.log('Primer bloque de singles=%s', JSON.stringify(firstSinglesBlock));

  // 5. Avanzar singles hasta reservar finales
  for (let step = 0; step < 8; step++) {
    const scheduledSingles = getMatches().filter(m =>
      String(m.phase_type) === 'singles' &&
      String(m.status) === 'scheduled'
    );

    Logger.log('step=%s scheduledSingles=%s', step, scheduledSingles.length);

    if (!scheduledSingles.length) {
      Logger.log('No quedan singles scheduled. Se detiene el loop.');
      break;
    }

    scheduledSingles.forEach((match, idx) => {
      submitMatchResult(match.match_id, {
        mode: 'final',
        sets_a: idx % 2 === 0 ? 2 : 1,
        sets_b: idx % 2 === 0 ? 0 : 2,
        submitted_by: 'system-ref',
        submitted_by_role: 'referee',
      });
    });

    const result = progressSinglesBracketsOneRound();
    Logger.log(`step=${step} result=${JSON.stringify(result)}`);

    if (areAllSinglesFinalsReserved()) {
      Logger.log('Las tres finales de singles ya quedaron reservadas.');
      break;
    }
  }

  // 6. Verificación final
  Logger.log('areAllSinglesFinalsReserved=%s', areAllSinglesFinalsReserved());

  const oroFinal = getSinglesFinalMatch('oro');
  const plataFinal = getSinglesFinalMatch('plata');
  const cobreFinal = getSinglesFinalMatch('cobre');

  Logger.log('oroFinal=%s', JSON.stringify(oroFinal));
  Logger.log('plataFinal=%s', JSON.stringify(plataFinal));
  Logger.log('cobreFinal=%s', JSON.stringify(cobreFinal));

  const reservedSinglesFinals = getMatches().filter(m =>
    String(m.phase_type) === 'singles' &&
    /_final$/.test(String(m.stage || ''))
  );

  Logger.log('Singles finals reserved count=%s', reservedSinglesFinals.length);

  reservedSinglesFinals.forEach(m => {
    Logger.log(JSON.stringify({
      match_id: m.match_id,
      stage: m.stage,
      round_no: m.round_no,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
      block_id: m.block_id,
      status: m.status,
    }));
  });
}

function testCreateDoublesFinalBlockIfNeeded() {
  resetTournamentFlowV2();
  testReserveDoublesFinal();

  const blockId = createDoublesFinalBlockIfNeeded();

  Logger.log('blockId=%s', blockId);
  Logger.log('current_block_id=%s', getConfigValue('current_block_id'));
  Logger.log('tournament_status=%s', getConfigValue('tournament_status'));
  Logger.log('current_block=%s', JSON.stringify(getCurrentBlock()));
  Logger.log('doublesFinal=%s', JSON.stringify(getDoublesFinalMatch()));
}

function testCreateSinglesFinalsBlockIfNeeded() {
  resetTournamentFlowV2();
  testReserveSinglesFinals();

  const blockId = createSinglesFinalsBlockIfNeeded();

  Logger.log('blockId=%s', blockId);
  Logger.log('current_block_id=%s', getConfigValue('current_block_id'));
  Logger.log('tournament_status=%s', getConfigValue('tournament_status'));
  Logger.log('current_block=%s', JSON.stringify(getCurrentBlock()));

  Logger.log('oroFinal=%s', JSON.stringify(getSinglesFinalMatch('oro')));
  Logger.log('plataFinal=%s', JSON.stringify(getSinglesFinalMatch('plata')));
  Logger.log('cobreFinal=%s', JSON.stringify(getSinglesFinalMatch('cobre')));
}

function testFinishTournamentFlowFinalBlocks() {
  resetTournamentFlowV2();

  // 1) reservar final de dobles
  testReserveDoublesFinal();

  // 2) programar final de dobles
  const doublesFinalBlockId = createDoublesFinalBlockIfNeeded();
  if (!doublesFinalBlockId) throw new Error('No se pudo crear bloque de final de dobles.');

  const doublesFinal = getDoublesFinalMatch();
  if (!doublesFinal) throw new Error('No existe final de dobles.');

  // 3) resolver final de dobles
  submitMatchResult(doublesFinal.match_id, {
    mode: 'final',
    sets_a: 2,
    sets_b: 1,
    submitted_by: 'system-ref',
    submitted_by_role: 'referee',
  });

  // 4) cerrar bloque de final de dobles
  const now = new Date();
  updateBlock(doublesFinalBlockId, {
    status: 'transition',
    start_ts: addMinutes(now, -21),
    close_signal_ts: addMinutes(now, -6),
    hard_close_ts: addMinutes(now, -3),
    end_ts: addMinutes(now, -1),
  });

  tickTournamentClock();

  Logger.log('Después de cerrar final de dobles:');
  Logger.log('tournament_status=%s', getConfigValue('tournament_status'));
  Logger.log('current_block_id=%s', getConfigValue('current_block_id'));
  Logger.log('current_block=%s', JSON.stringify(getCurrentBlock()));

  // 5) si todavía no existen finales de singles, reservarlas
  if (!areAllSinglesFinalsReserved()) {
    testReserveSinglesFinals();
    createSinglesFinalsBlockIfNeeded();
  }

  const currentBlock = getCurrentBlock();
  if (!currentBlock || !isSinglesFinalsBlock(currentBlock)) {
    const blockId = createSinglesFinalsBlockIfNeeded();
    Logger.log('Singles finals block created=%s', blockId);
  }

  const singlesFinalsBlock = getCurrentBlock();
  if (!singlesFinalsBlock || !isSinglesFinalsBlock(singlesFinalsBlock)) {
    throw new Error('No se logró programar el bloque de finales de singles.');
  }

  // 6) resolver finales de singles
  const finalMatches = getMatchesByBlock(singlesFinalsBlock.block_id).filter(m => String(m.phase_type) === 'singles');

  finalMatches.forEach((match, idx) => {
    submitMatchResult(match.match_id, {
      mode: 'final',
      sets_a: idx % 2 === 0 ? 2 : 1,
      sets_b: idx % 2 === 0 ? 0 : 2,
      submitted_by: 'system-ref',
      submitted_by_role: 'referee',
    });
  });

  // 7) cerrar bloque final de singles
  updateBlock(singlesFinalsBlock.block_id, {
    status: 'transition',
    start_ts: addMinutes(now, -21),
    close_signal_ts: addMinutes(now, -6),
    hard_close_ts: addMinutes(now, -3),
    end_ts: addMinutes(now, -1),
  });

  tickTournamentClock();

  Logger.log('Estado final del torneo=%s', getConfigValue('tournament_status'));
}

function testOpenDoublesConfirmationWindowV2() {
  resetTournamentFlowV2();
  openDoublesConfirmationWindow();

  Logger.log('tournament_status=%s', getConfigValue('tournament_status'));

  getPlayers().forEach(p => {
    Logger.log(JSON.stringify({
      player_id: p.player_id,
      checked_in: p.checked_in,
      is_singles_finalist: p.is_singles_finalist,
      doubles_status: p.doubles_status,
    }));
  });
}

function testGenerateDoublesFromCutV2() {
  resetTournamentFlowV2();
  openDoublesConfirmationWindow();

  const eligible = getPlayers().filter(p => String(p.doubles_status) === 'eligible');
  if (eligible.length < 8) throw new Error('No hay suficientes jugadores elegibles para test');

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

  const blockId = setupDoublesStageFromCut();

  Logger.log('blockId=%s', blockId);
  Logger.log('summary=%s', JSON.stringify(getDoublesStatusSummary()));

  getDoublesTeams().forEach(t => Logger.log(JSON.stringify(t)));
  getDoublesMatches().forEach(m => Logger.log(JSON.stringify({
    match_id: m.match_id,
    round_no: m.round_no,
    stage: m.stage,
    player_a_id: m.player_a_id,
    player_b_id: m.player_b_id,
    block_id: m.block_id,
    status: m.status,
  })));
}

function debugCurrentGroupRankingState() {
  const players = getPlayers().filter(p => String(p.group_id || '').trim() !== '');

  const rankSummary = {};
  players.forEach(player => {
    const rank = String(player.group_rank || '').trim() || '(blank)';
    rankSummary[rank] = (rankSummary[rank] || 0) + 1;
  });

  Logger.log('=== Group rank summary ===');
  Logger.log(JSON.stringify(rankSummary));

  const missingRank = players.filter(p => !String(p.group_rank || '').trim());
  Logger.log('Players without group_rank: %s', missingRank.length);
  missingRank.forEach(p => Logger.log(JSON.stringify({
    player_id: p.player_id,
    group_id: p.group_id,
    group_slot: p.group_slot,
    group_rank: p.group_rank,
  })));
}

function testSetupSinglesEliminationStageFromCurrentState() {
  Logger.log('=== testSetupSinglesEliminationStageFromCurrentState ===');

  debugCurrentGroupRankingState();

  const playersBefore = getPlayers().filter(p => String(p.group_id || '').trim() !== '');
  Logger.log('Players in singles pool: %s', playersBefore.length);

  setupSinglesEliminationStage();

  const oro = getPlayersBySinglesBracket('oro');
  const plata = getPlayersBySinglesBracket('plata');
  const cobre = getPlayersBySinglesBracket('cobre');

  Logger.log('Singles bracket counts => oro=%s plata=%s cobre=%s', oro.length, plata.length, cobre.length);

  const singlesMatches = getMatches().filter(m => String(m.phase_type) === 'singles');
  Logger.log('Singles matches generated: %s', singlesMatches.length);

  singlesMatches.forEach(m => Logger.log(JSON.stringify({
    match_id: m.match_id,
    bracket_type: m.bracket_type,
    round_no: m.round_no,
    stage: m.stage,
    player_a_id: m.player_a_id,
    player_b_id: m.player_b_id,
    block_id: m.block_id,
  })));
}

function debugPublicViewModel() {
  Logger.log('current_block_id config = %s', getConfigValue('current_block_id'));
  Logger.log('current block = %s', JSON.stringify(getCurrentBlock()));
  Logger.log('public vm = %s', JSON.stringify(getPublicViewModel()));
}