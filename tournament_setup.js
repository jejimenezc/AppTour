/**
 * Ejecuta la inicialización de grupos y fase de grupos.
 *
 * Hace:
 * 1. valida jugadores
 * 2. limpia datos previos de Groups, Matches y Blocks
 * 3. asigna grupos
 * 4. escribe Groups
 * 5. genera 3 bloques de grupos
 * 6. genera partidos de grupos
 * 7. deja current_block_id en 1
 */
function setupGroupStage() {
  const players = getCheckedInPlayers();

  validatePlayerCountForGroups(players);

  clearTournamentStageData();
  assignPlayersToGroups(players);
  buildGroupsSheetFromPlayers();
  createInitialGroupBlocks();
  generateGroupStageMatches();

  setConfigValue('current_block_id', 1, 'Bloque actual');
  setConfigValue('tournament_status', 'running_groups', 'Estado actual del torneo');

  Logger.log('Fase de grupos inicializada correctamente.');
}

/**
 * Valida cantidad de jugadores para este MVP.
 * @param {Object[]} players
 */
function validatePlayerCountForGroups(players) {
  const n = players.length;

  if (n === 0) {
    throw new Error('No hay jugadores con checked_in = TRUE');
  }

  if (n % 3 !== 0) {
    throw new Error(`La cantidad de jugadores (${n}) no es múltiplo de 3.`);
  }

  if (n !== 24 && n !== 36) {
    throw new Error(`Este MVP espera 24 o 36 jugadores. Recibidos: ${n}`);
  }
}

/**
 * Limpia datos de Groups, Matches y Blocks.
 * También limpia campos de agrupación en Players.
 */
function clearTournamentStageData() {
  replaceAllRows('Groups', []);
  replaceAllRows('Matches', []);
  replaceAllRows('Blocks', []);

  const players = getPlayers();
  players.forEach(player => {
    updatePlayer(player.player_id, {
      group_id: '',
      group_slot: '',
      group_rank: '',
      singles_bracket: '',
      singles_status: 'active',
      is_singles_finalist: false,
      doubles_eligible: true,
      doubles_partner_id: '',
      current_role: 'idle',
      current_block_id: '',
      notes: '',
    });
  });
}

/**
 * Asigna jugadores a grupos de 3.
 * Usa orden por seed si existe; si no, player_id.
 *
 * Estrategia:
 * - orden base por seed
 * - se reparten en grupos de 3 secuencialmente
 * - slots A, B, C
 *
 * @param {Object[]} checkedInPlayers
 */
function assignPlayersToGroups(checkedInPlayers) {
  const players = getPlayersSortedBySeed()
    .filter(player => toBoolean(player.checked_in));

  const numGroups = players.length / 3;
  const groupIds = generateGroupIds(numGroups);
  const slots = ['A', 'B', 'C'];

  for (let i = 0; i < players.length; i++) {
    const groupIndex = Math.floor(i / 3);
    const slotIndex = i % 3;

    const player = players[i];
    const groupId = groupIds[groupIndex];
    const groupSlot = slots[slotIndex];

    updatePlayer(player.player_id, {
      group_id: groupId,
      group_slot: groupSlot,
      group_rank: '',
      singles_bracket: '',
      singles_status: 'active',
      is_singles_finalist: false,
      doubles_eligible: true,
      doubles_partner_id: '',
      current_role: 'idle',
      current_block_id: '',
    });
  }
}

/**
 * Construye la hoja Groups a partir de Players.
 */
function buildGroupsSheetFromPlayers() {
  const players = getPlayers().filter(p => String(p.group_id || '').trim() !== '');

  const rows = players.map(player => {
    return createEmptyGroupRow(player.group_id, player.player_id);
  });

  rows.sort((a, b) => {
    const g = String(a.group_id).localeCompare(String(b.group_id));
    if (g !== 0) return g;
    return String(a.player_id).localeCompare(String(b.player_id));
  });

  replaceGroupRows(rows);
}

/**
 * Crea los 3 bloques iniciales de grupos.
 *
 * Usa hora base:
 * - si Config tiene tournament_start_ts, la usa;
 * - si no, usa "hoy a las 09:00:00" del timezone del script.
 */
function createInitialGroupBlocks() {
  const startBase = getTournamentStartDate();
  const blocks = [];

  for (let i = 0; i < 3; i++) {
    const start = addMinutes(startBase, i * 20);
    const closeSignal = addMinutes(start, 15);
    const hardClose = addMinutes(start, 18);
    const end = addMinutes(start, 20);

    blocks.push({
      block_id: i + 1,
      phase_type: 'groups',
      phase_label: `Grupos R${i + 1}`,
      start_ts: start,
      close_signal_ts: closeSignal,
      hard_close_ts: hardClose,
      end_ts: end,
      status: i === 0 ? 'scheduled' : 'scheduled',
      published_at: '',
      closed_at: '',
      advance_done: false,
      notes: '',
    });
  }

  replaceAllRows('Blocks', blocks);
}

/**
 * Genera los partidos de grupos y los escribe en Matches.
 *
 * Calendario por grupo:
 * R1: A vs B, arbitra C
 * R2: B vs C, arbitra A
 * R3: A vs C, arbitra B
 */
function generateGroupStageMatches() {
  const players = getPlayers().filter(p => String(p.group_id || '').trim() !== '');

  const grouped = {};
  players.forEach(player => {
    const groupId = String(player.group_id);
    if (!grouped[groupId]) grouped[groupId] = {};
    grouped[groupId][String(player.group_slot)] = player;
  });

  const groupIds = Object.keys(grouped).sort();
  const matches = [];
  let matchCounter = 1;

  groupIds.forEach(groupId => {
    const g = grouped[groupId];
    const A = g['A'];
    const B = g['B'];
    const C = g['C'];

    if (!A || !B || !C) {
      throw new Error(`El grupo ${groupId} no tiene slots completos A/B/C`);
    }

    const template = [
      {
        round_no: 1,
        player_a_id: A.player_id,
        player_b_id: B.player_id,
        referee_player_id: C.player_id,
        slot_code: `${groupId}-R1`,
      },
      {
        round_no: 2,
        player_a_id: B.player_id,
        player_b_id: C.player_id,
        referee_player_id: A.player_id,
        slot_code: `${groupId}-R2`,
      },
      {
        round_no: 3,
        player_a_id: A.player_id,
        player_b_id: C.player_id,
        referee_player_id: B.player_id,
        slot_code: `${groupId}-R3`,
      },
    ];

    template.forEach(item => {
      matches.push({
        match_id: `M${String(matchCounter).padStart(4, '0')}`,
        block_id: item.round_no,
        phase_type: 'groups',
        stage: 'group_match',
        round_no: item.round_no,
        table_no: '',
        match_order: '',
        group_id: groupId,
        bracket_type: '',
        slot_code: item.slot_code,
        player_a_id: item.player_a_id,
        player_b_id: item.player_b_id,
        referee_player_id: item.referee_player_id,
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
  });

  // Asignar mesas y orden visual dentro de cada bloque.
  assignTablesAndMatchOrderForGroupMatches(matches);

  replaceAllRows('Matches', matches);
}

/**
 * Asigna table_no y match_order por bloque.
 * Requiere que el número de partidos por bloque no supere max_tables.
 *
 * @param {Object[]} matches
 */
function assignTablesAndMatchOrderForGroupMatches(matches) {
  const maxTables = Number(getConfigValue('max_tables') || 12);
  const byBlock = {};

  matches.forEach(match => {
    const blockId = String(match.block_id);
    if (!byBlock[blockId]) byBlock[blockId] = [];
    byBlock[blockId].push(match);
  });

  Object.keys(byBlock).forEach(blockId => {
    const rows = byBlock[blockId].sort((a, b) => String(a.group_id).localeCompare(String(b.group_id)));

    if (rows.length > maxTables) {
      throw new Error(`El bloque ${blockId} tiene ${rows.length} partidos y excede max_tables=${maxTables}`);
    }

    rows.forEach((match, idx) => {
      match.table_no = idx + 1;
      match.match_order = idx + 1;
    });
  });
}

/**
 * Devuelve la fecha/hora de inicio del torneo.
 * Si existe Config.tournament_start_ts, la usa.
 * Si no, usa hoy 09:00:00.
 *
 * @returns {Date}
 */
function getTournamentStartDate() {
  const raw = getConfigValue('tournament_start_ts');

  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const now = new Date();
  now.setHours(9, 0, 0, 0);
  return now;
}

/**
 * Suma minutos a una fecha.
 * @param {Date} date
 * @param {number} minutes
 * @returns {Date}
 */
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/**
 * Formatea fecha-hora como string simple.
 * @param {Date} date
 * @returns {string}
 */
function formatDateTime(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
