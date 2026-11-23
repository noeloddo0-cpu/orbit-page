import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage, Tray, Menu, nativeImage } from 'electron';
import { mkdir, readFile, writeFile, copyFile, access, readdir, rename, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkRelease, downloadRelease, newer } from './orbit-updates.mjs';
import { installedSteamGames } from './steam-local.mjs';
import { createBackup, latestBackup, listBackups, preserveCorrupt, restoreFilesFromBackup, verifyBackup } from './orbit-backup.mjs';
import { createLogger } from './orbit-log.mjs';
import { initSecrets, migrateSecrets, getSecret, setSecret } from './orbit-secrets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let dataDir;
let logger;
let assetDir = here;
let appPort;
let setupWindow;
let libraryWindow;
let tray;
let bridgeStarted = false;
let backupTimer;
let quitAfterFlush = false;
let miniMode = false;
let libraryBounds = null;
const DATA_FILES = ['library.json', 'settings.json', 'recap.json', 'cinema.json'];
const REQUIRED_IMPORT_FILES = ['library.json', 'settings.json', 'recap.json'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
app.setName('orbit');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => showLibrary());

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function findEditableAssets() {
  try {
    const envPath = (await readFile(path.join(dataDir, 'discord-env-path.txt'), 'utf8')).trim();
    if (!envPath) return;
    const candidate = path.dirname(envPath);
    const required = ['bridge.js', 'bibliotheque.html', 'app-config.json', 'icon.svg', 'sw.js'];
    const ready = (await Promise.all(required.map(name => exists(path.join(candidate, name))))).every(Boolean) && await exists(path.join(candidate, 'themes'));
    if (ready && app.isPackaged && newer(app.getVersion(),JSON.parse(await readFile(path.join(candidate,'package.json'),'utf8')).version)) return;
    if (ready && await exists(path.join(candidate, 'node_modules', 'discord.js'))) assetDir = candidate;
  } catch {}
}
async function seedFile(name) {
  const target = path.join(dataDir, name);
  if (!(await exists(target)) && await exists(path.join(assetDir, name))) await copyFile(path.join(assetDir, name), target);
}
async function seedData() {
  await mkdir(dataDir, { recursive: true });
  await seedFile('library.json');
  if (!(await exists(path.join(dataDir,'library.json')))) await atomicJson(path.join(dataDir,'library.json'),{version:1,games:[],sessions:[],favorites:[],profiles:[{id:'main',name:'Profil principal'}]});
  await seedFile('meta.json');
  await seedFile('app-config.json');
  const coverDir = path.join(dataDir, 'covers');
  await mkdir(coverDir, { recursive: true });
  const sourceDir = path.join(assetDir, 'covers');
  try {
    for (const name of await readdir(sourceDir)) {
      const target = path.join(coverDir, name);
      if (!(await exists(target))) await copyFile(path.join(sourceDir, name), target);
    }
  } catch {}
}
async function prepareDataFiles() {
  const libraryPath = path.join(dataDir, 'library.json');
  try {
    const library = JSON.parse(await readFile(libraryPath, 'utf8')); if (!Array.isArray(library.games)) throw new Error('library invalid');
    const migrated = { version: 1, ...library, sessions: Array.isArray(library.sessions) ? library.sessions : [], favorites: Array.isArray(library.favorites) ? library.favorites : [], profiles: Array.isArray(library.profiles) && library.profiles.length ? library.profiles : [{ id: 'main', name: 'Profil principal' }] };
    if (!Number.isInteger(library.version) || !Array.isArray(library.sessions) || !Array.isArray(library.favorites) || !Array.isArray(library.profiles)) await atomicJson(libraryPath, migrated);
  } catch {}
  const settingsPath = path.join(dataDir, 'settings.json');
  if (!(await exists(settingsPath))) { let legacy = {}; try { legacy = JSON.parse(await readFile(path.join(dataDir, 'ui-preferences.json'), 'utf8')); } catch {} await atomicJson(settingsPath, { version: 1, ...legacy }); }
  const recapPath = path.join(dataDir, 'recap.json');
  if (!(await exists(recapPath))) await atomicJson(recapPath, { version: 1, lastOpened: null, recent: [], gameStats: {} });
  const cinemaPath = path.join(dataDir, 'cinema.json');
  if (!(await exists(cinemaPath))) await atomicJson(cinemaPath, { version: 1, items: [] });
}
async function atomicJson(file, value) { const temp = `${file}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2), 'utf8'); await rename(temp, file); }
function validData(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isInteger(value.version) || value.version < 1) return false;
  if (name === 'library.json') return Array.isArray(value.games) && value.games.every(g => g && (typeof g.n === 'string' || typeof g.name === 'string')) && Array.isArray(value.sessions) && Array.isArray(value.favorites);
  if (name === 'settings.json') return true;
  if (name === 'cinema.json') return Array.isArray(value.items) && value.items.length <= 5000 && value.items.every(item => item && typeof item.id === 'string' && item.id.length <= 100 && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 200 && ['film', 'series'].includes(item.type) && ['watchlist', 'watching', 'watched'].includes(item.status) && (item.year === null || (Number.isInteger(Number(item.year)) && Number(item.year) >= 1870 && Number(item.year) <= 2200)) && Number.isFinite(Number(item.rating)) && Number(item.rating) >= 0 && Number(item.rating) <= 5 && typeof item.poster === 'string' && item.poster.length <= 2048 && (item.watchedAt === null || typeof item.watchedAt === 'string') && (item.firstWatchedAt === undefined || item.firstWatchedAt === null || /^\d{4}-\d{2}-\d{2}$/.test(item.firstWatchedAt)) && (item.season === undefined || item.season === null || (Number.isInteger(item.season) && item.season > 0 && item.season <= 1000)) && (item.episode === undefined || item.episode === null || (Number.isInteger(item.episode) && item.episode > 0 && item.episode <= 10000)) && (item.watchedDates === undefined || (Array.isArray(item.watchedDates) && item.watchedDates.length <= 500 && item.watchedDates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))) && Number.isFinite(Number(item.addedAt)));
  return name === 'recap.json' && (value.lastOpened === null || typeof value.lastOpened === 'object') && Array.isArray(value.recent) && value.gameStats && typeof value.gameStats === 'object';
}
async function readValid(file, name) { try { const value = JSON.parse(await readFile(file, 'utf8')); return validData(name, value) ? value : null; } catch { return null; } }
async function backupData(force = false, reason = 'automatic') {
  const backupRoot = path.join(dataDir, 'backups'); await mkdir(backupRoot, { recursive: true });
  const dirs = (await readdir(backupRoot, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort().reverse();
  if (!force && dirs.length && Date.now() - (await stat(path.join(backupRoot, dirs[0]))).mtimeMs < 24 * 60 * 60 * 1000) return null;
  try {
    return await createBackup({ dataDir, reason, appVersion: app.getVersion(), logger });
  } catch (error) {
    logger?.error('Sauvegarde impossible', { reason, error });
    throw error;
  }
}
async function recoverCorruptFiles() {
  const backupRoot = path.join(dataDir, 'backups'); let dirs = [];
  try { dirs = (await readdir(backupRoot, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort().reverse(); } catch {}
  const restored = [];
  for (const name of DATA_FILES) {
    const current = path.join(dataDir, name); if (!(await exists(current)) || await readValid(current, name)) continue;
    const preserved = await preserveCorrupt(current);
    logger?.warn('Fichier de données abîmé conservé', { file: name, preserved });
    for (const dir of dirs) { const candidate = path.join(backupRoot, dir, name), value = await readValid(candidate, name); if (!value) continue; await atomicJson(current, value); restored.push(name); break; }
    if (name === 'settings.json' && !restored.includes(name)) {
      try { const legacy = JSON.parse(await readFile(path.join(dataDir, 'ui-preferences.json'), 'utf8')); if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) { const value = { version: 1, ...legacy }; await atomicJson(current, value); restored.push('settings.json depuis les anciens réglages'); } } catch {}
    }
  }
  return restored;
}
function validImport(value) { return value && value.format === 'orbit-backup' && value.version === 1 && REQUIRED_IMPORT_FILES.every(name => validData(name, value[name])) && (value['cinema.json'] === undefined || validData('cinema.json', value['cinema.json'])) && Array.isArray(value.covers) && value.covers.every(file => file && typeof file.name === 'string' && path.basename(file.name) === file.name && IMAGE_EXTENSIONS.has(path.extname(file.name).toLowerCase()) && typeof file.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(file.data)); }
async function getDataBundle() {
  const bundle = { format: 'orbit-backup', version: 1, exportedAt: new Date().toISOString(), covers: [] };
  for (const name of DATA_FILES) { const value = await readValid(path.join(dataDir, name), name); if (!value) throw new Error(`Le fichier ${name} est absent ou invalide.`); bundle[name] = value; }
  try { bundle.meta = JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf8')); } catch { bundle.meta = {}; }
  try { for (const name of await readdir(path.join(dataDir, 'covers'))) if (IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) bundle.covers.push({ name, data: (await readFile(path.join(dataDir, 'covers', name))).toString('base64') }); } catch {}
  return bundle;
}
async function writeImportBundle(bundle) {
  const stage = path.join(dataDir, '.orbit-staging-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(path.join(stage, 'covers'), { recursive: true });
  try {
    for (const name of DATA_FILES) if (bundle[name] !== undefined && bundle[name] !== null) await atomicJson(path.join(stage, name), bundle[name]);
    await atomicJson(path.join(stage, 'meta.json'), bundle.meta && typeof bundle.meta === 'object' && !Array.isArray(bundle.meta) ? bundle.meta : {});
    for (const file of bundle.covers) await writeFile(path.join(stage, 'covers', file.name), Buffer.from(file.data, 'base64'));
    for (const name of DATA_FILES) {
      const source = path.join(stage, name);
      if (!(await exists(source))) continue;
      const target = path.join(dataDir, name), temp = target + '.import-tmp';
      await copyFile(source, temp); await rename(temp, target);
    }
    const metaTemp = path.join(dataDir, 'meta.json.import-tmp');
    await copyFile(path.join(stage, 'meta.json'), metaTemp); await rename(metaTemp, path.join(dataDir, 'meta.json'));
    const coverDir = path.join(dataDir, 'covers'); await mkdir(coverDir, { recursive: true });
    for (const name of await readdir(coverDir)) if (IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) await rm(path.join(coverDir, name), { force: true });
    for (const file of bundle.covers) {
      const target = path.join(coverDir, file.name), temp = target + '.import-tmp';
      await copyFile(path.join(stage, 'covers', file.name), temp); await rename(temp, target);
    }
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
async function findAvailablePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function startBridge(config) {
  if (bridgeStarted) return;
  if (!process.env.ORBIT_BRIDGE_TOKEN) process.env.ORBIT_BRIDGE_TOKEN = randomBytes(32).toString('hex');
  if (config?.envFilePath) process.env.GAME_TRACKER_ENV_FILE = config.envFilePath;
  else if (config?.botToken) {
    const botToken = config.botToken.trim();
    let stored = false;
    try {
      stored = await setSecret('discordToken', botToken);
      if (stored) stored = (await getSecret('discordToken')) === botToken;
    } catch (error) { logger?.warn('Secret Discord non chiffré', { error: error.message }); }
    const next = { discordUserId: config.discordUserId || '', guildId: config.guildId || '' };
    if (!stored) next.botToken = botToken;
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dataDir, 'config.json'), JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
  process.env.GAME_TRACKER_DATA_DIR = dataDir;
  process.env.GAME_TRACKER_ASSET_DIR = assetDir;
  appPort = await findAvailablePort();
  process.env.BRIDGE_PORT = String(appPort);
  await import(pathToFileURL(path.join(assetDir, 'bridge.js')).href);
  bridgeStarted = true;
  const endpoint = `http://127.0.0.1:${appPort}/api/state`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const state = await response.json();
        if (state.discord?.status === 'connecté') return;
        if (state.discord?.status === 'connexion refusée' || state.discord?.status === 'non configuré (.env)') throw new Error('Discord a refusé la configuration enregistrée.');
      }
    } catch (error) { if (error.message?.includes('refusé')) throw error; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Discord ne répond pas. Vérifie le réseau ou sélectionne le fichier .env de discord-bridge.');
}
function ensureStartupLaunch() {
  if (process.platform !== 'win32') return;
  try {
    const args = app.isPackaged ? ['--orbit-background'] : [here, '--orbit-background'];
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args, enabled: true, name: 'Orbit' });
  } catch (error) { console.warn('Démarrage automatique indisponible :', error.message); }
}
function showLibrary() {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    if (libraryWindow.isMinimized()) libraryWindow.restore();
    libraryWindow.show(); libraryWindow.focus();
  }
}
// Compact always-on-top window: useful while a game launches, or beside it.
function setMiniMode(on) {
  const next = !!on;
  if (!libraryWindow || libraryWindow.isDestroyed()) { miniMode = next; return miniMode; }
  if (next === miniMode) return miniMode;
  if (next) {
    if (!libraryWindow.isMaximized()) libraryBounds = libraryWindow.getBounds();
    libraryWindow.unmaximize();
    libraryWindow.setMinimumSize(360, 480);
    libraryWindow.setSize(440, 700, true);
    libraryWindow.setAlwaysOnTop(true, 'floating');
    libraryWindow.show();
    libraryWindow.focus();
  } else {
    libraryWindow.setAlwaysOnTop(false);
    libraryWindow.setMinimumSize(720, 560);
    if (libraryBounds) { libraryWindow.setBounds(libraryBounds, true); libraryBounds = null; }
    else libraryWindow.setSize(1260, 900, true);
  }
  miniMode = next;
  refreshTrayMenu();
  if (!libraryWindow.isDestroyed()) libraryWindow.webContents.send('orbit:mini-changed', miniMode);
  return miniMode;
}
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Ouvrir Orbit', click: showLibrary },
    { label: 'Mini-mode', type: 'checkbox', checked: miniMode, click: item => setMiniMode(item.checked) },
    { type: 'separator' },
    { label: 'Quitter Orbit', click: () => app.quit() }
  ]);
}
function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(trayMenu());
}
function createTray() {
  if (tray) return;
  // Planet icon from MynaUI Icons (MIT): https://github.com/praveenjuge/mynaui-icons
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#07070a"/><g transform="translate(5.6 5.6) scale(2.2)" fill="#e7ecff"><path d="M19.08 12.215c-.112 3.638-3.052 6.535-6.642 6.535a6.5 6.5 0 0 1-2.948-.699c1.495-.501 3.116-1.24 4.738-2.19 1.913-1.12 3.58-2.389 4.852-3.646m-11.548 6.37a8.05 8.05 0 0 0 4.906 1.665c4.509 0 8.146-3.704 8.146-8.25q0-.697-.111-1.363c.506-.676.89-1.353 1.1-2.001.236-.734.272-1.518-.115-2.197-.394-.692-1.1-1.056-1.864-1.213-.722-.149-1.576-.132-2.494.008a8.03 8.03 0 0 0-4.662-1.484C7.93 3.75 4.293 7.454 4.293 12q0 .181.008.363c-.773.851-1.371 1.707-1.716 2.516-.368.862-.502 1.808-.043 2.615.448.786 1.293 1.148 2.186 1.267.81.108 1.77.037 2.804-.175m-1.354-1.307a8.3 8.3 0 0 1-1.554-2.942 6 6 0 0 0-.66 1.132c-.285.67-.242 1.067-.118 1.284.118.207.413.433 1.081.522.352.047.772.05 1.25.004M18.616 6.623q.378.01.676.072c.52.107.758.303.862.486.105.183.153.49-.01.994q-.08.255-.229.548a8.3 8.3 0 0 0-1.299-2.1"/></g></svg>';
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Orbit - suivi de jeu actif');
  refreshTrayMenu();
  tray.on('click', showLibrary);
  tray.on('double-click', showLibrary);
}
function openExternalAllowed(url) {
  try {
    const target = new URL(url);
    if (target.protocol === 'steam:' && /^\/run\/\d{1,10}\/?$/.test(target.pathname)) {
      void shell.openExternal(url).catch(() => {});
      return;
    }
    if (target.protocol !== 'https:') return;
    const allowed = ['github.com', 'www.themoviedb.org', 'themoviedb.org', 'store.steampowered.com', 'steamcommunity.com', 'rawg.io', 'www.igdb.com'];
    const host = target.hostname.toLowerCase();
    if (allowed.some(domain => host === domain || host.endsWith('.' + domain))) void shell.openExternal(target.href).catch(() => {});
  } catch {}
}
function openLibrary({ hidden = false } = {}) {
  createTray();
  libraryWindow = new BrowserWindow({
    width: 1260, height: 900, minWidth: 720, minHeight: 560,
    backgroundColor: '#030304', autoHideMenuBar: true, title: 'orbit', show: false,
    webPreferences: { preload: path.join(here, 'desktop-preload.cjs'), contextIsolation: true, sandbox: true }
  });
  libraryWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalAllowed(url);
    return { action: 'deny' };
  });
  libraryWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`http://127.0.0.1:${appPort}/`)) return;
    event.preventDefault();
    openExternalAllowed(url);
  });
  libraryWindow.loadURL(`http://127.0.0.1:${appPort}/`);
  libraryWindow.once('ready-to-show', () => { if (!hidden && libraryWindow && !libraryWindow.isDestroyed()) libraryWindow.show(); });
  libraryWindow.on('minimize', event => { event.preventDefault(); libraryWindow?.hide(); });
  libraryWindow.on('close', event => {
    if (quitAfterFlush) return;
    event.preventDefault();
    libraryWindow?.hide();
  });
  libraryWindow.on('closed', () => { libraryWindow = null; miniMode = false; libraryBounds = null; refreshTrayMenu(); });
}
function openSetup() {
  setupWindow = new BrowserWindow({
    width: 540, height: 720, resizable: false, autoHideMenuBar: true,
    backgroundColor: '#09090b', title: 'Configuration — orbit',
    webPreferences: {
      preload: path.join(here, 'desktop-preload.cjs'), contextIsolation: true, sandbox: true
    }
  });
  setupWindow.loadFile(path.join(here, 'setup.html'));
  setupWindow.on('closed', () => { setupWindow = null; });
}
function openSetupWithMessage(message) {
  openSetup();
  setupWindow.webContents.once('did-finish-load', () => {
    setupWindow.webContents.executeJavaScript(`document.getElementById('error').textContent=${JSON.stringify(message)}`);
  });
}
async function saveEnvFilePath(filePath) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, 'discord-env-path.txt'), filePath, 'utf8');
}
ipcMain.handle('config:import', async () => {
  const result = await dialog.showOpenDialog(setupWindow, { properties: ['openFile'], filters: [{ name: 'Configuration Discord (JSON)', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  try {
    const data = JSON.parse(await readFile(result.filePaths[0], 'utf8'));
    return { botToken: data.botToken || '', discordUserId: data.discordUserId || '', guildId: data.guildId || '' };
  } catch { throw new Error('Ce fichier ne contient pas une configuration JSON valide.'); }
});
ipcMain.handle('config:import-env', async () => {
  const result = await dialog.showOpenDialog(setupWindow, { properties: ['openFile'], filters: [{ name: 'Tous les fichiers', extensions: ['*'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  try { await access(result.filePaths[0]); return result.filePaths[0]; }
  catch { throw new Error('Ce fichier est introuvable.'); }
});
ipcMain.handle('config:save-env', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return { ok: false, error: 'Choisis le fichier .env de discord-bridge.' };
  try {
    await saveEnvFilePath(filePath.trim());
    if (bridgeStarted) { app.relaunch(); app.exit(0); return { ok: true, restarting: true }; }
    await startBridge({ envFilePath: filePath.trim() });
    ensureStartupLaunch();
    openLibrary(); setupWindow?.close();
    return { ok: true };
  } catch (error) { return { ok: false, error: `Connexion impossible : ${error.message}` }; }
});
ipcMain.handle('config:save', async (_event, config) => {
  for (const key of ['botToken', 'discordUserId', 'guildId']) {
    if (typeof config?.[key] !== 'string' || !config[key].trim()) return { ok: false, error: 'Remplis les trois champs.' };
  }
  try {
    await startBridge({ botToken: config.botToken.trim(), discordUserId: config.discordUserId.trim(), guildId: config.guildId.trim() });
    ensureStartupLaunch();
    openLibrary();
    setupWindow?.close();
    return { ok: true };
  } catch (error) {
    if (bridgeStarted) { app.relaunch(); app.exit(0); return { ok: true, restarting: true }; }
    return { ok: false, error: `Connexion impossible : ${error.message}. Vérifie la configuration et réessaie.` };
  }
});

ipcMain.handle('data:load-library', async () => {
  const library = await readValid(path.join(dataDir, 'library.json'), 'library.json');
  if (!library) throw new Error('Bibliothèque sauvegardée illisible');
  let recap = {}; try { recap = JSON.parse(await readFile(path.join(dataDir, 'recap.json'), 'utf8')); } catch {}
  return { ...library, recap };
});
ipcMain.handle('data:export', async () => {
  try {
    const result = await dialog.showSaveDialog(libraryWindow, { title: 'Exporter les données Orbit', defaultPath: `Orbit-sauvegarde-${new Date().toISOString().slice(0,10)}.json`, filters: [{ name: 'Sauvegarde Orbit', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await writeFile(result.filePath, JSON.stringify(await getDataBundle(), null, 2), 'utf8'); return { ok: true };
  } catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle('data:import', async () => {
  const result = await dialog.showOpenDialog(libraryWindow, { title: 'Importer une sauvegarde Orbit', properties: ['openFile'], filters: [{ name: 'Sauvegarde Orbit', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  try {
    const bundle = JSON.parse(await readFile(result.filePaths[0], 'utf8')); if (!validImport(bundle)) return { ok: false, message: 'Ce fichier ne ressemble pas à une sauvegarde Orbit complète.' };
    const answer = await dialog.showMessageBox(libraryWindow, { type: 'warning', buttons: ['Annuler', 'Importer'], defaultId: 0, cancelId: 0, title: 'Remplacer les données ?', message: 'L’import va remplacer les jeux, les réglages et le récapitulatif actuels.', detail: 'Une sauvegarde de l’état actuel sera créée avant l’import. En cas d’échec, Orbit restaure automatiquement cette sauvegarde.' });
    if (answer.response !== 1) return { ok: false, canceled: true };
    const backup = await backupData(true, 'before-import');
    try { await writeImportBundle(bundle); }
    catch (error) {
      if (backup?.directory) await restoreFilesFromBackup(backup.directory, dataDir);
      throw error;
    }
    app.relaunch(); app.exit(0); return { ok: true, restarting: true };
  } catch (error) { logger?.error('Import impossible', { error }); return { ok: false, message: `Import impossible : ${error.message}` }; }
});
ipcMain.handle('data:restore', async () => {
  const backupRoot = path.join(dataDir, 'backups');
  const result = await dialog.showOpenDialog(libraryWindow, { title: 'Choisir un dossier de sauvegarde', defaultPath: backupRoot, properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const chosen = path.resolve(result.filePaths[0]), root = path.resolve(backupRoot) + path.sep;
  if (!chosen.startsWith(root)) return { ok: false, message: 'Choisis un dossier situé dans les sauvegardes Orbit.' };
  try {
    const docs = {}; for (const name of DATA_FILES) { docs[name] = await readValid(path.join(chosen, name), name); if (name !== 'cinema.json' && !docs[name]) return { ok: false, message: `La sauvegarde ne contient pas un fichier ${name} valide.` }; }
    const verification = await verifyBackup(chosen);
    const manifest = verification.manifest;
    const counts = manifest?.counts || {};
    const detail = manifest
      ? `Sauvegarde du ${new Date(manifest.createdAt).toLocaleString('fr-FR')} · ${counts.games || 0} jeux · ${counts.sessions || 0} sessions · ${counts.films || 0} films · ${counts.series || 0} séries · vérification : ${verification.ok ? 'réussie' : 'ÉCHEC'}`
      : 'Cette ancienne sauvegarde ne contient pas de manifeste de vérification.';
    if (!verification.ok && !verification.legacy) return { ok: false, message: 'Cette sauvegarde est corrompue ou incomplète. Elle ne sera pas restaurée.', detail };
    const answer = await dialog.showMessageBox(libraryWindow, { type: 'warning', buttons: ['Annuler', 'Restaurer'], defaultId: 0, cancelId: 0, title: 'Restaurer cette sauvegarde ?', message: 'Les données actuelles seront remplacées. Une sauvegarde de l’état actuel sera créée avant la restauration.', detail });
    if (answer.response !== 1) return { ok: false, canceled: true };
    const bundle={...docs,meta:{}};try{bundle.meta=JSON.parse(await readFile(path.join(chosen,'meta.json'),'utf8'));}catch{};bundle.covers=[];try{for(const name of await readdir(path.join(chosen,'covers')))if(IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))bundle.covers.push({name,data:(await readFile(path.join(chosen,'covers',name))).toString('base64')});}catch{}
    const backup = await backupData(true, 'before-restore');
    try { await writeImportBundle(bundle); }
    catch (error) {
      if (backup?.directory) await restoreFilesFromBackup(backup.directory, dataDir);
      throw error;
    }
    app.relaunch(); app.exit(0); return { ok: true, restarting: true };
  } catch (error) { logger?.error('Restauration impossible', { error }); return { ok: false, message: `Restauration impossible : ${error.message}` }; }
});
function fromLibrary(event) {
  return !!libraryWindow && event.sender === libraryWindow.webContents && event.senderFrame === event.sender.mainFrame &&
    event.senderFrame.url.split('?')[0].split('#')[0] === 'http://127.0.0.1:'+appPort+'/';
}
ipcMain.handle('play:launch-steam', async (event, id) => {
  if (!fromLibrary(event) || !Number.isSafeInteger(id) || id<=0 || !installedSteamGames().some(g=>g.appId===id)) return {ok:false};
  try { await shell.openExternal('steam://run/'+id); return {ok:true}; } catch { return {ok:false}; }
});
ipcMain.handle('orbit:mini-get', event => fromLibrary(event) ? miniMode : false);
ipcMain.handle('orbit:mini-set', (event, on) => fromLibrary(event) ? setMiniMode(on) : miniMode);
ipcMain.handle('orbit:mini-toggle', event => fromLibrary(event) ? setMiniMode(!miniMode) : miniMode);
let updateBusy = false;
ipcMain.handle('orbit:update', async (event, installVersion) => {
  if (!fromLibrary(event) || updateBusy) return {message:'Action indisponible.'};
  updateBusy = true;
  try {
    const release = await checkRelease(app.getVersion());
    if (!release.version || installVersion !== release.version) return {message:release.message, version:release.version};
    const prompt = await dialog.showMessageBox(libraryWindow, {type:'question',buttons:['Installer et quitter','Annuler'],defaultId:1,cancelId:1,message:'Installer Orbit '+release.version+' ?',detail:'Orbit va enregistrer ta bibliothèque et fermer pour appliquer la mise à jour.'});
    if (prompt.response !== 0) return {message:'Installation annulée.',version:release.version};
    const target = await downloadRelease(release);
    await libraryWindow.webContents.executeJavaScript('window.__orbitFlush?.()');
    const flush = await fetch('http://127.0.0.1:'+appPort+'/api/flush',{method:'POST',headers:{'X-Orbit-Token':process.env.ORBIT_BRIDGE_TOKEN||''}});
    if (!flush.ok) throw Error('Enregistrement de la session impossible.');
    await backupData(true, 'before-update');
    const error = await shell.openPath(target);
    if (error) throw Error('Impossible d’ouvrir l’installateur.');
    app.quit();
    return {message:'Installation en cours.'};
  } catch (err) { return {message:err.message || 'Vérification impossible.'}; }
  finally { updateBusy=false; }
});

ipcMain.handle('data:open-folder', async () => { const folder = path.join(dataDir, 'backups'); await mkdir(folder, { recursive: true }); const message = await shell.openPath(folder); return message ? { ok: false, message } : { ok: true }; });
ipcMain.handle('data:backup-now', async () => {
  try {
    const backup = await backupData(true, 'manual');
    return { ok: true, name: backup.name, verified: backup.verified, counts: backup.manifest.counts, covers: backup.manifest.covers, size: backup.manifest.files.reduce((total, file) => total + file.size, 0) };
  } catch (error) { return { ok: false, message: `Sauvegarde impossible : ${error.message}` }; }
});
ipcMain.handle('data:verify-latest', async () => {
  try {
    const latest = await latestBackup(path.join(dataDir, 'backups'));
    if (!latest) return { ok: false, message: 'Aucune sauvegarde pour le moment.' };
    const verification = await verifyBackup(latest.directory);
    return { ok: verification.ok || verification.legacy, legacy: verification.legacy, verified: verification.ok, name: latest.name, createdAt: latest.createdAt, checked: verification.checked, errors: verification.errors.slice(0, 10), counts: latest.counts, covers: latest.covers, message: verification.legacy ? 'Ancienne sauvegarde sans manifeste : vérification détaillée impossible.' : verification.ok ? 'Sauvegarde vérifiée : tous les fichiers sont intacts.' : 'Sauvegarde incomplète ou corrompue.' };
  } catch (error) { return { ok: false, message: `Vérification impossible : ${error.message}` }; }
});
ipcMain.handle('data:list-backups', async () => {
  try {
    const backups = await listBackups(path.join(dataDir, 'backups'));
    return { ok: true, backups: backups.slice(0, 30).map(({ directory, ...backup }) => backup) };
  } catch (error) { return { ok: false, message: error.message, backups: [] }; }
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  dataDir = app.getPath('userData');
  logger = createLogger({ dir: dataDir, component: 'desktop' });
  process.on('uncaughtException', error => logger?.error('Exception non gérée', { error }));
  process.on('unhandledRejection', error => logger?.error('Rejet non géré', { error }));
  logger.info('Démarrage Orbit', { version: app.getVersion(), packaged: app.isPackaged });
  await findEditableAssets();
  await seedData();
  const restored = await recoverCorruptFiles();
  await prepareDataFiles();
  const invalid = [];
  for (const name of DATA_FILES) if (!(await readValid(path.join(dataDir, name), name))) invalid.push(name);
  if (invalid.length) { dialog.showErrorBox('Données à protéger', `Orbit n’a pas trouvé de sauvegarde valide pour : ${invalid.join(', ')}. Le fichier abîmé est conservé. Rien ne sera écrasé. Contacte-moi avant de relancer l’app.`); app.quit(); return; }
  await backupData(true, 'automatic');
  backupTimer = setInterval(() => backupData(true, 'automatic').catch(() => {}), 24 * 60 * 60 * 1000);
  await initSecrets({ dataDir, safeStorage, logger });
  let secretsMigration = { migrated: [] };
  try { secretsMigration = await migrateSecrets({ configPath: path.join(dataDir, 'config.json'), tmdbKeyPath: path.join(dataDir, 'tmdb-api-key.txt') }); }
  catch (error) { logger?.warn('Migration des secrets interrompue', { error }); }
  if (secretsMigration.migrated.length) logger.info('Secrets protégés par Windows', { migrated: secretsMigration.migrated });
  const configPath = path.join(dataDir, 'config.json');
  const envPathFile = path.join(dataDir, 'discord-env-path.txt');
  let config = {};
  try { if (await exists(configPath)) config = JSON.parse(await readFile(configPath, 'utf8')); } catch {}
  try { if (await exists(envPathFile)) config.envFilePath = (await readFile(envPathFile, 'utf8')).trim(); } catch {}
  if (config.botToken || config.envFilePath || (await getSecret('discordToken'))) {
    try {
      await startBridge(config);
      ensureStartupLaunch();
      openLibrary({ hidden: process.argv.includes('--orbit-background') });
      if (restored.length) dialog.showMessageBox(libraryWindow, { type: 'info', title: 'Sauvegarde restaurée', message: `Un fichier de données était abîmé. Il a été restauré depuis une sauvegarde : ${restored.join(', ')}.` });
    }
    catch (error) { if (bridgeStarted) { console.warn('Discord indisponible au démarrage; ouverture de la bibliothèque hors ligne :', error.message); openLibrary(); } else { openSetupWithMessage('Le pont Orbit ne démarre pas. Vérifie les fichiers de l’application et le fichier .env.'); } }
  } else openSetup();
});
app.on('activate', () => { if (libraryWindow) showLibrary(); else if (appPort) openLibrary(); });
app.on('before-quit', event => {
  clearInterval(backupTimer);
  if (quitAfterFlush || !appPort) return;
  event.preventDefault(); quitAfterFlush = true;
  const flush = libraryWindow?.webContents.executeJavaScript('window.__orbitFlush ? window.__orbitFlush() : Promise.resolve()').catch(() => {});
  Promise.race([Promise.resolve(flush), new Promise(resolve => setTimeout(resolve, 2500))]).then(() => fetch(`http://127.0.0.1:${appPort}/api/flush`, { method: 'POST', headers: { 'X-Orbit-Token': process.env.ORBIT_BRIDGE_TOKEN || '' } })).catch(() => {}).finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
