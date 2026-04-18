/**
 * Devuelve todos los partidos.
 * @returns {Object[]}
 */
function getMatches() {
  return getRows('Matches');
}

/**
 * Devuelve un partido por ID.
 * @param {string} matchId
 * @returns {Object|null}
 */
function getMatchById(matchId) {
  const found = findRowById('Matches', 'match_id', matchId);
  return found ? found.rowObject : null;
}

/**
 * Devuelve partidos por bloque.
 * @param {string|number} blockId
 * @returns {Object[]}
 */
function getMatchesByBlock(blockId) {
  return getMatches().filter(match => String(match.block_id) === String(blockId));
}

/**
 * Devuelve partidos por status.
 * @param {string} status
 * @returns {Object[]}
 */
function getMatchesByStatus(status) {
  return getMatches().filter(match => String(match.status) === String(status));
}

/**
 * Actualiza un partido por match_id.
 * @param {string} matchId
 * @param {Object} patch
 */
function updateMatch(matchId, patch) {
  updateRowById('Matches', 'match_id', matchId, patch);
}

/**
 * Determina si un rol tiene prioridad sobre otro.
 * Orden de precedencia:
 * admin > referee > player > auto_rule
 *
 * @param {string} newRole
 * @param {string} existingRole
 * @returns {boolean}
 */
function hasRolePriority(newRole, existingRole) {
  const rank = {
    auto_rule: 0,
    player: 1,
    referee: 2,
    admin: 3,
  };

  const a = Object.prototype.hasOwnProperty.call(rank, newRole) ? rank[newRole] : -1;
  const b = Object.prototype.hasOwnProperty.call(rank, existingRole) ? rank[existingRole] : -1;

  return a >= b;
}

/**
 * Valida un resultado final.
 * Debe ser uno de:
 * 2-0, 2-1, 0-2, 1-2
 *
 * @param {number|string} setsA
 * @param {number|string} setsB
 * @returns {boolean}
 */
function isValidFinalSets(setsA, setsB) {
  const a = Number(setsA);
  const b = Number(setsB);

  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (a === 2 && (b === 0 || b === 1)) return true;
  if (b === 2 && (a === 0 || a === 1)) return true;
  return false;
}

/**
 * Devuelve winner_id y loser_id a partir de sets.
 * @param {Object} match
 * @param {number|string} setsA
 * @param {number|string} setsB
 * @returns {{winner_id:string, loser_id:string}}
 */
function resolveWinnerLoserFromSets(match, setsA, setsB) {
  const a = Number(setsA);
  const b = Number(setsB);

  if (!isValidFinalSets(a, b)) {
    throw new Error(`Resultado inválido: ${setsA}-${setsB}`);
  }

  if (a > b) {
    return {
      winner_id: match.player_a_id,
      loser_id: match.player_b_id,
    };
  }

  return {
    winner_id: match.player_b_id,
    loser_id: match.player_a_id,
  };
}

/**
 * Devuelve true si un resultado final es compatible con un closing_state previo.
 *
 * @param {string} closingState
 * @param {number} setsA
 * @param {number} setsB
 * @returns {boolean}
 */
function isFinalCompatibleWithClosingState(closingState, setsA, setsB) {
  const state = String(closingState || '').trim();
  const a = Number(setsA);
  const b = Number(setsB);

  if (state === 'NOT_STARTED' || !state) {
    return true;
  }

  if (state === 'A_1_0') {
    return (a === 2 && b === 0) || (a === 2 && b === 1) || (a === 1 && b === 2);
  }

  if (state === 'B_1_0') {
    return (a === 0 && b === 2) || (a === 1 && b === 2) || (a === 2 && b === 1);
  }

  if (state === 'ONE_ONE') {
    return (a === 2 && b === 1) || (a === 1 && b === 2);
  }

  return false;
}

/**
 * Devuelve true si un closing_state nuevo es consistente con el anterior.
 *
 * Regla de progresion:
 * - NOT_STARTED -> cualquier parcial
 * - A_1_0 -> A_1_0 o ONE_ONE
 * - B_1_0 -> B_1_0 o ONE_ONE
 * - ONE_ONE -> solo ONE_ONE
 *
 * @param {string} previousState
 * @param {string} nextState
 * @returns {boolean}
 */
function isClosingStateCompatibleWithPrevious(previousState, nextState) {
  const prev = String(previousState || '').trim();
  const next = String(nextState || '').trim();

  if (!prev || prev === 'NOT_STARTED') {
    return ['NOT_STARTED', 'A_1_0', 'B_1_0', 'ONE_ONE'].includes(next);
  }

  if (prev === 'A_1_0') {
    return next === 'A_1_0' || next === 'ONE_ONE';
  }

  if (prev === 'B_1_0') {
    return next === 'B_1_0' || next === 'ONE_ONE';
  }

  if (prev === 'ONE_ONE') {
    return next === 'ONE_ONE';
  }

  return false;
}

/**
 * Valida que una nueva captura sea consistente con la ya almacenada.
 * Sin capa de edicion, solo se aceptan reenvios idempotentes
 * o finales compatibles con el parcial previamente ingresado.
 *
 * @param {Object} match
 * @param {string} mode
 * @param {Object} payload
 */
function validateResultCaptureConsistency(match, mode, payload) {
  const currentMode = String(match.result_mode || '').trim();
  const currentClosingState = String(match.closing_state || '').trim();
  const currentSetsA = valueOrBlank(match.sets_a);
  const currentSetsB = valueOrBlank(match.sets_b);

  if (!currentMode) {
    return;
  }

  if (currentMode === 'final') {
    if (mode !== 'final') {
      throw new Error('El partido ya tiene un resultado final. Para cambiarlo se requerira una edicion confirmada.');
    }

    const nextSetsA = Number(payload.sets_a);
    const nextSetsB = Number(payload.sets_b);
    if (String(currentSetsA) !== String(nextSetsA) || String(currentSetsB) !== String(nextSetsB)) {
      throw new Error('El partido ya tiene un resultado final distinto. No se puede sobrescribir sin una capa de edicion.');
    }

    return;
  }

  if (currentMode === 'closing_state') {
    if (mode === 'closing_state') {
      const nextClosingState = String(payload.closing_state || '').trim();
      if (!isClosingStateCompatibleWithPrevious(currentClosingState, nextClosingState)) {
        throw new Error(`El estado parcial ${nextClosingState} no es consistente con el parcial previo ${currentClosingState}.`);
      }
      return;
    }

    if (mode === 'final') {
      const nextSetsA = Number(payload.sets_a);
      const nextSetsB = Number(payload.sets_b);
      if (!isFinalCompatibleWithClosingState(currentClosingState, nextSetsA, nextSetsB)) {
        throw new Error(`El resultado final ${nextSetsA}-${nextSetsB} no es consistente con el parcial ${currentClosingState}.`);
      }
    }
  }
}

function valueOrBlank(value) {
  return value === null || typeof value === 'undefined' ? '' : value;
}

/**
 * Registra un resultado final o un estado de cierre.
 *
 * payload esperado:
 * {
 *   mode: 'final' | 'closing_state',
 *   sets_a?: 2,
 *   sets_b?: 1,
 *   closing_state?: 'A_1_0' | 'B_1_0' | 'ONE_ONE' | 'NOT_STARTED',
 *   submitted_by: 'P001',
 *   submitted_by_role: 'player' | 'referee' | 'admin'
 * }
 *
 * Reglas:
 * - árbitro prevalece sobre jugador
 * - admin prevalece sobre todos
 * - entre mismo rol, gana el último ingreso
 *
 * @param {string} matchId
 * @param {Object} payload
 */
function submitMatchResult(matchId, payload) {
  const match = getMatchById(matchId);
  if (!match) {
    throw new Error(`No existe el match_id=${matchId}`);
  }

  const mode = String(payload.mode || '').trim();
  const submittedBy = String(payload.submitted_by || '').trim();
  const submittedByRole = String(payload.submitted_by_role || '').trim();

  if (!mode) throw new Error('payload.mode es obligatorio');
  if (!submittedBy) throw new Error('payload.submitted_by es obligatorio');
  if (!submittedByRole) throw new Error('payload.submitted_by_role es obligatorio');

  const currentSource = String(match.result_source || '').trim();
  const currentRole = currentSource === 'player' || currentSource === 'referee' || currentSource === 'admin'
    ? currentSource
    : 'auto_rule';

  if (!hasRolePriority(submittedByRole, currentRole)) {
    // Si no tiene prioridad, ignoramos silenciosamente o lanzamos error.
    // Para MVP prefiero error explícito.
    throw new Error(`El rol ${submittedByRole} no puede sobrescribir un resultado existente de rol ${currentRole}`);
  }

  validateResultCaptureConsistency(match, mode, payload);

  if (mode === 'final') {
    const setsA = Number(payload.sets_a);
    const setsB = Number(payload.sets_b);

    if (!isValidFinalSets(setsA, setsB)) {
      throw new Error(`Resultado final inválido: ${payload.sets_a}-${payload.sets_b}`);
    }

    const resolved = resolveWinnerLoserFromSets(match, setsA, setsB);

    updateMatch(matchId, {
      status: 'result_submitted',
      result_mode: 'final',
      sets_a: setsA,
      sets_b: setsB,
      closing_state: '',
      winner_id: resolved.winner_id,
      loser_id: resolved.loser_id,
      result_source: submittedByRole,
      submitted_by: submittedBy,
      submitted_at: nowIso(),
      auto_closed: false,
      needs_review: false,
      admin_note: '',
    });

    return;
  }

  if (mode === 'closing_state') {
    const closingState = String(payload.closing_state || '').trim();
    const allowed = ['A_1_0', 'B_1_0', 'ONE_ONE', 'NOT_STARTED'];

    if (!allowed.includes(closingState)) {
      throw new Error(`closing_state inválido: ${closingState}`);
    }

    updateMatch(matchId, {
      status: 'live',
      result_mode: 'closing_state',
      sets_a: '',
      sets_b: '',
      closing_state: closingState,
      winner_id: '',
      loser_id: '',
      result_source: submittedByRole,
      submitted_by: submittedBy,
      submitted_at: nowIso(),
      auto_closed: false,
      needs_review: false,
      admin_note: '',
    });

    return;
  }

  throw new Error(`Modo no soportado: ${mode}`);
}

/**
 * Convierte estado de cierre a resultado final al hard close.
 * Reglas:
 * - A_1_0 => A gana 2-1
 * - B_1_0 => B gana 2-1
 * - ONE_ONE => cierre administrativo
 * - NOT_STARTED => cierre administrativo
 * - sin dato => cierre administrativo
 *
 * @param {string} matchId
 */
function finalizeMatchAtHardClose(matchId) {
  const match = getMatchById(matchId);
  if (!match) {
    throw new Error(`No existe el match_id=${matchId}`);
  }

  // Si ya hay resultado final válido, no tocar
  if (String(match.result_mode) === 'final' && isValidFinalSets(match.sets_a, match.sets_b)) {
    return;
  }

  const state = String(match.closing_state || '').trim();

  if (String(match.result_mode) === 'closing_state') {
    if (state === 'A_1_0') {
      updateMatch(matchId, {
        status: 'auto_closed',
        result_mode: 'final',
        sets_a: 2,
        sets_b: 1,
        closing_state_resolved_from: 'A_1_0',
        winner_id: match.player_a_id,
        loser_id: match.player_b_id,
        result_source: 'auto_rule',
        submitted_by: 'system',
        submitted_at: nowIso(),
        auto_closed: true,
        needs_review: false,
        admin_note: 'Converted from closing_state A_1_0 at hard close',
      });
      return;
    }

    if (state === 'B_1_0') {
      updateMatch(matchId, {
        status: 'auto_closed',
        result_mode: 'final',
        sets_a: 1,
        sets_b: 2,
        closing_state_resolved_from: 'B_1_0',
        winner_id: match.player_b_id,
        loser_id: match.player_a_id,
        result_source: 'auto_rule',
        submitted_by: 'system',
        submitted_at: nowIso(),
        auto_closed: true,
        needs_review: false,
        admin_note: 'Converted from closing_state B_1_0 at hard close',
      });
      return;
    }
  }

  applyAdministrativeClosure(matchId);
}

/**
 * Cierre administrativo de último recurso.
 * Para no bloquear el torneo:
 * - gana player_a_id 2-0
 * - queda marcado para revisión
 *
 * @param {string} matchId
 */
function applyAdministrativeClosure(matchId) {
  const match = getMatchById(matchId);
  if (!match) {
    throw new Error(`No existe el match_id=${matchId}`);
  }

  updateMatch(matchId, {
    status: 'auto_closed',
    result_mode: 'final',
    sets_a: 2,
    sets_b: 0,
    closing_state_resolved_from: String(match.closing_state || '').trim(),
    winner_id: match.player_a_id,
    loser_id: match.player_b_id,
    result_source: 'auto_rule',
    submitted_by: 'system',
    submitted_at: nowIso(),
    auto_closed: true,
    needs_review: true,
    admin_note: 'Administrative closure after hard close',
  });
}

/**
 * Marca todos los partidos de un bloque como live,
 * siempre que sigan en scheduled.
 *
 * @param {string|number} blockId
 */
function markMatchesAsLive(blockId) {
  const matches = getMatchesByBlock(blockId);

  matches.forEach(match => {
    if (String(match.status) === 'scheduled') {
      updateMatch(match.match_id, {
        status: 'live',
      });
    }
  });
}

/**
 * Devuelve true si un partido ya está resuelto de forma usable
 * para avanzar el torneo.
 *
 * @param {Object} match
 * @returns {boolean}
 */
function isMatchResolved(match) {
  const status = String(match.status || '').trim();
  const mode = String(match.result_mode || '').trim();

  if (mode === 'final' && isValidFinalSets(match.sets_a, match.sets_b)) {
    return true;
  }

  if (status === 'auto_closed') {
    return true;
  }

  return false;
}

/**
 * Finaliza todos los partidos pendientes de un bloque
 * aplicando hard close.
 *
 * @param {string|number} blockId
 */
function finalizePendingMatchesAtHardClose(blockId) {
  const matches = getMatchesByBlock(blockId);

  matches.forEach(match => {
    if (!isMatchResolved(match)) {
      finalizeMatchAtHardClose(match.match_id);
    }
  });
}

/**
 * Devuelve resumen de partidos por bloque.
 *
 * @param {string|number} blockId
 * @returns {{
 *   total:number,
 *   scheduled:number,
 *   live:number,
 *   result_submitted:number,
 *   auto_closed:number,
 *   resolved:number
 * }}
 */
function getMatchSummaryByBlock(blockId) {
  const matches = getMatchesByBlock(blockId);

  const summary = {
    total: matches.length,
    scheduled: 0,
    live: 0,
    result_submitted: 0,
    auto_closed: 0,
    resolved: 0,
  };

  matches.forEach(match => {
    const status = String(match.status || '').trim();

    if (status === 'scheduled') summary.scheduled++;
    if (status === 'live') summary.live++;
    if (status === 'result_submitted') summary.result_submitted++;
    if (status === 'auto_closed') summary.auto_closed++;
    if (isMatchResolved(match)) summary.resolved++;
  });

  return summary;
}
