/**
 * Devuelve Config como objeto key -> value.
 * Espera columnas: key, value, note
 * @returns {Object<string, any>}
 */
function getConfig() {
  const rows = getRows('Config');
  const config = {};

  rows.forEach(row => {
    const key = String(row.key || '').trim();
    if (!key) return;
    config[key] = row.value;
  });

  return config;
}

/**
 * Devuelve el valor de una key en Config.
 * @param {string} key
 * @returns {any}
 */
function getConfigValue(key) {
  const found = findRowById('Config', 'key', key);
  return found ? found.rowObject.value : null;
}

/**
 * Actualiza una key existente en Config.
 * Si no existe, la crea.
 * @param {string} key
 * @param {any} value
 * @param {string=} note
 */
function setConfigValue(key, value, note) {
  const found = findRowById('Config', 'key', key);

  if (found) {
    updateRowById('Config', 'key', key, {
      value,
      note: typeof note === 'undefined' ? found.rowObject.note : note,
    });
    return;
  }

  appendRow('Config', {
    key,
    value,
    note: typeof note === 'undefined' ? '' : note,
  });
}
