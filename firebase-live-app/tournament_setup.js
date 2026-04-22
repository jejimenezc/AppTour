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
  const players = getTournamentPlayers();

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
  const supportedCounts = {
    12: true,
    18: true,
    24: true,
    36: true,
  };

  if (n === 0) {
    throw new Error('No hay jugadores activos para el torneo.');
  }

  if (n % 3 !== 0) {
    throw new Error(`La cantidad de jugadores (${n}) no es múltiplo de 3.`);
  }

  if (!supportedCounts[n]) {
    throw new Error(`Este MVP soporta 12, 18, 24 o 36 jugadores. Recibidos: ${n}`);
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
  const players = (checkedInPlayers || []).slice();

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
    const window = buildBlockWindowFromBase(startBase, i * getBlockTotalMinutes());

    blocks.push({
      block_id: i + 1,
      phase_type: 'groups',
      phase_label: `Grupos R${i + 1}`,
      start_ts: window.start,
      close_signal_ts: window.closeSignal,
      hard_close_ts: window.hardClose,
      end_ts: window.end,
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
  assignTablesAndMatchOrderByBlock(matches, function (a, b) {
    return String(a.group_id || '').localeCompare(String(b.group_id || ''));
  });
}

/**
 * Devuelve true si el match requiere mesa fisica.
 * Los byes y partidos ya auto-cerrados no deben consumir mesa.
 *
 * @param {Object} match
 * @returns {boolean}
 */
function isPlayableMatchForTableAssignment(match) {
  const status = String(match.status || '').trim();
  const left = String(match.player_a_id || '').trim();
  const right = String(match.player_b_id || '').trim();

  return !!left && !!right && status !== 'auto_closed';
}

/**
 * Asigna mesas y orden solo a partidos jugables, agrupados por bloque.
 * Los byes quedan sin mesa ni orden.
 *
 * @param {Object[]} matches
 * @param {(function(Object,Object):number)=} compareFn
 */
function assignTablesAndMatchOrderByBlock(matches, compareFn) {
  const maxTables = Number(getConfigValue('max_tables') || 12);
  const byBlock = {};

  matches.forEach(match => {
    const blockId = String(match.block_id);
    if (!byBlock[blockId]) byBlock[blockId] = [];
    byBlock[blockId].push(match);
  });

  Object.keys(byBlock).forEach(blockId => {
    const rows = byBlock[blockId].slice().sort(compareFn || defaultTableAssignmentCompare_);
    const playable = rows.filter(isPlayableMatchForTableAssignment);

    if (playable.length > maxTables) {
      throw new Error(`El bloque ${blockId} tiene ${playable.length} partidos jugables y excede max_tables=${maxTables}`);
    }

    rows.forEach(match => {
      match.table_no = '';
      match.match_order = '';
    });

    playable.forEach((match, idx) => {
      match.table_no = idx + 1;
      match.match_order = idx + 1;
    });
  });
}

/**
 * Comparator por defecto para asignacion de mesas.
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
function defaultTableAssignmentCompare_(a, b) {
  return String(a.slot_code || '').localeCompare(String(b.slot_code || ''));
}

/**
 * Devuelve la fecha/hora de inicio del torneo.
 * Requiere Config.tournament_start_ts con un valor parseable.
 *
 * @returns {string}
 */
function getTournamentStartDate() {
  const raw = getConfigValue('tournament_start_ts');
  const value = String(raw || '').trim();

  if (!value) {
    throw new Error('Falta Config.tournament_start_ts. Define una fecha/hora base del torneo antes de generar bloques.');
  }

  const normalized = normalizeDateTimeText(value);
  if (!normalized) {
    throw new Error(`Config.tournament_start_ts no es valida: "${value}". Usa un formato parseable, por ejemplo 2026-04-18 13:20:00.`);
  }

  return normalized;
}

/**
 * Lee y valida la configuracion temporal de bloques.
 *
 * @returns {{scheduledMinutes:number, playMinutes:number, closeMinutes:number, transitionMinutes:number}}
 */
function getBlockTimingConfig() {
  const scheduledMinutes = getOptionalNonNegativeBlockMinutesConfig_('block_scheduled_min', 'ventana programada');
  const playMinutes = getPositiveBlockMinutesConfig_('block_play_min', 'duracion de juego');
  const closeMinutes = getPositiveBlockMinutesConfig_('block_close_min', 'ventana de cierre');
  const transitionMinutes = getPositiveBlockMinutesConfig_('block_transition_min', 'ventana de transicion');

  return {
    scheduledMinutes,
    playMinutes,
    closeMinutes,
    transitionMinutes,
  };
}

/**
 * Devuelve la duracion total de un bloque.
 *
 * @returns {number}
 */
function getBlockTotalMinutes() {
  const timing = getBlockTimingConfig();
  return timing.scheduledMinutes + timing.playMinutes + timing.closeMinutes + timing.transitionMinutes;
}

/**
 * Construye las ventanas temporales de un bloque a partir de una fecha base.
 *
 * @param {Date|string} startBase
 * @param {number=} offsetMinutes
 * @returns {{start:string, closeSignal:string, hardClose:string, end:string}}
 */
function buildBlockWindowFromBase(startBase, offsetMinutes) {
  const timing = getBlockTimingConfig();
  const offset = Number(offsetMinutes || 0);
  const baseText = normalizeDateTimeText(startBase);

  if (!baseText) {
    throw new Error(`Fecha base invalida para construir bloque: ${startBase}`);
  }

  const start = addMinutesToDateTimeText(baseText, offset + timing.scheduledMinutes);
  const closeSignal = addMinutesToDateTimeText(start, timing.playMinutes);
  const hardClose = addMinutesToDateTimeText(closeSignal, timing.closeMinutes);
  const end = addMinutesToDateTimeText(hardClose, timing.transitionMinutes);

  return {
    start: start,
    closeSignal: closeSignal,
    hardClose: hardClose,
    end: end,
  };
}

/**
 * Lee una key de minutos de Config y exige entero positivo.
 *
 * @param {string} key
 * @param {string} label
 * @returns {number}
 */
function getPositiveBlockMinutesConfig_(key, label) {
  const raw = getConfigValue(key);
  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) {
    throw new Error(`Config.${key} invalido (${raw}). Define un entero positivo para ${label}.`);
  }

  return value;
}

/**
 * Lee una key opcional de minutos y permite 0 como valor valido.
 * Si la key no existe o esta vacia, usa 0.
 *
 * @param {string} key
 * @param {string} label
 * @returns {number}
 */
function getOptionalNonNegativeBlockMinutesConfig_(key, label) {
  const raw = getConfigValue(key);
  if (raw === null || raw === '') {
    return 0;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
    throw new Error(`Config.${key} invalido (${raw}). Define un entero no negativo para ${label}.`);
  }

  return value;
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
 * Suma minutos a un timestamp canonico yyyy-MM-dd HH:mm:ss
 * sin introducir conversiones de zona horaria en el texto resultante.
 *
 * @param {string} dateTimeText
 * @param {number} minutes
 * @returns {string}
 */
function addMinutesToDateTimeText(dateTimeText, minutes) {
  const parsed = parseBlockDate(dateTimeText);
  if (!parsed) {
    throw new Error(`Fecha/hora invalida: ${dateTimeText}`);
  }

  const shifted = new Date(parsed.getTime() + Number(minutes || 0) * 60 * 1000);
  return formatParsedBlockDate(shifted);
}

/**
 * Formatea fecha-hora como string simple.
 * @param {Date} date
 * @returns {string}
 */
function formatDateTime(date) {
  return Utilities.formatDate(date, getAppTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
