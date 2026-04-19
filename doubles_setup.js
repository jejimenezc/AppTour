/**
 * Limpia hoja DoublesTeams.
 */
function clearDoublesTeams() {
  replaceAllRows('DoublesTeams', []);
}

/**
 * Devuelve equipos de dobles.
 * @returns {Object[]}
 */
function getDoublesTeams() {
  return getRows('DoublesTeams');
}

/**
 * Devuelve un equipo de dobles por team_id.
 *
 * @param {string} teamId
 * @returns {Object|null}
 */
function getDoublesTeamById(teamId) {
  const target = String(teamId || '').trim();
  if (!target) return null;

  const teams = getDoublesTeams();
  for (let i = 0; i < teams.length; i++) {
    if (String(teams[i].team_id || '').trim() === target) {
      return teams[i];
    }
  }

  return null;
}

/**
 * Obtiene parejas confirmadas únicas.
 * @returns {Object[]}
 */
function buildConfirmedDoublesTeams() {
  const players = getPlayers().filter(p => String(p.doubles_status) === 'partner_confirmed');
  const visited = new Set();
  const teams = [];
  let teamNo = 1;

  players.forEach(player => {
    const pid = String(player.player_id);
    if (visited.has(pid)) return;

    const partnerId = String(player.doubles_partner_id || '').trim();
    if (!partnerId) return;

    visited.add(pid);
    visited.add(partnerId);

    teams.push({
      team_id: `D${String(teamNo).padStart(2, '0')}`,
      player_1_id: pid,
      player_2_id: partnerId,
      seed_rank: teamNo,
      source_note: 'partner_confirmed',
      is_active: true,
    });

    teamNo++;
  });

  return teams;
}

/**
 * Ordena pool para emparejamiento automático.
 * @param {Object[]} players
 * @returns {Object[]}
 */
function rankPoolPlayersForDoubles(players) {
  return players.slice().sort((a, b) => {
    const rankA = Number(a.group_rank || 999);
    const rankB = Number(b.group_rank || 999);
    if (rankA !== rankB) return rankA - rankB;

    const groupCmp = String(a.group_id || '').localeCompare(String(b.group_id || ''));
    if (groupCmp !== 0) return groupCmp;

    return String(a.player_id || '').localeCompare(String(b.player_id || ''));
  });
}

/**
 * Construye equipos automáticos a partir de jugadores en pool.
 * @param {number} startingTeamNo
 * @returns {Object[]}
 */
function buildPoolDoublesTeams(startingTeamNo) {
  const poolPlayers = getPlayers().filter(p => String(p.doubles_status) === 'pool');
  const ranked = rankPoolPlayersForDoubles(poolPlayers);

  if (ranked.length % 2 !== 0) {
    throw new Error('La cantidad de jugadores en pool es impar.');
  }

  const teams = [];
  let left = 0;
  let right = ranked.length - 1;
  let teamNo = startingTeamNo;

  while (left < right) {
    const p1 = ranked[left];
    const p2 = ranked[right];

    teams.push({
      team_id: `D${String(teamNo).padStart(2, '0')}`,
      player_1_id: p1.player_id,
      player_2_id: p2.player_id,
      seed_rank: teamNo,
      source_note: 'pool_auto',
      is_active: true,
    });

    updatePlayer(p1.player_id, {
      doubles_partner_id: p2.player_id,
    });

    updatePlayer(p2.player_id, {
      doubles_partner_id: p1.player_id,
    });

    left++;
    right--;
    teamNo++;
  }

  return teams;
}

/**
 * Genera todos los equipos finales de dobles:
 * - primero confirmados manualmente
 * - luego pool automático
 *
 * @returns {Object[]}
 */
function generateDoublesTeamsAtCut() {
  const validation = validateDoublesCut();
  if (!validation.ok) {
    throw new Error(`No se puede generar dobles:\n- ${validation.errors.join('\n- ')}`);
  }

  clearDoublesTeams();

  const confirmedTeams = buildConfirmedDoublesTeams();
  const poolTeams = buildPoolDoublesTeams(confirmedTeams.length + 1);
  const allTeams = [...confirmedTeams, ...poolTeams];

  replaceAllRows('DoublesTeams', allTeams);
  return allTeams;
}

/**
 * Construye matchups iniciales de dobles con byes si hace falta.
 *
 * @param {Object[]} teams
 * @returns {Object[]}
 */
function buildInitialDoublesMatchups(teams) {
  const ordered = teams.slice().sort((a, b) => Number(a.seed_rank) - Number(b.seed_rank));
  const n = ordered.length;
  const size = nextPowerOfTwo(n);
  const positions = generateSeedPositions(size);

  const seededMap = {};
  for (let seed = 1; seed <= size; seed++) {
    seededMap[seed] = seed <= n ? ordered[seed - 1] : null;
  }

  const positioned = positions.map(seed => ({
    seed,
    team: seededMap[seed],
  }));

  const round1 = [];
  const roundLabel = size === 8 ? 'QF' : size === 4 ? 'SF' : size === 16 ? 'R16' : size === 32 ? 'R32' : `R${size}`;

  for (let i = 0; i < positioned.length; i += 2) {
    const left = positioned[i];
    const right = positioned[i + 1];
    const matchNo = i / 2 + 1;

    round1.push({
      round_no: 1,
      round_label: roundLabel,
      slot_code: `D-${roundLabel}-M${matchNo}`,
      team_a_id: left.team ? left.team.team_id : '',
      team_b_id: right.team ? right.team.team_id : '',
      has_bye: !left.team || !right.team,
    });
  }

  return round1;
}

/**
 * Genera matches iniciales de dobles.
 * En dobles, player_a_id/player_b_id almacenan team_id por simplicidad.
 *
 * @param {Object[]} matchups
 */
function generateInitialDoublesMatches(matchups) {
  const existing = getMatches();
  let matchCounter = getNextMatchCounter(existing);

  matchups.forEach(match => {
    const isBye = !match.team_a_id || !match.team_b_id;

    let winnerId = '';
    let loserId = '';
    let status = 'scheduled';
    let resultMode = '';
    let setsA = '';
    let setsB = '';
    let resultSource = '';
    let autoClosed = false;
    let note = '';

    if (isBye) {
      winnerId = match.team_a_id || match.team_b_id || '';
      status = 'auto_closed';
      resultMode = 'final';
      setsA = match.team_a_id ? 2 : 0;
      setsB = match.team_b_id ? 2 : 0;
      resultSource = 'auto_rule';
      autoClosed = true;
      note = 'Advance by bye';
    }

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
      needs_review: false,
      admin_note: note,
    });

    matchCounter++;
  });
}

/**
 * Crea primer bloque de dobles.
 * @returns {number|null}
 */
function createInitialDoublesBlock() {
  const pending = getMatches().filter(match =>
    String(match.phase_type) === 'doubles' &&
    String(match.block_id || '') === ''
  );

  if (!pending.length) return null;

  const blocks = getBlocksSorted();
  const lastBlock = blocks.length ? blocks[blocks.length - 1] : null;
  const startBase = lastBlock ? normalizeDateTimeText(lastBlock.end_ts) : getTournamentStartDate();

  const window = buildBlockWindowFromBase(startBase);

  const newBlockId = blocks.reduce((acc, b) => Math.max(acc, Number(b.block_id || 0)), 0) + 1;

  createBlock({
    block_id: newBlockId,
    phase_type: 'doubles',
    phase_label: 'Dobles · Primera ronda',
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
    String(match.block_id || '') === ''
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
 * Setup completo de dobles al corte.
 *
 * En V2 ya NO depende de finalistas de singles.
 *
 * @returns {number|null}
 */
function setupDoublesStageFromCut() {
  const existingDoubles = getMatches().filter(m => String(m.phase_type) === 'doubles');
  if (existingDoubles.length > 0) {
    const latestBlock = getBlocksSorted().slice(-1)[0];
    return latestBlock ? latestBlock.block_id : null;
  }

  const teams = generateDoublesTeamsAtCut();
  const matchups = buildInitialDoublesMatchups(teams);

  generateInitialDoublesMatches(matchups);
  const blockId = createInitialDoublesBlock();

  setConfigValue('tournament_status', 'running_doubles', 'Dobles generado al cierre de la ventana');
  if (blockId) {
    setConfigValue('current_block_id', blockId, 'Bloque actual');
  }

  return blockId;
}
