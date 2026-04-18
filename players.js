/**
 * Devuelve todos los jugadores.
 * @returns {Object[]}
 */
function getPlayers() {
  return getRows('Players');
}

/**
 * Devuelve jugadores con checked_in verdadero.
 * @returns {Object[]}
 */
function getCheckedInPlayers() {
  return getPlayers().filter(player => toBoolean(player.checked_in));
}

/**
 * Devuelve un jugador por ID.
 * @param {string} playerId
 * @returns {Object|null}
 */
function getPlayerById(playerId) {
  const found = findRowById('Players', 'player_id', playerId);
  return found ? found.rowObject : null;
}

/**
 * Actualiza un jugador por player_id.
 * @param {string} playerId
 * @param {Object} patch
 */
function updatePlayer(playerId, patch) {
  updateRowById('Players', 'player_id', playerId, patch);
}

/**
 * Reemplaza todos los jugadores en lote.
 * @param {Object[]} players
 */
function replacePlayers(players) {
  replaceAllRows('Players', players);
}

/**
 * Devuelve jugadores ordenados por seed ascendente.
 * Los que no tengan seed quedan al final.
 * @returns {Object[]}
 */
function getPlayersSortedBySeed() {
  const players = getPlayers().slice();

  players.sort((a, b) => {
    const seedA = Number(a.seed);
    const seedB = Number(b.seed);

    const validA = !Number.isNaN(seedA) && seedA > 0;
    const validB = !Number.isNaN(seedB) && seedB > 0;

    if (validA && validB) return seedA - seedB;
    if (validA) return -1;
    if (validB) return 1;

    return String(a.player_id).localeCompare(String(b.player_id));
  });

  return players;
}

/**
 * Devuelve jugadores por bracket de singles.
 * @param {string} bracketType
 * @returns {Object[]}
 */
function getPlayersBySinglesBracket(bracketType) {
  return getPlayers().filter(player =>
    String(player.singles_bracket || '').trim() === String(bracketType)
  );
}

/**
 * Actualiza bracket de singles según rank de grupo:
 * 1 -> oro
 * 2 -> plata
 * 3 -> cobre
 *
 * Optimizado en batch.
 */
function assignSinglesBracketsFromGroupRanks() {
  const players = getPlayers().slice();

  players.forEach(player => {
    const rank = Number(player.group_rank);
    let bracket = '';

    if (rank === 1) bracket = 'oro';
    if (rank === 2) bracket = 'plata';
    if (rank === 3) bracket = 'cobre';

    player.singles_bracket = bracket;
  });

  replacePlayers(players);
}

/**
 * Estados válidos para dobles.
 * @returns {string[]}
 */
function getValidDoublesStatuses() {
  return [
    'blocked',
    'eligible',
    'opted_out',
    'pool',
    'partner_pending',
    'partner_confirmed',
  ];
}

/**
 * Devuelve jugadores base para la ventana de dobles en V2.
 * En el nuevo cronograma, dobles va primero, por lo que depende de checked_in,
 * no de finalistas de singles.
 *
 * @returns {Object[]}
 */
function getBaseEligiblePlayersForDoubles() {
  return getPlayers().filter(player => toBoolean(player.checked_in));
}

/**
 * Abre la ventana de confirmación de dobles:
 * - jugadores checked_in => eligible
 * - jugadores fuera del torneo => blocked
 *
 * Ya NO bloquea por is_singles_finalist.
 */
function openDoublesConfirmationWindow() {
  const players = getPlayers().slice();

  players.forEach(player => {
    const isCheckedIn = toBoolean(player.checked_in);

    player.doubles_status = isCheckedIn ? 'eligible' : 'blocked';
    player.doubles_partner_id = '';
    player.doubles_request_to = '';
    player.doubles_request_from = '';
  });

  replacePlayers(players);
  setConfigValue('tournament_status', 'awaiting_doubles_confirmation', 'Ventana de configuración de dobles abierta');
}

/**
 * Devuelve jugadores por estado de dobles.
 * @param {string} status
 * @returns {Object[]}
 */
function getPlayersByDoublesStatus(status) {
  return getPlayers().filter(player =>
    String(player.doubles_status || '').trim() === String(status)
  );
}

/**
 * Devuelve un jugador listo para operar en dobles.
 * @param {string} playerId
 * @returns {Object}
 */
function getPlayerOrThrow(playerId) {
  const player = getPlayerById(playerId);
  if (!player) throw new Error(`No existe el jugador ${playerId}`);
  return player;
}

/**
 * Verifica si un jugador puede entrar a la ventana de dobles.
 * @param {Object} player
 * @returns {boolean}
 */
function isPlayerAvailableForDoublesWindow(player) {
  const status = String(player.doubles_status || '').trim();
  return status !== 'blocked';
}

/**
 * Devuelve jugadores con propuesta de grupo.
 * @returns {Object[]}
 */
function getPlayersWithProposedGroups() {
  return getPlayers().filter(player =>
    String(player.proposed_group_id || '').trim() !== ''
  );
}

/**
 * Limpia propuesta de grupos.
 */
function clearProposedGroups() {
  const players = getPlayers().slice();

  players.forEach(player => {
    player.proposed_group_id = '';
    player.proposed_group_slot = '';
  });

  replacePlayers(players);
}