/**
 * Inicializa el flujo del torneo versión 2:
 * - dobles primero
 * - grupos después
 */
function initializeTournamentFlowV2() {
  prepareTournamentFlowV2ResetClockState_();
  resetTournamentFlowV2();
  openDoublesConfirmationWindow();
  setConfigValue('tournament_status', 'awaiting_doubles_confirmation', 'Ventana de dobles abierta');
}

function prepareTournamentFlowV2ResetClockState_() {
  removeTournamentClockTriggers();
  resetTournamentInternalClock();
  pauseTournamentInternalClock();
  setConfigValue('clock_trigger_last_run_at', '', 'Ultima ejecucion del reloj');
  setConfigValue('clock_trigger_last_error', '', 'Ultimo error del reloj');
  setConfigValue('clock_last_processed_internal_ts', '', 'Ultimo tiempo interno procesado por el motor');
  setConfigValue('clock_publish_last_run_at', '', 'Ultimo intento de publish realtime');
  setConfigValue('clock_publish_last_status', '', 'Estado del ultimo publish realtime');
  setConfigValue('clock_publish_last_error', '', 'Ultimo error del publish realtime');
  setConfigValue('clock_publish_last_snapshot_version', '', 'Ultima version publicada en realtime');
}

/**
 * Limpieza suave del flujo V2.
 * No borra Players, pero limpia estructuras de torneo.
 */
function resetTournamentFlowV2() {
  replaceAllRows('Groups', []);
  replaceAllRows('Matches', []);
  replaceAllRows('Blocks', []);
  replaceAllRows('BracketSlots', []);
  replaceAllRows('DoublesTeams', []);

  const players = getPlayers().map(function (player) {
    return Object.assign({}, player, {
      group_id: '',
      group_slot: '',
      group_rank: '',
      proposed_group_id: '',
      proposed_group_slot: '',
      singles_bracket: '',
      singles_status: 'active',
      is_singles_finalist: false,
      doubles_eligible: true,
      doubles_partner_id: '',
      doubles_request_to: '',
      doubles_request_from: '',
      doubles_status: '',
      current_role: 'idle',
      current_block_id: '',
      notes: '',
    });
  });
  replacePlayers(players);

  setConfigValue('current_block_id', '', 'Bloque actual');
  setConfigValue('tournament_status', 'setup', 'Estado inicial');
}

/**
 * Devuelve true si ya existe al menos un partido de dobles.
 * @returns {boolean}
 */
function doublesStageAlreadyGenerated() {
  return getMatches().some(match => String(match.phase_type) === 'doubles');
}

/**
 * Devuelve true si ya existe al menos un partido de groups.
 * @returns {boolean}
 */
function groupStageAlreadyGenerated() {
  return getMatches().some(match => String(match.phase_type) === 'groups');
}

/**
 * Devuelve true si ya existe al menos un partido de singles knockout.
 * @returns {boolean}
 */
function singlesKnockoutAlreadyGenerated() {
  return getMatches().some(match => String(match.phase_type) === 'singles');
}
