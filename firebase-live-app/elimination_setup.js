/**
 * Devuelve true si todos los partidos de groups están resueltos.
 * @returns {boolean}
 */
function areAllGroupMatchesResolved() {
  const groupMatches = getMatches().filter(m => String(m.phase_type) === 'groups');
  if (groupMatches.length === 0) return false;

  return groupMatches.every(isMatchResolved);
}

/**
 * Asigna brackets oro/plata/cobre y genera primera ronda.
 */
function setupSinglesEliminationStage() {
  if (!areAllGroupMatchesResolved()) {
    throw new Error('La fase de grupos aún no está completamente resuelta.');
  }

  const players = getPlayers().filter(p => String(p.group_id || '').trim() !== '');
  const playersWithoutRank = players.filter(p => !Number(p.group_rank));

  if (playersWithoutRank.length > 0) {
    throw new Error('No se puede generar singles knockout: hay jugadores sin group_rank. RecomputeGroupStandings no se ha aplicado correctamente.');
  }

  assignSinglesBracketsFromGroupRanks();

  clearBracketSlots();

  const oroPlayers = getPlayersBySinglesBracket('oro');
  const plataPlayers = getPlayersBySinglesBracket('plata');
  const cobrePlayers = getPlayersBySinglesBracket('cobre');

  const oroMatchups = buildInitialBracketMatchups('oro', oroPlayers);
  const plataMatchups = buildInitialBracketMatchups('plata', plataPlayers);
  const cobreMatchups = buildInitialBracketMatchups('cobre', cobrePlayers);

  const allMatchups = [...oroMatchups, ...plataMatchups, ...cobreMatchups];

  writeInitialBracketSlots(allMatchups);
  generateInitialEliminationMatches(allMatchups);
  createInitialEliminationBlocks(allMatchups);

  setConfigValue('tournament_status', 'running_singles_knockout', 'Llaves de singles generadas');
}

/**
 * Escribe BracketSlots mínimos para ronda inicial.
 *
 * @param {Object[]} matchups
 */
function writeInitialBracketSlots(matchups) {
  const rows = matchups.map(m => ({
    bracket_type: m.bracket_type,
    round_no: m.round_no,
    slot_code: m.slot_code,
    source_type_a: 'fixed_player',
    source_value_a: m.player_a_id,
    source_type_b: 'fixed_player',
    source_value_b: m.player_b_id,
    winner_to_slot: '',
    loser_to_slot: '',
    assigned_a: m.player_a_id,
    assigned_b: m.player_b_id,
    resolved: false,
  }));

  replaceBracketSlots(rows);
}

/**
 * Genera Matches para primera ronda de singles.
 * Los byes quedan resueltos automáticamente.
 *
 * @param {Object[]} matchups
 */
function generateInitialEliminationMatches(matchups) {
  const existing = getMatches();
  let matchCounter = getNextMatchCounter(existing);

  const rows = existing.slice();

  matchups.forEach(m => {
    const isBye = !m.player_a_id || !m.player_b_id;

    let winnerId = '';
    let loserId = '';
    let status = 'scheduled';
    let resultMode = '';
    let setsA = '';
    let setsB = '';
    let resultSource = '';
    let autoClosed = false;
    let needsReview = false;
    let note = '';

    if (isBye) {
      winnerId = m.player_a_id || m.player_b_id || '';
      loserId = '';
      status = 'auto_closed';
      resultMode = 'final';
      setsA = m.player_a_id ? 2 : 0;
      setsB = m.player_b_id ? 2 : 0;
      resultSource = 'auto_rule';
      autoClosed = true;
      note = 'Advance by bye';
    }

    rows.push({
      match_id: `M${String(matchCounter).padStart(4, '0')}`,
      block_id: '', // se asigna después
      phase_type: 'singles',
      stage: `${m.bracket_type}_${m.round_label.toLowerCase()}`,
      round_no: m.round_no,
      table_no: '',
      match_order: '',
      group_id: '',
      bracket_type: m.bracket_type,
      slot_code: m.slot_code,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
      referee_player_id: '',
      status,
      result_mode: resultMode,
      sets_a: setsA,
      sets_b: setsB,
      closing_state: '',
      closing_state_resolved_from: '',
      winner_id: winnerId,
      loser_id: loserId,
      result_source: resultSource,
      submitted_by: isBye ? 'system' : '',
      submitted_at: isBye ? nowIso() : '',
      auto_closed: autoClosed,
      needs_review: needsReview,
      admin_note: note,
    });

    matchCounter++;
  });

  replaceAllRows('Matches', rows);
}

/**
 * Crea bloques iniciales para la primera ronda de singles.
 *
 * Reglas:
 * - si 12 jugadores => 4 por bracket => SF => 2 partidos por bracket = 6 total => 1 bloque
 * - si 18 jugadores => 6 por bracket => QF con byes => 4 partidos por bracket = 12 total => 1 bloque
 * - si 24 jugadores => 8 por bracket => QF => 4 partidos por bracket = 12 total => 1 bloque
 * - si 36 jugadores => 12 por bracket => R16 parcial => 4 partidos por bracket = 12 total => 1 bloque
 *
 * @param {Object[]} matchups
 */
function createInitialEliminationBlocks(matchups) {
  const blocks = getBlocks();
  const maxBlockId = blocks.reduce((acc, b) => Math.max(acc, Number(b.block_id || 0)), 0);

  const lastBlock = blocks.length ? getBlocksSorted()[blocks.length - 1] : null;
  const startBase = lastBlock ? normalizeDateTimeText(lastBlock.end_ts) : getTournamentStartDate();

  const window = buildBlockWindowFromBase(startBase);

  const newBlockId = maxBlockId + 1;

  createBlock({
    block_id: newBlockId,
    phase_type: 'singles',
    phase_label: 'Singles · Primera ronda',
    start_ts: window.start,
    close_signal_ts: window.closeSignal,
    hard_close_ts: window.hardClose,
    end_ts: window.end,
    status: 'scheduled',
    published_at: '',
    closed_at: '',
    advance_done: false,
    notes: '',
  });

  // asignar este bloque a los matches nuevos de la ronda 1 no-group
  const matches = getMatches();
  const rows = matches.slice();

  const initialSingles = rows.filter(m =>
    String(m.phase_type) === 'singles' &&
    Number(m.round_no) === 1 &&
    String(m.block_id || '') === ''
  );

  initialSingles.sort((a, b) => {
    const x = String(a.bracket_type).localeCompare(String(b.bracket_type));
    if (x !== 0) return x;
    return String(a.slot_code).localeCompare(String(b.slot_code));
  });

  initialSingles.forEach(match => {
    match.block_id = newBlockId;
  });

  assignTablesAndMatchOrderByBlock(initialSingles, function (a, b) {
    const x = String(a.bracket_type || '').localeCompare(String(b.bracket_type || ''));
    if (x !== 0) return x;
    return String(a.slot_code || '').localeCompare(String(b.slot_code || ''));
  });

  initialSingles.forEach(match => {
    updateMatch(match.match_id, {
      block_id: newBlockId,
      table_no: match.table_no,
      match_order: match.match_order,
    });
  });
}

/**
 * Obtiene el siguiente correlativo para match_id.
 * @param {Object[]} matches
 * @returns {number}
 */
function getNextMatchCounter(matches) {
  let max = 0;

  matches.forEach(match => {
    const raw = String(match.match_id || '');
    const n = Number(raw.replace(/^M/, ''));
    if (!Number.isNaN(n)) {
      max = Math.max(max, n);
    }
  });

  return max + 1;
}

/**
 * Prepara una clasificación artificial completa para poder probar setup de llaves.
 * Útil si no quieres cargar todos los resultados manualmente.
 */
function seedFakeGroupRanksForTesting() {
  const players = getPlayers().filter(p => String(p.group_id || '').trim() !== '');

  // Orden por grupo y slot A/B/C => ranks 1/2/3
  const slotRank = { A: 1, B: 2, C: 3 };

  players.forEach(player => {
    const rank = slotRank[String(player.group_slot)];
    updatePlayer(player.player_id, {
      group_rank: rank,
    });
  });

  recomputeGroupsSheetFromPlayerRanksOnly();
}

/**
 * Reconstruye Groups desde Players.group_rank manteniendo stats vacíos.
 * Solo para test rápido del paso 5.
 */
function recomputeGroupsSheetFromPlayerRanksOnly() {
  const players = getPlayers().filter(p => String(p.group_id || '').trim() !== '');
  const rows = players.map(player => ({
    group_id: player.group_id,
    player_id: player.player_id,
    played: '',
    wins: '',
    losses: '',
    sets_for: '',
    sets_against: '',
    sets_diff: '',
    rank_in_group: player.group_rank,
    tie_break_note: 'Seeded for testing',
  }));

  replaceGroupRows(rows);
}

/**
 * Marca todos los partidos de grupos como resueltos artificialmente
 * para habilitar setupSinglesEliminationStage().
 */
function forceResolveAllGroupMatchesForTesting() {
  const matches = getMatches().filter(m => String(m.phase_type) === 'groups');

  matches.forEach(match => {
    updateMatch(match.match_id, {
      status: 'auto_closed',
      result_mode: 'final',
      sets_a: 2,
      sets_b: 0,
      winner_id: match.player_a_id,
      loser_id: match.player_b_id,
      result_source: 'auto_rule',
      submitted_by: 'system',
      submitted_at: nowIso(),
      auto_closed: true,
      needs_review: false,
      admin_note: 'Forced resolution for testing',
    });
  });
}

/**
 * Test principal del paso 5.
 */
function testSetupSinglesEliminationStage() {
  testSetupGroupStage();
  seedFakeGroupRanksForTesting();
  assignSinglesBracketsFromGroupRanks();
  forceResolveAllGroupMatchesForTesting();

  setupSinglesEliminationStage();

  Logger.log('Tournament status: %s', getConfigValue('tournament_status'));

  const oro = getPlayersBySinglesBracket('oro');
  const plata = getPlayersBySinglesBracket('plata');
  const cobre = getPlayersBySinglesBracket('cobre');

  Logger.log('oro=%s plata=%s cobre=%s', oro.length, plata.length, cobre.length);

  const singlesMatches = getMatches().filter(m => String(m.phase_type) === 'singles');
  Logger.log('Singles matches count: %s', singlesMatches.length);

  const latestBlock = getBlocksSorted().slice(-1)[0];
  Logger.log('Latest block: %s', JSON.stringify(latestBlock));

  singlesMatches.forEach(m => {
    Logger.log(JSON.stringify({
      match_id: m.match_id,
      bracket_type: m.bracket_type,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
      status: m.status,
      block_id: m.block_id,
      table_no: m.table_no,
    }));
  });
}
