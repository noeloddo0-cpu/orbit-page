import { steamRoots, installedSteamGames, localPortrait, imageSize } from "./steam-local.mjs";
import { createRequire } from "node:module";
import { shells as SHELL_REGISTRY } from "./themes/index.js";
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
const TOKEN = pick("DISCORD_TOKEN", "BOT_TOKEN", "TOKEN") || savedConfig.botToken || "";
const USER_ID = pick("DISCORD_USER_ID", "USER_ID", "TARGET_USER_ID", "DISCORD_ID") || savedConfig.discordUserId || "";
const GUILD_ID = pick("DISCORD_GUILD_ID", "GUILD_ID", "SERVER_ID", "DISCORD_SERVER_ID") || savedConfig.guildId || "";
const PORT = +process.env.BRIDGE_PORT || 3181;
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
const atomicWrite = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = file + ".tmp"; fs.writeFileSync(temp, JSON.stringify(value, null, 2)); fs.renameSync(temp, file); };
const CINEMA_FILE = path.join(DATA_DIR, "cinema.json");
const TMDB_KEY_FILE = path.join(DATA_DIR, "tmdb-api-key.txt");
let cinema = { version: 1, items: [] };
try { const savedCinema = JSON.parse(fs.readFileSync(CINEMA_FILE, "utf8")); if (savedCinema && Array.isArray(savedCinema.items)) cinema = { version: 1, ...savedCinema }; }
catch (e) { if (!fs.existsSync(CINEMA_FILE)) { try { atomicWrite(CINEMA_FILE, cinema); } catch (writeError) {} } }
function migrateFileVersion(file, legacyFile, fallback) {
  try { const current = JSON.parse(fs.readFileSync(file, "utf8")); if (current && typeof current === "object") return { version: 1, ...current }; } catch (e) {}
  try { const legacy = JSON.parse(fs.readFileSync(legacyFile, "utf8")); if (legacy && typeof legacy === "object") { const migrated = { version: 1, ...legacy }; atomicWrite(file, migrated); return migrated; } } catch (e) {}
  return { version: 1, ...fallback };
}
let settingsDocument = migrateFileVersion(SETTINGS_FILE, UI_PREFS_FILE, {});
let recap = migrateFileVersion(RECAP_FILE, path.join(DATA_DIR, "recap.json"), { lastOpened: null, recent: [], gameStats: {} });
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
const SHELL_CSS = Object.fromEntries(Object.keys(SHELLS).map(id => { try { return [id, fs.readFileSync(path.join(THEMES_DIR, id, "shell.css"), "utf8")]; } catch (e) { return [id, ""]; } }));
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
let state = { games: [], sessions: [], session: null, favorites: [], profiles: [{ id: "main", name: "Profil principal" }], activeProfileId: "main", meta: {} };
try {
  const stored = JSON.parse(fs.readFileSync(DATA, "utf8"));
  state.games = Array.isArray(stored.games) ? stored.games : [];
  state.sessions = Array.isArray(stored.sessions) ? stored.sessions : [];
  state.favorites = Array.isArray(stored.favorites) ? stored.favorites : [];
  state.profiles = Array.isArray(stored.profiles) && stored.profiles.length ? stored.profiles : state.profiles;
  state.activeProfileId = typeof stored.activeProfileId === "string" ? stored.activeProfileId : state.profiles[0].id;
  state.meta = stored.meta && typeof stored.meta === "object" ? stored.meta : {};
} catch (e) {}
try {
  const cached = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
  if (cached && typeof cached === "object") state.meta = { ...state.meta, ...cached };
} catch (e) {}
const disc = { status: "démarrage", playing: null };
const ckey = n => String(n || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[®™©]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
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
  try { atomicWrite(DATA, { version: 1, games: state.games, sessions: state.sessions, favorites: state.favorites, profiles: state.profiles, activeProfileId: state.activeProfileId }); }
  catch (e) { console.log("Sauvegarde impossible :", e.message); }
}
function saveRecap() { try { atomicWrite(RECAP_FILE, recap); } catch (e) { console.log("Sauvegarde du récap impossible :", e.message); } }
function saveMeta() {
  try { fs.writeFileSync(META_FILE + ".tmp", JSON.stringify(state.meta, null, 1)); fs.renameSync(META_FILE + ".tmp", META_FILE); }
  catch (e) { console.log("Cache infos impossible :", e.message); }
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
function playDetailsIndex() {
  const installed = localInstallIndex();
  return Object.fromEntries(state.games.map(g => {
    const key = ckey(g.n), m = state.meta[metaKey(g.n)] || {};
    const installedId = installed.names.get(key) || (installed.ids.has(m.localSteamId) ? m.localSteamId : null);
    return [key, { ...m.playDetails, installedId }];
  }));
}
function validPortrait(bytes) {
  const size = imageSize(bytes);
  return size && size[0] >= 150 && size[1] > size[0] && size[1] <= 12000 && size[0] <= 12000;
}
function savePlayMeta(key, patch) {
  const merged = { ...state.meta, [key]: { ...state.meta[key], ...patch } };
  atomicWrite(META_FILE, merged);
  state.meta = merged;
  broadcast();
}
async function downloadSteamPortrait(id) {
  for (const filename of ['library_600x900_2x.jpg', 'library_600x900.jpg']) {
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
      if (validPortrait(bytes)) return bytes;
    } catch {}
  }
  return null;
}

function steamPortraitIndex(){const result={};for(const g of state.games){const m=state.meta[metaKey(g.n)],portrait=m?.playPortrait || m?.steamPortrait;if(portrait&&fs.existsSync(path.join(COVERS,path.basename(portrait.f))))result[ckey(g.n)]=portrait;}return result;}
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
let portraitJob=null;
async function completeVerticalCovers(){
 const available=steamPortraitIndex();
 const games=state.games.filter(g=>!available[ckey(g.n)]);let added=0,next=0;
 async function worker(){while(next<games.length){const game=games[next++];try{
 const key=metaKey(game.n),old=state.meta[key]||{};let appId=Number(old.appId)||0;
 if(!appId){const result=await getJson('https://store.steampowered.com/api/storesearch/?'+new URLSearchParams({term:game.n,l:'english',cc:'us'}));const match=(result.items||[]).find(x=>ckey(x.name)===ckey(game.n));appId=Number(match?.id)||0;}if(!appId)continue;
 const found=await downloadSteamPortrait(appId);
 if(!found)continue;const filename='steam-'+appId+'-portrait.jpg',target=path.join(COVERS,filename);fs.writeFileSync(target+'.tmp',found);fs.renameSync(target+'.tmp',target);
 state.meta[key]={...(state.meta[key]||{title:game.n}),appId,steamPortrait:{f:filename,v:Math.round(fs.statSync(target).mtimeMs)}};added++;
 }catch{}}}
 await Promise.all([worker(),worker(),worker()]);saveMeta();broadcast();return {ok:true,added,total:Object.keys(steamPortraitIndex()).length,missing:state.games.length-Object.keys(steamPortraitIndex()).length};
}
const payload = () => ({ games: state.games, sessions: state.sessions, session: state.session, favorites: state.favorites, profiles: state.profiles, activeProfileId: state.activeProfileId, recap, discord: { status: disc.status, playing: disc.playing }, covers: coverIndex(), steamCovers: steamPortraitIndex(), playDetails: playDetailsIndex() });
const clients = new Set();
function broadcast() { const d = "data: " + JSON.stringify(payload()) + "\n\n"; for (const r of clients) r.write(d); }
const metaKey = name => crypto.createHash("sha1").update(ckey(name)).digest("hex");
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
    const type = (r.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!r.ok || !type.startsWith("image/")) return "";
    const bytes = Buffer.from(await r.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return "";
    const ext = type === "image/png" ? ".png" : type === "image/webp" ? ".webp" : type === "image/jpeg" ? ".jpg" : "";
    if (!ext) return "";
    const filename = key + ext, target = path.join(COVERS, filename);
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
function startSession(name) {
  let g = findGame(name);
  if (!g) { g = { n: String(name).replace(/[®™©]/g, "").trim(), s: 2, c: 0, m: 0, t: 0 }; state.games.push(g); console.log("Nouveau jeu ajouté :", g.n); }
  state.session = { id: crypto.randomUUID(), name: g.n, start: Date.now(), mins: 0 };
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
  state.sessions.push({ id: current.id, game: current.name, start: current.start, end: ended, durationMs: Math.max(0, ended - current.start), minutes: Math.max(0, current.mins) });
  const g = state.games.find(x => x.n === current.name); if (g) g.t = ended;
  console.log("Session terminée :", current.name);
  state.session = null; save();
  broadcast();
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

/* ---------- Discord ---------- */
function playingFrom(p) { const a = p && (p.activities || []).find(x => x.type === 0); return a ? a.name : null; }
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
    setPlaying(playingFrom(pr)); broadcast();
  };
  c.once("ready", onReady); c.once("clientReady", onReady);
  c.on("presenceUpdate", (_o, n) => { if (n && n.userId === USER_ID && (!GUILD_ID || n.guild.id === GUILD_ID)) setPlaying(playingFrom(n)); });
  c.on("error", e => console.log("Erreur Discord :", e.message));
  c.login(TOKEN).catch(e => { disc.status = "connexion refusée"; console.log("Connexion Discord impossible :", e.message); broadcast(); });
}

/* ---------- Serveur web ---------- */
function body(req, limit = 4e6) { return new Promise((res, rej) => { let b = ""; req.on("data", d => { b += d; if (b.length > limit) { rej(new Error("trop gros")); req.destroy(); } }); req.on("end", () => res(b)); }); }
function binaryBody(req, limit = 8 * 1024 * 1024) { return new Promise((res, rej) => { const parts = []; let size = 0; req.on("data", d => { size += d.length; if (size > limit) { rej(new Error("fichier trop gros")); req.destroy(); } else parts.push(d); }); req.on("end", () => res(Buffer.concat(parts))); }); }
http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://127.0.0.1:${PORT}`), url = parsed.pathname;
  const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); };
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
    if (!file.startsWith(root + path.sep) || ![".js", ".css", ".json", ".woff2"].includes(ext) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("Not found"); }
    const type = ext === ".js" ? "text/javascript; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : ext === ".woff2" ? "font/woff2" : "application/json; charset=utf-8";
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
      savePlayMeta(key, {playDetails: {kind: fields.kind, note: fields.note, collections: [...new Set(fields.collections.map(t=>t.trim()))], platforms: [...new Set(fields.platforms.map(t=>t.trim()))]}});
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
      if (!bytes || !validPortrait(bytes)) return json(400, {error: 'Choisis une jaquette verticale JPG ou PNG, de 150 px de large minimum et 8 Mo maximum.'});
      const key = metaKey(game.n), filename = 'play-' + key + (bytes[0] === 255 ? '.jpg' : '.png');
      const target = path.join(COVERS, filename), temp = target + '.tmp';
      fs.writeFileSync(temp, bytes); fs.renameSync(temp, target);
      const cover = { f: filename, v: Math.round(fs.statSync(target).mtimeMs) };
      savePlayMeta(key, { playPortrait: cover });
      return json(200, {ok: true, cover});
    } catch { return json(400, {error: 'Jaquette indisponible ou fichier trop grand.'}); }
  }

  if(url==="/api/steam/portraits"&&req.method==="POST"){try{if(!portraitJob)portraitJob=completeVerticalCovers().finally(()=>{portraitJob=null;});return json(200,await portraitJob);}catch{return json(500,{ok:false,message:"Recherche des jaquettes momentanément indisponible"});}}
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
      delete current.cover; current.image = ""; current.coverManual = false; state.meta[metaId] = current; saveMeta(); broadcast();
      return json(200, { ok: true });
    }
    try {
      const type = (req.headers["content-type"] || "").split(";")[0].toLowerCase();
      if (type !== "image/jpeg") return json(415, { error: "image JPEG attendue" });
      const bytes = await binaryBody(req, 8 * 1024 * 1024);
      if (!bytes.length) return json(400, { error: "image vide" });
      const filename = key + ".jpg", target = path.join(COVERS, filename), temp = target + ".tmp-" + crypto.randomBytes(6).toString("hex");
      fs.writeFileSync(temp, bytes);
      for (const f of matching()) { try { fs.unlinkSync(path.join(COVERS, f)); } catch (e) {} }
      fs.renameSync(temp, target);
      const v = Math.round(fs.statSync(target).mtimeMs);
      state.meta[metaId] = { ...current, image: "", cover: "/covers/" + encodeURIComponent(filename) + "?v=" + v, coverManual: true, checkedAt: current.checkedAt || Date.now() };
      saveMeta(); broadcast(); return json(200, { ok: true, cover: { f: filename, v } });
    } catch (e) { return json(400, { error: "image impossible à enregistrer" }); }
  }
  if (url === "/api/state" && req.method === "GET") return json(200, payload());
  if (url === "/api/cinema/tmdb-key" && req.method === "GET") return json(200, { configured: fs.existsSync(TMDB_KEY_FILE) && !!fs.readFileSync(TMDB_KEY_FILE, "utf8").trim() });
  if (url === "/api/cinema/tmdb-key" && req.method === "POST") {
    try { const input = JSON.parse(await body(req, 2000)), key = String(input?.key || "").trim(); if (key.length > 500) return json(400, { error: "Clé invalide" }); const temp = TMDB_KEY_FILE + ".tmp"; if (key) fs.writeFileSync(temp, key, "utf8"); else { try { fs.unlinkSync(TMDB_KEY_FILE); } catch (e) {} return json(200, { configured: false }); } fs.renameSync(temp, TMDB_KEY_FILE); return json(200, { configured: true }); }
    catch (error) { return json(500, { error: "Sauvegarde de la clé TMDB impossible" }); }
  }  if (url === "/api/cinema/poster-search" && req.method === "POST") {
    try {
      const input = JSON.parse(await body(req, 5000));
      const key = fs.existsSync(TMDB_KEY_FILE) ? fs.readFileSync(TMDB_KEY_FILE, "utf8").trim() : "", title = String(input?.title || "").trim(), type = input?.type === "series" ? "tv" : input?.type === "film" ? "movie" : "";
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
      const key = fs.existsSync(TMDB_KEY_FILE) ? fs.readFileSync(TMDB_KEY_FILE, "utf8").trim() : "";
      const type = input?.type === "series" ? "tv" : input?.type === "film" ? "movie" : "";
      const id = Number(input?.id);
      if (!key || key.length > 500 || !type || !Number.isSafeInteger(id) || id <= 0) return json(400, { error: "Paramètres de fiche invalides" });
      const response = await fetch(`https://api.themoviedb.org/3/${type}/${id}?language=fr-FR`, { headers: { Authorization: `Bearer ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) return json(response.status === 401 ? 401 : 502, { error: response.status === 401 ? "Clé TMDB invalide" : "Fiche TMDB indisponible" });
      const item = await response.json();
      const date = item.release_date || item.first_air_date || "";
      const runtime = type === "movie" ? item.runtime : (Array.isArray(item.episode_run_time) && item.episode_run_time.length ? Math.round(item.episode_run_time.reduce((a,b)=>a+b,0)/item.episode_run_time.length) : null);
      return json(200, { id: Number(item.id), title: item.title || item.name || "", originalTitle: item.original_title || item.original_name || "", date, releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "", posterPath: item.poster_path || "", overview: item.overview || "", genres: Array.isArray(item.genres) ? item.genres.map(g=>String(g.name||"")).filter(Boolean).slice(0,20) : [], runtime: Number.isInteger(runtime) && runtime > 0 ? runtime : null });
    } catch (error) { return json(502, { error: "Impossible de charger la fiche TMDB" }); }
  }
  if (url === "/api/cinema" && req.method === "GET") return json(200, cinema);
  if (url === "/api/cinema" && req.method === "PUT") {
    try {
      const input = JSON.parse(await body(req, 2 * 1024 * 1024));
      if (!Array.isArray(input.items) || input.items.length > 5000) return json(400, { error: "Liste de films invalide" });
      const items = [];
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
        items.push({ id: String(raw.id || crypto.randomUUID()).slice(0, 100), title, type, year: releaseDate ? Number(releaseDate.slice(0,4)) : year, releaseDate, status, rating, poster, season, episode, watchedAt, firstWatchedAt, watchedDates, tmdbId, overview, originalTitle, genres, runtime, addedAt: Math.max(0, Number(raw.addedAt) || Date.now()) });
      }
      cinema = { version: 1, items };
      atomicWrite(CINEMA_FILE, cinema);
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
      recap = { version: 1, lastOpened: value.lastOpened ? { name: value.lastOpened.name.slice(0, 200), at: +value.lastOpened.at, scrollTop: Math.max(0, +value.lastOpened.scrollTop || 0) } : null, recent: Array.isArray(value.recent) ? value.recent.filter(x => x && typeof x.name === "string" && Number.isFinite(+x.at)).slice(0, 20).map(x => ({ name: x.name.slice(0, 200), at: +x.at })) : [], gameStats: value.gameStats && typeof value.gameStats === "object" && !Array.isArray(value.gameStats) ? value.gameStats : {} };
      saveRecap(); return json(200, { ok: true });
    } catch (e) { return json(400, { error: "Récap invalide" }); }
  }
  if (url === "/api/session/start" && req.method === "POST") {
    try { const b = JSON.parse(await body(req, 2000)), name = String(b.name || "").trim(); if (!name) return json(400, { error: "jeu manquant" }); if (state.session) endSession(); startSession(name); broadcast(); return json(200, { ok: true }); }
    catch (e) { return json(400, { error: "session impossible à démarrer" }); }
  }
  if (url === "/api/session/stop" && req.method === "POST") { endSession(); return json(200, { ok: true }); }
  if (url === "/api/state" && req.method === "PUT") {
    try {
      const b = JSON.parse(await body(req));
      if (!Array.isArray(b.games)) return json(400, { error: "games manquant" });
      const known = new Set(state.games.map(g => ckey(g.n)));
      state.games = b.games.filter(g => g && typeof g.n === "string" && g.n.trim()).map(g => ({ n: g.n, s: g.s | 0, c: g.c | 0, m: Math.max(0, g.m | 0), t: +g.t || 0, firstPlayed: Math.max(0, +g.firstPlayed || 0) }));
      if (Array.isArray(b.sessions)) {
        const byId = new Map();
        const keepSession = x => {
          if (!x || typeof x.game !== "string" || !Number.isFinite(+x.start)) return;
          const session = { ...(typeof x.id === "string" ? { id: x.id } : {}), game: x.game, start: +x.start, end: Number.isFinite(+x.end) ? +x.end : null, durationMs: Math.max(0, +x.durationMs || 0), minutes: Math.max(0, +x.minutes || 0) };
          const key = session.id ? `id:${session.id}` : `${ckey(session.game)}:${session.start}`;
          const previous = byId.get(key);
          byId.set(key, previous ? { ...previous, end: Math.max(previous.end || 0, session.end || 0) || null, durationMs: Math.max(previous.durationMs, session.durationMs), minutes: Math.max(previous.minutes, session.minutes) } : session);
        };
        state.sessions.forEach(keepSession);
        b.sessions.forEach(keepSession);
        state.sessions = [...byId.values()].sort((a, b) => a.start - b.start);
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
    const hb = setInterval(() => res.write(": hb\n\n"), 25000);
    req.on("close", () => { clearInterval(hb); clients.delete(res); });
    return res.write("data: " + JSON.stringify(payload()) + "\n\n");
  }
  if (process.env.BIBLIO_TEST && url === "/api/_fake" && req.method === "POST") { setPlaying(JSON.parse(await body(req)).name); return json(200, { ok: true }); }
  if (url === "/" || url === "/index.html") {
    try { const page = fs.readFileSync(PAGE, "utf8").replace("<!--ORBIT_PREFS-->", `<script>window.__ORBIT_THEMES=${JSON.stringify(THEMES)};window.__ORBIT_PREFERENCES=${JSON.stringify(readUiPrefs())};window.__ORBIT_SHELLS=${JSON.stringify(SHELLS)};window.__ORBIT_SHELL_CSS=${JSON.stringify(SHELL_CSS)}</script>`); res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); return res.end(page); }
    catch (e) { res.writeHead(500); return res.end("bibliotheque.html introuvable à côté de bridge.js"); }
  }
  res.writeHead(404); res.end("Not found");
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Bibliothèque : http://127.0.0.1:${PORT}/`);
  console.log(`Token : ${TOKEN ? "ok" : "ABSENT"} · ID utilisateur : ${USER_ID ? "ok" : "ABSENT"} · ID serveur : ${GUILD_ID ? "ok" : "non précisé (1er serveur)"}`);
  startDiscord();
});
process.on("SIGINT", () => { endSession(); writeLibrary(); saveRecap(); process.exit(0); });
