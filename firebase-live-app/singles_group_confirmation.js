/**
 * Abre la ventana de confirmacion de grupos de singles.
 * Genera propuesta inicial en proposed_group_id / proposed_group_slot.
 */
function openSinglesGroupConfirmationWindow() {
  pauseTournamentInternalClock();
  clearProposedGroups();
  generateProposedSinglesGroups();
  setConfigValue('tournament_status', 'awaiting_singles_group_confirmation', 'Ventana de confirmacion de grupos abierta');
}

/**
 * Genera propuesta inicial de grupos en proposed_group_id / proposed_group_slot.
 * Usa jugadores vigentes del torneo.
 *
 * Regla:
 * - jugadores activos del torneo
 * - agrupacion de 3
 */
function generateProposedSinglesGroups() {
  const players = getPlayers().slice();
  const tournamentPlayerLookup = getTournamentPlayerIdLookup();
  const tournamentPlayers = players.filter(player => !!tournamentPlayerLookup[String(player.player_id)]);
  validatePlayerCountForGroups(tournamentPlayers);

  const numGroups = tournamentPlayers.length / 3;
  const groupIds = generateGroupIds(numGroups);
  const slots = ['A', 'B', 'C'];

  tournamentPlayers.forEach(player => {
    player.proposed_group_id = '';
    player.proposed_group_slot = '';
  });

  for (let i = 0; i < tournamentPlayers.length; i++) {
    const groupIndex = Math.floor(i / 3);
    const slotIndex = i % 3;

    tournamentPlayers[i].proposed_group_id = groupIds[groupIndex];
    tournamentPlayers[i].proposed_group_slot = slots[slotIndex];
  }

  replacePlayers(players);
}

/**
 * Recalcula desde cero la propuesta de grupos.
 */
function recalculateProposedSinglesGroups() {
  clearProposedGroups();
  generateProposedSinglesGroups();
}

/**
 * Mueve un jugador a un grupo/slot propuesto.
 *
 * Regla ligera:
 * - si el slot destino esta ocupado, intercambia
 * - no permite dejar duplicados
 *
 * @param {string} playerId
 * @param {string} targetGroupId
 * @param {string} targetSlot
 */
function movePlayerToProposedGroup(playerId, targetGroupId, targetSlot) {
  const players = getPlayers().slice();
  const player = players.find(p => String(p.player_id) === String(playerId));
  const slot = String(targetSlot || '').trim().toUpperCase();

  if (!player) {
    throw new Error(`No existe el jugador ${playerId}`);
  }

  if (!['A', 'B', 'C'].includes(slot)) {
    throw new Error(`Slot propuesto invalido: ${targetSlot}`);
  }

  const occupant = players.find(p =>
    String(p.proposed_group_id || '').trim() === String(targetGroupId) &&
    String(p.proposed_group_slot || '').trim().toUpperCase() === slot
  );

  const playerCurrentGroup = String(player.proposed_group_id || '').trim();
  const playerCurrentSlot = String(player.proposed_group_slot || '').trim().toUpperCase();

  if (!playerCurrentGroup || !playerCurrentSlot) {
    throw new Error(`El jugador ${playerId} no tiene propuesta de grupo actual.`);
  }

  if (occupant && String(occupant.player_id) !== String(playerId)) {
    occupant.proposed_group_id = playerCurrentGroup;
    occupant.proposed_group_slot = playerCurrentSlot;
  }

  player.proposed_group_id = String(targetGroupId || '').trim();
  player.proposed_group_slot = slot;
  replacePlayers(players);
}

/**
 * Valida consistencia del checkpoint de grupos.
 *
 * Reglas:
 * - total de jugadores activos del torneo multiplo de 3
 * - todos tienen proposed_group_id / proposed_group_slot
 * - sin duplicados por slot
 * - cada grupo debe tener exactamente A, B, C
 *
 * @returns {{ok:boolean, errors:string[]}}
 */
function validateSinglesGroupCheckpoint() {
  const errors = [];
  const players = getTournamentPlayers();

  if (players.length % 3 !== 0) {
    errors.push(`La cantidad de jugadores activos (${players.length}) no es multiplo de 3.`);
  }

  const seen = {};
  const grouped = {};

  players.forEach(player => {
    const groupId = String(player.proposed_group_id || '').trim();
    const slot = String(player.proposed_group_slot || '').trim().toUpperCase();

    if (!groupId) {
      errors.push(`El jugador ${player.player_id} no tiene proposed_group_id.`);
      return;
    }

    if (!['A', 'B', 'C'].includes(slot)) {
      errors.push(`El jugador ${player.player_id} no tiene proposed_group_slot valido.`);
      return;
    }

    const key = `${groupId}::${slot}`;
    if (seen[key]) {
      errors.push(`Slot duplicado en ${groupId} ${slot}.`);
    } else {
      seen[key] = player.player_id;
    }

    if (!grouped[groupId]) grouped[groupId] = [];
    grouped[groupId].push(slot);
  });

  Object.keys(grouped).forEach(groupId => {
    const slots = grouped[groupId].slice().sort().join(',');
    if (slots !== 'A,B,C') {
      errors.push(`El grupo ${groupId} no tiene exactamente los slots A, B y C.`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
  };
}

/**
 * Confirma los grupos propuestos y arranca la fase de grupos.
 *
 * Hace:
 * - copiar proposed_group_id / proposed_group_slot a group_id / group_slot
 * - reconstruir Groups
 * - crear bloques iniciales de grupos
 * - generar matches de grupos
 * - set current_block_id
 * - set status running_groups
 */
function confirmSinglesGroupsAndStartGroupStage() {
  const validation = validateSinglesGroupCheckpoint();
  if (!validation.ok) {
    throw new Error(`No se puede confirmar grupos:\n- ${validation.errors.join('\n- ')}`);
  }

  const tournamentPlayerLookup = getTournamentPlayerIdLookup();
  const allPlayers = getPlayers();

  replaceAllRows('Groups', []);

  const nonGroupMatches = getMatches().filter(m => String(m.phase_type) !== 'groups');
  replaceAllRows('Matches', nonGroupMatches);

  const nonGroupBlocks = getBlocks().filter(b => String(b.phase_type) !== 'groups');
  replaceAllRows('Blocks', nonGroupBlocks);

  allPlayers.forEach(player => {
    const isTournamentPlayer = !!tournamentPlayerLookup[String(player.player_id)];

    updatePlayer(player.player_id, {
      group_id: isTournamentPlayer ? player.proposed_group_id : '',
      group_slot: isTournamentPlayer ? player.proposed_group_slot : '',
      group_rank: '',
      singles_bracket: '',
      singles_status: 'active',
      current_role: 'idle',
      current_block_id: '',
    });
  });

  buildGroupsSheetFromPlayers();
  createInitialGroupBlocksAfterExistingBlocks();
  generateGroupStageMatchesAfterExistingMatches();

  const firstGroupBlock = getBlocks()
    .filter(b => String(b.phase_type) === 'groups')
    .sort((a, b) => Number(a.block_id) - Number(b.block_id))[0];

  if (firstGroupBlock) {
    setConfigValue('current_block_id', firstGroupBlock.block_id, 'Bloque actual');
  }

  setConfigValue('tournament_status', 'running_groups', 'Fase de grupos en curso');
}

/**
 * Crea los 3 bloques iniciales de grupos, continuando desde el ultimo bloque existente.
 */
function createInitialGroupBlocksAfterExistingBlocks() {
  const existingBlocks = getBlocksSorted();
  const maxBlockId = existingBlocks.reduce((acc, b) => Math.max(acc, Number(b.block_id || 0)), 0);
  const lastBlock = existingBlocks.length ? existingBlocks[existingBlocks.length - 1] : null;
  const startBase = lastBlock ? normalizeDateTimeText(lastBlock.end_ts) : getTournamentStartDate();

  for (let i = 0; i < 3; i++) {
    const window = buildBlockWindowFromBase(startBase, i * getBlockTotalMinutes());

    createBlock({
      block_id: maxBlockId + i + 1,
      phase_type: 'groups',
      phase_label: `Grupos R${i + 1}`,
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
  }
}

/**
 * Genera matches de groups, continuando correlativo desde los matches existentes.
 */
function generateGroupStageMatchesAfterExistingMatches() {
  const players = getPlayers().filter(p => String(p.group_id || '').trim() !== '');

  const grouped = {};
  players.forEach(player => {
    const groupId = String(player.group_id);
    if (!grouped[groupId]) grouped[groupId] = {};
    grouped[groupId][String(player.group_slot)] = player;
  });

  const groupBlocks = getBlocks()
    .filter(b => String(b.phase_type) === 'groups')
    .sort((a, b) => Number(a.block_id) - Number(b.block_id));

  if (groupBlocks.length < 3) {
    throw new Error('No existen los 3 bloques de groups requeridos.');
  }

  let matchCounter = getNextMatchCounter(getMatches());

  Object.keys(grouped).sort().forEach(groupId => {
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
        block_id: groupBlocks[0].block_id,
        player_a_id: A.player_id,
        player_b_id: B.player_id,
        referee_player_id: C.player_id,
        slot_code: `${groupId}-R1`,
      },
      {
        round_no: 2,
        block_id: groupBlocks[1].block_id,
        player_a_id: B.player_id,
        player_b_id: C.player_id,
        referee_player_id: A.player_id,
        slot_code: `${groupId}-R2`,
      },
      {
        round_no: 3,
        block_id: groupBlocks[2].block_id,
        player_a_id: A.player_id,
        player_b_id: C.player_id,
        referee_player_id: B.player_id,
        slot_code: `${groupId}-R3`,
      },
    ];

    template.forEach(item => {
      appendRow('Matches', {
        match_id: `M${String(matchCounter).padStart(4, '0')}`,
        block_id: item.block_id,
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

  assignTablesAndMatchOrderForAllGroupMatches();
}

/**
 * Asigna mesas/orden a todos los matches de groups existentes.
 */
function assignTablesAndMatchOrderForAllGroupMatches() {
  const groupMatches = getMatches().filter(m => String(m.phase_type) === 'groups');
  assignTablesAndMatchOrderByBlock(groupMatches, function (a, b) {
    return String(a.group_id || '').localeCompare(String(b.group_id || ''));
  });

  groupMatches.forEach(match => {
    updateMatch(match.match_id, {
      table_no: match.table_no,
      match_order: match.match_order,
    });
  });
}
