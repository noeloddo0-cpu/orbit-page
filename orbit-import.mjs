// Analyse locale des imports : CSV, doublons et similarité.
// Aucune écriture ici : le pont applique les décisions dans une transaction.

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_TITLE = 200;
export const IMPORT_MAX_MINUTES = 1000000;
export const SIMILARITY_THRESHOLD = 0.78;

export const STATUS_LABELS = ['En cours', 'En pause', 'À faire', 'Terminé', 'Abandonné', 'Neutre'];
export const COMPLETION_LABELS = ['À définir', 'Pas 100 %', '100 % / Platine'];

const STATUS_ALIASES = new Map();
const COMPLETION_ALIASES = new Map();

function addAliases(map, index, labels) {
  for (const label of labels) map.set(normalizeName(label), index);
}

STATUS_LABELS.forEach((label, index) => addAliases(STATUS_ALIASES, index, [label, String(index)]));
for (const [index, aliases] of [
  [0, ['en jeu', 'playing', 'in progress', 'current']],
  [1, ['pause', 'paused', 'on hold']],
  [2, ['backlog', 'to play', 'todo', 'pas commencé', 'pas commence']],
  [3, ['fini', 'finished', 'completed', 'done']],
  [4, ['dropped', 'abandoned']],
  [5, ['neutral', 'none', 'sans statut']]
]) {
  for (const alias of aliases) STATUS_ALIASES.set(normalizeName(alias), index);
}

COMPLETION_LABELS.forEach((label, index) => addAliases(COMPLETION_ALIASES, index, [label, String(index)]));
for (const [index, aliases] of [
  [0, ['non', 'none', 'pas commencé', 'pas commence']],
  [1, ['partiel', 'partial', 'en cours', 'progress']],
  [2, ['100', '100 %', '100%', 'platine', 'platinum', 'terminé', 'termine', 'completed', 'fini']]
]) {
  for (const alias of aliases) COMPLETION_ALIASES.set(normalizeName(alias), index);
}

export function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanTitle(value, max = IMPORT_MAX_TITLE) {
  return String(value ?? '')
    .replace(/[®™©]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function levenshtein(left, right) {
  const a = String(left ?? '').slice(0, 120);
  const b = String(right ?? '').slice(0, 120);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = new Uint16Array(b.length + 1);
  let current = new Uint16Array(b.length + 1);
  for (let index = 0; index <= b.length; index += 1) previous[index] = index;
  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

export function nameSimilarity(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const distance = levenshtein(a, b);
  const editScore = 1 - distance / Math.max(a.length, b.length);
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  let common = 0;
  for (const token of aTokens) if (bTokens.has(token)) common += 1;
  const dice = aTokens.size && bTokens.size ? (2 * common) / (aTokens.size + bTokens.size) : 0;
  let score = 0.55 * editScore + 0.45 * dice;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // Un titre qui commence par l'autre est souvent une suite ou une variante :
  // on le signale, mais l'utilisateur garde toujours le dernier mot.
  if (shorter.length >= 4 && longer.startsWith(shorter + ' ')) {
    score = Math.max(score, 0.72 + Math.min(0.12, (shorter.length / longer.length) * 0.12));
  }
  return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
}

export function parseStatus(value) {
  if (value === null || value === undefined) return { value: null };
  const text = String(value).trim();
  if (!text) return { value: null };
  const number = Number(text.replace(',', '.'));
  if (Number.isInteger(number) && number >= 0 && number <= 5) return { value: number };
  const mapped = STATUS_ALIASES.get(normalizeName(text));
  if (mapped !== undefined) return { value: mapped };
  return { value: null, error: 'statut inconnu' };
}

export function parseCompletion(value) {
  if (value === null || value === undefined) return { value: null };
  const text = String(value).trim();
  if (!text) return { value: null };
  const number = Number(text.replace('%', '').replace(',', '.').trim());
  if (Number.isInteger(number) && number >= 0 && number <= 2) return { value: number };
  const mapped = COMPLETION_ALIASES.get(normalizeName(text));
  if (mapped !== undefined) return { value: mapped };
  return { value: null, error: 'complétion inconnue' };
}

export function parseMinutes(value) {
  if (value === null || value === undefined) return { value: null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > IMPORT_MAX_MINUTES) {
      return { value: null, error: 'durée invalide' };
    }
    return { value: Math.round(value) };
  }
  const text = String(value).trim();
  if (!text) return { value: null };
  let match = text.match(/^(\d{1,6})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?$/);
  if (match) {
    const minutes = Number(match[1]) * 60 + Number(match[2]) + Math.round(Number(match[3] || 0) / 60);
    return minutes <= IMPORT_MAX_MINUTES ? { value: minutes } : { value: null, error: 'durée invalide' };
  }
  match = text.match(/^(\d{1,6})\s*h(?:eures?)?\s*(\d{1,2})?\s*(?:min(?:utes?)?)?$/i);
  if (match) {
    const minutes = Number(match[1]) * 60 + Number(match[2] || 0);
    return minutes <= IMPORT_MAX_MINUTES ? { value: minutes } : { value: null, error: 'durée invalide' };
  }
  match = text.match(/^(\d{1,7})\s*(?:min|minutes?|m)$/i);
  if (match) {
    const minutes = Number(match[1]);
    return minutes <= IMPORT_MAX_MINUTES ? { value: minutes } : { value: null, error: 'durée invalide' };
  }
  match = text.match(/^\d+(?:[.,]\d+)?$/);
  if (match) {
    const minutes = Math.round(Number(text.replace(',', '.')));
    return minutes <= IMPORT_MAX_MINUTES ? { value: minutes } : { value: null, error: 'durée invalide' };
  }
  return { value: null, error: 'durée invalide' };
}

export function parseKind(value) {
  if (value === null || value === undefined) return { value: null };
  const text = normalizeName(value);
  if (!text) return { value: null };
  if (['jeu', 'jeux', 'game', 'games'].includes(text)) return { value: 'game' };
  if (['application', 'applications', 'app', 'apps', 'logiciel', 'software', 'outil'].includes(text)) {
    return { value: 'app' };
  }
  return { value: null, error: 'type inconnu' };
}

export function parseNameList(value) {
  if (value === null || value === undefined) return { value: null };
  const values = Array.isArray(value)
    ? value
    : String(value)
        .split(/[,;|]/)
        .map((entry) => entry.trim());
  const seen = new Set();
  const list = [];
  for (const entry of values) {
    const text = String(entry ?? '').trim();
    const key = normalizeName(text);
    if (!key || seen.has(key)) continue;
    if (text.length > 60) return { value: [], error: 'nom trop long' };
    seen.add(key);
    list.push(text);
    if (list.length > 20) return { value: [], error: '20 noms maximum' };
  }
  return { value: list };
}

export function parseAppId(value) {
  if (value === null || value === undefined) return { value: null };
  const text = String(value).trim();
  if (!text) return { value: null };
  if (!/^\d{1,10}$/.test(text)) return { value: null, error: 'appId Steam invalide' };
  return { value: text };
}

const HEADER_ALIASES = {
  title: ['titre', 'titre du jeu', 'jeu', 'nom', 'name', 'title', 'game', 'games'],
  status: ['statut', 'status', 'etat'],
  completion: ['completion', 'progression', 'pourcentage', 'percent', 'progress'],
  minutes: ['minutes', 'minute', 'temps', 'temps de jeu', 'duree', 'playtime', 'time'],
  platforms: ['plateforme', 'plateformes', 'platform', 'platforms', 'support', 'supports'],
  tags: ['tags', 'etiquettes', 'collections', 'collection', 'labels'],
  kind: ['type', 'kind', 'categorie'],
  appId: ['appid', 'app id', 'steam appid', 'steam app id', 'steamid', 'steam id']
};

export const IMPORT_FIELDS = Object.keys(HEADER_ALIASES);

function headerMatches(text, alias) {
  const key = normalizeName(text);
  const needle = normalizeName(alias);
  if (!key || !needle) return false;
  return key === needle || key.startsWith(needle + ' ') || key.endsWith(' ' + needle);
}

export function detectMapping(headers) {
  const mapping = {};
  const used = new Set();
  for (const field of IMPORT_FIELDS) {
    const aliases = HEADER_ALIASES[field];
    const index = headers.findIndex((header, position) => {
      if (used.has(position)) return false;
      return aliases.some((alias) => headerMatches(header, alias));
    });
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

function detectDelimiter(text) {
  const sample =
    String(text ?? '')
      .split(/\r?\n/)
      .find((line) => line.trim()) || '';
  let quoted = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const char of sample) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && Object.hasOwn(counts, char)) counts[char] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsv(text, options = {}) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const delimiter = options.delimiter || detectDelimiter(source);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const pushRow = () => {
    row.push(field);
    field = '';
    if (row.some((cell) => String(cell).trim())) rows.push({ cells: row, line: rowLine });
    row = [];
    rowLine = line;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      pushRow();
      line += 1;
      rowLine = line;
      continue;
    }
    field += char;
  }
  if (field.length || row.length) pushRow();
  return { rows, delimiter };
}

function resolveColumn(value, headers, rows) {
  if (value === null || value === undefined || value === '') return null;
  if (Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  const key = normalizeName(value);
  const index = headers.findIndex((header) => normalizeName(header) === key);
  if (index >= 0) return index;
  // Un index a pu être fourni avant l'ajout de l'en-tête : on retombe sur l'ordre.
  if (rows[0] && Number(value) >= 0 && Number(value) < rows[0].cells.length) return Number(value);
  return null;
}

export function readCsvDocument(text, requestedMapping = null) {
  const parsed = parseCsv(text);
  if (!parsed.rows.length) {
    return { rows: [], headers: [], columns: [], mapping: {}, delimiter: parsed.delimiter, hasHeader: false };
  }
  const first = parsed.rows[0].cells;
  const detected = detectMapping(first);
  const hasHeader =
    detected.title !== undefined &&
    (Object.keys(detected).length >= 2 ||
      first.some((cell) => headerMatches(cell, 'titre') || headerMatches(cell, 'jeu') || headerMatches(cell, 'title')));
  const headers = hasHeader ? parsed.rows[0].cells : first.map((_, index) => `Colonne ${index + 1}`);
  const columns = hasHeader ? headers : first.map((_, index) => `Colonne ${index + 1}`);
  const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows;
  const mapping = hasHeader
    ? { ...detected }
    : { title: 0, status: 1, completion: 2, minutes: 3, platforms: 4, tags: 5 };
  if (requestedMapping && typeof requestedMapping === 'object') {
    for (const field of IMPORT_FIELDS) {
      if (!Object.hasOwn(requestedMapping, field)) continue;
      const column = resolveColumn(requestedMapping[field], headers, dataRows);
      if (column === null) delete mapping[field];
      else mapping[field] = column;
    }
  }
  return {
    rows: dataRows,
    headers: hasHeader ? headers : [],
    columns,
    mapping,
    delimiter: parsed.delimiter,
    hasHeader
  };
}

export function entryFromRow(row, mapping) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  const line = Number(row?.line) || 0;
  const cell = (field) => (mapping[field] === undefined ? null : String(cells[mapping[field]] ?? ''));
  const errors = [];
  const addError = (field, message) => errors.push({ field, message });
  const title = cleanTitle(cell('title'));
  if (!title) addError('title', 'titre manquant');
  if (String(cell('title') ?? '').trim().length > IMPORT_MAX_TITLE) addError('title', 'titre trop long');
  const status = parseStatus(cell('status'));
  if (status.error) addError('status', status.error);
  const completion = parseCompletion(cell('completion'));
  if (completion.error) addError('completion', completion.error);
  const minutes = parseMinutes(cell('minutes'));
  if (minutes.error) addError('minutes', minutes.error);
  const kind = parseKind(cell('kind'));
  if (kind.error) addError('kind', kind.error);
  const platforms = parseNameList(cell('platforms'));
  if (platforms.error) addError('platforms', platforms.error);
  const tags = parseNameList(cell('tags'));
  if (tags.error) addError('tags', tags.error);
  const appId = parseAppId(cell('appId'));
  if (appId.error) addError('appId', appId.error);
  return {
    line,
    title,
    status: status.value,
    completion: completion.value,
    minutes: minutes.value,
    kind: kind.value,
    platforms: platforms.value,
    tags: tags.value,
    appId: appId.value,
    provided: {
      status: mapping.status !== undefined,
      completion: mapping.completion !== undefined,
      minutes: mapping.minutes !== undefined,
      kind: mapping.kind !== undefined,
      platforms: mapping.platforms !== undefined,
      tags: mapping.tags !== undefined,
      appId: mapping.appId !== undefined
    },
    cover: '',
    source: '',
    errors
  };
}

export function entryFromItem(item, index, options = {}) {
  const source = item && typeof item === 'object' ? item : { title: item };
  const errors = [];
  const addError = (field, message) => errors.push({ field, message });
  const title = cleanTitle(source.title ?? source.name);
  if (!title) addError('title', 'titre manquant');
  if (String(source.title ?? source.name ?? '').trim().length > IMPORT_MAX_TITLE) addError('title', 'titre trop long');
  const status = parseStatus(source.status ?? source.s ?? options.defaultStatus);
  if (status.error) addError('status', status.error);
  const completion = parseCompletion(source.completion ?? source.c);
  if (completion.error) addError('completion', completion.error);
  const minutes = parseMinutes(source.minutes ?? source.m);
  if (minutes.error) addError('minutes', minutes.error);
  const kind = parseKind(source.kind);
  if (kind.error) addError('kind', kind.error);
  const platforms = parseNameList(source.platforms);
  if (platforms.error) addError('platforms', platforms.error);
  const tags = parseNameList(source.tags);
  if (tags.error) addError('tags', tags.error);
  const appId = parseAppId(source.appId ?? source.steamAppId);
  if (appId.error) addError('appId', appId.error);
  const cover =
    typeof source.cover === 'string' && /^https?:\/\//i.test(source.cover) ? source.cover.slice(0, 1000) : '';
  return {
    line: Number(source.line) || index + 1,
    title,
    status: status.value,
    completion: completion.value,
    minutes: minutes.value,
    kind: kind.value,
    platforms: platforms.value,
    tags: tags.value,
    appId: appId.value,
    provided: {
      status: source.status !== undefined || source.s !== undefined || options.providedStatus === true,
      completion: source.completion !== undefined || source.c !== undefined,
      minutes: source.minutes !== undefined || source.m !== undefined,
      kind: source.kind !== undefined,
      platforms: source.platforms !== undefined,
      tags: source.tags !== undefined,
      appId: source.appId !== undefined || source.steamAppId !== undefined
    },
    cover,
    source: String(source.source || '').slice(0, 80),
    errors
  };
}

export function reportToCsv(report) {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const actions = { add: 'Ajouter', merge: 'Fusionner', update: 'Remplacer', ignore: 'Ignorer', reject: 'Rejeter' };
  const results = {
    added: 'Ajouté',
    merged: 'Fusionné',
    updated: 'Mis à jour',
    ignored: 'Ignoré',
    rejected: 'Rejeté'
  };
  const lines = [['Ligne', 'Titre', 'Action', 'Résultat', 'Jeu', 'Erreur'].map(escape).join(',')];
  for (const item of report?.lines || []) {
    lines.push(
      [
        item.line,
        item.title,
        actions[item.action] || item.action,
        results[item.result] || item.result,
        item.name || '',
        item.error || ''
      ]
        .map(escape)
        .join(',')
    );
  }
  return '\uFEFF' + lines.join('\r\n');
}
