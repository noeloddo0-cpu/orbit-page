import { createViewingTracker, isVideoActivity } from "./discord-viewing.mjs";
import { selectArtwork, fillArtwork } from "./game-art.mjs";
import { steamRoots, installedSteamGames, localPortrait, imageSize } from "./steam-local.mjs";
import { getSteamAchievements, getSteamAchievementSummary, getSteamPlaytime, steamAccount } from "./steam-achievements.mjs";
import { withCinemaStatistics } from "./cinema-statistics.mjs";
import { createCoopIndex } from "./orbit-activity.mjs";
import { createRequire } from "node:module";
import { shells as SHELL_REGISTRY } from "./themes/index.js";
import { createLogger } from "./orbit-log.mjs";
import { getSecret, setSecret, deleteSecret, secretsAvailable } from "./orbit-secrets.mjs";
const require = createRequire(import.meta.url);
const __dirname = require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url));

// Pont Discord <-> Bibliothèque de jeux.
// Lance : node bridge.js   puis ouvre http://127.0.0.1:3181/
// Place ce fichier et bibliotheque.html dans le dossier discord-bridge (à côté de ton .env).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const DATA_DIR = process.env.GAME_TRACKER_DATA_DIR || __dirname;
const ASSET_DIR = process.env.GAME_TRACKER_ASSET_DIR || __dirname;
const logger = createLogger({ dir: DATA_DIR, component: 'bridge', console: process.env.ORBIT_LOG_CONSOLE === '1' });
const startedAt = Date.now();
const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ASSET_DIR, 'package.json'), 'utf8')).version || ''; } catch { return ''; } })();
process.on('uncaughtException', error => logger.error('Exception non gérée', { error }));
process.on('unhandledRejection', error => logger.error('Rejet non géré', { error }));

/* ---------- Config (.env) ---------- */
function loadEnv() {
  try {
    const envFile = process.env.GAME_TRACKER_ENV_FILE || path.join(__dirname, ".env");
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) {}
}
loadEnv();
const pick = (...k) => { for (const x of k) if (process.env[x]) return process.env[x]; return ""; };
let savedConfig = {};
try { savedConfig = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "config.json"), "utf8")); } catch (e) {}
const ENCRYPTED_DISCORD_TOKEN = await getSecret("discordToken");
const TOKEN = pick("DISCORD_TOKEN", "BOT_TOKEN", "TOKEN") || ENCRYPTED_DISCORD_TOKEN || savedConfig.botToken || "";
const USER_ID = pick("DISCORD_USER_ID", "USER_ID", "TARGET_USER_ID", "DISCORD_ID") || savedConfig.discordUserId || "";
const GUILD_ID = pick("DISCORD_GUILD_ID", "GUILD_ID", "SERVER_ID", "DISCORD_SERVER_ID") || savedConfig.guildId || "";
const PORT = +process.env.BRIDGE_PORT || 3181;
const BRIDGE_TOKEN = process.env.ORBIT_BRIDGE_TOKEN || crypto.randomBytes(32).toString("hex");
const MINUTE = +process.env.MINUTE_MS || 60000; // réglable pour les tests
const DATA = path.join(DATA_DIR, "library.json");
const PAGE = path.join(ASSET_DIR, "bibliotheque.html");
const META_FILE = path.join(DATA_DIR, "meta.json");
const COVERS = path.join(DATA_DIR, "covers");
const APP_CONFIG_FILE = path.join(ASSET_DIR, "app-config.json");
const THEMES_DIR = path.join(ASSET_DIR, "themes");
const UI_PREFS_FILE = path.join(DATA_DIR, "ui-preferences.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const RECAP_FILE = path.join(DATA_DIR, "recap.json");
const atomicWrite = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temp = file + ".tmp"; fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 }); fs.renameSync(temp, file); try { fs.chmodSync(file, 0o600); } catch {} };
const CINEMA_FILE = path.join(DATA_DIR, "cinema.json");
const TMDB_KEY_FILE = path.join(DATA_DIR, "tmdb-api-key.txt");
function tmdbKeyFromFile() {
  try {
    return fs.existsSync(TMDB_KEY_FILE) ? fs.readFileSync(TMDB_KEY_FILE, "utf8").trim() : "";
  } catch {
    return "";
  }
}
async function tmdbKey() {
  const envKey = String(process.env.TMDB_API_KEY || "").trim();
  if (envKey) return envKey;
  const encrypted = await getSecret("tmdbKey");
  if (encrypted) return encrypted;
  return tmdbKeyFromFile();
}
async function saveTmdbKey(key) {
  const value = String(key || "").trim();
  if (secretsAvailable()) {
    if (value) {
      await setSecret("tmdbKey", value);
      if ((await getSecret("tmdbKey")) !== value) throw new Error("La clé TMDB chiffrée n’a pas pu être relue.");
    } else {
      await deleteSecret("tmdbKey");
    }
    try {
      fs.unlinkSync(TMDB_KEY_FILE);
    } catch {}
    return;
  }
  if (!value) {
    try {
      fs.unlinkSync(TMDB_KEY_FILE);
    } catch {}
    return;
  }
  const temp = TMDB_KEY_FILE + ".tmp";
  fs.writeFileSync(temp, value, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, TMDB_KEY_FILE);
  try {
    fs.chmodSync(TMDB_KEY_FILE, 0o600);
  } catch {}
}
let cinema = { version: 1, items: [] };
try { const savedCinema = JSON.parse(fs.readFileSync(CINEMA_FILE, "utf8")); if (savedCinema && Array.isArray(savedCinema.items)) cinema = { version: 1, ...savedCinema }; }
catch (e) { if (!fs.existsSync(CINEMA_FILE)) { try { atomicWrite(CINEMA_FILE, cinema); } catch (writeError) {} } }
function migrateFileVersion(file, legacyFile, fallback) {
  try { const current = JSON.parse(fs.readFileSync(file, "utf8")); if (current && typeof current === "object") return { version: 1, ...current }; } catch (e) {}
  try { const legacy = JSON.parse(fs.readFileSync(legacyFile, "utf8")); if (legacy && typeof legacy === "object") { const migrated = { version: 1, ...legacy }; atomicWrite(file, migrated); return migrated; } } catch (e) {}
  return { version: 1, ...fallback };
}
let settingsDocument = migrateFileVersion(SETTINGS_FILE, UI_PREFS_FILE, {});
let recap = migrateFileVersion(RECAP_FILE, path.join(DATA_DIR, "recap.json"), { lastOpened: null, recent: [], gameStats: {}, queue: [] });
recap.queue = Array.isArray(recap.queue) ? recap.queue.filter(name => typeof name === "string" && name.trim()).slice(0, 50) : [];
function loadThemes() {
  const themes = {};
  try {
    for (const dir of fs.readdirSync(THEMES_DIR, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      if (!Object.hasOwn(SHELL_REGISTRY, dir.name)) continue;
      const data = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, dir.name, "theme.json"), "utf8"));
      if (data && /^[a-z0-9-]+$/.test(data.id || "") && data.id === dir.name && data.tokens && data.animations && data.sounds && data.typography && data.effects) themes[data.id] = data;
    }
  } catch (e) {}
  return themes;
}
const THEMES = loadThemes();
const SHELLS = Object.fromEntries(Object.entries(SHELL_REGISTRY).map(([id, shell]) => [id, { id, name: shell.name, menuLayout: shell.menuLayout, libraryLayout: shell.libraryLayout, navigation: shell.navigation, components: shell.components }]));
const SHELL_CSS = Object.fromEntries(Object.keys(SHELLS).map(id => {
  const directory = SHELL_REGISTRY[id].styleSource || id;
  try { return [id, fs.readFileSync(path.join(THEMES_DIR, directory, "shell.css"), "utf8")]; }
  catch { return [id, ""]; }
}));
const UI_THEMES = new Set(Object.keys(THEMES).filter(id => Object.hasOwn(SHELLS, id)));
const LEGACY_THEME_IDS = { minuit: "apple-tv", ocean: "apple-tv", aurore: "apple-tv", foret: "apple-tv", braise: "apple-tv", clair: "apple-tv" };
function validTheme(id) { return UI_THEMES.has(id) ? id : (LEGACY_THEME_IDS[id] && UI_THEMES.has(LEGACY_THEME_IDS[id]) ? LEGACY_THEME_IDS[id] : "apple-tv"); }
function readUiPrefs() {
  const defaults = { theme: validTheme("apple-tv"), accent: "", volume: 0.07, introEnabled: true, tileSize: "medium", effectsQuality: "balanced", glassQuality: "balanced" };
  try {
    const p = settingsDocument;
    return { theme: validTheme(p.theme), accent: /^#[\da-f]{6}$/i.test(p.accent || "") ? p.accent : "", volume: Number.isFinite(+p.volume) ? Math.max(0, Math.min(1, +p.volume)) : defaults.volume, introEnabled: typeof p.introEnabled === "boolean" ? p.introEnabled : true, tileSize: ["small","medium","large"].includes(p.tileSize) ? p.tileSize : defaults.tileSize, effectsQuality: ["max","balanced","light"].includes(p.effectsQuality) ? p.effectsQuality : defaults.effectsQuality, glassQuality: ["max","balanced","light"].includes(p.glassQuality) ? p.glassQuality : defaults.glassQuality };
  } catch (e) { return defaults; }
}
const DEFAULT_APP_CONFIG = {
  name: "orbit", logo: "/icon.svg", colors: { background: "#030304", accent: "#b9c6ff" },
  sound: { enabled: true, volume: 0.07 },
  sections: [
    { id: "library", title: "Bibliothèque", icon: "library", active: true, destination: "library" },
    { id: "films", title: "Films & séries", icon: "film", active: false, destination: null },
    { id: "music", title: "Musique", icon: "music", active: false, destination: null },
    { id: "photos", title: "Photos", icon: "photos", active: false, destination: null },
    { id: "discover", title: "Découvrir", icon: "discover", active: false, destination: null },
    { id: "settings", title: "Réglages", icon: "settings", active: false, destination: null }
  ]
};
let APP_CONFIG = DEFAULT_APP_CONFIG;
try {
  const c = JSON.parse(fs.readFileSync(APP_CONFIG_FILE, "utf8"));
  if (c && typeof c === "object") APP_CONFIG = {
    ...DEFAULT_APP_CONFIG, ...c,
    colors: { ...DEFAULT_APP_CONFIG.colors, ...(c.colors || {}) },
    sound: { ...DEFAULT_APP_CONFIG.sound, ...(c.sound || {}) },
    sections: Array.isArray(c.sections) ? c.sections : DEFAULT_APP_CONFIG.sections
  };
} catch (e) {}
const RAWG_KEY = pick("RAWG_KEY");
fs.mkdirSync(COVERS, { recursive: true });

/* ---------- État ---------- */
const NEUTRAL_STATUS = 5;
const normalizeStatus = value => value !== null && value !== undefined && value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 5 ? Number(value) : NEUTRAL_STATUS;
const legacySessionId = session => "legacy-" + crypto.createHash("sha1").update(`${session?.game || ""}|${session?.start || ""}`).digest("hex").slice(0, 20);
const normalizeSession = session => {
  if (!session || typeof session !== "object") return null;
  const game = String(session.game || "").trim(), start = Number(session.start);
  if (!game || !Number.isFinite(start)) return null;
  const end = Number.isFinite(Number(session.end)) ? Number(session.end) : null;
  const durationMs = Math.max(0, Number(session.durationMs) || (end !== null ? end - start : 0) || Number(session.minutes) * 60000 || 0);
  return {
    ...session,
    id: typeof session.id === "string" && session.id ? session.id.slice(0, 100) : legacySessionId(session),
    game, start, end,
    durationMs,
    minutes: Math.max(0, Number(session.minutes) || Math.floor(durationMs / 60000)),
    source: ["manual", "discord", "import"].includes(session.source) ? session.source : "manual",
    note: typeof session.note === "string" ? session.note.slice(0, 1000) : "",
    dated: session.dated !== false,
    revision: Number.isInteger(session.revision) && session.revision > 0 ? session.revision : 1,
    updatedAt: Number(session.updatedAt) || end || start
  };
};
let state = { games: [], sessions: [], deletedSessions: [], session: null, favorites: [], profiles: [{ id: "main", name: "Profil principal" }], activeProfileId: "main", meta: {} };
try {
  const stored = JSON.parse(fs.readFileSync(DATA, "utf8"));
  state.games = Array.isArray(stored.games) ? stored.games.map(game => game && typeof game === "object" ? { ...game, s: normalizeStatus(game.s) } : game) : [];
  state.sessions = Array.isArray(stored.sessions) ? stored.sessions.map(normalizeSession).filter(Boolean) : [];
  state.deletedSessions = Array.isArray(stored.deletedSessions) ? stored.deletedSessions.filter(item => item && typeof item.id === "string").slice(-5000) : [];
  state.favorites = Array.isArray(stored.favorites) ? stored.favorites : [];
  state.profiles = Array.isArray(stored.profiles) && stored.profiles.length ? stored.profiles : state.profiles;
  state.activeProfileId = typeof stored.activeProfileId === "string" ? stored.activeProfileId : state.profiles[0].id;
  state.meta = stored.meta && typeof stored.meta === "object" ? stored.meta : {};
} catch (e) {}
try {
  const cached = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
  if (cached && typeof cached === "object") state.meta = { ...state.meta, ...cached };
} catch (e) {}
let psnReference={};
try { psnReference=JSON.parse(fs.readFileSync(path.join(DATA_DIR,"psn-reference.json"),"utf8")); } catch {}
const coopIndex=createCoopIndex(DATA_DIR,atomicWrite);
const disc = { status: "démarrage", playing: null };
const ckey = n => String(n || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[®™©]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const gameIdFor = name => "name-" + crypto.createHash("sha1").update(ckey(name)).digest("hex").slice(0, 16);
const sessionDuration = session => Math.max(0, Number(session?.durationMs) || (Number.isFinite(Number(session?.end)) ? Number(session.end) - Number(session.start) : 0) || Number(session?.minutes) * 60000 || 0);
const sessionEnd = session => Number.isFinite(Number(session?.end)) ? Number(session.end) : Number(session.start) + sessionDuration(session);
function isTombstoned(session) {
  if (!session) return false;
  const ids = new Set([session.id, legacySessionId(session)].filter(Boolean));
  return state.deletedSessions.some(item => ids.has(item.id));
}
function addTombstone(session, reason = "delete") {
  const ids = new Set([session?.id, legacySessionId(session || {})].filter(Boolean));
  for (const id of ids) {
    if (!state.deletedSessions.some(item => item.id === id)) state.deletedSessions.push({ id, deletedAt: Date.now(), reason });
  }
  if (state.deletedSessions.length > 5000) state.deletedSessions = state.deletedSessions.slice(-5000);
}
function removeTombstone(id) {
  state.deletedSessions = state.deletedSessions.filter(item => item.id !== id);
}
state.sessions = state.sessions
  .filter(session => !isTombstoned(session))
  .map(session => ({ ...session, gameId: session.gameId || gameIdFor(session.game) }));
function canonicalGameName(name) {
  const found = state.games.find(game => ckey(game.n) === ckey(name));
  return found ? found.n : "";
}
function timestamp(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}
function sessionConflicts(candidate, excludeId = null) {
  const start = Number(candidate.start), end = sessionEnd(candidate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  return state.sessions
    .filter(other => other.id !== excludeId && other.id !== candidate.id)
    .filter(other => {
      const otherStart = Number(other.start), otherEnd = sessionEnd(other);
      return Number.isFinite(otherStart) && Number.isFinite(otherEnd) && start < otherEnd && end > otherStart;
    })
    .slice(0, 20)
    .map(other => ({ id: other.id, game: other.game, start: other.start, end: other.end, durationMs: sessionDuration(other) }));
}
function sessionIssues(candidate, excludeId = null, confirm = false) {
  const conflicts = sessionConflicts(candidate, excludeId);
  const longSession = sessionDuration(candidate) > 24 * 60 * 60 * 1000;
  return { conflicts, longSession, requiresConfirmation: !confirm && (conflicts.length > 0 || longSession) };
}
function buildSession(raw, previous = null) {
  const source = raw.source !== undefined ? raw.source : previous?.source ?? "manual";
  if (!["manual", "discord", "import"].includes(source)) return { error: "source invalide" };
  const game = canonicalGameName(raw.game !== undefined ? raw.game : previous?.game);
  if (!game) return { error: "jeu inconnu" };
  const start = raw.start !== undefined ? timestamp(raw.start) : Number(previous?.start);
  if (!Number.isFinite(start) || start <= 0) return { error: "date de début invalide" };
  let end = raw.end !== undefined ? (raw.end === null ? null : timestamp(raw.end)) : (previous ? (previous.end ?? null) : null);
  if (end !== null && (!Number.isFinite(end) || end < start)) return { error: "date de fin invalide" };
  const previousDuration = previous ? sessionDuration(previous) : null;
  let durationMs;
  if (raw.durationMs !== undefined) durationMs = Number(raw.durationMs);
  else if (raw.end !== undefined && end !== null) durationMs = end - start;
  else if (raw.start !== undefined && end !== null) durationMs = end - start;
  else if (raw.minutes !== undefined) durationMs = Number(raw.minutes) * 60000;
  else if (previousDuration !== null) { durationMs = previousDuration; if (end === null && durationMs > 0) end = start + durationMs; }
  else durationMs = end !== null ? end - start : 0;
  if (!Number.isFinite(durationMs) || durationMs < 0) return { error: "durée invalide" };
  if (durationMs > 10 * 365 * 24 * 60 * 60 * 1000) return { error: "durée trop grande" };
  if (end === null && durationMs > 0) end = start + durationMs;
  const explicitId = typeof raw.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(raw.id) ? raw.id : null;
  const id = explicitId || previous?.id || crypto.randomUUID();
  const note = raw.note !== undefined ? String(raw.note || "").slice(0, 1000) : (previous?.note || "");
  const dated = raw.dated !== undefined ? raw.dated !== false : previous ? previous.dated !== false : true;
  const sameGame = previous && ckey(previous.game) === ckey(game);
  return {
    session: {
      id, gameId: raw.gameId || (sameGame ? previous.gameId : null) || gameIdFor(game), game, start, end, durationMs,
      minutes: Math.floor(durationMs / 60000), source, note, dated,
      revision: previous ? previous.revision : 1, updatedAt: Date.now()
    }
  };
}
function persistSessions() {
  const ok = writeLibrary();
  if (ok) broadcast();
  return ok;
}
state.favorites = [...new Set(state.favorites.map(ckey).filter(Boolean))];
state.profiles = state.profiles.filter(p => p && typeof p.id === "string" && typeof p.name === "string" && p.id && p.name).slice(0, 20);
if (!state.profiles.length) state.profiles = [{ id: "main", name: "Profil principal" }];
if (!state.profiles.some(p => p.id === state.activeProfileId)) state.activeProfileId = state.profiles[0].id;

let saveTimer;
function save() {
  clearTimeout(saveTimer); saveTimer = setTimeout(() => {
  writeLibrary();
  }, 500);
}
function writeLibrary() {
  clearTimeout(saveTimer);
  onCoverLibraryChange();
  try { atomicWrite(DATA, { version: 1, games: state.games, sessions: state.sessions, deletedSessions: state.deletedSessions, favorites: state.favorites, profiles: state.profiles, activeProfileId: state.activeProfileId }); return true; }
  catch (e) { logger.error("Sauvegarde impossible", { error: e }); return false; }
}
function saveRecap() { try { atomicWrite(RECAP_FILE, recap); } catch (e) { logger.error("Sauvegarde du récap impossible", { error: e }); } }
function saveMeta() {
  try { fs.writeFileSync(META_FILE + ".tmp", JSON.stringify(state.meta, null, 1)); fs.renameSync(META_FILE + ".tmp", META_FILE); }
  catch (e) { logger.error("Cache infos impossible", { error: e }); }
}
function coverIndex() {
  const found = {};
  let files = [];
  try { files = fs.readdirSync(COVERS, { withFileTypes: true }); } catch (e) {}
  for (const entry of files) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) continue;
    const key = ckey(path.basename(entry.name, path.extname(entry.name)));
    if (!key) continue;
    try {
      const v = Math.round(fs.statSync(path.join(COVERS, entry.name)).mtimeMs);
      if (!found[key] || v > found[key].v) found[key] = { f: entry.name, v };
    } catch (e) {}
  }
  return found;
}
let steamInstallCache;
function localInstallIndex(force = false) {
  if (force || !steamInstallCache || Date.now() - steamInstallCache.at > 60000) {
    const games = installedSteamGames();
    steamInstallCache = { at: Date.now(), names: new Map(games.map(g => [ckey(g.name), g.appId])), ids: new Set(games.map(g => g.appId)) };
  }
  return steamInstallCache;
}
let steamPlaytimeCache;
function localSteamPlaytime(force = false) {
  if (force || !steamPlaytimeCache || Date.now() - steamPlaytimeCache.at > 60000) {
    let times = new Map();
    try { times = getSteamPlaytime(); } catch {}
    steamPlaytimeCache = { at: Date.now(), times };
  }
  return steamPlaytimeCache.times;
}
function playDetailsIndex() {
  const installed = localInstallIndex();
  const steamTimes = localSteamPlaytime();
  return Object.fromEntries(state.games.map(g => {
    const key = ckey(g.n), m = state.meta[metaKey(g.n)] || {};
    const installedId = installed.names.get(key) || (installed.ids.has(m.localSteamId) ? m.localSteamId : null);
    const steamAppId = installedId || m.appId || m.localSteamId || null;
    const steamInfo = steamAppId ? steamTimes.get(String(steamAppId)) : null;
    return [key, { ...m.playDetails, psnMinutes:psnReference[key], installedId, steamAppId,
      steamMinutes: steamInfo?.minutes || 0, steamLastPlayed: steamInfo?.lastPlayed || 0 }];
  }));
}
function validPortrait(bytes) {
  const size = imageSize(bytes);
  return size && size[0] >= 150 && size[1] > size[0] && size[1] <= 12000 && size[0] <= 12000;
}
function imageKind(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "webp";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return "gif";
  return null;
}
function savePlayMeta(key, patch) {
  const merged = { ...state.meta, [key]: { ...state.meta[key], ...patch } };
  atomicWrite(META_FILE, merged);
  state.meta = merged;
  broadcast();
}
async function downloadSteamPortrait(id) {
  return downloadSteamArt(id, ['library_600x900_2x.jpg', 'library_600x900.jpg'], validPortrait);
}
async function downloadSteamArt(id, files, validate) {
  for (const filename of files) {
    try {
      const response = await fetch('https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/' + filename, { signal: AbortSignal.timeout(7000) });
      if (!response.ok) continue;
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 8 * 1024 * 1024) { await reader.cancel(); break; }
        chunks.push(value);
      }
      if (length > 8 * 1024 * 1024) continue;
      const bytes = Buffer.concat(chunks);
      if (validate(bytes)) return bytes;
    } catch {}
  }
  return null;
}

function artworkIndices() {
  const files = coverIndex(), covers = {}, steamCovers = {};
  for (const game of state.games) {
    const key = ckey(game.n);
    const {wide,tall} = selectArtwork(COVERS,game.n,files[key],state.meta[metaKey(game.n)],files);
    if (wide) covers[key] = wide;
    if (tall) steamCovers[key] = tall;
  }
  return {covers,steamCovers};
}
function steamPortraitIndex() { return artworkIndices().steamCovers; }
function importLocalSteam(){
 const roots=steamRoots();if(!roots.length)return {ok:false,message:"Steam n’a pas été trouvé sur cet ordinateur."};
 steamInstallCache=null;
 const installed=installedSteamGames(roots);let added=0,portraits=0;
 for(const entry of installed){let g=state.games.find(g=>ckey(g.n)===ckey(entry.name))||state.games.find(g=>Number(state.meta[metaKey(g.n)]?.appId)===entry.appId);
 if(!g){g={n:entry.name,s:2,c:0,m:0,t:0};state.games.push(g);added++;}
 const key=metaKey(g.n);state.meta[key]={...(state.meta[key]||{title:g.n}),appId:entry.appId,localSteamId:entry.appId};
 }
 for(const game of state.games){const key=metaKey(game.n),m=state.meta[key];if(!m?.appId)continue;const portrait=localPortrait(m.appId,roots);if(!portrait)continue;
 const filename='steam-'+m.appId+'-portrait'+portrait.extension,target=path.join(COVERS,filename);if(!fs.existsSync(target)||!fs.readFileSync(target).equals(portrait.bytes)){const temp=target+'.tmp';fs.writeFileSync(temp,portrait.bytes);fs.renameSync(temp,target);}m.steamPortrait={f:filename,v:Math.round(fs.statSync(target).mtimeMs)};portraits++;
 }
 saveMeta();writeLibrary();broadcast();return {ok:true,installed:installed.length,added,portraits,total:state.games.length};
}
function syncSteamState() {
  steamInstallCache = null;
  steamPlaytimeCache = null;
  const installed = installedSteamGames();
  const byName = new Map(installed.map(game => [ckey(game.name), game.appId]));
  const ids = new Set(installed.map(game => game.appId));
  const times = localSteamPlaytime(true);
  let linked = 0, playtime = 0;
  for (const game of state.games) {
    const key = metaKey(game.n), meta = state.meta[key] || { title: game.n };
    const appId = byName.get(ckey(game.n)) || (ids.has(Number(meta.localSteamId)) ? Number(meta.localSteamId) : null);
    const steam = appId ? times.get(String(appId)) : null;
    const next = { ...meta, localSteamId: appId || meta.localSteamId || null, steamSyncedAt: Date.now() };
    if (steam) {
      next.playDetails = { ...(meta.playDetails || {}), steamMinutes: steam.minutes || 0, steamLastPlayed: steam.lastPlayed || 0 };
      if (steam.minutes) playtime++;
    }
    if (appId) linked++;
    if (JSON.stringify(next) !== JSON.stringify(meta)) state.meta[key] = next;
  }
  saveMeta();
  broadcast();
  return { ok: true, installed: installed.length, linked, playtime, account: steamAccount(steamRoots())?.accountId || null };
}
let steamSummaryCache = { at: 0, value: null };
function steamSummary(force = false) {
  if (!force && steamSummaryCache.value && Date.now() - steamSummaryCache.at < 60000) return steamSummaryCache.value;
  const details = playDetailsIndex(), summaries = {};
  for (const game of state.games) {
    const key = ckey(game.n), appId = String(details[key]?.steamAppId || "").match(/^\d{1,10}$/)?.[0];
    if (!appId) continue;
    try { summaries[key] = getSteamAchievementSummary(appId, { refresh: force }); }
    catch { summaries[key] = { ok: false, error: "lecture-impossible", appId }; }
  }
  steamSummaryCache = { at: Date.now(), value: summaries };
  return summaries;
}
const HOUR = 3600000;
const ART_FORMAT_VERSION = 3;
let portraitJob, coverTimer, coverLibrarySignature;
function scheduleCovers() {
  if (!coverTimer) coverTimer = setTimeout(() => {
    coverTimer = null;
    if (portraitJob) { portraitJob.then(scheduleCovers, scheduleCovers); return; }
    runCoverSync().catch(() => {});
  }, 2000);
}
function onCoverLibraryChange() {
  const signature = JSON.stringify(state.games.map(game => ckey(game.n)).sort());
  if (signature === coverLibrarySignature) return;
  coverLibrarySignature = signature;
  scheduleCovers();
}
function runCoverSync(force = false) {
  if (!portraitJob) portraitJob = syncSteamArt(force).finally(() => { portraitJob = null; });
  return portraitJob;
}
function writeArt(filename, bytes) {
  const target = path.join(COVERS, filename);
  if (fs.existsSync(target) && fs.readFileSync(target).equals(bytes)) return false;
  fs.writeFileSync(target + '.tmp', bytes);
  fs.renameSync(target + '.tmp', target);
  return true;
}
function artRecord(filename) {
  return {f:filename, v:Math.round(fs.statSync(path.join(COVERS, filename)).mtimeMs)};
}
async function syncSteamArt(force) {
  const games = state.games.filter(game => {
    const m = state.meta[metaKey(game.n)] || {};
    return m.playDetails?.kind !== 'app' && (force || m.artFormatVersion !== ART_FORMAT_VERSION || !(m.artRetryAt > Date.now()));
  });
  if (!games.length) {
    const total = Object.keys(steamPortraitIndex()).length;
    return {ok:true, added:0, total, missing:state.games.length-total};
  }
  const wide = coverIndex(), portraits = steamPortraitIndex(), roots = steamRoots();
  const installed = new Map(installedSteamGames(roots).map(game => [ckey(game.name), game.appId]));
  let added = 0, next = 0, notifyTimer;
  function publishSoon() {
    if (!notifyTimer) notifyTimer = setTimeout(() => {
      notifyTimer = null;
      broadcast();
    }, 1000);
  }
  async function update(game) {
    const name = ckey(game.n), key = metaKey(game.n), old = state.meta[key] || {};
    const touch = fields => Object.assign(state.meta[key] ||= {title:game.n}, fields);
    const ownedWide = file => file && old.autoBanner && old.autoBanner.f === file.f && old.autoBanner.v === file.v;
    const selected = selectArtwork(COVERS,game.n,wide[name],old,wide,{allowNearSquare:false});
    const needsWide = !old.coverManual && !old.autoBannerOff && (!selected.wide || ownedWide(wide[name]));
    const needsTall = !selected.tall || (!force && selected.tall.f === old.steamPortrait?.f);
    if (!needsWide && !needsTall && (selected.wide || old.autoBannerOff) && selected.tall) { touch({artFormatVersion:ART_FORMAT_VERSION,artRetryAt:Date.now()+30*24*HOUR}); saveMeta(); return; }
    let retry = 6 * HOUR;
    let id;
    try {
      id = installed.get(name) || old.localSteamId || (ckey(old.title || game.n) === name && old.appId);
      if (!id) {
        const search = await getJson('https://store.steampowered.com/api/storesearch/?'+new URLSearchParams({term:game.n,l:'english',cc:'us'}));
        id = search.items?.find(hit => ckey(hit.name) === name)?.id;
        if (!id) { retry = 7*24*HOUR; return; }
      }
      if (!/^\d{1,10}$/.test(String(id))) return;
      let complete = true;
      if (needsTall) {
        const local = localPortrait(id, roots);
        const bytes = local?.bytes || await downloadSteamPortrait(id);
        if (bytes) {
          const filename = 'steam-'+id+'-portrait'+(local?.extension || '.jpg');
          const changed = writeArt(filename, bytes);
          touch({steamPortrait:artRecord(filename)});
          if (!portraits[name]) added++;
          if (changed || portraits[name]?.f !== filename) publishSoon();
        } else complete = false;
      }
      if (needsWide) {
        const bytes = await downloadSteamArt(id, ['header.jpg'], data => {
          const size = imageSize(data);
          return size && size[0] >= 300 && size[0] > size[1];
        });
        if (bytes) {
          // Une image choisie pendant le téléchargement garde la priorité.
          const current = coverIndex()[name], m = state.meta[key];
          if (!m?.coverManual && !m?.autoBannerOff && (!current || ownedWide(current))) {
            const filename = name+'.jpg';
            if (writeArt(filename, bytes)) publishSoon();
            touch({autoBanner:artRecord(filename)});
          }
        } else complete = false;
      }
      retry = complete ? 30*24*HOUR : 6*HOUR;
    } finally {
      const current = state.meta[key] || old, files = coverIndex();
      const available = selectArtwork(COVERS,game.n,files[name],current,files,{allowNearSquare:false});
      const missing = ['wide','tall'].filter(kind => !available[kind] && !(kind==='wide' && current.autoBannerOff));
      if (missing.length) {
        const found = await fillArtwork(COVERS,game.n,missing,id);
        if (found.length) { publishSoon(); if(found.includes('tall')) added++; }
        retry = found.length === missing.length ? 30*24*HOUR : Math.min(7*24*HOUR,retry);
      }
      touch({artFormatVersion:ART_FORMAT_VERSION,artRetryAt:Date.now()+retry}); saveMeta();
    }
  }
  async function worker() {
    while (next < games.length) {
      const game = games[next++];
      try { await update(game); } catch {}
      if (next < games.length) await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  await Promise.all([worker(), worker()]);
  if (notifyTimer) { clearTimeout(notifyTimer); broadcast(); }
  const total = Object.keys(steamPortraitIndex()).length;
  return {ok:true, added, total, missing:state.games.length-total};
}
const payload = () => ({ games: state.games, sessions: state.sessions, session: state.session, favorites: state.favorites, profiles: state.profiles, activeProfileId: state.activeProfileId, recap, discord: { status: disc.status, playing: disc.playing }, ...artworkIndices(), playDetails: playDetailsIndex() });
const clients = new Set();
function broadcast() { const d = "data: " + JSON.stringify(payload()) + "\n\n"; for (const r of clients) r.write(d); }
const metaKey = name => crypto.createHash("sha1").update(ckey(name)).digest("hex");
let healthCache = { at: 0, value: null };
function lastBackupSummary() {
  const root = path.join(DATA_DIR, 'backups');
  try {
    const names = fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(entry.name))
      .map(entry => entry.name).sort().reverse();
    if (!names.length) return null;
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(root, names[0], 'backup-manifest.json'), 'utf8')); } catch {}
    return {
      name: names[0],
      at: manifest?.createdAt || new Date(fs.statSync(path.join(root, names[0])).mtimeMs).toISOString(),
      verified: manifest ? manifest.verified === true : null,
      reason: manifest?.reason || 'automatic',
      counts: manifest?.counts || {},
      covers: manifest?.covers || 0
    };
  } catch { return null; }
}
function healthReport() {
  if (healthCache.value && Date.now() - healthCache.at < 5000) return healthCache.value;
  const artwork = artworkIndices();
  const covered = new Set([...Object.keys(artwork.covers), ...Object.keys(artwork.steamCovers)]);
  const knownNames = new Set(state.games.map(game => ckey(game.n)));
  const metaKeys = new Set(state.games.map(game => metaKey(game.n)));
  const duplicateMap = new Map();
  for (const game of state.games) {
    const key = ckey(game.n);
    if (!duplicateMap.has(key)) duplicateMap.set(key, []);
    duplicateMap.get(key).push(game.n);
  }
  const duplicateGames = [...duplicateMap.entries()].filter(([, names]) => names.length > 1).map(([key, names]) => ({ key, names }));
  const orphanSessions = state.sessions.filter(session => !knownNames.has(ckey(session.game)));
  const orphanMeta = Object.entries(state.meta).filter(([key]) => !metaKeys.has(key));
  const missingCovers = state.games.filter(game => !covered.has(ckey(game.n)));
  const filmsWithoutPoster = cinema.items.filter(item => item.type === 'film' && !item.poster);
  const gamesWithoutKind = state.games.filter(game => !['game', 'app'].includes(state.meta[metaKey(game.n)]?.playDetails?.kind));
  const apps = state.games.filter(game => state.meta[metaKey(game.n)]?.playDetails?.kind === 'app');
  const statusCounts = {};
  for (const game of state.games) statusCounts[normalizeStatus(game.s)] = (statusCounts[normalizeStatus(game.s)] || 0) + 1;
  let coversFiles = 0;
  try { coversFiles = fs.readdirSync(COVERS).filter(name => ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(name).toLowerCase())).length; } catch {}
  const sessionMinutes = Math.round(state.sessions.reduce((total, session) => total + Math.max(0, Number(session.durationMs) || Number(session.minutes) * 60000 || 0), 0) / 60000);
  const gameMinutes = state.games.reduce((total, game) => total + Math.max(0, Number(game.m) || 0), 0);
  const value = {
    app: { version: APP_VERSION, schemaVersion: Number(state.schemaVersion) || 1, startedAt: new Date(startedAt).toISOString(), uptimeMs: Date.now() - startedAt, platform: process.platform, arch: process.arch, node: process.versions.node, electron: process.versions.electron || null },
    data: {
      games: state.games.length, sessions: state.sessions.length, favorites: state.favorites.length,
      films: cinema.items.filter(item => item.type === 'film').length,
      series: cinema.items.filter(item => item.type === 'series').length,
      covers: coversFiles, backups: (() => { try { return fs.readdirSync(path.join(DATA_DIR, 'backups'), { withFileTypes: true }).filter(entry => entry.isDirectory()).length; } catch { return 0; } })(),
      lastBackup: lastBackupSummary()
    },
    anomalies: {
      orphanSessions: orphanSessions.length,
      orphanSessionsSample: orphanSessions.slice(0, 10).map(session => ({ game: session.game, start: session.start })),
      orphanMeta: orphanMeta.length,
      orphanMetaSample: orphanMeta.slice(0, 10).map(([key, meta]) => ({ key, title: meta?.title || '' })),
      gamesWithoutCover: missingCovers.length,
      gamesWithoutCoverSample: missingCovers.slice(0, 10).map(game => game.n),
      filmsWithoutPoster: filmsWithoutPoster.length,
      filmsWithoutPosterSample: filmsWithoutPoster.slice(0, 10).map(item => item.title),
      gamesWithoutKind: gamesWithoutKind.length,
      apps: apps.length,
      duplicateGames: duplicateGames.length,
      duplicateGamesSample: duplicateGames.slice(0, 10),
      sessionsWithoutId: state.sessions.filter(session => !session.id || String(session.id).startsWith("legacy-")).length
    },
    time: { gameMinutes, sessionMinutes, importedOrManualMinutes: Math.max(0, gameMinutes - sessionMinutes) },
    statusCounts,
    discord: { status: disc.status, playing: disc.playing },
    paths: { data: DATA_DIR, assets: ASSET_DIR, logs: path.join(DATA_DIR, 'logs') },
    generatedAt: new Date().toISOString()
  };
  healthCache = { at: Date.now(), value };
  return value;
}
function migrateLegacyCovers() {
  let changed = false;
  for (const game of state.games) {
    const key = ckey(game.n), meta = state.meta[metaKey(game.n)];
    if (!key || !meta || !meta.cover) continue;
    let oldName = "";
    try { oldName = path.basename(decodeURIComponent(new URL(meta.cover, "http://localhost").pathname)); } catch (e) { continue; }
    const ext = path.extname(oldName).toLowerCase();
    if (!/^[a-f0-9]{40}\.(jpg|jpeg|png|webp)$/i.test(oldName) || ![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) continue;
    const oldFile = path.join(COVERS, oldName), newName = key + ext, newFile = path.join(COVERS, newName);
    if (!fs.existsSync(oldFile)) continue;
    try {
      if (oldName !== newName && !fs.existsSync(newFile)) fs.renameSync(oldFile, newFile);
      meta.cover = "/covers/" + encodeURIComponent(newName);
      changed = true;
    } catch (e) {}
  }
  if (changed) saveMeta();
}
migrateLegacyCovers();
async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": "MaBibliothequeDeJeux/2.0" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("source indisponible");
  return r.json();
}
async function saveRemoteCover(name, url) {
  if (!url) return "";
  try {
    const key = ckey(name);
    if (!key) return "";
    const existing = coverIndex()[key];
    if (existing) return "/covers/" + encodeURIComponent(existing.f) + "?v=" + existing.v;
    const r = await fetch(url, { headers: { "User-Agent": "MaBibliothequeDeJeux/2.0" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return "";
    const bytes = Buffer.from(await r.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return "";
    const kind = imageKind(bytes);
    const ext = kind === "png" ? ".png" : kind === "webp" ? ".webp" : kind === "jpeg" ? ".jpg" : "";
    if (!ext) return "";
    const filename = key + ext, target = path.join(COVERS, filename);
    const latest = coverIndex()[key];
    if (latest) return "/covers/" + encodeURIComponent(latest.f) + "?v=" + latest.v;
    fs.writeFileSync(target, bytes);
    const v = Math.round(fs.statSync(target).mtimeMs);
    return "/covers/" + encodeURIComponent(filename) + "?v=" + v;
  } catch (e) { return ""; }
}
function plainText(html) {
  return String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?\s*>|<\/(p|li|div|h[1-6])\s*>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/\s+/g, " ").trim();
}
async function searchGameCandidates(query) {
  const q = String(query || "").trim(); if (!q) return [];
  const all = [], queryKey = ckey(q);
  const add = (name, image, source, sourceUrl, extra = {}) => {
    if (!name) return;
    const key = ckey(name), score = key === queryKey ? 100 : key.startsWith(queryKey) || queryKey.startsWith(key) ? 75 : key.includes(queryKey) || queryKey.includes(key) ? 45 : 15;
    all.push({ name, image: image || "", source, sourceUrl: sourceUrl || "", score, ...extra });
  };
  try {
    const params = new URLSearchParams({ term: q, l: "french", cc: "fr" });
    const result = await getJson("https://store.steampowered.com/api/storesearch/?" + params);
    for (const item of (result.items || []).slice(0, 8)) add(item.name, item.tiny_image, "Steam", `https://store.steampowered.com/app/${item.id}/`, { appId: item.id });
  } catch (e) {}
  if (RAWG_KEY) try {
    const params = new URLSearchParams({ key: RAWG_KEY, search: q, page_size: "8" });
    const result = await getJson("https://api.rawg.io/api/games?" + params);
    for (const item of (result.results || []).slice(0, 8)) add(item.name, item.background_image, "RAWG", `https://rawg.io/games/${item.slug || ""}`, { rawgId: item.id });
  } catch (e) {}
  const unique = new Map();
  for (const item of all) { const key = ckey(item.name), old = unique.get(key); if (!old || item.score > old.score || (item.image && !old.image)) unique.set(key, item); }
  return [...unique.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr")).slice(0, 3);
}
async function steamMeta(name) {
  const q = new URLSearchParams({ term: name, l: "french", cc: "fr" });
  const search = await getJson("https://store.steampowered.com/api/storesearch/?" + q);
  const items = Array.isArray(search.items) ? search.items : [];
  const exact = items.find(x => ckey(x.name || "") === ckey(name));
  const item = exact || items.find(x => ckey(x.name || "").startsWith(ckey(name)) || ckey(name).startsWith(ckey(x.name || "")));
  if (!item) return null;
  const data = await getJson("https://store.steampowered.com/api/appdetails/?" + new URLSearchParams({ appids: item.id, l: "french", cc: "fr" }));
  const details = data && data[item.id] && data[item.id].success ? data[item.id].data : {};
  return {
    title: details.name || item.name, description: plainText(details.about_the_game || details.short_description || ""),
    developers: details.developers || [], publishers: details.publishers || [], releaseDate: details.release_date && details.release_date.date || "",
    genres: (details.genres || []).map(x => x.description).filter(Boolean), platforms: Object.keys(details.platforms || {}).filter(k => details.platforms[k]),
    image: details.library_assets && details.library_assets.hero_image || details.header_image || item.tiny_image || "",
    source: "Steam", sourceUrl: `https://store.steampowered.com/app/${item.id}/`, appId: item.id
  };
}
async function rawgMeta(name) {
  if (!RAWG_KEY) return null;
  const q = new URLSearchParams({ key: RAWG_KEY, search: name, page_size: "5" });
  const search = await getJson("https://api.rawg.io/api/games?" + q);
  const list = Array.isArray(search.results) ? search.results : [];
  const item = list.find(x => ckey(x.name || "") === ckey(name)) || list[0];
  if (!item) return null;
  const details = item.id ? await getJson(`https://api.rawg.io/api/games/${item.id}?key=${encodeURIComponent(RAWG_KEY)}`) : item;
  return {
    title: details.name || item.name, description: details.description_raw || "",
    developers: (details.developers || []).map(x => x.name).filter(Boolean), publishers: (details.publishers || []).map(x => x.name).filter(Boolean),
    releaseDate: details.released || "", genres: (details.genres || []).map(x => x.name).filter(Boolean),
    platforms: (details.platforms || []).map(x => x.platform && x.platform.name).filter(Boolean),
    image: details.background_image || item.background_image || "", source: "RAWG", sourceUrl: details.website || `https://rawg.io/games/${details.slug || item.slug || ""}`
  };
}
async function wikiMeta(name) {
  for (const lang of ["fr", "en"]) {
    try {
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({ action: "query", list: "search", srsearch: name, srlimit: "5", format: "json", origin: "*" });
      const search = await getJson(searchUrl), hits = search.query && search.query.search || [];
      const hit = hits.find(x => ckey(x.title) === ckey(name)) || hits[0]; if (!hit) continue;
      const page = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`);
      if (!page.extract) continue;
      return { title: page.title || hit.title, description: page.extract, developers: [], publishers: [], releaseDate: "", genres: [], platforms: [], image: page.thumbnail && page.thumbnail.source || "", source: lang === "fr" ? "Wikipédia (français)" : "Wikipédia (anglais)", sourceUrl: page.content_urls && page.content_urls.desktop && page.content_urls.desktop.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title)}` };
    } catch (e) {}
  }
  return null;
}
async function fetchGameMeta(name) {
  const key = metaKey(name), old = state.meta[key];
  if (old && old.checkedAt && Date.now() - old.checkedAt < 30 * 24 * 60 * 60 * 1000) { if (/<[a-z][\s\S]*>/i.test(old.description || "")) { old.description = plainText(old.description); saveMeta(); } return old; }
  let meta = null;
  try { meta = await steamMeta(name); } catch (e) {}
  if (!meta) try { meta = await rawgMeta(name); } catch (e) {}
  if (!meta) try { meta = await wikiMeta(name); } catch (e) {}
  if (!meta) meta = { title: name, description: "Aucune information trouvée pour ce jeu.", developers: [], publishers: [], releaseDate: "", genres: [], platforms: [], image: "", source: "Aucune source", sourceUrl: "" };
  const cover = (old && old.cover) || await saveRemoteCover(name, meta.image);
  state.meta[key] = { ...state.meta[key], ...meta, cover, accent: old && old.accent || "", checkedAt: Date.now() };
  saveMeta();
  broadcast();
  return state.meta[key];
}
function scheduleEnrichment(name) { setTimeout(() => { fetchGameMeta(name).catch(() => {}); }, 1200); }

/* ---------- Suivi des sessions ---------- */
function findGame(name) {
  const k = ckey(name);
  let g = state.games.find(x => ckey(x.n) === k);
  if (g) return g;
  let best = null, diff = 1e9;
  for (const x of state.games) {
    const a = ckey(x.n);
    if (Math.min(a.length, k.length) >= 5 && (a.startsWith(k) || k.startsWith(a))) {
      const d = Math.abs(a.length - k.length);
      if (d < diff) { diff = d; best = x; }
    }
  }
  return best;
}
function startSession(name, source="discord") {
  let g = findGame(name);
  if (!g) { g = { n: String(name).replace(/[®™©]/g, "").trim(), s: 2, c: 0, m: 0, t: 0 }; state.games.push(g); console.log("Nouveau jeu ajouté :", g.n); }
  // Lancer un jeu ou démarrer une session ne doit jamais changer son statut.
  g.s = normalizeStatus(g.s);
  state.session = { id: crypto.randomUUID(), name: g.n, start: Date.now(), mins: 0, source };
  g.t = Date.now(); save();
  console.log("Session démarrée :", g.n);
  scheduleEnrichment(g.n);
}
function tickSession() {
  const se = state.session; if (!se) return;
  const g = state.games.find(x => x.n === se.name);
  if (!g) { state.session = null; return; }
  const add = Math.floor((Date.now() - se.start) / MINUTE) - se.mins;
  if (add > 0) { g.m += add; se.mins += add; g.t = Date.now(); save(); broadcast(); }
}
function endSession() {
  if (!state.session) return;
  tickSession();
  const current = { ...state.session }, ended = Date.now();
  const completed = normalizeSession({ id: current.id, source: current.source, game: current.name, start: current.start, end: ended, durationMs: Math.max(0, ended - current.start), minutes: Math.max(0, current.mins), updatedAt: ended });
  if (completed) {
    completed.gameId = gameIdFor(completed.game);
    state.sessions.push(completed);
  }
  const g = state.games.find(x => x.n === current.name); if (g) g.t = ended;
  console.log("Session terminée :", current.name);
  state.session = null;
  const persisted=writeLibrary();
  broadcast();
  if(persisted){
    const receipt=state.sessions.at(-1);
    for(const client of clients)client.write("event: session-saved\ndata: "+JSON.stringify(receipt)+"\n\n");
  }
  return persisted;
}
let rawPlaying = null;
function setPlaying(name) {
  name = name || null;
  if (name === rawPlaying) return;
  endSession();
  rawPlaying = name;
  if (name) startSession(name);
  disc.playing = state.session ? state.session.name : null;
  broadcast();
}
setInterval(tickSession, Math.min(10000, MINUTE));

function saveCinema(next) {
  const document = withCinemaStatistics(cinema, next);
  atomicWrite(CINEMA_FILE, document);
  cinema = document;
}

/* ---------- Discord ---------- */
let videoActivities = [], cinemaDirty = false;
const viewing = createViewingTracker({
  items: () => cinema.items,
  save(item) {
    const next = {...cinema,items:cinema.items.map(x=>x.id===item.id?item:x)};
    saveCinema(next);
    cinemaDirty=true;
  },
  notify() {
    const message=JSON.stringify({view:viewing.snapshot(),refresh:cinemaDirty});
    cinemaDirty=false;
    for(const client of clients)client.write("event: cinema-viewing\ndata: "+message+"\n\n");
  }
});
function applyPresence(p) {
  const activities=p?.activities || [];
  videoActivities=activities.filter(isVideoActivity);
  viewing.update(videoActivities);
  setPlaying(activities.find(a=>a.type===0 && !isVideoActivity(a))?.name || null);
}
setInterval(()=>viewing.tick(),10000).unref();
function startDiscord() {
  let D; try { D = require("discord.js"); } catch (e) { disc.status = "discord.js manquant (npm i discord.js)"; console.log(disc.status); return; }
  if (!TOKEN || !USER_ID) { disc.status = "non configuré (.env)"; console.log("Token ou ID utilisateur introuvable dans .env"); return; }
  const c = new D.Client({ intents: [D.GatewayIntentBits.Guilds, D.GatewayIntentBits.GuildPresences] });
  let ready = false;
  const onReady = () => {
    if (ready) return; ready = true;
    disc.status = "connecté"; console.log("Discord connecté.");
    const guild = GUILD_ID ? c.guilds.cache.get(GUILD_ID) : c.guilds.cache.first();
    const pr = guild && guild.presences.cache.get(USER_ID);
    applyPresence(pr); broadcast();
  };
  c.once("ready", onReady); c.once("clientReady", onReady);
  c.on("presenceUpdate", (_o, n) => { if (n && n.userId === USER_ID && (!GUILD_ID || n.guild.id === GUILD_ID)) applyPresence(n); });
  c.on("shardDisconnect",(_event,shardId)=>{
    const guild=GUILD_ID?c.guilds.cache.get(GUILD_ID):c.guilds.cache.first();
    if(!guild || guild.shardId===shardId){ videoActivities=[]; viewing.update([]); }
  });
  c.on("shardResume",()=>{const guild=GUILD_ID?c.guilds.cache.get(GUILD_ID):c.guilds.cache.first();applyPresence(guild?.presences.cache.get(USER_ID));});
  c.on("error", e => console.log("Erreur Discord :", e.message));
  c.login(TOKEN).catch(e => { disc.status = "connexion refusée"; console.log("Connexion Discord impossible :", e.message); broadcast(); });
}

/* ---------- Serveur web ---------- */
function body(req, limit = 4e6) { return new Promise((res, rej) => { let b = ""; req.on("data", d => { b += d; if (b.length > limit) { rej(new Error("trop gros")); req.destroy(); } }); req.on("end", () => res(b)); }); }
function binaryBody(req, limit = 8 * 1024 * 1024) { return new Promise((res, rej) => { const parts = []; let size = 0; req.on("data", d => { size += d.length; if (size > limit) { rej(new Error("fichier trop gros")); req.destroy(); } else parts.push(d); }); req.on("end", () => res(Buffer.concat(parts))); }); }
const rateBuckets = new Map();
function rateLimited(bucket, max = 120, windowMs = 60000) {
  const now = Date.now();
  const recent = (rateBuckets.get(bucket) || []).filter(at => now - at < windowMs);
  if (recent.length >= max) { rateBuckets.set(bucket, recent); return true; }
  recent.push(now);
  rateBuckets.set(bucket, recent);
  if (rateBuckets.size > 100) for (const [key, times] of rateBuckets) if (!times.some(at => now - at < windowMs)) rateBuckets.delete(key);
  return false;
}
function sendSecurityHeaders(res, nonce) {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://cdn.cloudflare.steamstatic.com https://shared.akamai.steamstatic.com https://image.tmdb.org https://images.igdb.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'"
  ].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}
function renderLibraryPage(nonce) {
  let page = fs.readFileSync(PAGE, "utf8");
  const tokenAttribute = String(BRIDGE_TOKEN).replace(/[&"<>]/g, character => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character]);
  page = page.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta name="orbit-bridge-token" content="${tokenAttribute}">`);
  page = page.replace("<!--ORBIT_PREFS-->", `<script>window.__ORBIT_THEMES=${JSON.stringify(THEMES)};window.__ORBIT_PREFERENCES=${JSON.stringify(readUiPrefs())};window.__ORBIT_SHELLS=${JSON.stringify(SHELLS)};window.__ORBIT_SHELL_CSS=${JSON.stringify(SHELL_CSS)};(()=>{const token=document.querySelector('meta[name="orbit-bridge-token"]')?.content||"";const original=window.fetch.bind(window);window.fetch=(input,init)=>{const method=String(init?.method||(input instanceof Request?input.method:"GET")).toUpperCase();let sameOrigin=true;try{sameOrigin=new URL(typeof input==="string"?input:input instanceof Request?input.url:String(input),location.href).origin===location.origin;}catch{}if(token&&sameOrigin&&!["GET","HEAD","OPTIONS"].includes(method)){const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));headers.set("X-Orbit-Token",token);init={...(init||{}),headers};}return original(input,init);};})()</script>`);
  page = page.replace(/<script(?![^>]*\bsrc=)(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
  return page;
}
http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://127.0.0.1:${PORT}`), url = parsed.pathname;
  const nonce = crypto.randomBytes(18).toString("base64");
  sendSecurityHeaders(res, nonce);
  const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); };
  if (url.startsWith("/api/")) {
    const origin = req.headers.origin, site = req.headers["sec-fetch-site"];
    const allowedOrigins = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
    if ((origin && !allowedOrigins.has(String(origin))) || (site && !["same-origin", "none"].includes(String(site)))) return json(403, { error: "origine refusée" });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-orbit-token"] !== BRIDGE_TOKEN) return json(403, { error: "jeton requis", code: "token_required" });
  }
  const limitedFamily = url === "/api/search-games" ? "search" : url === "/api/meta" ? "meta" : url.startsWith("/api/steam") ? "steam" : url.startsWith("/api/cinema") ? "cinema" : "";
  if (limitedFamily && rateLimited(limitedFamily)) { res.setHeader("Retry-After", "60"); return json(429, { error: "trop de requêtes, réessaie dans une minute" }); }
  if (req.method === "GET" && (url === "/launcher.css" || url === "/launcher.js")) {
    const file = path.join(ASSET_DIR, url.slice(1));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": url.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-cache" }); return res.end(fs.readFileSync(file));
  }
  if (req.method === "GET" && (url === "/mentions-legales" || url === "/confidentialite")) {
    const filename = url === "/mentions-legales" ? "mentions-legales.html" : "confidentialite.html";
    const file = path.join(ASSET_DIR, filename);
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Page introuvable"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }); return res.end(fs.readFileSync(file));
  }
  if (req.method === "GET" && url === "/og-image.png") {
    const file = path.join(ASSET_DIR, "og-image.png");
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Image introuvable"); }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }); return fs.createReadStream(file).pipe(res);
  }
  if (url.startsWith("/themes/") && req.method === "GET") {
    let relative = ""; try { relative = decodeURIComponent(url.slice("/themes/".length)); } catch (e) { res.writeHead(400); return res.end("Bad path"); }
    const root = path.resolve(THEMES_DIR), file = path.resolve(root, relative), ext = path.extname(file).toLowerCase();
    if (!file.startsWith(root + path.sep) || ![".js", ".css", ".json", ".woff2", ".webp"].includes(ext) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("Not found"); }
    const type = ext === ".js" ? "text/javascript; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : ext === ".webp" ? "image/webp" : ext === ".woff2" ? "font/woff2" : "application/json; charset=utf-8";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" }); return res.end(fs.readFileSync(file));
  }
  if (url === "/app-config.json" && req.method === "GET") return json(200, APP_CONFIG);
  if (url === "/manifest.webmanifest" && req.method === "GET") {
    const name = APP_CONFIG.name;
    const logo = String(APP_CONFIG.logo || "/icon.svg").split("?")[0], logoExt = path.extname(logo).toLowerCase();
    const logoType = logoExt === ".png" ? "image/png" : logoExt === ".webp" ? "image/webp" : [".jpg", ".jpeg"].includes(logoExt) ? "image/jpeg" : "image/svg+xml";
    const manifest = { id: "/", name, short_name: name, description: "Bibliothèque de jeux personnelle", start_url: "/", scope: "/", display: "standalone", display_override: ["fullscreen", "standalone"], background_color: APP_CONFIG.colors.background || "#050507", theme_color: APP_CONFIG.colors.background || "#050507", icons: [{ src: logo, sizes: logoExt === ".svg" ? "any" : "512x512", type: logoType, purpose: "any maskable" }] };
    res.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-cache" }); return res.end(JSON.stringify(manifest));
  }
  if ((url === "/sw.js" || url === "/icon.svg") && req.method === "GET") {
    const file = path.join(ASSET_DIR, url.slice(1));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
    const type = url === "/sw.js" ? "text/javascript; charset=utf-8" : "image/svg+xml; charset=utf-8";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": url === "/sw.js" ? "no-cache" : "public, max-age=86400" }); return res.end(fs.readFileSync(file));
  }
  if (url.startsWith("/covers/") && req.method === "GET") {
    let filename = "";
    try { filename = decodeURIComponent(url.slice(8)); } catch (e) { res.writeHead(400); return res.end("Bad filename"); }
    if (!filename || filename.includes("/") || filename.includes("\\") || path.basename(filename) !== filename || !/\.(jpg|jpeg|png|webp)$/i.test(filename)) { res.writeHead(404); return res.end("Not found"); }
    const file = path.join(COVERS, filename);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(filename).toLowerCase(), type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" }); return fs.createReadStream(file).pipe(res);
  }
  if (url === '/api/play/details' && req.method === 'PATCH') {
    try {
      const input = JSON.parse(await body(req, 24000));
      const game = state.games.find(g => ckey(g.n) === ckey(input.name));
      if (!game) return json(404, {error: 'Titre introuvable.'});
      const key = metaKey(game.n), fields = input.details;
      if (!fields || !['game','app'].includes(fields.kind) || typeof fields.note !== 'string' || fields.note.length > 2000) return json(400, {error: 'Fiche invalide.'});
      const validTags = tags => Array.isArray(tags) && tags.length <= 20 && tags.every(t => typeof t === 'string' && t.trim().length > 0 && t.length <= 60);
      if (!validTags(fields.collections) || !validTags(fields.platforms)) return json(400, {error: '20 noms maximum, 60 caractères par nom.'});
      const rating = Math.max(0, Math.min(5, Number(fields.rating) || 0));
      const review = typeof fields.review === 'string' ? fields.review.trim().slice(0, 500) : '';
      const previous = state.meta[key]?.playDetails || {};
      savePlayMeta(key, {playDetails: {...previous, kind: fields.kind, note: fields.note, collections: [...new Set(fields.collections.map(t=>t.trim()))], platforms: [...new Set(fields.platforms.map(t=>t.trim()))], rating, review}});
      return json(200, {ok: true});
    } catch { return json(400, {error: 'Impossible d’enregistrer la fiche.'}); }
  }
  if (url === '/api/play/portrait' && req.method === 'PUT') {
    const game = state.games.find(g => ckey(g.n) === ckey(parsed.searchParams.get('name')));
    if (!game) return json(404, {error: 'Titre introuvable.'});
    try {
      const id = parsed.searchParams.get('steam');
      if (id !== null && !/^\d{1,10}$/.test(id)) return json(400, {error: 'Jeu Steam inconnu.'});
      const bytes = id ? await downloadSteamPortrait(id) : await binaryBody(req);
      const kind = imageKind(bytes);
      if (!bytes || !["jpeg", "png"].includes(kind) || !validPortrait(bytes)) return json(400, {error: 'Choisis une jaquette verticale JPG ou PNG, de 150 px de large minimum et 8 Mo maximum.'});
      const key = metaKey(game.n), filename = 'play-' + key + (kind === 'png' ? '.png' : '.jpg');
      const target = path.join(COVERS, filename), temp = target + '.tmp';
      fs.writeFileSync(temp, bytes); fs.renameSync(temp, target);
      const cover = { f: filename, v: Math.round(fs.statSync(target).mtimeMs) };
      savePlayMeta(key, { playPortrait: cover });
      return json(200, {ok: true, cover});
    } catch { return json(400, {error: 'Jaquette indisponible ou fichier trop grand.'}); }
  }

  if(url==="/api/steam/portraits"&&req.method==="POST"){try{return json(200,await runCoverSync(true));}catch{return json(500,{ok:false,message:"Recherche des jaquettes momentanément indisponible"});}}
  if(url==="/api/steam/import"&&req.method==="POST"){try{return json(200,importLocalSteam());}catch(error){return json(500,{ok:false,message:"L’import Steam local a échoué. Réessaie après avoir ouvert Steam."});}}
  if (url === "/api/search-games" && req.method === "GET") {
    const name = (parsed.searchParams.get("name") || "").trim(); if (!name) return json(400, { error: "nom manquant" });
    try { return json(200, { results: await searchGameCandidates(name) }); }
    catch (e) { return json(200, { results: [] }); }
  }
  if (url === "/api/meta" && req.method === "GET") {
    const name = (parsed.searchParams.get("name") || "").trim(); if (!name) return json(400, { error: "nom manquant" });
    try { return json(200, await fetchGameMeta(name)); } catch (e) { return json(502, { error: "Informations momentanément indisponibles" }); }
  }
  if (url === "/api/meta/accent" && req.method === "PUT") {
    try {
      const b = JSON.parse(await body(req)), name = String(b.name || "").trim(), accent = String(b.accent || "");
      if (!name || !/^#[0-9a-f]{6}$/i.test(accent)) return json(400, { error: "couleur invalide" });
      const key = metaKey(name); state.meta[key] = { ...(state.meta[key] || { title: name, source: "" }), accent }; saveMeta(); return json(200, { ok: true });
    } catch (e) { return json(400, { error: "JSON invalide" }); }
  }
  if (url === "/api/cover" && (req.method === "PUT" || req.method === "DELETE" || req.method === "POST")) {
    const rawKey = (parsed.searchParams.get("key") || parsed.searchParams.get("name") || "").trim(), key = ckey(rawKey);
    if (!key) return json(400, { error: "clé de jaquette manquante" });
    const extensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
    const matching = () => {
      try { return fs.readdirSync(COVERS).filter(f => extensions.has(path.extname(f).toLowerCase()) && ckey(path.basename(f, path.extname(f))) === key); }
      catch (e) { return []; }
    };
    const metaId = metaKey(rawKey), current = state.meta[metaId] || { title: rawKey, source: "" };
    if (req.method === "DELETE") {
      for (const f of matching()) { try { fs.unlinkSync(path.join(COVERS, f)); } catch (e) {} }
      delete current.cover; current.autoBannerOff = true; current.image = ""; current.coverManual = false; state.meta[metaId] = current; saveMeta(); broadcast();
      return json(200, { ok: true });
    }
    try {
      const type = (req.headers["content-type"] || "").split(";")[0].toLowerCase();
      if (type !== "image/jpeg") return json(415, { error: "image JPEG attendue" });
      const bytes = await binaryBody(req, 8 * 1024 * 1024);
      if (!bytes.length || imageKind(bytes) !== "jpeg") return json(415, { error: "image JPEG attendue" });
      const filename = key + ".jpg", target = path.join(COVERS, filename), temp = target + ".tmp-" + crypto.randomBytes(6).toString("hex");
      fs.writeFileSync(temp, bytes);
      for (const f of matching()) { try { fs.unlinkSync(path.join(COVERS, f)); } catch (e) {} }
      fs.renameSync(temp, target);
      const v = Math.round(fs.statSync(target).mtimeMs);
      state.meta[metaId] = { ...current, image: "", cover: "/covers/" + encodeURIComponent(filename) + "?v=" + v, coverManual: true, checkedAt: current.checkedAt || Date.now() };
      saveMeta(); broadcast(); return json(200, { ok: true, cover: { f: filename, v } });
    } catch (e) { return json(400, { error: "image impossible à enregistrer" }); }
  }
  if (url === "/api/steam/achievements" && req.method === "GET") {
    try {
      const params = new URL(req.url, "http://127.0.0.1").searchParams;
      const name = params.get("name") || "";
      const mapped = name ? playDetailsIndex()[ckey(name)]?.steamAppId : null;
      const appId = String(params.get("appId") || mapped || "").match(/^\d{1,10}$/)?.[0];
      if (!appId) return json(404, { ok: false, error: "appid-introuvable" });
      return json(200, getSteamAchievements(appId, { refresh: params.get("refresh") === "1" }));
    } catch (error) {
      return json(500, { ok: false, error: "lecture-impossible", message: error.message });
    }
  }
  if (url === "/api/steam/summary" && req.method === "GET") {
    try {
      const params = new URL(req.url, "http://127.0.0.1").searchParams;
      const refresh = params.get("refresh") === "1";
      let summaries = steamSummary(refresh);
      const appId = String(params.get("appId") || "").match(/^\d{1,10}$/)?.[0];
      if (appId) {
        const key = Object.keys(summaries).find(name => String(summaries[name]?.appId) === appId);
        summaries = key ? { [key]: summaries[key] } : {};
      }
      return json(200, { ok: true, summaries });
    } catch (error) { return json(500, { ok: false, error: "lecture-impossible", message: error.message }); }
  }
  if (url === "/api/steam/sync" && req.method === "POST") {
    try { return json(200, syncSteamState()); }
    catch (error) { return json(500, { ok: false, error: "synchronisation-impossible", message: error.message }); }
  }
  if (url === "/api/steam/coop" && (req.method==="POST" || req.method==="GET")) {
    return json(200, req.method==="GET" ? coopIndex.snapshot() : coopIndex.start(Object.values(playDetailsIndex()).map(d=>d.steamAppId)));
  }
  if (url === "/api/health" && req.method === "GET") return json(200, healthReport());
  if (url === "/api/diagnostics" && req.method === "GET") return json(200, {
    generatedAt: new Date().toISOString(),
    health: healthReport(),
    environment: { platform: process.platform, arch: process.arch, node: process.versions.node, electron: process.versions.electron || null, pid: process.pid },
    logs: logger.recent(50)
  });
  if (url === "/api/state" && req.method === "GET") return json(200, payload());
  if (url === "/api/cinema/tmdb-key" && req.method === "GET") return json(200, { configured: !!(await tmdbKey()) });
  if (url === "/api/cinema/tmdb-key" && req.method === "POST") {
    try { const input = JSON.parse(await body(req, 2000)), key = String(input?.key || "").trim(); if (key.length > 500) return json(400, { error: "Clé invalide" }); await saveTmdbKey(key); return json(200, { configured: !!key }); }
    catch (error) { return json(500, { error: "Sauvegarde de la clé TMDB impossible" }); }
  }  if (url === "/api/cinema/poster-search" && req.method === "POST") {
    try {
      const input = JSON.parse(await body(req, 5000));
      const key = await tmdbKey(), title = String(input?.title || "").trim(), type = input?.type === "series" ? "tv" : input?.type === "film" ? "movie" : "";
      if (!key || key.length > 500 || !title || title.length > 200 || !type) return json(400, { error: "Paramètres de recherche invalides" });
      const query = new URLSearchParams({ query: title, language: "fr-FR", include_adult: "false" });
      const year = Number(input.year); if (Number.isInteger(year) && year >= 1870 && year <= 2200) query.set(type === "tv" ? "first_air_date_year" : "year", String(year));
      const response = await fetch(`https://api.themoviedb.org/3/search/${type}?${query}`, { headers: { Authorization: `Bearer ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) return json(response.status === 401 ? 401 : 502, { error: response.status === 401 ? "Clé TMDB invalide" : "Recherche TMDB indisponible" });
      const result = await response.json();
      return json(200, { results: (Array.isArray(result.results) ? result.results : []).slice(0, 10).map(item => ({ id: Number(item.id), title: item.title || item.name || "", originalTitle: item.original_title || item.original_name || "", date: item.release_date || item.first_air_date || "", posterPath: item.poster_path || "", overview: item.overview || "" })) });
    } catch (error) { return json(502, { error: "Impossible de joindre TMDB" }); }
  }
  if (url === "/api/cinema/details" && req.method === "POST") {
    try {
      const input = JSON.parse(await body(req, 2000));
      const key = await tmdbKey();
      const type = input?.type === "series" ? "tv" : input?.type === "film" ? "movie" : "";
      const id = Number(input?.id);
      if (!key || key.length > 500 || !type || !Number.isSafeInteger(id) || id <= 0) return json(400, { error: "Paramètres de fiche invalides" });
      const response = await fetch(`https://api.themoviedb.org/3/${type}/${id}?language=fr-FR`, { headers: { Authorization: `Bearer ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) return json(response.status === 401 ? 401 : 502, { error: response.status === 401 ? "Clé TMDB invalide" : "Fiche TMDB indisponible" });
      const item = await response.json();
      const date = item.release_date || item.first_air_date || "";
      const runtime = type === "movie" ? item.runtime : (Array.isArray(item.episode_run_time) && item.episode_run_time.length ? Math.round(item.episode_run_time.reduce((a,b)=>a+b,0)/item.episode_run_time.length) : null);
      const last = item.last_episode_to_air, next = item.next_episode_to_air;
      const countOrNull = value => Number.isInteger(value) && value >= 0 ? value : null;
      const episodeGuide = type === "tv" && Array.isArray(item.seasons) ? {
        tvId: Number(item.id), total: countOrNull(item.number_of_episodes),
        specials: countOrNull(item.seasons.find(s => s.season_number === 0)?.episode_count),
        seasons: Object.fromEntries(item.seasons.filter(s => Number.isInteger(s.season_number) && s.season_number > 0)
          .map(s => [s.season_number, countOrNull(s.episode_count)])),
        nextAir: next?.season_number > 0 && next?.episode_number > 0 ? {s:next.season_number,e:next.episode_number,date:next.air_date || null} : null,
        aired: last?.season_number > 0 && last?.episode_number > 0 ? {s:last.season_number,e:last.episode_number} : null,
        ended: ["Ended","Canceled"].includes(item.status)
      } : null;
      return json(200, { episodeGuide, id: Number(item.id), title: item.title || item.name || "", originalTitle: item.original_title || item.original_name || "", date, releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "", posterPath: item.poster_path || "", overview: item.overview || "", genres: Array.isArray(item.genres) ? item.genres.map(g=>String(g.name||"")).filter(Boolean).slice(0,20) : [], runtime: Number.isInteger(runtime) && runtime > 0 ? runtime : null });
    } catch (error) { return json(502, { error: "Impossible de charger la fiche TMDB" }); }
  }
  if (url === "/api/cinema/episode" && req.method === "POST") {
    let input;
    try { input = JSON.parse(await body(req, 2000)); } catch { return json(400,{error:"Progression invalide."}); }
    const item = cinema.items.find(x => x.id === input?.id && x.type === "series");
    if (!item) return json(404,{error:"Série introuvable."});
    const season = Number(item.season) || 0, episode = Number(item.episode) || 0;
    if (item.status !== "watching" || season !== Number(input.season) || episode !== Number(input.episode))
      return json(409,{error:"La progression a déjà changé.",item});
    const next = input.next;
    if (!next || !Number.isInteger(next.season) || next.season < 1 || next.season > 1000 ||
        !Number.isInteger(next.episode) || next.episode < 1 || next.episode > 10000 ||
        !((next.season === (season || 1) && next.episode === episode + 1 && (episode || !season)) ||
          (next.season === season + 1 && next.episode === 1)))
      return json(400,{error:"Épisode invalide."});
    const at=Date.now();
    const updated = {...item,season:next.season,episode:next.episode,progressUpdatedAt:at,
      episodeHistory:[...(item.episodeHistory||[]),{s:next.season,e:next.episode,at}]};
    if (next.final === true) {
      updated.status="watched";
      const now=new Date();
      const day=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
      updated.watchedAt=day; updated.firstWatchedAt ||= day;
      updated.watchedDates=[...new Set([...(item.watchedDates || []),day])].sort();
    }
    const changed={...cinema,items:cinema.items.map(x=>x===item?updated:x)};
    try { saveCinema(changed); } catch { return json(500,{error:"Impossible d’enregistrer cet épisode sur le disque."}); }
    return json(200,{item:updated});
  }
  if (url === "/api/cinema/viewing/confirm" && req.method === "POST") {
    try {
      const {key}=JSON.parse(await body(req,2000));
      return viewing.confirm(key)?json(200,{ok:true}):json(409,{error:"La lecture a changé."});
    } catch {return json(400,{error:"Validation impossible."});}
  }
  if (url === "/api/cinema" && req.method === "GET") return json(200, cinema);
  if (url === "/api/cinema" && req.method === "PUT") {
    try {
      const input = JSON.parse(await body(req, 2 * 1024 * 1024));
      if (!Array.isArray(input.items) || input.items.length > 5000) return json(400, { error: "Liste de films invalide" });
      const items = [];
      const previousById = new Map(cinema.items.map(item=>[item.id,item]));
      for (const raw of input.items) {
        const title = String(raw?.title || "").trim(), type = raw?.type, status = raw?.status;
        if (!title || title.length > 200 || !["film", "series"].includes(type) || !["watchlist", "watching", "watched"].includes(status)) return json(400, { error: "Une fiche de film ou série est invalide" });
        const year = raw.year === null || raw.year === "" ? null : Number(raw.year), rating = Number(raw.rating) || 0;
        if ((year !== null && (!Number.isInteger(year) || year < 1870 || year > 2200)) || !Number.isFinite(rating) || rating < 0 || rating > 5) return json(400, { error: "Année ou note invalide" });
        const poster = String(raw.poster || "").trim();
        if (poster) { let parsedPoster; try { parsedPoster = new URL(poster); } catch (e) { return json(400, { error: "Adresse d’affiche invalide" }); } if (!["http:", "https:"].includes(parsedPoster.protocol) || poster.length > 2048) return json(400, { error: "Adresse d’affiche invalide" }); }
        const watchedDates = Array.isArray(raw.watchedDates) ? [...new Set(raw.watchedDates.filter(date => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort().slice(0, 500) : [];
        const watchedAt = status === "watched" && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.watchedAt || "")) ? String(raw.watchedAt) : watchedDates.at(-1) || null;
        const season = type === "series" && status === "watching" && Number.isInteger(Number(raw.season)) && Number(raw.season) > 0 && Number(raw.season) <= 1000 ? Number(raw.season) : null;
        const episode = type === "series" && status === "watching" && Number.isInteger(Number(raw.episode)) && Number(raw.episode) > 0 && Number(raw.episode) <= 10000 ? Number(raw.episode) : null;
        const firstWatchedAt = status !== "watchlist" ? (watchedDates[0] || (/^\d{4}-\d{2}-\d{2}$/.test(String(raw.firstWatchedAt || "")) ? raw.firstWatchedAt : watchedAt)) : null;
        const tmdbId = Number.isSafeInteger(Number(raw.tmdbId)) && Number(raw.tmdbId) > 0 ? Number(raw.tmdbId) : null;
        const overview = String(raw.overview || "").slice(0, 5000), originalTitle = String(raw.originalTitle || "").slice(0, 200);
        const genres = Array.isArray(raw.genres) ? [...new Set(raw.genres.map(value=>String(value).trim()).filter(Boolean))].slice(0, 20) : [];
        const runtime = Number.isInteger(Number(raw.runtime)) && Number(raw.runtime) > 0 && Number(raw.runtime) <= 1000 ? Number(raw.runtime) : null;
        const releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.releaseDate || "")) ? String(raw.releaseDate) : null;
        const previous = previousById.get(raw.id);
        const newerProgress = previous?.progressUpdatedAt && previous.progressUpdatedAt > (Number(raw.progressUpdatedAt) || 0);
        items.push({ id: String(raw.id || crypto.randomUUID()).slice(0, 100), title, type, year: releaseDate ? Number(releaseDate.slice(0,4)) : year, releaseDate, status, rating, poster, season, episode, watchedAt, firstWatchedAt, watchedDates, tmdbId, overview, originalTitle, genres, runtime, addedAt: Math.max(0, Number(raw.addedAt) || Date.now()), ...(previous?.progressUpdatedAt ? {progressUpdatedAt:previous.progressUpdatedAt} : {}), ...(previous?.episodeHistory ? {episodeHistory:previous.episodeHistory} : {}) });
        if (newerProgress) {
          for (const key of ["status","season","episode","watchedAt","firstWatchedAt","watchedDates"])
            items.at(-1)[key]=previous[key];
        }
      }
      const nextCinema = { ...cinema, items };
      saveCinema(nextCinema);
      viewing.update(videoActivities);
      return json(200, { ok: true, count: items.length });
    } catch (e) { return json(400, { error: "Impossible d’enregistrer les films et séries" }); }
  }
  if (url === "/api/flush" && req.method === "POST") { endSession(); writeLibrary(); saveRecap(); return json(200, { ok: true }); }
  if (url === "/api/preferences" && req.method === "PUT") {
    try {
      const p = JSON.parse(await body(req, 2000)), clean = readUiPrefs();
      if (typeof p.theme === "string") clean.theme = validTheme(p.theme);
      if (Object.hasOwn(p, "accent")) clean.accent = /^#[\da-f]{6}$/i.test(p.accent || "") ? p.accent : "";
      if (Number.isFinite(+p.volume)) clean.volume = Math.max(0, Math.min(1, +p.volume));
      if (typeof p.introEnabled === "boolean") clean.introEnabled = p.introEnabled;
      if (["small","medium","large"].includes(p.tileSize)) clean.tileSize = p.tileSize;
      if (["max","balanced","light"].includes(p.effectsQuality)) clean.effectsQuality = p.effectsQuality;
      if (["max","balanced","light"].includes(p.glassQuality)) clean.glassQuality = p.glassQuality;
      settingsDocument = { version: 1, ...clean }; atomicWrite(SETTINGS_FILE, settingsDocument);
      return json(200, { ok: true });
    } catch (e) { return json(400, { error: "Préférences impossibles à enregistrer" }); }
  }
  if (url === "/api/recap" && req.method === "PUT") {
    try {
      const value = JSON.parse(await body(req, 12000));
      if (value.lastOpened !== null && (!value.lastOpened || typeof value.lastOpened.name !== "string" || !Number.isFinite(+value.lastOpened.at))) return json(400, { error: "dernier jeu invalide" });
      recap = { version: 1, lastOpened: value.lastOpened ? { name: value.lastOpened.name.slice(0, 200), at: +value.lastOpened.at, scrollTop: Math.max(0, +value.lastOpened.scrollTop || 0) } : null, recent: Array.isArray(value.recent) ? value.recent.filter(x => x && typeof x.name === "string" && Number.isFinite(+x.at)).slice(0, 20).map(x => ({ name: x.name.slice(0, 200), at: +x.at })) : [], gameStats: value.gameStats && typeof value.gameStats === "object" && !Array.isArray(value.gameStats) ? value.gameStats : {}, queue: Array.isArray(value.queue) ? value.queue.filter(name => typeof name === "string" && name.trim()).map(name => name.slice(0, 200)).slice(0, 50) : [] };
      saveRecap(); return json(200, { ok: true });
    } catch (e) { return json(400, { error: "Récap invalide" }); }
  }
  if (url === "/api/v1/sessions" && req.method === "GET") {
    const params = parsed.searchParams, game = params.get("game"), gameId = params.get("gameId");
    const from = params.get("from") ? timestamp(params.get("from")) : null, to = params.get("to") ? timestamp(params.get("to")) : null;
    if (from !== null && !Number.isFinite(from)) return json(400, { error: "from invalide" });
    if (to !== null && !Number.isFinite(to)) return json(400, { error: "to invalide" });
    const limit = Math.min(1000, Math.max(1, Number(params.get("limit")) || 100));
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    const list = state.sessions
      .filter(session => !game || ckey(session.game) === ckey(game))
      .filter(session => !gameId || session.gameId === gameId || ckey(session.game) === ckey(gameId))
      .filter(session => from === null || session.start >= from)
      .filter(session => to === null || session.start <= to)
      .sort((a, b) => b.start - a.start);
    return json(200, { sessions: list.slice(offset, offset + limit), total: list.length, limit, offset, hasMore: offset + limit < list.length });
  }
  if (url === "/api/v1/sessions" && req.method === "POST") {
    try {
      const b = JSON.parse(await body(req, 100000));
      const explicitId = typeof b.id === "string" && b.id ? b.id : null;
      if (explicitId && state.deletedSessions.some(item => item.id === explicitId) && b.restore !== true) return json(409, { error: "session supprimée", deleted: true });
      if (explicitId && state.sessions.some(session => session.id === explicitId)) return json(409, { error: "identifiant déjà utilisé" });
      const built = buildSession({ ...b, ...(explicitId ? { id: explicitId } : {}) });
      if (built.error) return json(400, { error: built.error });
      const issues = sessionIssues(built.session, null, b.confirm === true);
      if (issues.requiresConfirmation) return json(409, { error: "confirmation requise", requiresConfirmation: true, conflicts: issues.conflicts, longSession: issues.longSession });
      state.sessions.push(built.session);
      state.sessions.sort((a, b) => a.start - b.start);
      removeTombstone(built.session.id);
      removeTombstone(legacySessionId(built.session));
      if (!persistSessions()) return json(500, { error: "écriture impossible" });
      return json(201, { ok: true, session: built.session });
    } catch (e) { return json(400, { error: "session invalide" }); }
  }
  if (url === "/api/v1/sessions/merge" && req.method === "POST") {
    try {
      const b = JSON.parse(await body(req, 100000));
      const ids = [...new Set((Array.isArray(b.ids) ? b.ids : Array.isArray(b.sessionIds) ? b.sessionIds : []).filter(id => typeof id === "string"))];
      if (ids.length < 2) return json(400, { error: "au moins deux sessions sont nécessaires" });
      const selected = ids.map(id => state.sessions.find(session => session.id === id));
      const missing = ids.filter((id, index) => !selected[index]);
      if (missing.length) return json(404, { error: "session introuvable", missing });
      const game = selected[0].game;
      if (selected.some(session => ckey(session.game) !== ckey(game))) return json(400, { error: "les sessions doivent concerner le même jeu" });
      const intervals = selected.map(session => [Number(session.start), sessionEnd(session)]).filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start).sort((a, b) => a[0] - b[0]);
      if (!intervals.length) return json(400, { error: "durées invalides" });
      let cursor = null, durationMs = 0;
      for (const [start, end] of intervals) {
        if (cursor === null) { cursor = end; durationMs += end - start; }
        else if (start <= cursor) { if (end > cursor) { durationMs += end - cursor; cursor = end; } }
        else { durationMs += end - start; cursor = end; }
      }
      const start = Math.min(...intervals.map(([value]) => value)), end = Math.max(...intervals.map(([, value]) => value));
      const source = selected.every(session => session.source === selected[0].source) ? selected[0].source : "manual";
      const note = [...new Set(selected.map(session => String(session.note || "").trim()).filter(Boolean))].join(" · ").slice(0, 1000);
      const merged = {
        id: crypto.randomUUID(), gameId: selected[0].gameId || gameIdFor(game), game, start, end, durationMs,
        minutes: Math.floor(durationMs / 60000), source, note, dated: selected.every(session => session.dated !== false),
        revision: 1, updatedAt: Date.now(), mergedFrom: ids.slice(0, 100)
      };
      state.sessions = state.sessions.filter(session => !ids.includes(session.id));
      for (const session of selected) addTombstone(session, "merge");
      state.sessions.push(merged);
      state.sessions.sort((a, b) => a.start - b.start);
      if (!persistSessions()) return json(500, { error: "écriture impossible" });
      return json(201, { ok: true, session: merged, merged: ids.length });
    } catch (e) { return json(400, { error: "fusion impossible" }); }
  }
  const splitSession = url.match(/^\/api\/v1\/sessions\/([^/]+)\/split$/);
  if (splitSession && req.method === "POST") {
    try {
      const id = decodeURIComponent(splitSession[1]), current = state.sessions.find(session => session.id === id);
      if (!current) return json(404, { error: "session introuvable" });
      const b = JSON.parse(await body(req, 100000));
      const start = Number(current.start), end = sessionEnd(current);
      const at = b.at !== undefined ? timestamp(b.at) : start + Math.floor(sessionDuration(current) / 2);
      if (!Number.isFinite(at) || at <= start || at >= end) return json(400, { error: "le point de découpe doit être compris dans la session" });
      const now = Date.now();
      const first = { ...current, id: crypto.randomUUID(), start, end: at, durationMs: at - start, minutes: Math.floor((at - start) / 60000), revision: 1, updatedAt: now, splitFrom: current.id };
      const second = { ...current, id: crypto.randomUUID(), start: at, end, durationMs: end - at, minutes: Math.floor((end - at) / 60000), revision: 1, updatedAt: now, splitFrom: current.id };
      state.sessions = state.sessions.filter(session => session.id !== current.id);
      addTombstone(current, "split");
      state.sessions.push(first, second);
      state.sessions.sort((a, b) => a.start - b.start);
      if (!persistSessions()) return json(500, { error: "écriture impossible" });
      return json(201, { ok: true, sessions: [first, second], totalDurationMs: sessionDuration(first) + sessionDuration(second) });
    } catch (e) { return json(400, { error: "découpage impossible" }); }
  }
  const singleSession = url.match(/^\/api\/v1\/sessions\/([^/]+)$/);
  if (singleSession && req.method === "PATCH") {
    try {
      const id = decodeURIComponent(singleSession[1]), current = state.sessions.find(session => session.id === id);
      if (!current) return json(404, { error: "session introuvable" });
      const b = JSON.parse(await body(req, 100000));
      if (b.revision !== undefined && Number(b.revision) !== current.revision) return json(409, { error: "conflit de révision", current });
      const built = buildSession({ ...b, id: current.id }, current);
      if (built.error) return json(400, { error: built.error });
      built.session.id = current.id;
      built.session.revision = current.revision + 1;
      built.session.updatedAt = Date.now();
      const issues = sessionIssues(built.session, current.id, b.confirm === true);
      if (issues.requiresConfirmation) return json(409, { error: "confirmation requise", requiresConfirmation: true, conflicts: issues.conflicts, longSession: issues.longSession });
      state.sessions[state.sessions.findIndex(session => session.id === current.id)] = built.session;
      state.sessions.sort((a, b) => a.start - b.start);
      if (!persistSessions()) return json(500, { error: "écriture impossible" });
      return json(200, { ok: true, session: built.session });
    } catch (e) { return json(400, { error: "édition impossible" }); }
  }
  if (singleSession && req.method === "DELETE") {
    const id = decodeURIComponent(singleSession[1]), current = state.sessions.find(session => session.id === id);
    const revision = parsed.searchParams.get("revision");
    if (!current) return json(200, { ok: true, alreadyDeleted: state.deletedSessions.some(item => item.id === id) });
    if (revision !== null && Number(revision) !== current.revision) return json(409, { error: "conflit de révision", current });
    state.sessions = state.sessions.filter(session => session.id !== current.id);
    addTombstone(current, "delete");
    if (!persistSessions()) return json(500, { error: "écriture impossible" });
    return json(200, { ok: true, session: current });
  }
  if (url === "/api/session/start" && req.method === "POST") {
    try { const b = JSON.parse(await body(req, 2000)), name = String(b.name || "").trim(); if (!name) return json(400, { error: "jeu manquant" }); if (state.session) endSession(); startSession(name,"manual"); broadcast(); return json(200, { ok: true }); }
    catch (e) { return json(400, { error: "session impossible à démarrer" }); }
  }
  if (url === "/api/session/stop" && req.method === "POST") { const ok=endSession()!==false; return json(ok?200:500, {ok}); }
  if (url === "/api/state" && req.method === "PUT") {
    try {
      const b = JSON.parse(await body(req));
      if (!Array.isArray(b.games)) return json(400, { error: "games manquant" });
      const known = new Set(state.games.map(g => ckey(g.n)));
      const priorGames=new Map(state.games.map(g=>[ckey(g.n),g]));
      state.games = b.games.filter(g => g && typeof g.n === "string" && g.n.trim()).map(g => ({ n: g.n, s: normalizeStatus(g.s), c: g.c | 0, m: Math.max(0, g.m | 0), manualDelta: Number.isSafeInteger(g.manualDelta)?g.manualDelta:(priorGames.get(ckey(g.n))?.manualDelta||0), t: +g.t || 0, firstPlayed: Math.max(0, +g.firstPlayed || 0) }));
      if (Array.isArray(b.sessions)) {
        const seen = new Set();
        state.sessions = b.sessions
          .map(normalizeSession)
          .filter(Boolean)
          .map(session => ({ ...session, gameId: session.gameId || gameIdFor(session.game) }))
          .filter(session => !isTombstoned(session))
          .filter(session => {
            if (seen.has(session.id)) return false;
            seen.add(session.id);
            return true;
          })
          .sort((a, b) => a.start - b.start);
      }
      if (Array.isArray(b.favorites)) state.favorites = [...new Set(b.favorites.map(ckey).filter(Boolean))];
      if (Array.isArray(b.profiles)) {
        const profiles = b.profiles.filter(p => p && typeof p.id === "string" && typeof p.name === "string" && p.id.trim() && p.name.trim()).slice(0, 20).map(p => ({ id: p.id.slice(0, 80), name: p.name.trim().slice(0, 60) }));
        if (profiles.length) state.profiles = profiles;
      }
      if (typeof b.activeProfileId === "string" && state.profiles.some(p => p.id === b.activeProfileId)) state.activeProfileId = b.activeProfileId;
      for (const g of state.games) if (!known.has(ckey(g.n))) scheduleEnrichment(g.n);
      if (state.session && !state.games.find(x => x.n === state.session.name)) state.session = null;
      save(); broadcast(); return json(200, { ok: true });
    } catch (e) { return json(400, { error: "JSON invalide" }); }
  }
  if (url === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("retry: 2000\n\n"); clients.add(res);
    res.write("event: cinema-viewing\ndata: "+JSON.stringify({view:viewing.snapshot(),refresh:true})+"\n\n");
    const hb = setInterval(() => res.write(": hb\n\n"), 25000);
    req.on("close", () => { clearInterval(hb); clients.delete(res); });
    return res.write("data: " + JSON.stringify(payload()) + "\n\n");
  }
  if (process.env.BIBLIO_TEST && url === "/api/_fake" && req.method === "POST") { setPlaying(JSON.parse(await body(req)).name); return json(200, { ok: true }); }
  if (url === "/" || url === "/index.html") {
    try { const page = renderLibraryPage(nonce); res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); return res.end(page); }
    catch (e) { res.writeHead(500); return res.end("bibliotheque.html introuvable à côté de bridge.js"); }
  }
  res.writeHead(404); res.end("Not found");
}).listen(PORT, "127.0.0.1", () => {
  logger.info('Pont démarré', { port: PORT, version: APP_VERSION, games: state.games.length, sessions: state.sessions.length });
  console.log(`Bibliothèque : http://127.0.0.1:${PORT}/`);
  console.log(`Token : ${TOKEN ? "ok" : "ABSENT"} · ID utilisateur : ${USER_ID ? "ok" : "ABSENT"} · ID serveur : ${GUILD_ID ? "ok" : "non précisé (1er serveur)"}`);
  onCoverLibraryChange();
  setInterval(scheduleCovers, HOUR).unref();
  startDiscord();
});
process.on("SIGINT", () => { endSession(); writeLibrary(); saveRecap(); process.exit(0); });
