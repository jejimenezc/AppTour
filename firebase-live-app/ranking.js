/**
 * Recalcula completamente la hoja Groups a partir de Matches de groups.
 * También actualiza Players.group_rank.
 */
function recomputeGroupStandings() {
  const players = getPlayers().filter(p => String(p.group_id || '').trim() !== '');
  const matches = getMatches().filter(m => String(m.phase_type || '').trim() === 'groups');

  // Base: un registro vacío por jugador en su grupo
  const rows = players.map(player => createEmptyGroupRow(player.group_id, player.player_id));

  const rowMap = {};
  rows.forEach(row => {
    const groupId = String(row.group_id);
    const playerId = String(row.player_id);
    if (!rowMap[groupId]) rowMap[groupId] = {};
    rowMap[groupId][playerId] = row;
  });

  // Aplicar resultados válidos
  matches.forEach(match => {
    if (!isMatchResolved(match)) return;

    const groupId = String(match.group_id || '').trim();
    const playerA = String(match.player_a_id || '').trim();
    const playerB = String(match.player_b_id || '').trim();

    if (!groupId || !playerA || !playerB) return;
    if (!rowMap[groupId] || !rowMap[groupId][playerA] || !rowMap[groupId][playerB]) return;

    const rowA = rowMap[groupId][playerA];
    const rowB = rowMap[groupId][playerB];

    const setsA = Number(match.sets_a);
    const setsB = Number(match.sets_b);

    rowA.played += 1;
    rowB.played += 1;

    rowA.sets_for += setsA;
    rowA.sets_against += setsB;

    rowB.sets_for += setsB;
    rowB.sets_against += setsA;

    if (String(match.winner_id) === playerA) {
      rowA.wins += 1;
      rowB.losses += 1;
    } else if (String(match.winner_id) === playerB) {
      rowB.wins += 1;
      rowA.losses += 1;
    }
  });

  // sets_diff
  rows.forEach(row => {
    row.sets_diff = Number(row.sets_for) - Number(row.sets_against);
    row.rank_in_group = '';
    row.tie_break_note = '';
  });

  // Ranking por grupo
  const grouped = {};
  rows.forEach(row => {
    const groupId = String(row.group_id);
    if (!grouped[groupId]) grouped[groupId] = [];
    grouped[groupId].push(row);
  });

  Object.keys(grouped).forEach(groupId => {
    const ranked = rankSingleGroup(groupId, grouped[groupId], matches);
    ranked.forEach((row, idx) => {
      row.rank_in_group = idx + 1;
    });
  });

  // Escritura ordenada
  const ordered = rows.slice().sort((a, b) => {
    const g = String(a.group_id).localeCompare(String(b.group_id));
    if (g !== 0) return g;
    return Number(a.rank_in_group || 999) - Number(b.rank_in_group || 999);
  });

  replaceGroupRows(ordered);
  syncPlayersGroupRanksFromGroups();
}

/**
 * Ordena un grupo completo según reglas:
 * 1. más victorias
 * 2. mejor diferencia de sets
 * 3. si empate entre 2 jugadores: resultado entre ambos
 * 4. si persiste empate múltiple o irresoluble: sorteo administrativo
 *
 * @param {string} groupId
 * @param {Object[]} rows
 * @param {Object[]} allGroupMatches
 * @returns {Object[]}
 */
function rankSingleGroup(groupId, rows, allGroupMatches) {
  const rowsCopy = rows.slice();

  // Base: victorias, luego sets_diff
  rowsCopy.sort((a, b) => {
    const winDiff = Number(b.wins) - Number(a.wins);
    if (winDiff !== 0) return winDiff;

    const setDiff = Number(b.sets_diff) - Number(a.sets_diff);
    if (setDiff !== 0) return setDiff;

    return 0;
  });

  // Resolver empates por segmentos
  return resolveTiedSegments(groupId, rowsCopy, allGroupMatches);
}

/**
 * Recorre la lista ordenada y resuelve segmentos empatados.
 *
 * @param {string} groupId
 * @param {Object[]} sortedRows
 * @param {Object[]} allGroupMatches
 * @returns {Object[]}
 */
function resolveTiedSegments(groupId, sortedRows, allGroupMatches) {
  const result = [];
  let i = 0;

  while (i < sortedRows.length) {
    const current = sortedRows[i];
    const segment = [current];
    let j = i + 1;

    while (
      j < sortedRows.length &&
      Number(sortedRows[j].wins) === Number(current.wins) &&
      Number(sortedRows[j].sets_diff) === Number(current.sets_diff)
    ) {
      segment.push(sortedRows[j]);
      j++;
    }

    if (segment.length === 1) {
      result.push(segment[0]);
    } else if (segment.length === 2) {
      const resolved = resolveTwoWayTieByHeadToHead(groupId, segment, allGroupMatches);
      result.push(...resolved);
    } else {
      // Triple empate o más: no resoluble con head-to-head simple según tu regla.
      const administrativelyOrdered = segment.slice().sort((a, b) =>
        String(a.player_id).localeCompare(String(b.player_id))
      );

      administrativelyOrdered.forEach(row => {
        row.tie_break_note = 'Empate múltiple no resuelto por reglas principales; requiere sorteo administrativo';
      });

      result.push(...administrativelyOrdered);
    }

    i = j;
  }

  return result;
}

/**
 * Resuelve empate entre dos jugadores usando el resultado del partido entre ambos.
 *
 * @param {string} groupId
 * @param {Object[]} tiedRows
 * @param {Object[]} allGroupMatches
 * @returns {Object[]}
 */
function resolveTwoWayTieByHeadToHead(groupId, tiedRows, allGroupMatches) {
  const a = tiedRows[0];
  const b = tiedRows[1];

  const match = findHeadToHeadGroupMatch(groupId, a.player_id, b.player_id, allGroupMatches);

  if (!match || !isMatchResolved(match)) {
    const fallback = tiedRows.slice().sort((x, y) =>
      String(x.player_id).localeCompare(String(y.player_id))
    );

    fallback.forEach(row => {
      row.tie_break_note = 'Empate no resuelto por enfrentamiento directo; requiere sorteo administrativo';
    });

    return fallback;
  }

  if (String(match.winner_id) === String(a.player_id)) {
    a.tie_break_note = 'Desempate por enfrentamiento directo';
    b.tie_break_note = 'Desempate por enfrentamiento directo';
    return [a, b];
  }

  if (String(match.winner_id) === String(b.player_id)) {
    a.tie_break_note = 'Desempate por enfrentamiento directo';
    b.tie_break_note = 'Desempate por enfrentamiento directo';
    return [b, a];
  }

  // Fallback ultra defensivo
  const fallback = tiedRows.slice().sort((x, y) =>
    String(x.player_id).localeCompare(String(y.player_id))
  );

  fallback.forEach(row => {
    row.tie_break_note = 'Empate no resuelto por enfrentamiento directo; requiere sorteo administrativo';
  });

  return fallback;
}

/**
 * Busca el partido de grupo entre dos jugadores.
 *
 * @param {string} groupId
 * @param {string} player1
 * @param {string} player2
 * @param {Object[]} allGroupMatches
 * @returns {Object|null}
 */
function findHeadToHeadGroupMatch(groupId, player1, player2, allGroupMatches) {
  for (const match of allGroupMatches) {
    if (String(match.group_id) !== String(groupId)) continue;

    const a = String(match.player_a_id);
    const b = String(match.player_b_id);

    const samePair =
      (a === String(player1) && b === String(player2)) ||
      (a === String(player2) && b === String(player1));

    if (samePair) return match;
  }

  return null;
}
