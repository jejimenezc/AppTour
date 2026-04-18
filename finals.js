/**
 * Devuelve true si existe una final reservada de dobles sin bloque.
 * @returns {boolean}
 */
function isReservedDoublesFinalPendingBlock() {
  const finalMatch = getDoublesFinalMatch();
  return !!(finalMatch && String(finalMatch.block_id || '').trim() === '');
}

/**
 * Devuelve true si existen las tres finales de singles reservadas sin bloque.
 * @returns {boolean}
 */
function areReservedSinglesFinalsPendingBlock() {
  return ['oro', 'plata', 'cobre'].every(bracketType => {
    const match = getSinglesFinalMatch(bracketType);
    return !!(match && String(match.block_id || '').trim() === '');
  });
}

/**
 * Devuelve la fecha base para crear un nuevo bloque final:
 * el end_ts del último bloque existente.
 *
 * @returns {Date}
 */
function getNextBlockStartBase() {
  const blocks = getBlocksSorted();
  const lastBlock = blocks.length ? blocks[blocks.length - 1] : null;
  return lastBlock ? parseBlockDate(lastBlock.end_ts) : getTournamentStartDate();
}

/**
 * Devuelve el próximo block_id disponible.
 *
 * @returns {number}
 */
function getNextBlockId() {
  return getBlocksSorted().reduce((acc, b) => Math.max(acc, Number(b.block_id || 0)), 0) + 1;
}

/**
 * Crea el bloque para la final de dobles si está reservada.
 *
 * @returns {number|null}
 */
function createDoublesFinalBlockIfNeeded() {
  if (!isReservedDoublesFinalPendingBlock()) return null;

  const finalMatch = getDoublesFinalMatch();
  if (!finalMatch) return null;

  const startBase = getNextBlockStartBase();
  const start = addMinutes(startBase, 0);
  const closeSignal = addMinutes(start, 15);
  const hardClose = addMinutes(start, 18);
  const end = addMinutes(start, 20);

  const newBlockId = getNextBlockId();

  createBlock({
    block_id: newBlockId,
    phase_type: 'doubles',
    phase_label: 'Final de dobles',
    start_ts: start,
    close_signal_ts: closeSignal,
    hard_close_ts: hardClose,
    end_ts: end,
    status: 'scheduled',
    published_at: '',
    closed_at: '',
    advance_done: false,
    notes: 'Bloque final reservado de dobles',
  });

  updateMatch(finalMatch.match_id, {
    block_id: newBlockId,
    table_no: 1,
    match_order: 1,
  });

  setConfigValue('current_block_id', newBlockId, 'Bloque actual');
  setConfigValue('tournament_status', 'running_finals', 'Final de dobles programada');

  return newBlockId;
}

/**
 * Crea el bloque para las tres finales de singles si están reservadas.
 *
 * @returns {number|null}
 */
function createSinglesFinalsBlockIfNeeded() {
  if (!areReservedSinglesFinalsPendingBlock()) return null;

  const oroFinal = getSinglesFinalMatch('oro');
  const plataFinal = getSinglesFinalMatch('plata');
  const cobreFinal = getSinglesFinalMatch('cobre');

  if (!oroFinal || !plataFinal || !cobreFinal) return null;

  const startBase = getNextBlockStartBase();
  const start = addMinutes(startBase, 0);
  const closeSignal = addMinutes(start, 15);
  const hardClose = addMinutes(start, 18);
  const end = addMinutes(start, 20);

  const newBlockId = getNextBlockId();

  createBlock({
    block_id: newBlockId,
    phase_type: 'singles',
    phase_label: 'Finales de singles',
    start_ts: start,
    close_signal_ts: closeSignal,
    hard_close_ts: hardClose,
    end_ts: end,
    status: 'scheduled',
    published_at: '',
    closed_at: '',
    advance_done: false,
    notes: 'Bloque final reservado de singles',
  });

  updateMatch(oroFinal.match_id, {
    block_id: newBlockId,
    table_no: 1,
    match_order: 1,
  });

  updateMatch(plataFinal.match_id, {
    block_id: newBlockId,
    table_no: 2,
    match_order: 2,
  });

  updateMatch(cobreFinal.match_id, {
    block_id: newBlockId,
    table_no: 3,
    match_order: 3,
  });

  setConfigValue('current_block_id', newBlockId, 'Bloque actual');
  setConfigValue('tournament_status', 'running_finals', 'Finales de singles programadas');

  return newBlockId;
}

/**
 * Devuelve true si el bloque corresponde exclusivamente a la final de dobles.
 *
 * @param {Object} block
 * @returns {boolean}
 */
function isDoublesFinalBlock(block) {
  if (!block) return false;
  const matches = getMatchesByBlock(block.block_id);
  if (String(block.phase_type) !== 'doubles') return false;
  return matches.length === 1 && matches.every(isDoublesFinalMatch);
}

/**
 * Devuelve true si el bloque corresponde a las finales de singles.
 *
 * @param {Object} block
 * @returns {boolean}
 */
function isSinglesFinalsBlock(block) {
  if (!block) return false;
  const matches = getMatchesByBlock(block.block_id).filter(m => String(m.phase_type) === 'singles');
  if (String(block.phase_type) !== 'singles') return false;
  if (matches.length !== 3) return false;

  const stages = matches.map(m => String(m.stage || '')).sort();
  return stages.join(',') === 'cobre_final,oro_final,plata_final';
}