/**
 * Devuelve las filas de Groups.
 * @returns {Object[]}
 */
function getGroupRows() {
  return getRows('Groups');
}

/**
 * Reemplaza todas las filas de Groups.
 * @param {Object[]} rows
 */
function replaceGroupRows(rows) {
  replaceAllRows('Groups', rows);
}

/**
 * Genera IDs de grupo tipo G01, G02, ...
 * @param {number} n
 * @returns {string[]}
 */
function generateGroupIds(n) {
  const ids = [];
  for (let i = 1; i <= n; i++) {
    ids.push(`G${String(i).padStart(2, '0')}`);
  }
  return ids;
}

/**
 * Devuelve estructura vacía de fila Groups.
 * @param {string} groupId
 * @param {string} playerId
 * @returns {Object}
 */
function createEmptyGroupRow(groupId, playerId) {
  return {
    group_id: groupId,
    player_id: playerId,
    played: 0,
    wins: 0,
    losses: 0,
    sets_for: 0,
    sets_against: 0,
    sets_diff: 0,
    rank_in_group: '',
    tie_break_note: '',
  };
}

/**
 * Devuelve filas de Groups indexadas por group_id -> player_id.
 * @returns {Object<string, Object<string, Object>>}
 */
function getGroupRowsMap() {
  const rows = getGroupRows();
  const map = {};

  rows.forEach(row => {
    const groupId = String(row.group_id || '').trim();
    const playerId = String(row.player_id || '').trim();

    if (!groupId || !playerId) return;
    if (!map[groupId]) map[groupId] = {};
    map[groupId][playerId] = row;
  });

  return map;
}

/**
 * Actualiza Players.group_rank desde Groups.rank_in_group.
 *
 * Optimizado en batch.
 */
function syncPlayersGroupRanksFromGroups() {
  const groupRows = getGroupRows();
  const rankMap = {};

  groupRows.forEach(row => {
    rankMap[String(row.player_id)] = row.rank_in_group;
  });

  const players = getPlayers().slice();

  players.forEach(player => {
    const pid = String(player.player_id);
    if (Object.prototype.hasOwnProperty.call(rankMap, pid)) {
      player.group_rank = rankMap[pid];
    }
  });

  replacePlayers(players);
}