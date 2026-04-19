/**
 * Devuelve partidos de dobles.
 * @returns {Object[]}
 */
function getDoublesMatches() {
  return getMatches().filter(match => String(match.phase_type) === 'doubles');
}

/**
 * Devuelve partidos de dobles por ronda.
 * @param {number} roundNo
 * @returns {Object[]}
 */
function getDoublesMatchesByRound(roundNo) {
  return getDoublesMatches()
    .filter(match => Number(match.round_no) === Number(roundNo))
    .sort((a, b) => String(a.slot_code || '').localeCompare(String(b.slot_code || '')));
}

/**
 * Devuelve round_no máximo de dobles.
 * @returns {number}
 */
function getMaxDoublesRoundNo() {
  const matches = getDoublesMatches();
  if (!matches.length) return 0;
  return matches.reduce((max, m) => Math.max(max, Number(m.round_no || 0)), 0);
}

/**
 * Verifica si una ronda de dobles está resuelta.
 * @param {number} roundNo
 * @returns {boolean}
 */
function isDoublesRoundResolved(roundNo) {
  const matches = getDoublesMatchesByRound(roundNo);
  if (!matches.length) return false;
  return matches.every(isMatchResolved);
}

/**
 * Devuelve ganadores de ronda de dobles.
 * @param {number} roundNo
 * @returns {string[]}
 */
function getDoublesRoundWinners(roundNo) {
  const matches = getDoublesMatchesByRound(roundNo);
  if (!matches.every(isMatchResolved)) {
    throw new Error(`La ronda ${roundNo} de dobles no está resuelta.`);
  }

  return matches.map(m => String(m.winner_id || '').trim()).filter(Boolean);
}

/**
 * Devuelve true si un match de dobles es final.
 * @param {Object} match
 * @returns {boolean}
 */
function isDoublesFinalMatch(match) {
  return String(match.phase_type) === 'doubles' && String(match.stage) === 'doubles_final';
}

/**
 * Devuelve el match final de dobles si existe.
 * @returns {Object|null}
 */
function getDoublesFinalMatch() {
  const finals = getDoublesMatches().filter(match => String(match.stage) === 'doubles_final');
  return finals.length ? finals[0] : null;
}

/**
 * Devuelve true si la final de dobles ya está creada.
 * @returns {boolean}
 */
function isDoublesFinalReserved() {
  return !!getDoublesFinalMatch();
}

/**
 * Genera la siguiente ronda de dobles.
 * @returns {Object[]}
 */
function buildNextDoublesRound() {
  const currentRound = getMaxDoublesRoundNo();
  if (!currentRound) return [];

  if (!isDoublesRoundResolved(currentRound)) return [];

  const winners = getDoublesRoundWinners(currentRound);
  if (winners.length < 2) return [];

  const nextRound = currentRound + 1;
  const roundLabel = getRoundLabelByPlayerCount(winners.length);

  const matches = [];
  for (let i = 0; i < winners.length; i += 2) {
    matches.push({
      round_no: nextRound,
      round_label: roundLabel,
      slot_code: `D-${roundLabel}-M${i / 2 + 1}`,
      team_a_id: winners[i],
      team_b_id: winners[i + 1],
    });
  }

  return matches;
}

/**
 * Verifica si ya existe la siguiente ronda de dobles.
 * @param {number} roundNo
 * @returns {boolean}
 */
function doublesRoundAlreadyExists(roundNo) {
  return getDoublesMatchesByRound(roundNo).length > 0;
}

/**
 * Inserta la siguiente ronda de dobles.
 * @param {Object[]} matches
 */
function appendDoublesRoundMatches(matches) {
  if (!matches.length) return;

  const existing = getMatches();
  let matchCounter = getNextMatchCounter(existing);

  matches.forEach(match => {
    appendRow('Matches', {
      match_id: `M${String(matchCounter).padStart(4, '0')}`,
      block_id: '',
      phase_type: 'doubles',
      stage: `doubles_${String(match.round_label).toLowerCase()}`,
      round_no: match.round_no,
      table_no: '',
      match_order: '',
      group_id: '',
      bracket_type: 'doubles',
      slot_code: match.slot_code,
      player_a_id: match.team_a_id,
      player_b_id: match.team_b_id,
      referee_player_id: '',
      status: 'scheduled',
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

    matchCounter++;
  });
}

/**
 * Crea siguiente bloque de dobles SOLO para partidos no-final.
 * La final queda reservada sin bloque.
 *
 * @returns {number|null}
 */
function createNextDoublesBlockIfNeeded() {
  const pending = getMatches().filter(match =>
    String(match.phase_type) === 'doubles' &&
    String(match.block_id || '') === '' &&
    !isDoublesFinalMatch(match)
  );

  if (!pending.length) return null;

  const blocks = getBlocksSorted();
  const lastBlock = blocks.length ? blocks[blocks.length - 1] : null;
  const startBase = lastBlock ? parseBlockDate(lastBlock.end_ts) : getTournamentStartDate();

  const window = buildBlockWindowFromBase(startBase);

  const newBlockId = blocks.reduce((acc, b) => Math.max(acc, Number(b.block_id || 0)), 0) + 1;

  createBlock({
    block_id: newBlockId,
    phase_type: 'doubles',
    phase_label: 'Dobles · Siguiente ronda',
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

  const pendingNow = getMatches().filter(match =>
    String(match.phase_type) === 'doubles' &&
    String(match.block_id || '') === '' &&
    !isDoublesFinalMatch(match)
  );

  pendingNow.forEach(match => {
    match.block_id = newBlockId;
  });

  assignTablesAndMatchOrderByBlock(pendingNow, function (a, b) {
    return String(a.slot_code || '').localeCompare(String(b.slot_code || ''));
  });

  pendingNow.forEach(match => {
    updateMatch(match.match_id, {
      block_id: newBlockId,
      table_no: match.table_no,
      match_order: match.match_order,
    });
  });

  return newBlockId;
}

/**
 * Avanza dobles una ronda.
 * Si la siguiente ronda es FINAL, la crea reservada (sin bloque).
 *
 * @returns {{createdMatches:number, newBlockId:number|null}}
 */
function progressDoublesOneRound() {
  const currentRound = getMaxDoublesRoundNo();
  if (!currentRound) return { createdMatches: 0, newBlockId: null };
  if (!isDoublesRoundResolved(currentRound)) return { createdMatches: 0, newBlockId: null };

  const nextRoundMatches = buildNextDoublesRound();
  if (!nextRoundMatches.length) return { createdMatches: 0, newBlockId: null };

  const nextRoundNo = nextRoundMatches[0].round_no;
  if (doublesRoundAlreadyExists(nextRoundNo)) {
    return { createdMatches: 0, newBlockId: null };
  }

  appendDoublesRoundMatches(nextRoundMatches);
  const newBlockId = createNextDoublesBlockIfNeeded();

  return {
    createdMatches: nextRoundMatches.length,
    newBlockId,
  };
}

/**
 * Devuelve true si la final de dobles está resuelta.
 * @returns {boolean}
 */
function isDoublesFinalResolved() {
  const finalMatch = getDoublesFinalMatch();
  return finalMatch ? isMatchResolved(finalMatch) : false;
}
