import fs from 'node:fs';
import path from 'node:path';
import { steamRoots } from './steam-local.mjs';

const STEAM_ID_BASE = 76561197960265728n;
const ICON_BASE = 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/';
const parsedCache = new Map();

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function parseKeyValues(buffer) {
  let offset = 0;
  const readString = () => {
    const start = offset;
    while (offset < buffer.length && buffer[offset] !== 0) offset++;
    const value = buffer.toString('utf8', start, offset);
    offset++;
    return value;
  };
  const readScalar = type => {
    switch (type) {
      case 1: return readString();
      case 2: { const value = buffer.readInt32LE(offset); offset += 4; return value; }
      case 3: { const value = buffer.readFloatLE(offset); offset += 4; return value; }
      case 4: { offset += 4; return 0; }
      case 5: {
        const start = offset;
        while (offset + 1 < buffer.length && (buffer[offset] || buffer[offset + 1])) offset += 2;
        const value = buffer.toString('utf16le', start, offset);
        offset += 2;
        return value;
      }
      case 6: { offset += 4; return 0; }
      case 7: { const value = buffer.readBigUInt64LE(offset); offset += 8; return value; }
      default: throw new Error('Type binaire Steam inconnu: ' + type);
    }
  };
  const readSection = () => {
    const result = {};
    while (offset < buffer.length) {
      const type = buffer[offset++];
      if (type === 8) return result;
      if (type === 0) {
        const key = readString();
        if (!key) return result;
        result[key] = readSection();
      } else {
        const key = readString();
        if (!key) return result;
        result[key] = readScalar(type);
      }
    }
    return result;
  };
  if (!buffer.length || buffer[0] !== 0) throw new Error('Fichier Steam illisible.');
  offset = 1;
  const rootKey = readString();
  return { key: rootKey, value: readSection() };
}

export function steamAccount(roots) {
  for (const root of roots) {
    const users = readText(path.join(root, 'config', 'loginusers.vdf'));
    let fallback = '';
    for (const match of users.matchAll(/"(\d{17})"\s*\{([^}]*)\}/g)) {
      if (!fallback) fallback = match[1];
      if (/"MostRecent"\s*"1"/i.test(match[2])) {
        return { id: match[1], accountId: (BigInt(match[1]) - STEAM_ID_BASE).toString() };
      }
    }
    if (fallback) return { id: fallback, accountId: (BigInt(fallback) - STEAM_ID_BASE).toString() };
  }
  for (const root of roots) {
    let folders = [];
    try { folders = fs.readdirSync(path.join(root, 'userdata'), { withFileTypes: true }).filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name) && entry.name !== '0'); } catch {}
    if (folders.length) {
      folders.sort((a, b) => {
        const count = folder => { try { return fs.readdirSync(path.join(root, 'userdata', folder.name)).length; } catch { return 0; } };
        return count(b) - count(a);
      });
      return { id: '', accountId: folders[0].name };
    }
  }
  return null;
}

function textKeyValues(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      index++;
      let value = '';
      while (index < text.length) {
        const next = text[index++];
        if (next === '\\' && index < text.length) { value += text[index++]; continue; }
        if (next === '"') break;
        value += next;
      }
      tokens.push(value);
    } else if (char === '{' || char === '}') {
      tokens.push(char); index++;
    } else index++;
  }
  let cursor = 0;
  const parseObject = () => {
    const result = {};
    while (cursor < tokens.length) {
      const token = tokens[cursor++];
      if (token === '}') return result;
      if (tokens[cursor] === '{') { cursor++; result[token] = parseObject(); }
      else result[token] = tokens[cursor++] ?? '';
    }
    return result;
  };
  return parseObject();
}

// Steam stores the total playtime in userdata/<account>/config/localconfig.vdf.
// The value is in minutes and is read-only here: Orbit keeps its own session log.
export function getSteamPlaytime(options = {}) {
  const roots = options.roots || steamRoots();
  const account = options.account || steamAccount(roots);
  if (!account) return new Map();
  for (const root of roots) {
    let config;
    try { config = textKeyValues(readText(path.join(root, 'userdata', account.accountId, 'config', 'localconfig.vdf'))); }
    catch { continue; }
    let appMap = config?.UserLocalConfigStore?.Software?.Valve?.Steam?.apps
      || config?.Software?.Valve?.Steam?.apps
      || config?.apps;
    if (!appMap || typeof appMap !== 'object') {
      const find = value => {
        if (!value || typeof value !== 'object') return null;
        for (const [key, child] of Object.entries(value)) {
          if (key === 'apps' && child && typeof child === 'object') return child;
          const nested = find(child);
          if (nested) return nested;
        }
        return null;
      };
      appMap = find(config);
    }
    if (!appMap || typeof appMap !== 'object') continue;
    const result = new Map();
    for (const [appId, entry] of Object.entries(appMap)) {
      if (!/^\d{1,10}$/.test(appId) || !entry || typeof entry !== 'object') continue;
      const minutes = Math.max(0, Number(entry.Playtime) || 0);
      const lastPlayed = Math.max(0, Number(entry.LastPlayed) || 0) * 1000;
      if (minutes || lastPlayed) result.set(appId, { minutes, lastPlayed });
    }
    return result;
  }
  return new Map();
}

function statsFile(roots, accountId, appId) {
  const name = `UserGameStats_${accountId}_${appId}.bin`;
  for (const root of roots) {
    const file = path.join(root, 'appcache', 'stats', name);
    try { if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return null;
}

function schemaFile(roots, appId) {
  for (const root of roots) {
    const file = path.join(root, 'appcache', 'stats', `UserGameStatsSchema_${appId}.bin`);
    try { if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return null;
}

function localized(section) {
  if (!section || typeof section !== 'object') return '';
  return section.french || section.english || Object.values(section).find(value => typeof value === 'string') || '';
}

function achievementDefinitions(schema, appId) {
  const application = schema.value[String(appId)] || schema.value;
  const groups = application?.stats || {};
  const definitions = [];
  const groupIds = Object.keys(groups).sort((a, b) => Number(a) - Number(b));
  for (const groupId of groupIds) {
    const bits = groups[groupId]?.bits;
    if (!bits || typeof bits !== 'object') continue;
    const indices = Object.keys(bits).sort((a, b) => Number(a) - Number(b));
    for (const index of indices) {
      const definition = bits[index] || {};
      const display = definition.display || {};
      const title = localized(display.name) || definition.name || 'Trophée';
      const description = localized(display.desc) || localized(definition.desc) || '';
      const icon = String(display.icon || definition.icon || '').trim();
      const iconGray = String(display.icon_gray || definition.icon_gray || '').trim();
      definitions.push({
        id: groupId + ':' + index,
        group: groupId,
        index,
        name: String(definition.name || ''),
        title,
        description,
        hidden: Number(display.hidden ?? definition.hidden) === 1,
        icon: icon ? ICON_BASE + appId + '/' + icon : '',
        iconGray: iconGray ? ICON_BASE + appId + '/' + iconGray : (icon ? ICON_BASE + appId + '/' + icon : ''),
      });
    }
  }
  return definitions;
}

function timestamps(stats) {
  const cache = stats.value?.cache || stats.value || {};
  const times = new Map();
  for (const [groupId, group] of Object.entries(cache)) {
    const values = group?.AchievementTimes;
    if (!values || typeof values !== 'object') continue;
    for (const [index, value] of Object.entries(values)) times.set(groupId + ':' + index, Number(value) || 0);
  }
  return times;
}

export function getSteamAchievements(appId, options = {}) {
  const id = String(appId || '').trim();
  if (!/^\d{1,10}$/.test(id)) return { ok: false, error: 'appid-invalide' };
  const roots = options.roots || steamRoots();
  const account = options.account || steamAccount(roots);
  if (!account) return { ok: false, error: 'compte-steam-introuvable', appId: id };
  const schemaPath = schemaFile(roots, id);
  if (!schemaPath) return { ok: false, error: 'schema-indisponible', appId: id, accountId: account.accountId };
  const statsPath = statsFile(roots, account.accountId, id);
  let signature;
  try {
    signature = fs.statSync(schemaPath).mtimeMs + ':' + (statsPath ? fs.statSync(statsPath).mtimeMs : 'aucune');
  } catch { signature = ''; }
  const cacheKey = id + ':' + account.accountId;
  const cached = parsedCache.get(cacheKey);
  if (!options.refresh && cached && cached.signature === signature) return cached.result;

  let definitions;
  try {
    definitions = achievementDefinitions(parseKeyValues(fs.readFileSync(schemaPath)), id);
  } catch (error) {
    return { ok: false, error: 'schema-illisible', appId: id, accountId: account.accountId, message: error.message };
  }
  let unlocked = new Map();
  let synced = false;
  if (statsPath) {
    try {
      unlocked = timestamps(parseKeyValues(fs.readFileSync(statsPath)));
      synced = true;
    } catch {}
  }
  const achievements = definitions.map(definition => {
    const unlockTime = unlocked.has(definition.id) ? Number(unlocked.get(definition.id)) || 0 : 0;
    return { ...definition, unlocked: unlocked.has(definition.id), unlockTime: unlockTime > 1000000000 ? unlockTime : 0 };
  });
  achievements.sort((a, b) => (Number(b.unlocked) - Number(a.unlocked)) || (b.unlockTime - a.unlockTime) || (Number(a.group) - Number(b.group)) || (Number(a.index) - Number(b.index)));
  const total = achievements.length;
  const count = achievements.filter(item => item.unlocked).length;
  const result = {
    ok: true,
    appId: id,
    accountId: account.accountId,
    synced,
    total,
    unlocked: count,
    percent: total ? Math.round(count / total * 100) : 0,
    achievements,
    fetchedAt: Date.now(),
  };
  parsedCache.set(cacheKey, { signature, result });
  return result;
}

export function getSteamAchievementSummary(appId, options = {}) {
  const full = getSteamAchievements(appId, options);
  if (!full.ok) return full;
  const achievements = Array.isArray(full.achievements) ? full.achievements : [];
  const next = achievements.find(item => !item.unlocked && !item.hidden) || achievements.find(item => !item.unlocked) || null;
  const now = new Date();
  const yearStart = Date.UTC(now.getFullYear(), 0, 1) / 1000;
  const weekStart = new Date(now); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekStartSeconds = weekStart.getTime() / 1000;
  return {
    ok: true,
    appId: full.appId,
    total: full.total,
    unlocked: full.unlocked,
    percent: full.percent,
    synced: full.synced,
    next: next ? { title: next.title, description: next.description, icon: next.iconGray || next.icon } : null,
    unlockedThisYear: achievements.filter(item => item.unlocked && item.unlockTime >= yearStart).length,
    unlockedThisWeek: achievements.filter(item => item.unlocked && item.unlockTime >= weekStartSeconds).length,
    fetchedAt: full.fetchedAt,
  };
}
