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
  updateRowById('Blocks', 'block_id', blockId, normalizeBlockDateFields_(patch));
}

/**
 * Crea un bloque.
 * @param {Object} block
 */
function createBlock(block) {
  appendRow('Blocks', normalizeBlockDateFields_(block));
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
  const normalized = normalizeDateTimeText(value);
  if (!normalized) return null;

  const parts = normalized.split(' ');
  if (parts.length !== 2) return null;

  const datePart = parts[0];
  const timePart = parts[1];
  const d = datePart.split('-').map(Number);
  const t = timePart.split(':').map(Number);

  if (d.length !== 3 || t.length !== 3) return null;

  const [year, month, day] = d;
  const [hour, minute, second] = t;
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Formatea un Date construido por parseBlockDate() de vuelta al
 * texto canonico yyyy-MM-dd HH:mm:ss sin aplicar conversion de zona horaria.
 *
 * @param {Date} date
 * @returns {string}
 */
function formatParsedBlockDate(date) {
  if (Object.prototype.toString.call(date) !== '[object Date]' || Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * Normaliza una fecha/hora a texto canonico yyyy-MM-dd HH:mm:ss.
 * Para objetos Date usa la zona horaria operativa de la app.
 *
 * @param {any} value
 * @returns {string}
 */
function normalizeDateTimeText(value) {
  if (value === null || typeof value === 'undefined' || value === '') return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Number.isNaN(value.getTime()) ? '' : formatDateTime(value);
  }

  let str = String(value).trim();
  if (!str) return '';

  if (str.charAt(0) === "'") {
    str = str.slice(1).trim();
  }

  let match = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6] || '00'}`;
  }

  match = str.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]} ${match[4]}:${match[5]}:${match[6] || '00'}`;
  }

  const nativeDate = new Date(str);
  if (!Number.isNaN(nativeDate.getTime())) {
    return formatDateTime(nativeDate);
  }

  return '';
}

/**
 * Normaliza los campos temporales de Blocks antes de persistirlos en Sheets.
 * Esto evita corrimientos de zona horaria al guardar Date nativo en celdas.
 *
 * @param {Object} rowLike
 * @returns {Object}
 */
function normalizeBlockDateFields_(rowLike) {
  const normalized = { ...rowLike };
  const dateKeys = ['start_ts', 'close_signal_ts', 'hard_close_ts', 'end_ts'];

  dateKeys.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) return;

    const value = normalized[key];
    if (value === null || value === '' || typeof value === 'undefined') return;

    const text = normalizeDateTimeText(value);
    if (!text) {
      throw new Error(`Fecha de bloque invalida para ${key}: ${value}`);
    }

    normalized[key] = `'${text}`;
  });

  return normalized;
}
