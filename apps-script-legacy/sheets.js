/**
 * Devuelve el Spreadsheet activo o abre por ID si se definió SPREADSHEET_ID.
 */
function getSpreadsheet() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.trim()) {
    return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Devuelve una hoja por nombre.
 * Lanza error si no existe.
 * @param {string} sheetName
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`No existe la hoja: ${sheetName}`);
  }
  return sheet;
}

/**
 * Devuelve el mapa header -> índice (0-based).
 * Asume que la fila 1 contiene encabezados.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Object<string, number>}
 */
function getHeaderMap(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) {
    throw new Error(`La hoja ${sheet.getName()} no tiene encabezados.`);
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const map = {};

  headers.forEach((header, idx) => {
    const key = String(header || '').trim();
    if (!key) return;
    map[key] = idx;
  });

  return map;
}

/**
 * Devuelve los encabezados de una hoja.
 * @param {string} sheetName
 * @returns {string[]}
 */
function getHeaders(sheetName) {
  const sheet = getSheet(sheetName);
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(v => String(v || '').trim());
}

/**
 * Convierte una fila array a objeto usando headers.
 * @param {string[]} headers
 * @param {any[]} row
 * @returns {Object}
 */
function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, idx) => {
    obj[header] = row[idx];
  });
  return obj;
}

/**
 * Devuelve todas las filas de datos como objetos.
 * Omite la fila de encabezados.
 * @param {string} sheetName
 * @returns {Object[]}
 */
function getRows(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn === 0) {
    return [];
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(v => String(v || '').trim());
  const range = sheet.getRange(2, 1, lastRow - 1, lastColumn);
  const rawValues = range.getValues();
  const displayValues = range.getDisplayValues();
  const values = shouldReadSheetUsingDisplayValues_(sheetName)
    ? displayValues
    : rawValues;

  return values.map(row => rowToObject(headers, row));
}

/**
 * Determina si una hoja debe leerse desde su valor visible en pantalla.
 * Esto evita reinterpretaciones horarias de Sheets en campos timestamp.
 *
 * @param {string} sheetName
 * @returns {boolean}
 */
function shouldReadSheetUsingDisplayValues_(sheetName) {
  return sheetName === 'Config' || sheetName === 'Blocks';
}

/**
 * Agrega una fila a la hoja a partir de un objeto.
 * Los campos se ordenan según el header.
 * @param {string} sheetName
 * @param {Object} obj
 */
function appendRow(sheetName, obj) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);

  if (headers.length === 0) {
    throw new Error(`La hoja ${sheetName} no tiene encabezados.`);
  }

  const row = headers.map(header => {
    return Object.prototype.hasOwnProperty.call(obj, header) ? obj[header] : '';
  });

  const rowNumber = sheet.getLastRow() + 1;
  writeSheetRow_(sheet, rowNumber, row);
}

/**
 * Busca una fila por ID y devuelve metadata.
 * Busca desde la fila 2.
 *
 * @param {string} sheetName
 * @param {string} idField
 * @param {string|number} idValue
 * @returns {{rowNumber:number, rowObject:Object}|null}
 */
function findRowById(sheetName, idField, idValue) {
  const sheet = getSheet(sheetName);
  const rows = getRows(sheetName);

  for (let i = 0; i < rows.length; i++) {
    const rowObj = rows[i];
    if (String(rowObj[idField]) === String(idValue)) {
      return {
        rowNumber: i + 2,
        rowObject: rowObj,
      };
    }
  }

  return null;
}

/**
 * Actualiza una fila por ID con los campos indicados en patch.
 * Solo actualiza columnas que existan en la hoja.
 *
 * @param {string} sheetName
 * @param {string} idField
 * @param {string|number} idValue
 * @param {Object} patch
 */
function updateRowById(sheetName, idField, idValue, patch) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);
  const found = findRowById(sheetName, idField, idValue);

  if (!found) {
    throw new Error(`No se encontró fila en ${sheetName} con ${idField}=${idValue}`);
  }

  const rowNumber = found.rowNumber;
  const current = found.rowObject;
  const merged = { ...current, ...patch };

  const row = headers.map(header => {
    return Object.prototype.hasOwnProperty.call(merged, header) ? merged[header] : '';
  });

  writeSheetRow_(sheet, rowNumber, row);
}

/**
 * Reemplaza por completo el contenido de datos de una hoja,
 * conservando los encabezados.
 *
 * @param {string} sheetName
 * @param {Object[]} objects
 */
function replaceAllRows(sheetName, objects) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);

  if (headers.length === 0) {
    throw new Error(`La hoja ${sheetName} no tiene encabezados.`);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  }

  if (!objects || objects.length === 0) {
    return;
  }

  const values = objects.map(obj =>
    headers.map(header =>
      Object.prototype.hasOwnProperty.call(obj, header) ? obj[header] : ''
    )
  );

  values.forEach((row, index) => {
    writeSheetRow_(sheet, index + 2, row);
  });
}

/**
 * Escribe una fila en Sheets respetando celdas marcadas como texto explícito.
 * Los valores string que comienzan con apostrofo se persisten como texto plano.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowNumber
 * @param {any[]} row
 */
function writeSheetRow_(sheet, rowNumber, row) {
  const range = sheet.getRange(rowNumber, 1, 1, row.length);
  const numberFormats = [row.map(value => shouldForceTextCell_(value) ? '@' : 'General')];
  const normalizedRow = [row.map(normalizeCellValueForWrite_)];

  range.setNumberFormats(numberFormats);
  range.setValues(normalizedRow);
}

/**
 * Determina si una celda debe escribirse como texto plano.
 *
 * @param {any} value
 * @returns {boolean}
 */
function shouldForceTextCell_(value) {
  return typeof value === 'string' && value.charAt(0) === "'";
}

/**
 * Limpia marcadores internos antes de escribir en la hoja.
 *
 * @param {any} value
 * @returns {any}
 */
function normalizeCellValueForWrite_(value) {
  if (shouldForceTextCell_(value)) {
    return value.slice(1);
  }
  return value;
}

/**
 * Devuelve la zona horaria operativa de la app.
 * Prioriza una configuracion explicita en Config.app_time_zone.
 *
 * @returns {string}
 */
function getAppTimeZone() {
  const configured = String(getConfigValue('app_time_zone') || '').trim();
  if (configured) return configured;

  const ss = getSpreadsheet();
  const spreadsheetTz = ss && typeof ss.getSpreadsheetTimeZone === 'function'
    ? String(ss.getSpreadsheetTimeZone() || '').trim()
    : '';

  if (spreadsheetTz) return spreadsheetTz;

  return Session.getScriptTimeZone();
}

/**
 * Devuelve un resumen de zonas horarias relevantes para diagnostico.
 *
 * @returns {{appTimeZone:string, spreadsheetTimeZone:string, scriptTimeZone:string}}
 */
function getTimeZoneDiagnostics() {
  const ss = getSpreadsheet();
  const spreadsheetTimeZone = ss && typeof ss.getSpreadsheetTimeZone === 'function'
    ? String(ss.getSpreadsheetTimeZone() || '').trim()
    : '';

  return {
    appTimeZone: getAppTimeZone(),
    spreadsheetTimeZone: spreadsheetTimeZone,
    scriptTimeZone: Session.getScriptTimeZone(),
  };
}

/**
 * Convierte a boolean de forma tolerante.
 * @param {any} value
 * @returns {boolean}
 */
function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  const str = String(value).trim().toLowerCase();
  return str === 'true' || str === '1' || str === 'yes' || str === 'y' || str === 'si' || str === 'sí';
}

/**
 * Devuelve timestamp ISO simple en zona del script.
 * @returns {string}
 */
function nowIso() {
  return Utilities.formatDate(new Date(), getAppTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
