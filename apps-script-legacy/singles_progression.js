/**
 * Devuelve partidos de singles de un bracket.
 * @param {string} bracketType
 * @returns {Object[]}
 */
function getSinglesMatchesByBracket(bracketType) {
  return getMatches().filter(match =>
    String(match.phase_type) === 'singles' &&
    String(match.bracket_type) === String(bracketType)
  );
}

/**
 * Devuelve el máximo round_no existente para un bracket de singles.
 * @param {string} bracketType
 * @returns {number}
 */
function getMaxSinglesRoundNo(bracketType) {
  const matches = getSinglesMatchesByBracket(bracketType);
  if (!matches.length) return 0;

  return matches.reduce((max, m) => Math.max(max, Number(m.round_no || 0)), 0);
}

/**
 * Devuelve partidos de una ronda específica de un bracket.
 * @param {string} bracketType
 * @param {number} roundNo
 * @returns {Object[]}
 */
function getSinglesMatchesByBracketAndRound(bracketType, roundNo) {
  return getSinglesMatchesByBracket(bracketType)
    .filter(match => Number(match.round_no) === Number(roundNo))
    .sort((a, b) => String(a.slot_code || '').localeCompare(String(b.slot_code || '')));
}

/**
 * Devuelve true si una ronda completa de un bracket está resuelta.
 * @param {string} bracketType
 * @param {number} roundNo
 * @returns {boolean}
 */
function isSinglesRoundResolved(bracketType, roundNo) {
  const matches = getSinglesMatchesByBracketAndRound(bracketType, roundNo);
  if (!matches.length) return false;
  return matches.every(isMatchResolved);
}

/**
 * Devuelve ganadores de una ronda, en orden.
 * @param {string} bracketType
 * @param {number} roundNo
 * @returns {string[]}
 */
function getSinglesRoundWinners(bracketType, roundNo) {
  const matches = getSinglesMatchesByBracketAndRound(bracketType, roundNo);

  if (!matches.every(isMatchResolved)) {
    throw new Error(`La ronda ${roundNo} de ${bracketType} no está completamente resuelta.`);
  }

  return matches.map(match => String(match.winner_id || '').trim()).filter(Boolean);
}

/**
 * Determina etiqueta de ronda según cantidad de jugadores.
 * @param {number} numPlayers
 * @returns {string}
 */
function getRoundLabelByPlayerCount(numPlayers) {
  if (numPlayers === 8) return 'QF';
  if (numPlayers === 4) return 'SF';
  if (numPlayers === 2) return 'FINAL';
  if (numPlayers === 16) return 'R16';
  if (numPlayers === 32) return 'R32';
  return `R${numPlayers}`;
}

/**
 * Genera la siguiente ronda para un bracket, si corresponde.
 *
 * @param {string} bracketType
 * @returns {Object[]}
 */
function buildNextSinglesRound(bracketType) {
  const currentRound = getMaxSinglesRoundNo(bracketType);
  if (!currentRound) return [];

  if (!isSinglesRoundResolved(bracketType, currentRound)) {
    return [];
  }

  const winners = getSinglesRoundWinners(bracketType, currentRound);

  if (winners.length < 2) {
    return [];
  }

  if (winners.length % 2 !== 0) {
    throw new Error(`Cantidad impar de ganadores en ${bracketType}, ronda ${currentRound}: ${winners.length}`);
  }

  const nextRound = currentRound + 1;
  const roundLabel = getRoundLabelByPlayerCount(winners.length);

  const matches = [];
  for (let i = 0; i < winners.length; i += 2) {
    const matchNo = i / 2 + 1;

    matches.push({
      bracket_type: bracketType,
      round_no: nextRound,
      round_label: roundLabel,
      slot_code: `${bracketType.toUpperCase()}-${roundLabel}-M${matchNo}`,
      player_a_id: winners[i],
      player_b_id: winners[i + 1],
    });
  }

  return matches;
}

/**
 * Devuelve true si ya existe la ronda siguiente para ese bracket.
 * @param {string} bracketType
 * @param {number} roundNo
 * @returns {boolean}
 */
function singlesRoundAlreadyExists(bracketType, roundNo) {
  return getSinglesMatchesByBracketAndRound(bracketType, roundNo).length > 0;
}

/**
 * Inserta matches de una ronda de singles.
 *
 * @param {Object[]} roundMatches
 */
function appendSinglesRoundMatches(roundMatches) {
  if (!roundMatches.length) return;

  const existing = getMatches();
  let matchCounter = getNextMatchCounter(existing);

  roundMatches.forEach(match => {
    appendRow('Matches', {
      match_id: `M${String(matchCounter).padStart(4, '0')}`,
      block_id: '',
      phase_type: 'singles',
      stage: `${match.bracket_type}_${String(match.round_label).toLowerCase()}`,
      round_no: match.round_no,
      table_no: '',
      match_order: '',
      group_id: '',
      bracket_type: match.bracket_type,
      slot_code: match.slot_code,
      player_a_id: match.player_a_id,
      player_b_id: match.player_b_id,
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
 * Crea un nuevo bloque de singles SOLO para partidos pendientes no-final.
 * Las finales quedan reservadas sin bloque.
 *
 * @returns {number|null}
 */
function createNextSinglesBlockIfNeeded() {
  const pending = getMatches().filter(match =>
    String(match.phase_type) === 'singles' &&
    String(match.block_id || '') === '' &&
    !isSinglesFinalMatch(match)
  );

  if (!pending.length) return null;

  const blocks = getBlocksSorted();
  const lastBlock = blocks.length ? blocks[blocks.length - 1] : null;
  const startBase = lastBlock ? normalizeDateTimeText(lastBlock.end_ts) : getTournamentStartDate();

  const window = buildBlockWindowFromBase(startBase);

  const newBlockId = blocks.reduce((acc, b) => Math.max(acc, Number(b.block_id || 0)), 0) + 1;

  createBlock({
    block_id: newBlockId,
    phase_type: 'singles',
    phase_label: 'Singles · Siguiente ronda',
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

  const nowPending = getMatches().filter(match =>
    String(match.phase_type) === 'singles' &&
    String(match.block_id || '') === '' &&
    !isSinglesFinalMatch(match)
  );

  nowPending.forEach(match => {
    match.block_id = newBlockId;
  });

  assignTablesAndMatchOrderByBlock(nowPending, function (a, b) {
    const x = String(a.bracket_type || '').localeCompare(String(b.bracket_type || ''));
    if (x !== 0) return x;
    return String(a.slot_code || '').localeCompare(String(b.slot_code || ''));
  });

  nowPending.forEach(match => {
    updateMatch(match.match_id, {
      block_id: newBlockId,
      table_no: match.table_no,
      match_order: match.match_order,
    });
  });

  return newBlockId;
}

/**
 * Devuelve true si un match de singles es final.
 * @param {Object} match
 * @returns {boolean}
 */
function isSinglesFinalMatch(match) {
  return String(match.phase_type) === 'singles' && /_final$/.test(String(match.stage || ''));
}

/**
 * Devuelve el match final de un bracket si existe.
 * @param {string} bracketType
 * @returns {Object|null}
 */
function getSinglesFinalMatch(bracketType) {
  const finals = getSinglesMatchesByBracket(bracketType).filter(m =>
    String(m.stage) === `${bracketType}_final`
  );

  return finals.length ? finals[0] : null;
}

/**
 * Devuelve true si la final de un bracket ya está creada.
 * @param {string} bracketType
 * @returns {boolean}
 */
function isSinglesFinalReserved(bracketType) {
  return !!getSinglesFinalMatch(bracketType);
}

/**
 * Devuelve true si las tres finales de singles existen.
 * @returns {boolean}
 */
function areAllSinglesFinalsReserved() {
  return ['oro', 'plata', 'cobre'].every(isSinglesFinalReserved);
}

/**
 * Devuelve true si las tres finales de singles están resueltas.
 * @returns {boolean}
 */
function areAllSinglesFinalsResolved() {
  return ['oro', 'plata', 'cobre'].every(bracketType => {
    const finalMatch = getSinglesFinalMatch(bracketType);
    return finalMatch ? isMatchResolved(finalMatch) : false;
  });
}

/**
 * Avanza singles una ronda por bracket si corresponde.
 * Si la siguiente ronda es FINAL, la crea reservada (sin bloque).
 *
 * @returns {{
 *   createdMatches:number,
 *   newBlockId:number|null
 * }}
 */
function progressSinglesBracketsOneRound() {
  const brackets = ['oro', 'plata', 'cobre'];
  let createdMatches = 0;

  brackets.forEach(bracketType => {
    const currentRound = getMaxSinglesRoundNo(bracketType);
    if (!currentRound) return;
    if (!isSinglesRoundResolved(bracketType, currentRound)) return;

    const nextRoundMatches = buildNextSinglesRound(bracketType);
    if (!nextRoundMatches.length) return;

    const nextRoundNo = Number(nextRoundMatches[0].round_no);
    if (singlesRoundAlreadyExists(bracketType, nextRoundNo)) return;

    appendSinglesRoundMatches(nextRoundMatches);
    createdMatches += nextRoundMatches.length;
  });

  const newBlockId = createdMatches > 0 ? createNextSinglesBlockIfNeeded() : null;

  return {
    createdMatches,
    newBlockId,
  };
}

/**
 * Devuelve finalistas de oro si están definidos.
 *
 * @returns {string[]}
 */
function getGoldFinalistsIfDefined() {
  const oroMatches = getSinglesMatchesByBracket('oro');
  if (!oroMatches.length) return [];

  const finalMatch = getSinglesFinalMatch('oro');
  if (finalMatch) {
    const a = String(finalMatch.player_a_id || '').trim();
    const b = String(finalMatch.player_b_id || '').trim();
    if (a && b) return [a, b];
  }

  const semis = oroMatches.filter(m => String(m.stage) === 'oro_sf');
  if (semis.length === 2 && semis.every(isMatchResolved)) {
    return semis.map(m => String(m.winner_id || '').trim()).filter(Boolean);
  }

  return [];
}

/**
 * Marca finalistas de oro si aplica.
 * En V2 ya NO toca dobles_status ni doubles_eligible.
 */
function markGoldFinalistsIfApplicable() {
  const finalists = getGoldFinalistsIfDefined();
  if (finalists.length !== 2) return;

  getPlayers().forEach(player => {
    const isFinalist = finalists.includes(String(player.player_id));
    updatePlayer(player.player_id, {
      is_singles_finalist: isFinalist,
      singles_status: isFinalist ? 'finalist' : String(player.singles_status || 'active'),
    });
  });
}
