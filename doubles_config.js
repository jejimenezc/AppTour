/**
 * Valida que un estado de dobles sea válido.
 * @param {string} status
 */
function assertValidDoublesStatus(status) {
  if (!getValidDoublesStatuses().includes(status)) {
    throw new Error(`Estado de dobles inválido: ${status}`);
  }
}

/**
 * Limpia toda la configuración de dobles de un jugador.
 * No cambia blocked.
 *
 * @param {string} playerId
 * @param {string=} fallbackStatus
 */
function clearPlayerDoublesConfig(playerId, fallbackStatus) {
  const player = getPlayerOrThrow(playerId);
  const currentStatus = String(player.doubles_status || '').trim();

  if (currentStatus === 'blocked') return;

  updatePlayer(playerId, {
    doubles_status: fallbackStatus || 'eligible',
    doubles_partner_id: '',
    doubles_request_to: '',
    doubles_request_from: '',
  });
}

/**
 * Limpia referencias cruzadas de partner/request relacionadas con un jugador.
 * Se usa antes de cambiar de estado de forma importante.
 *
 * @param {string} playerId
 */
function detachPlayerFromDoublesRelations(playerId) {
  const players = getPlayers();

  players.forEach(player => {
    const pid = String(player.player_id);
    const requestTo = String(player.doubles_request_to || '').trim();
    const requestFrom = String(player.doubles_request_from || '').trim();
    const partnerId = String(player.doubles_partner_id || '').trim();

    const patch = {};

    if (requestTo === String(playerId)) patch.doubles_request_to = '';
    if (requestFrom === String(playerId)) patch.doubles_request_from = '';
    if (partnerId === String(playerId)) patch.doubles_partner_id = '';

    if (Object.keys(patch).length > 0) {
      // si queda colgando un pending sin referencias, devolver a eligible
      if (String(player.doubles_status || '').trim() === 'partner_pending') {
        patch.doubles_status = 'eligible';
      }
      updatePlayer(pid, patch);
    }
  });
}

/**
 * Jugador declara: "Declino competir en dobles"
 *
 * @param {string} playerId
 */
function declineDoubles(playerId) {
  const player = getPlayerOrThrow(playerId);
  if (String(player.doubles_status || '').trim() === 'blocked') {
    throw new Error('Jugador bloqueado para dobles.');
  }

  detachPlayerFromDoublesRelations(playerId);

  updatePlayer(playerId, {
    doubles_status: 'opted_out',
    doubles_partner_id: '',
    doubles_request_to: '',
    doubles_request_from: '',
  });
}

/**
 * Jugador declara: "Asígname un partner al azar"
 *
 * @param {string} playerId
 */
function optIntoPool(playerId) {
  const player = getPlayerOrThrow(playerId);
  const status = String(player.doubles_status || '').trim();

  if (status === 'blocked') throw new Error('Jugador bloqueado para dobles.');
  if (status === 'partner_confirmed') throw new Error('Jugador ya tiene partner confirmado.');

  detachPlayerFromDoublesRelations(playerId);

  updatePlayer(playerId, {
    doubles_status: 'pool',
    doubles_partner_id: '',
    doubles_request_to: '',
    doubles_request_from: '',
  });
}

/**
 * Jugador propone partner específico.
 *
 * Reglas:
 * - ninguno puede estar blocked / opted_out / partner_confirmed
 * - no self-pairing
 * - una sola propuesta activa por jugador
 *
 * @param {string} requesterId
 * @param {string} targetId
 */
function proposePartner(requesterId, targetId) {
  if (String(requesterId) === String(targetId)) {
    throw new Error('No puedes proponerte como tu propio partner.');
  }

  const requester = getPlayerOrThrow(requesterId);
  const target = getPlayerOrThrow(targetId);

  const requesterStatus = String(requester.doubles_status || '').trim();
  const targetStatus = String(target.doubles_status || '').trim();

  const forbidden = ['blocked', 'opted_out', 'partner_confirmed'];

  if (forbidden.includes(requesterStatus)) {
    throw new Error(`El jugador ${requesterId} no puede proponer partner desde estado ${requesterStatus}`);
  }

  if (forbidden.includes(targetStatus)) {
    throw new Error(`El jugador ${targetId} no puede ser partner desde estado ${targetStatus}`);
  }

  // limpiar relaciones previas de ambos
  detachPlayerFromDoublesRelations(requesterId);
  detachPlayerFromDoublesRelations(targetId);

  updatePlayer(requesterId, {
    doubles_status: 'partner_pending',
    doubles_partner_id: '',
    doubles_request_to: targetId,
    doubles_request_from: '',
  });

  updatePlayer(targetId, {
    doubles_status: 'partner_pending',
    doubles_partner_id: '',
    doubles_request_to: '',
    doubles_request_from: requesterId,
  });
}

/**
 * El jugador receptor confirma partner.
 *
 * @param {string} targetId
 */
function confirmPartner(targetId) {
  const target = getPlayerOrThrow(targetId);
  const requesterId = String(target.doubles_request_from || '').trim();

  if (!requesterId) {
    throw new Error(`El jugador ${targetId} no tiene solicitud pendiente para confirmar.`);
  }

  const requester = getPlayerOrThrow(requesterId);

  if (String(requester.doubles_request_to || '').trim() !== String(targetId)) {
    throw new Error('La solicitud no es consistente entre ambos jugadores.');
  }

  updatePlayer(requesterId, {
    doubles_status: 'partner_confirmed',
    doubles_partner_id: targetId,
    doubles_request_to: '',
    doubles_request_from: '',
  });

  updatePlayer(targetId, {
    doubles_status: 'partner_confirmed',
    doubles_partner_id: requesterId,
    doubles_request_to: '',
    doubles_request_from: '',
  });
}

/**
 * El jugador receptor rechaza partner.
 * Ambos vuelven a eligible.
 *
 * @param {string} targetId
 */
function rejectPartner(targetId) {
  const target = getPlayerOrThrow(targetId);
  const requesterId = String(target.doubles_request_from || '').trim();

  if (!requesterId) {
    throw new Error(`El jugador ${targetId} no tiene solicitud pendiente para rechazar.`);
  }

  const requester = getPlayerOrThrow(requesterId);

  updatePlayer(requester.player_id, {
    doubles_status: 'eligible',
    doubles_partner_id: '',
    doubles_request_to: '',
    doubles_request_from: '',
  });

  updatePlayer(target.player_id, {
    doubles_status: 'eligible',
    doubles_partner_id: '',
    doubles_request_to: '',
    doubles_request_from: '',
  });
}

/**
 * Resumen de estado de dobles.
 * @returns {Object}
 */
function getDoublesStatusSummary() {
  const players = getPlayers();

  const summary = {
    blocked: 0,
    eligible: 0,
    opted_out: 0,
    pool: 0,
    partner_pending: 0,
    partner_confirmed: 0,
  };

  players.forEach(player => {
    const status = String(player.doubles_status || '').trim();
    if (Object.prototype.hasOwnProperty.call(summary, status)) {
      summary[status]++;
    }
  });

  return summary;
}

/**
 * Valida si se puede cerrar la ventana y generar dobles.
 *
 * Reglas:
 * - no debe haber partner_pending
 * - cantidad de pool debe ser par
 * - partner_confirmed debe ser consistente y par
 *
 * @returns {{ok:boolean, errors:string[]}}
 */
function validateDoublesCut() {
  const errors = [];
  const players = getPlayers();

  const pending = players.filter(p => String(p.doubles_status) === 'partner_pending');
  if (pending.length > 0) {
    errors.push('Hay solicitudes de partner pendientes de confirmación.');
  }

  const pool = players.filter(p => String(p.doubles_status) === 'pool');
  if (pool.length % 2 !== 0) {
    errors.push('La cantidad de jugadores sin partner es impar.');
  }

  const confirmed = players.filter(p => String(p.doubles_status) === 'partner_confirmed');
  if (confirmed.length % 2 !== 0) {
    errors.push('La cantidad de jugadores con partner confirmado es inconsistente.');
  }

  // validar simetría de partner_confirmed
  confirmed.forEach(player => {
    const partnerId = String(player.doubles_partner_id || '').trim();
    if (!partnerId) {
      errors.push(`El jugador ${player.player_id} figura con partner confirmado, pero no tiene partner_id.`);
      return;
    }

    const partner = getPlayerById(partnerId);
    if (!partner) {
      errors.push(`El partner ${partnerId} de ${player.player_id} no existe.`);
      return;
    }

    if (String(partner.doubles_status || '') !== 'partner_confirmed') {
      errors.push(`El partner ${partnerId} de ${player.player_id} no está confirmado.`);
    }

    if (String(partner.doubles_partner_id || '') !== String(player.player_id)) {
      errors.push(`La pareja confirmada ${player.player_id} <-> ${partnerId} no es simétrica.`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
  };
}
