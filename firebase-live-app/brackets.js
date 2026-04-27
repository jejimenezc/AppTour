/**
 * Limpia BracketSlots.
 */
function clearBracketSlots() {
  replaceAllRows('BracketSlots', []);
}

/**
 * Devuelve filas de BracketSlots.
 * @returns {Object[]}
 */
function getBracketSlots() {
  return getRows('BracketSlots');
}

/**
 * Agrega multiples slots a BracketSlots.
 * @param {Object[]} slots
 */
function replaceBracketSlots(slots) {
  replaceAllRows('BracketSlots', slots);
}

/**
 * Devuelve tamano de cuadro potencia de 2.
 * @param {number} n
 * @returns {number}
 */
function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Genera seed positions clasicos para bracket power-of-two.
 * Devuelve array de seeds en orden de posiciones.
 *
 * Ejemplos:
 * n=2 => [1,2]
 * n=4 => [1,4,3,2]
 * n=8 => [1,8,5,4,3,6,7,2]
 *
 * @param {number} size
 * @returns {number[]}
 */
function generateSeedPositions(size) {
  if (size === 1) return [1];
  let arr = [1, 2];

  while (arr.length < size) {
    const nextSize = arr.length * 2 + 1;
    const next = [];

    arr.forEach(seed => {
      next.push(seed);
      next.push(nextSize - seed);
    });

    arr = next;
  }

  return arr;
}

/**
 * Ordena jugadores de un bracket usando:
 * - group_id ascendente
 * - player_id ascendente
 *
 * Mas adelante esto se puede mejorar con siembra real.
 *
 * @param {Object[]} players
 * @returns {Object[]}
 */
function orderPlayersForBracket(players) {
  return players.slice().sort((a, b) => {
    const g = String(a.group_id || '').localeCompare(String(b.group_id || ''));
    if (g !== 0) return g;
    return String(a.player_id || '').localeCompare(String(b.player_id || ''));
  });
}

/**
 * Construye el cuadro de primera ronda con byes si hace falta.
 *
 * Devuelve pares de enfrentamiento para la ronda 1:
 * [{slot_code, seed_a, player_a_id, seed_b, player_b_id, winner_to_slot}, ...]
 *
 * @param {string} bracketType
 * @param {Object[]} players
 * @returns {Object[]}
 */
function buildInitialBracketMatchups(bracketType, players) {
  const ordered = orderPlayersForBracket(players);
  const n = ordered.length;
  const size = nextPowerOfTwo(n);
  const positions = generateSeedPositions(size);

  // seed number -> player or bye
  const seededMap = {};
  for (let seed = 1; seed <= size; seed++) {
    seededMap[seed] = seed <= n ? ordered[seed - 1] : null;
  }

  const positionedPlayers = positions.map(seed => ({
    seed,
    player: seededMap[seed],
  }));

  const round1 = [];
  const roundLabel = getRoundLabelByPlayerCount(size);

  for (let i = 0; i < positionedPlayers.length; i += 2) {
    const left = positionedPlayers[i];
    const right = positionedPlayers[i + 1];
    const matchNo = i / 2 + 1;

    round1.push({
      bracket_type: bracketType,
      round_no: 1,
      round_label: roundLabel,
      slot_code: `${bracketType.toUpperCase()}-${roundLabel}-M${matchNo}`,
      seed_a: left.seed,
      player_a_id: left.player ? left.player.player_id : '',
      seed_b: right.seed,
      player_b_id: right.player ? right.player.player_id : '',
      has_bye: !left.player || !right.player,
    });
  }

  return round1;
}

/**
 * Normaliza la etiqueta de ronda para uso visible en phase_label.
 *
 * @param {string} roundLabel
 * @returns {string}
 */
function getVisibleRoundLabel_(roundLabel) {
  const value = String(roundLabel || '').trim().toUpperCase();
  if (!value) return '';
  if (value === 'FINAL' || value === 'F') return 'Final';
  return value;
}

/**
 * Construye phase_label de bloque segun fase y ronda real.
 *
 * @param {string} phaseType
 * @param {string} roundLabel
 * @returns {string}
 */
function buildPhaseLabelFromRound_(phaseType, roundLabel) {
  const phase = String(phaseType || '').trim().toLowerCase();
  const visibleRoundLabel = getVisibleRoundLabel_(roundLabel);

  if (phase === 'doubles') {
    return visibleRoundLabel ? `Dobles - ${visibleRoundLabel}` : 'Dobles';
  }

  if (phase === 'singles') {
    return visibleRoundLabel ? `Singles - ${visibleRoundLabel}` : 'Singles';
  }

  return visibleRoundLabel ? `${phaseType} - ${visibleRoundLabel}` : String(phaseType || '').trim();
}
