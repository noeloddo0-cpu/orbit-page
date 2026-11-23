import { createHash } from 'node:crypto';

export const LIBRARY_VERSION = 2;
export const META_SCHEMA_VERSION = 2;

// Namespace fixe : les identifiants générés restent identiques d'un dry-run à l'autre.
const GAME_NAMESPACE = '4f1b6e2c-8a3d-5f70-9c41-2d8e6b7a1f30';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha1(value) {
  return createHash('sha1').update(String(value)).digest('hex');
}

export function legacyMetaKey(name) {
  return sha1(normalizeName(name));
}

export function uuidv5(value) {
  const namespace = Buffer.from(GAME_NAMESPACE.replace(/-/g, ''), 'hex');
  const digest = createHash('sha1').update(Buffer.concat([namespace, Buffer.from(String(value), 'utf8')])).digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function stableGameId(name, occurrence = 0) {
  return uuidv5(`orbit:game:${normalizeName(name)}#${Math.max(0, occurrence | 0)}`);
}

export function stableSessionId(session) {
  return 'legacy-' + sha1(`${session?.gameNameSnapshot || session?.game || ''}|${session?.start || ''}`).slice(0, 20);
}

export function isStableId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function number(value, fallback = 0, min = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function normalizeStatus(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed : 5;
}

function normalizeCompletion(value) {
  const parsed = Number(value);
  return parsed === 1 || parsed === 2 ? parsed : 0;
}

export function parseMetaDocument(raw) {
  const result = {
    sourceVersion: 1,
    canonical: {},
    aliases: {},
    orphans: {},
    archived: [],
    legacy: []
  };
  const source = asObject(raw);
  if (source._schema === META_SCHEMA_VERSION) {
    result.sourceVersion = META_SCHEMA_VERSION;
    result.aliases = { ...asObject(source._aliases) };
    result.orphans = { ...asObject(source._orphans) };
    result.archived = Array.isArray(source._archived)
      ? source._archived.filter((entry) => entry && typeof entry === 'object').slice(0, 5000)
      : [];
    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith('_') || Object.hasOwn(result.aliases, key) || Object.hasOwn(result.orphans, key)) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) result.canonical[key] = value;
    }
    return result;
  }
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('_')) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) result.legacy.push({ key, value });
  }
  return result;
}

export function buildMetaDocument({ canonical = {}, aliases = {}, orphans = {}, archived = [] } = {}) {
  const document = {
    _schema: META_SCHEMA_VERSION,
    _aliases: { ...aliases },
    _orphans: { ...orphans }
  };
  if (archived.length) document._archived = archived;
  const mirror = new Map();
  for (const [alias, gameId] of Object.entries(aliases)) {
    if (!mirror.has(gameId)) mirror.set(gameId, []);
    mirror.get(gameId).push(alias);
  }
  for (const [gameId, meta] of Object.entries(canonical)) {
    if (!gameId || !meta || typeof meta !== 'object') continue;
    document[gameId] = meta;
    for (const alias of mirror.get(gameId) || []) {
      if (alias !== gameId && !Object.hasOwn(document, alias)) document[alias] = meta;
    }
  }
  for (const [key, meta] of Object.entries(orphans)) {
    if (key.startsWith('_') || Object.hasOwn(document, key)) continue;
    document[key] = meta;
  }
  return document;
}

function imageKind(record) {
  const width = Number(record?.width) || 0;
  const height = Number(record?.height) || 0;
  if (width <= 0 || height <= 0) return '';
  if (height >= width * 1.15) return 'tall';
  return 'wide';
}

function fileFromUrl(value) {
  try {
    const url = new URL(String(value), 'http://localhost');
    const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    return name && name === decodeURIComponent(name) && !name.includes('/') && !name.includes('\\') ? name : '';
  } catch {
    return '';
  }
}

function artworkRecord(record) {
  if (!record?.name) return null;
  return { f: record.name, v: Math.round(Number(record.mtime) || 0) };
}

function pickArtwork(game, meta, coverRecords) {
  const stems = [
    normalizeName(game.name),
    'orbit-wide-' + legacyMetaKey(game.name),
    'orbit-tall-' + legacyMetaKey(game.name)
  ];
  const candidates = [];
  for (const stem of stems) {
    for (const record of coverRecords.get(stem) || []) candidates.push(record);
  }
  const known = new Map();
  for (const name of [fileFromUrl(meta.cover), meta.steamPortrait?.f, meta.playPortrait?.f, meta.artwork?.wide?.f, meta.artwork?.tall?.f]) {
    if (!name) continue;
    for (const record of coverRecords.get(normalizeName(name.replace(/\.[^.]+$/, ''))) || []) {
      if (record.name === name) known.set(name, record);
    }
  }
  for (const record of known.values()) candidates.push(record);

  const unique = [...new Map(candidates.map((record) => [record.name, record])).values()];
  const wide = unique.filter((record) => imageKind(record) === 'wide').sort((a, b) => b.mtime - a.mtime);
  const tall = unique.filter((record) => imageKind(record) === 'tall').sort((a, b) => b.mtime - a.mtime);
  const artwork = { ...asObject(meta.artwork) };
  if (!artwork.wide) {
    const manual = meta.coverManual ? fileFromUrl(meta.cover) : '';
    const chosen = unique.find((record) => record.name === manual) || wide[0];
    const record = artworkRecord(chosen);
    if (record) artwork.wide = record;
  }
  if (!artwork.tall) {
    const preferred = [meta.playPortrait?.f, meta.steamPortrait?.f].filter(Boolean);
    const chosen = preferred.map((name) => unique.find((record) => record.name === name)).find(Boolean) || tall[0];
    const record = artworkRecord(chosen);
    if (record) artwork.tall = record;
  }
  return artwork;
}

function gameKind(raw, meta) {
  if (raw.kind === 'app' || raw.kind === 'game') return raw.kind;
  const kind = meta?.playDetails?.kind;
  return kind === 'app' || kind === 'game' ? kind : 'game';
}

function playDetailList(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((entry) => text(entry, 60)).filter(Boolean))].slice(0, 20);
}

export function migrateToV2({ library, meta = {}, covers = [], now = Date.now() } = {}) {
  if (!library || !Array.isArray(library.games)) throw new Error('library.games manquant');
  const sourceVersion = Number(library.version) || 1;
  const migratedAt = Number(library.migratedAt) || now;
  const report = {
    sourceVersion,
    targetVersion: LIBRARY_VERSION,
    generatedAt: new Date(now).toISOString(),
    counts: {},
    duplicateGames: [],
    orphanSessions: [],
    orphanMeta: [],
    orphanFavorites: [],
    recoveredMeta: [],
    mergedMeta: [],
    archivedMeta: [],
    warnings: []
  };

  const parsedMeta = parseMetaDocument(meta);
  const games = [];
  const usedIds = new Set();
  const occurrences = new Map();

  for (const raw of library.games) {
    if (!raw || typeof raw !== 'object') continue;
    const name = text(raw.name || raw.n);
    if (!name) {
      report.warnings.push({ code: 'jeu-sans-nom', message: 'Une entrée de jeu sans nom a été ignorée.' });
      continue;
    }
    const key = normalizeName(name);
    let occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    let id = isStableId(raw.id) ? raw.id : stableGameId(name, occurrence);
    while (usedIds.has(id)) id = stableGameId(name, ++occurrence);
    usedIds.add(id);

    const status = normalizeStatus(raw.s ?? raw.status);
    const completion = normalizeCompletion(raw.c ?? raw.completion);
    const minutes = Math.max(0, Math.round(number(raw.m ?? raw.minutes)));
    const firstPlayedAt = Math.max(0, number(raw.firstPlayed ?? raw.firstPlayedAt));
    const lastPlayedAt = Math.max(0, number(raw.t ?? raw.lastPlayedAt));
    games.push({
      ...raw,
      id,
      name,
      n: name,
      kind: gameKind(raw, null),
      status,
      s: status,
      completion,
      c: completion,
      minutes,
      m: minutes,
      manualDelta: Number.isSafeInteger(raw.manualDelta) ? raw.manualDelta : 0,
      firstPlayedAt,
      firstPlayed: firstPlayedAt,
      lastPlayedAt,
      t: lastPlayedAt,
      rating: Math.max(0, Math.min(5, number(raw.rating))),
      review: text(raw.review, 500),
      tags: playDetailList(raw.tags),
      platforms: playDetailList(raw.platforms),
      ownership: text(raw.ownership, 100),
      createdAt: Math.max(0, number(raw.createdAt)) || firstPlayedAt || migratedAt,
      updatedAt: Math.max(0, number(raw.updatedAt)) || migratedAt
    });
  }

  const gameById = new Map(games.map((game) => [game.id, game]));
  const gamesByKey = new Map();
  const gamesByLegacyKey = new Map();
  for (const game of games) {
    const key = normalizeName(game.name);
    if (!gamesByKey.has(key)) gamesByKey.set(key, []);
    gamesByKey.get(key).push(game);
    const legacyKey = legacyMetaKey(game.name);
    if (!gamesByLegacyKey.has(legacyKey)) gamesByLegacyKey.set(legacyKey, game);
  }
  for (const [key, list] of gamesByKey) {
    if (list.length > 1) {
      report.duplicateGames.push({
        name: list[0].name,
        key,
        ids: list.map((game) => game.id),
        count: list.length
      });
    }
  }

  const canonical = {};
  const aliases = {};
  const orphans = { ...parsedMeta.orphans };
  const archived = [...parsedMeta.archived];
  const metaKeysByGame = new Map(games.map((game) => [game.id, new Set()]));
  const primaryByKey = new Map();
  for (const game of games) {
    const key = legacyMetaKey(game.name);
    if (!primaryByKey.has(key)) primaryByKey.set(key, []);
    primaryByKey.get(key).push(game);
  }

  const mergeMissing = (primary, secondary) => {
    if (!secondary || typeof secondary !== 'object' || Array.isArray(secondary)) return primary;
    const result = { ...primary };
    for (const [field, value] of Object.entries(secondary)) {
      if (result[field] === undefined) result[field] = value;
      else if (Array.isArray(result[field]) && Array.isArray(value) && !result[field].length) result[field] = value;
      else if (
        result[field] &&
        value &&
        typeof result[field] === 'object' &&
        typeof value === 'object' &&
        !Array.isArray(result[field]) &&
        !Array.isArray(value)
      ) {
        result[field] = mergeMissing(result[field], value);
      }
    }
    return result;
  };

  const archiveDuplicate = (value, game, key, method) => {
    archived.push({
      reason: 'doublon-metadonnees',
      key,
      gameId: game.id,
      name: game.name,
      method,
      title: text(value?.title),
      value
    });
    if (archived.length > 5000) archived.splice(0, archived.length - 5000);
    report.archivedMeta.push({ key, gameId: game.id, name: game.name, method, title: text(value?.title) });
  };

  const attach = (value, game, key, method, primary = false) => {
    if (!game || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    const existing = canonical[game.id];
    if (existing) {
      canonical[game.id] = primary ? mergeMissing({ ...value }, existing) : mergeMissing(existing, value);
      report.mergedMeta.push({ key, gameId: game.id, name: game.name, method });
      if (!primary) archiveDuplicate(value, game, key, method);
    } else {
      canonical[game.id] = { ...value };
    }
    if (key && key !== game.id) {
      if (aliases[key] && aliases[key] !== game.id) {
        report.warnings.push({ code: 'alias-partage', key, gameId: game.id, existing: aliases[key] });
      } else {
        aliases[key] = game.id;
      }
      metaKeysByGame.get(game.id)?.add(key);
    }
    if (method !== 'id') {
      report.recoveredMeta.push({ key, gameId: game.id, name: game.name, method, title: text(value.title) });
    }
    return true;
  };

  for (const [key, value] of Object.entries(parsedMeta.canonical)) {
    const game = gameById.get(key);
    if (game) {
      canonical[game.id] = value;
    } else {
      orphans[key] = value;
      report.orphanMeta.push({ key, title: text(value?.title), reason: 'identifiant de jeu inconnu' });
    }
  }

  for (const [key, gameId] of Object.entries(parsedMeta.aliases)) {
    if (gameById.has(gameId)) aliases[key] = gameId;
  }

  const legacyEntries = parsedMeta.sourceVersion === META_SCHEMA_VERSION
    ? Object.entries(orphans).map(([key, value]) => ({ key, value, fromOrphan: true }))
    : parsedMeta.legacy.map((entry) => ({ ...entry, fromOrphan: false }));
  const richness = (entry) => {
    const value = entry.value || {};
    let score = Object.keys(value).length;
    if (typeof value.description === 'string') score += Math.min(50, value.description.length / 100);
    if (value.cover) score += 2;
    if (value.artwork) score += 2;
    return score;
  };
  const entryRank = (entry) => {
    if (primaryByKey.has(entry.key) || (!entry.fromOrphan && gameById.has(entry.key))) return 0;
    if (gameById.has(aliases[entry.key])) return 1;
    return 2;
  };
  legacyEntries.sort((a, b) => entryRank(a) - entryRank(b) || richness(b) - richness(a));

  for (const { key, value, fromOrphan } of legacyEntries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const byId = gameById.get(key);
    if (byId) {
      attach(value, byId, key, 'id', !fromOrphan);
      if (fromOrphan) delete orphans[key];
      continue;
    }
    const byLegacyKey = gamesByLegacyKey.get(key);
    if (byLegacyKey) {
      attach(value, byLegacyKey, key, 'cle', true);
      if (fromOrphan) delete orphans[key];
      continue;
    }
    const byAlias = gameById.get(aliases[key]);
    if (byAlias) {
      attach(value, byAlias, key, 'alias');
      if (fromOrphan) delete orphans[key];
      continue;
    }
    const byKey = gamesByKey.get(normalizeName(value.title));
    if (byKey?.length) {
      attach(value, byKey[0], key, 'titre');
      if (fromOrphan || !parsedMeta.orphans[key]) delete orphans[key];
      continue;
    }
    if (!fromOrphan) {
      orphans[key] = value;
      report.orphanMeta.push({ key, title: text(value.title), reason: 'aucun jeu correspondant' });
    } else {
      report.orphanMeta.push({ key, title: text(value.title), reason: 'archive de migration' });
    }
  }

  const coverRecords = new Map();
  for (const record of covers) {
    if (!record?.name) continue;
    const stem = normalizeName(String(record.name).replace(/\.[^.]+$/, ''));
    if (!stem) continue;
    if (!coverRecords.has(stem)) coverRecords.set(stem, []);
    coverRecords.get(stem).push({ ...record, mtime: Number(record.mtime) || 0 });
  }

  for (const game of games) {
    const meta = canonical[game.id] || {};
    const title = text(meta.title) || game.name;
    const details = asObject(meta.playDetails);
    const tags = playDetailList(details.collections, game.tags);
    const platforms = playDetailList(details.platforms, game.platforms);
    const artwork = pickArtwork(game, meta, coverRecords);
    if (!meta.title) meta.title = title;
    if (Object.keys(artwork).length) meta.artwork = artwork;
    if (!meta.cover && artwork.wide?.f) {
      meta.cover = '/covers/' + encodeURIComponent(artwork.wide.f) + '?v=' + Math.round(artwork.wide.v || 0);
    }
    if (!meta.steamPortrait && artwork.tall?.f) meta.steamPortrait = { ...artwork.tall };
    if (metaKeysByGame.get(game.id)?.size) meta.legacyKeys = [...metaKeysByGame.get(game.id)];

    game.kind = gameKind(game, meta);
    game.rating = Math.max(0, Math.min(5, number(game.rating || details.rating)));
    game.review = text(game.review || details.review, 500);
    game.tags = tags;
    game.platforms = platforms;
    game.ownership = text(game.ownership, 100);
    canonical[game.id] = meta;
    const legacyKey = legacyMetaKey(game.name);
    if (!aliases[legacyKey]) aliases[legacyKey] = game.id;
    metaKeysByGame.get(game.id)?.add(legacyKey);
    if (meta.legacyKeys) meta.legacyKeys = [...metaKeysByGame.get(game.id)];
  }

  const usedSessionIds = new Set();
  const sessions = [];
  for (const raw of Array.isArray(library.sessions) ? library.sessions : []) {
    if (!raw || typeof raw !== 'object') continue;
    const start = Number(raw.start);
    if (!Number.isFinite(start)) continue;
    let id = isStableId(raw.id) ? raw.id : stableSessionId(raw);
    while (usedSessionIds.has(id)) id = `${id}-${usedSessionIds.size + 1}`;
    usedSessionIds.add(id);
    const snapshot = text(raw.gameNameSnapshot || raw.game) || 'Jeu inconnu';
    let game = isStableId(raw.gameId) ? gameById.get(raw.gameId) : null;
    if (!game && raw.game) game = gamesByKey.get(normalizeName(raw.game))?.[0] || null;
    const gameId = game?.id || null;
    const end = Number.isFinite(Number(raw.end)) ? Number(raw.end) : null;
    const durationMs = Math.max(0, number(raw.durationMs, end !== null ? Math.max(0, end - start) : 0));
    const session = {
      ...raw,
      id,
      gameId,
      gameNameSnapshot: snapshot,
      game: game?.name || snapshot,
      start,
      end,
      durationMs,
      minutes: Math.max(0, Math.floor(number(raw.minutes, Math.floor(durationMs / 60000)))),
      source: ['manual', 'discord', 'import'].includes(raw.source) ? raw.source : 'manual',
      note: text(raw.note, 1000),
      dated: raw.dated !== false,
      revision: Number.isInteger(raw.revision) && raw.revision > 0 ? raw.revision : 1,
      createdAt: Math.max(0, number(raw.createdAt)) || start,
      updatedAt: Math.max(0, number(raw.updatedAt)) || end || start
    };
    if (gameId) delete session.orphan;
    else {
      session.orphan = true;
      if (raw.gameId && raw.gameId !== gameId) session.legacyGameId = String(raw.gameId).slice(0, 100);
      report.orphanSessions.push({ id, game: snapshot, start, reason: 'aucun jeu correspondant' });
    }
    sessions.push(session);
  }

  const favorites = [];
  const favoriteOrphans = [];
  for (const entry of Array.isArray(library.favoriteOrphans) ? library.favoriteOrphans : []) {
    const value = text(entry, 200);
    if (value) favoriteOrphans.push(value);
  }
  for (const entry of Array.isArray(library.favorites) ? library.favorites : []) {
    const value = text(entry, 200);
    if (!value) continue;
    const game = gameById.get(value) || gamesByKey.get(normalizeName(value))?.[0];
    if (game) favorites.push(game.id);
    else {
      favoriteOrphans.push(value);
      report.orphanFavorites.push(value);
    }
  }

  const uniqueFavorites = [...new Set(favorites)];
  const uniqueOrphanFavorites = [...new Set(favoriteOrphans)];
  const deletedGames = (Array.isArray(library.deletedGames) ? library.deletedGames : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const snapshot = asObject(entry.snapshot || entry.game);
      const name = text(snapshot.name || snapshot.n || entry.name);
      const id = isStableId(entry.id) ? entry.id : isStableId(snapshot.id) ? snapshot.id : stableGameId(name || 'jeu-supprime');
      return {
        ...entry,
        id,
        name: name || 'Jeu supprimé',
        deletedAt: Math.max(0, number(entry.deletedAt)) || now,
        snapshot: { ...snapshot, id, name: name || 'Jeu supprimé', n: name || 'Jeu supprimé' }
      };
    });

  const nextLibrary = {
    ...library,
    version: LIBRARY_VERSION,
    schemaVersion: LIBRARY_VERSION,
    migratedAt,
    migratedFrom: Number(library.migratedFrom) || (sourceVersion < LIBRARY_VERSION ? sourceVersion : undefined),
    games,
    sessions,
    favorites: uniqueFavorites,
    favoriteOrphans: uniqueOrphanFavorites,
    deletedGames,
    profiles: Array.isArray(library.profiles) && library.profiles.length
      ? library.profiles
      : [{ id: 'main', name: 'Profil principal' }],
    activeProfileId: typeof library.activeProfileId === 'string' ? library.activeProfileId : 'main'
  };
  if (nextLibrary.migratedFrom === undefined) delete nextLibrary.migratedFrom;

  report.counts = {
    games: games.length,
    sessions: sessions.length,
    favorites: uniqueFavorites.length,
    favoriteOrphans: uniqueOrphanFavorites.length,
    metaEntries: Object.keys(canonical).length,
    metaAliases: Object.keys(aliases).length,
    orphanMeta: Object.keys(orphans).length,
    archivedMeta: archived.length,
    duplicateGames: report.duplicateGames.length,
    covers: covers.length
  };
  const sourceGames = Array.isArray(library.games) ? library.games : [];
  const sourceSessions = Array.isArray(library.sessions) ? library.sessions : [];
  const sourceFavorites = Array.isArray(library.favorites) ? library.favorites : [];
  report.changed =
    sourceVersion !== LIBRARY_VERSION ||
    parsedMeta.sourceVersion !== META_SCHEMA_VERSION ||
    sourceGames.some((raw) => !isStableId(raw?.id)) ||
    sourceSessions.some((raw) => !isStableId(raw?.id)) ||
    sourceSessions.some((raw) => raw && raw.orphan !== true && !isStableId(raw.gameId)) ||
    sourceFavorites.some((entry) => !gameById.has(entry)) ||
    uniqueFavorites.length !== sourceFavorites.length;

  return {
    library: nextLibrary,
    meta: buildMetaDocument({ canonical, aliases, orphans, archived }),
    metaState: { canonical, aliases, orphans, archived },
    report
  };
}

export function gamesById(library) {
  return new Map((Array.isArray(library?.games) ? library.games : []).filter((game) => isStableId(game?.id)).map((game) => [game.id, game]));
}
