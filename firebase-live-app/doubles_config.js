const DOUBLES_PROPOSAL_TTL_MS = 2 * 60 * 1000;

/**
 * Valida que un estado de dobles sea válido.
 * @param {string} status
 */
function assertValidDoublesStatus(status) {
  if (!getValidDoublesStatuses().includes(status)) {
    throw new Error(`Estado de dobles inválido: ${status}`);
  }
}

function getDoublesProposalTtlMs_() {
  return DOUBLES_PROPOSAL_TTL_MS;
}

function getActiveDoublesProposalIntents_() {
  const proposals = readFirebaseNode_('doubles/intents/proposals');
  if (!proposals || typeof proposals !== 'object') return [];

  const nowMs = Date.now();

  return Object.keys(proposals)
    .map(function (intentId) {
      const value = proposals[intentId] && typeof proposals[intentId] === 'object'
        ? proposals[intentId]
        : {};
      const createdAtMs = Number(value.createdAtMs || 0);
      const expiresAtMs = Number(value.expiresAtMs || (createdAtMs ? createdAtMs + getDoublesProposalTtlMs_() : 0));
      return {
        intentId: String(value.intentId || intentId || '').trim(),
        fromPlayerId: String(value.fromPlayerId || value.actorPlayerId || '').trim(),
        toPlayerId: String(value.toPlayerId || value.targetPlayerId || '').trim(),
        createdAt: String(value.createdAt || '').trim(),
        createdAtMs: createdAtMs,
        expiresAtMs: expiresAtMs,
      };
    })
    .filter(function (intent) {
      return !!intent.intentId &&
        !!intent.fromPlayerId &&
        !!intent.toPlayerId &&
        intent.expiresAtMs > nowMs;
    })
    .sort(function (left, right) {
      if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
      return String(left.intentId || '').localeCompare(String(right.intentId || ''));
    });
}

function cleanupExpiredDoublesProposalIntents_() {
  const proposals = readFirebaseNode_('doubles/intents/proposals');
  if (!proposals || typeof proposals !== 'object') {
    return {
      removedCount: 0,
      impactedPlayerIds: [],
    };
  }

  const nowMs = Date.now();
  const impactedPlayerIds = [];
  let removedCount = 0;

  Object.keys(proposals).forEach(function (intentId) {
    const value = proposals[intentId] && typeof proposals[intentId] === 'object'
      ? proposals[intentId]
      : {};
    const createdAtMs = Number(value.createdAtMs || 0);
    const expiresAtMs = Number(value.expiresAtMs || (createdAtMs ? createdAtMs + getDoublesProposalTtlMs_() : 0));

    if (!expiresAtMs || expiresAtMs > nowMs) return;

    deleteFirebaseNode_(`doubles/intents/proposals/${intentId}`);
    removedCount++;

    [
      value.fromPlayerId,
      value.toPlayerId,
      value.actorPlayerId,
      value.targetPlayerId,
    ].map(normalizeRealtimePlayerIdSafe_).filter(Boolean).forEach(function (playerId) {
      impactedPlayerIds.push(playerId);
    });
  });

  return {
    removedCount: removedCount,
    impactedPlayerIds: impactedPlayerIds.filter(onlyUnique_),
  };
}

function getDoublesConfirmedPartnerMap_() {
  const confirmedByPlayer = readFirebaseNode_('doubles/intents/confirmedByPlayer');
  if (!confirmedByPlayer || typeof confirmedByPlayer !== 'object') return {};

  const partnerMap = {};

  Object.keys(confirmedByPlayer).forEach(function (playerId) {
    const value = confirmedByPlayer[playerId] && typeof confirmedByPlayer[playerId] === 'object'
      ? confirmedByPlayer[playerId]
      : {};
    const normalizedPlayerId = String(value.playerId || playerId || '').trim();
    const partnerId = String(value.partnerId || '').trim();
    if (!normalizedPlayerId || !partnerId) return;
    partnerMap[normalizedPlayerId] = partnerId;
  });

  return partnerMap;
}

function getDoublesConfirmedPairsSnapshot_() {
  const partnerMap = getDoublesConfirmedPartnerMap_();
  const seen = {};
  const pairs = [];
  const errors = [];

  Object.keys(partnerMap).forEach(function (playerId) {
    const partnerId = String(partnerMap[playerId] || '').trim();
    if (!partnerId) return;

    const reversePartnerId = String(partnerMap[partnerId] || '').trim();
    if (reversePartnerId !== String(playerId)) {
      errors.push(`La confirmacion ${playerId} -> ${partnerId} no es simetrica en Firebase.`);
      return;
    }

    const pairKey = [playerId, partnerId].sort().join('__');
    if (seen[pairKey]) return;
    seen[pairKey] = true;
    pairs.push({
      playerAId: [playerId, partnerId].sort()[0],
      playerBId: [playerId, partnerId].sort()[1],
    });
  });

  return {
    partnerMap: partnerMap,
    pairs: pairs,
    errors: errors,
  };
}

function getDoublesCheckinStateMap_() {
  const byPlayer = readFirebaseNode_('doubles/checkin/byPlayer');
  if (!byPlayer || typeof byPlayer !== 'object') return {};

  const checkinMap = {};

  Object.keys(byPlayer).forEach(function (playerId) {
    const rawValue = byPlayer[playerId];
    const isObjectValue = rawValue && typeof rawValue === 'object';
    const normalizedPlayerId = String(isObjectValue ? rawValue.playerId || playerId || '' : playerId || '').trim();
    const status = String(isObjectValue ? rawValue.status || '' : rawValue || '').trim();
    if (!normalizedPlayerId) return;
    if (status !== 'eligible' && status !== 'pool' && status !== 'opted_out') return;
    checkinMap[normalizedPlayerId] = status;
  });

  return checkinMap;
}

function getEffectiveDoublesStatusForPlayer_(player, context) {
  const playerId = String(player && player.player_id || '').trim();
  const baseStatus = String(player && player.doubles_status || '').trim();
  const confirmedPartnerMap = context && context.confirmedPartnerMap || {};
  const proposalPlayerIds = context && context.proposalPlayerIds || {};
  const checkinMap = context && context.checkinMap || {};

  if (baseStatus === 'blocked') return 'blocked';
  if (confirmedPartnerMap[playerId]) return 'partner_confirmed';
  if (proposalPlayerIds[playerId]) return 'partner_pending';
  if (checkinMap[playerId]) return String(checkinMap[playerId] || '').trim();
  return baseStatus;
}

function consolidateDoublesFirebaseStateAtCut_() {
  cleanupExpiredDoublesProposalIntents_();

  const players = getPlayers().slice();
  const tournamentLookup = getTournamentPlayerIdLookup();
  const confirmedSnapshot = getDoublesConfirmedPairsSnapshot_();
  const confirmedPartnerMap = confirmedSnapshot.partnerMap || {};
  const checkinMap = getDoublesCheckinStateMap_();

  players.forEach(function (player) {
    const playerId = String(player.player_id || '').trim();
    if (!tournamentLookup[playerId]) return;
    if (String(player.doubles_status || '').trim() === 'blocked') return;
    if (String(checkinMap[playerId] || '').trim() === 'opted_out') {
      player.doubles_status = 'opted_out';
      player.doubles_partner_id = '';
      player.doubles_request_to = '';
      player.doubles_request_from = '';
      return;
    }
    if (String(checkinMap[playerId] || '').trim() === 'pool') {
      player.doubles_status = 'pool';
      player.doubles_partner_id = '';
      player.doubles_request_to = '';
      player.doubles_request_from = '';
      return;
    }

    player.doubles_status = 'eligible';
    player.doubles_partner_id = '';
    player.doubles_request_to = '';
    player.doubles_request_from = '';
  });

  Object.keys(confirmedPartnerMap).forEach(function (playerId) {
    const player = players.find(function (row) {
      return String(row.player_id || '').trim() === String(playerId);
    });
    if (!player) return;

    player.doubles_status = 'partner_confirmed';
    player.doubles_partner_id = String(confirmedPartnerMap[playerId] || '').trim();
    player.doubles_request_to = '';
    player.doubles_request_from = '';
  });

  replacePlayers(players);
  deleteFirebaseNode_('doubles/intents/proposals');
  deleteFirebaseNode_('doubles/intents/confirmedByPlayer');
  deleteFirebaseNode_('doubles/intents/confirmedPairs');
  deleteFirebaseNode_('doubles/checkin/byPlayer');
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
  const requesterRequestTo = String(requester.doubles_request_to || '').trim();
  const requesterRequestFrom = String(requester.doubles_request_from || '').trim();

  const forbidden = ['blocked', 'opted_out', 'partner_confirmed'];

  if (forbidden.includes(requesterStatus)) {
    throw new Error(`El jugador ${requesterId} no puede proponer partner desde estado ${requesterStatus}`);
  }

  if (forbidden.includes(targetStatus)) {
    throw new Error(`El jugador ${targetId} no puede ser partner desde estado ${targetStatus}`);
  }

  if (requesterStatus === 'partner_pending' && requesterRequestFrom && !requesterRequestTo) {
    throw new Error(`El jugador ${requesterId} debe responder su solicitud pendiente antes de proponer otra pareja.`);
  }

  if (targetStatus === 'partner_pending') {
    throw new Error(`El jugador ${targetId} ya tiene una solicitud pendiente y no esta libre para una nueva propuesta.`);
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
  const players = getTournamentPlayers();
  const activeProposals = getActiveDoublesProposalIntents_();
  const confirmedSnapshot = getDoublesConfirmedPairsSnapshot_();
  const checkinMap = getDoublesCheckinStateMap_();
  const proposalPlayerIds = {};

  const summary = {
    blocked: 0,
    eligible: 0,
    opted_out: 0,
    pool: 0,
    partner_pending: 0,
    partner_confirmed: 0,
  };

  activeProposals.forEach(function (intent) {
    if (intent.fromPlayerId) proposalPlayerIds[intent.fromPlayerId] = true;
    if (intent.toPlayerId) proposalPlayerIds[intent.toPlayerId] = true;
  });

  players.forEach(player => {
    const status = getEffectiveDoublesStatusForPlayer_(player, {
      confirmedPartnerMap: confirmedSnapshot.partnerMap || {},
      proposalPlayerIds: proposalPlayerIds,
      checkinMap: checkinMap,
    });

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
  const players = getTournamentPlayers();
  const activeProposals = getActiveDoublesProposalIntents_();
  const confirmedSnapshot = getDoublesConfirmedPairsSnapshot_();
  const checkinMap = getDoublesCheckinStateMap_();
  const proposalPlayerIds = {};
  const hasDynamicState = activeProposals.length > 0 ||
    Object.keys(confirmedSnapshot.partnerMap || {}).length > 0 ||
    Object.keys(checkinMap || {}).length > 0;

  if (!hasDynamicState) {
    return validateDoublesCutLegacy_(players);
  }

  if (activeProposals.length > 0) {
    errors.push('Hay solicitudes de partner pendientes de confirmacion.');
  }

  activeProposals.forEach(function (intent) {
    if (intent.fromPlayerId) proposalPlayerIds[intent.fromPlayerId] = true;
    if (intent.toPlayerId) proposalPlayerIds[intent.toPlayerId] = true;
  });

  const pool = players.filter(function (player) {
    return getEffectiveDoublesStatusForPlayer_(player, {
      confirmedPartnerMap: confirmedSnapshot.partnerMap || {},
      proposalPlayerIds: proposalPlayerIds,
      checkinMap: checkinMap,
    }) === 'pool';
  });
  if (pool.length % 2 !== 0) {
    errors.push('La cantidad de jugadores sin partner es impar.');
  }

  confirmedSnapshot.errors.forEach(function (error) {
    errors.push(error);
  });

  return {
    ok: errors.length === 0,
    errors,
  };
}

function validateDoublesCutLegacy_(players) {
  const errors = [];
  const pending = players.filter(function (player) {
    return String(player.doubles_status || '') === 'partner_pending';
  });

  if (pending.length > 0) {
    errors.push('Hay solicitudes de partner pendientes de confirmacion.');
  }

  const pool = players.filter(function (player) {
    return String(player.doubles_status || '') === 'pool';
  });
  if (pool.length % 2 !== 0) {
    errors.push('La cantidad de jugadores sin partner es impar.');
  }

  const confirmed = players.filter(function (player) {
    return String(player.doubles_status || '') === 'partner_confirmed';
  });

  confirmed.forEach(function (player) {
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
      errors.push(`El partner ${partnerId} de ${player.player_id} no esta confirmado.`);
    }

    if (String(partner.doubles_partner_id || '') !== String(player.player_id)) {
      errors.push(`La pareja confirmada ${player.player_id} <-> ${partnerId} no es simetrica.`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
  };
}
