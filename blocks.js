/**
 * Devuelve todos los bloques.
 * @returns {Object[]}
 */
function getBlocks() {
  return getRows('Blocks');
}

/**
 * Devuelve un bloque por ID.
 * @param {string|number} blockId
 * @returns {Object|null}
 */
function getBlockById(blockId) {
  const found = findRowById('Blocks', 'block_id', blockId);
  return found ? found.rowObject : null;
}

/**
 * Devuelve el bloque actual desde Config.current_block_id.
 * @returns {Object|null}
 */
function getCurrentBlock() {
  const currentBlockId = getConfigValue('current_block_id');
  if (currentBlockId === null || currentBlockId === '') {
    return null;
  }
  return getBlockById(currentBlockId);
}

/**
 * Actualiza un bloque por block_id.
 * @param {string|number} blockId
 * @param {Object} patch
 */
function updateBlock(blockId, patch) {
  updateRowById('Blocks', 'block_id', blockId, patch);
}

/**
 * Crea un bloque.
 * @param {Object} block
 */
function createBlock(block) {
  appendRow('Blocks', block);
}

/**
 * Cambia status de bloque.
 * @param {string|number} blockId
 * @param {string} status
 */
function setBlockStatus(blockId, status) {
  updateBlock(blockId, {
    status,
  });
}

/**
 * Devuelve bloques ordenados por block_id ascendente.
 * @returns {Object[]}
 */
function getBlocksSorted() {
  return getBlocks().slice().sort((a, b) => Number(a.block_id) - Number(b.block_id));
}

/**
 * Devuelve el siguiente bloque del actual.
 * @param {string|number} currentBlockId
 * @returns {Object|null}
 */
function getNextBlock(currentBlockId) {
  const blocks = getBlocksSorted();
  const currentId = Number(currentBlockId);

  for (let i = 0; i < blocks.length; i++) {
    const id = Number(blocks[i].block_id);
    if (id > currentId) return blocks[i];
  }

  return null;
}

/**
 * Marca un bloque como publicado.
 * @param {string|number} blockId
 */
function publishBlock(blockId) {
  updateBlock(blockId, {
    published_at: nowIso(),
  });
}

/**
 * Cierra un bloque definitivamente.
 * @param {string|number} blockId
 */
function closeBlock(blockId) {
  updateBlock(blockId, {
    status: 'closed',
    closed_at: nowIso(),
  });
}

/**
 * Activa el siguiente bloque si existe.
 * También actualiza Config.current_block_id.
 *
 * @returns {Object|null}
 */
function activateNextBlock() {
  const current = getCurrentBlock();
  if (!current) return null;

  const next = getNextBlock(current.block_id);
  if (!next) {
    return null;
  }

  setConfigValue('current_block_id', next.block_id, 'Bloque actual');
  updateBlock(next.block_id, {
    status: 'scheduled',
  });

  return getBlockById(next.block_id);
}

/**
 * Devuelve Date desde un valor almacenado en Blocks.
 * Acepta Date real o string fallback.
 *
 * @param {any} value
 * @returns {Date|null}
 */
function parseBlockDate(value) {
  if (!value) return null;

  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (!Number.isNaN(value.getTime())) return value;
    return null;
  }

  const str = String(value).trim();
  if (!str) return null;

  const parts = str.split(' ');
  if (parts.length !== 2) return null;

  const datePart = parts[0];
  const timePart = parts[1];

  const d = datePart.split('-').map(Number);
  const t = timePart.split(':').map(Number);

  if (d.length !== 3 || t.length !== 3) return null;

  const [year, month, day] = d;
  const [hour, minute, second] = t;

  const parsed = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
}
