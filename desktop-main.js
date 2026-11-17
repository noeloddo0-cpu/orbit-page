import { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage } from 'electron';
import { mkdir, readFile, writeFile, copyFile, access, readdir, rename, rm, stat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkRelease, downloadRelease } from './orbit-updates.mjs';
import { installedSteamGames } from './steam-local.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let dataDir;
const assetDir = here;
let appPort;
let setupWindow;
let libraryWindow;
let tray;
let bridgeStarted = false;
let backupTimer;
let quitAfterFlush = false;
const DATA_FILES = ['library.json', 'settings.json', 'recap.json', 'cinema.json'];
const REQUIRED_IMPORT_FILES = ['library.json', 'settings.json', 'recap.json'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
app.setName('orbit');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => showLibrary());

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function seedFile(name) {
  const target = path.join(dataDir, name);
  if (!(await exists(target)) && await exists(path.join(assetDir, name))) await copyFile(path.join(assetDir, name), target);
}
async function seedData() {
  await mkdir(dataDir, { recursive: true });
  if (!(await exists(path.join(dataDir,'library.json')))) await atomicJson(path.join(dataDir,'library.json'),{version:1,games:[],sessions:[],favorites:[],profiles:[{id:'main',name:'Profil principal'}]});
  await seedFile('app-config.json');
  const coverDir = path.join(dataDir, 'covers');
  await mkdir(coverDir, { recursive: true });
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
  if (name === 'library.json') return Array.isArray(value.games) && value.games.every(g => g && typeof g.n === 'string') && Array.isArray(value.sessions) && Array.isArray(value.favorites);
  if (name === 'settings.json') return true;
  if (name === 'cinema.json') return Array.isArray(value.items) && value.items.length <= 5000 && value.items.every(item => item && typeof item.id === 'string' && item.id.length <= 100 && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 200 && ['film', 'series'].includes(item.type) && ['watchlist', 'watching', 'watched'].includes(item.status) && (item.year === null || (Number.isInteger(Number(item.year)) && Number(item.year) >= 1870 && Number(item.year) <= 2200)) && Number.isFinite(Number(item.rating)) && Number(item.rating) >= 0 && Number(item.rating) <= 5 && typeof item.poster === 'string' && item.poster.length <= 2048 && (item.watchedAt === null || typeof item.watchedAt === 'string') && (item.firstWatchedAt === undefined || item.firstWatchedAt === null || /^\d{4}-\d{2}-\d{2}$/.test(item.firstWatchedAt)) && (item.season === undefined || item.season === null || (Number.isInteger(item.season) && item.season > 0 && item.season <= 1000)) && (item.episode === undefined || item.episode === null || (Number.isInteger(item.episode) && item.episode > 0 && item.episode <= 10000)) && (item.watchedDates === undefined || (Array.isArray(item.watchedDates) && item.watchedDates.length <= 500 && item.watchedDates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))) && Number.isFinite(Number(item.addedAt)));
  return name === 'recap.json' && (value.lastOpened === null || typeof value.lastOpened === 'object') && Array.isArray(value.recent) && value.gameStats && typeof value.gameStats === 'object';
}
async function readValid(file, name) { try { const value = JSON.parse(await readFile(file, 'utf8')); return validData(name, value) ? value : null; } catch { return null; } }
async function backupData(force = false) {
  const backupRoot = path.join(dataDir, 'backups'); await mkdir(backupRoot, { recursive: true });
  const dirs = (await readdir(backupRoot, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort().reverse();
  if (!force && dirs.length && Date.now() - (await stat(path.join(backupRoot, dirs[0]))).mtimeMs < 24 * 60 * 60 * 1000) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), destination = path.join(backupRoot, stamp); await mkdir(destination, { recursive: true });
  for (const name of DATA_FILES) { const source = path.join(dataDir, name); if (await exists(source)) await copyFile(source, path.join(destination, name)); }
  if (await exists(path.join(dataDir, 'meta.json'))) await copyFile(path.join(dataDir, 'meta.json'), path.join(destination, 'meta.json'));
  const sourceCovers = path.join(dataDir, 'covers'), backupCovers = path.join(destination, 'covers');
  try { await mkdir(backupCovers, { recursive: true }); for (const item of await readdir(sourceCovers)) await copyFile(path.join(sourceCovers, item), path.join(backupCovers, item)); } catch {}
  const all = (await readdir(backupRoot, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort().reverse();
  for (const old of all.slice(10)) await rm(path.join(backupRoot, old), { recursive: true, force: true });
}
async function recoverCorruptFiles() {
  const backupRoot = path.join(dataDir, 'backups'); let dirs = [];
  try { dirs = (await readdir(backupRoot, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort().reverse(); } catch {}
  const restored = [];
  for (const name of DATA_FILES) {
    const current = path.join(dataDir, name); if (!(await exists(current)) || await readValid(current, name)) continue;
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
  for (const name of DATA_FILES) if (bundle[name] !== undefined && bundle[name] !== null) await atomicJson(path.join(dataDir, name), bundle[name]);
  await atomicJson(path.join(dataDir, 'meta.json'), bundle.meta && typeof bundle.meta === 'object' && !Array.isArray(bundle.meta) ? bundle.meta : {});
  const coverDir = path.join(dataDir, 'covers'); await mkdir(coverDir, { recursive: true });
  for (const name of await readdir(coverDir)) if (IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) await rm(path.join(coverDir, name), { force: true });
  for (const file of bundle.covers) await writeFile(path.join(coverDir, file.name), Buffer.from(file.data, 'base64'));
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
  if (config?.envFilePath) process.env.GAME_TRACKER_ENV_FILE = config.envFilePath;
  else if (config?.botToken) await writeFile(path.join(dataDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
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
function createTray() {
  if (tray) return;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#07070a"/><circle cx="32" cy="32" r="19" fill="none" stroke="#f5f5f7" stroke-width="5"/><ellipse cx="32" cy="32" rx="28" ry="10" fill="none" stroke="#bdcaff" stroke-width="3" transform="rotate(-28 32 32)"/><circle cx="51" cy="18" r="4" fill="#e7ecff"/></svg>';
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Orbit — suivi de jeu actif');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Orbit', click: showLibrary },
    { type: 'separator' },
    { label: 'Quitter Orbit', click: () => app.quit() }
  ]));
  tray.on('click', showLibrary);
  tray.on('double-click', showLibrary);
}
function openLibrary({ hidden = false } = {}) {
  createTray();
  libraryWindow = new BrowserWindow({
    width: 1260, height: 900, minWidth: 720, minHeight: 560,
    backgroundColor: '#030304', autoHideMenuBar: true, title: 'orbit', show: false,
    webPreferences: { preload: path.join(here, 'desktop-preload.cjs'), contextIsolation: true, sandbox: true }
  });
  libraryWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^steam:\/\/run\/\d{1,10}\/?$/.test(url)) {
      void shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  libraryWindow.loadURL(`http://127.0.0.1:${appPort}/`);
  libraryWindow.once('ready-to-show', () => { if (!hidden && libraryWindow && !libraryWindow.isDestroyed()) libraryWindow.show(); });
  libraryWindow.on('minimize', event => { event.preventDefault(); libraryWindow?.hide(); });
  libraryWindow.on('close', event => {
    if (quitAfterFlush) return;
    event.preventDefault();
    libraryWindow?.hide();
  });
  libraryWindow.on('closed', () => { libraryWindow = null; });
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
    const answer = await dialog.showMessageBox(libraryWindow, { type: 'warning', buttons: ['Annuler', 'Importer'], defaultId: 0, cancelId: 0, title: 'Remplacer les données ?', message: 'L’import va remplacer les jeux, les réglages et le récapitulatif actuels.' });
    if (answer.response !== 1) return { ok: false, canceled: true };
    await backupData(true); await writeImportBundle(bundle); app.relaunch(); app.exit(0); return { ok: true, restarting: true };
  } catch (error) { return { ok: false, message: `Import impossible : ${error.message}` }; }
});
ipcMain.handle('data:restore', async () => {
  const backupRoot = path.join(dataDir, 'backups');
  const result = await dialog.showOpenDialog(libraryWindow, { title: 'Choisir un dossier de sauvegarde', defaultPath: backupRoot, properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const chosen = path.resolve(result.filePaths[0]), root = path.resolve(backupRoot) + path.sep;
  if (!chosen.startsWith(root)) return { ok: false, message: 'Choisis un dossier situé dans les sauvegardes Orbit.' };
  try {
    const docs = {}; for (const name of DATA_FILES) { docs[name] = await readValid(path.join(chosen, name), name); if (name !== 'cinema.json' && !docs[name]) return { ok: false, message: `La sauvegarde ne contient pas un fichier ${name} valide.` }; }
    const answer = await dialog.showMessageBox(libraryWindow, { type: 'warning', buttons: ['Annuler', 'Restaurer'], defaultId: 0, cancelId: 0, title: 'Restaurer cette sauvegarde ?', message: 'Les données actuelles seront remplacées. Une sauvegarde de l’état actuel sera créée avant la restauration.' });
    if (answer.response !== 1) return { ok: false, canceled: true };
    const bundle={...docs,meta:{}};try{bundle.meta=JSON.parse(await readFile(path.join(chosen,'meta.json'),'utf8'));}catch{};bundle.covers=[];try{for(const name of await readdir(path.join(chosen,'covers')))if(IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))bundle.covers.push({name,data:(await readFile(path.join(chosen,'covers',name))).toString('base64')});}catch{}
    await backupData(true); await writeImportBundle(bundle); app.relaunch(); app.exit(0); return { ok: true, restarting: true };
  } catch (error) { return { ok: false, message: `Restauration impossible : ${error.message}` }; }
});
function fromLibrary(event) {
  return !!libraryWindow && event.sender === libraryWindow.webContents && event.senderFrame === event.sender.mainFrame &&
    event.senderFrame.url.split('?')[0].split('#')[0] === 'http://127.0.0.1:'+appPort+'/';
}
ipcMain.handle('play:launch-steam', async (event, id) => {
  if (!fromLibrary(event) || !Number.isSafeInteger(id) || id<=0 || !installedSteamGames().some(g=>g.appId===id)) return {ok:false};
  try { await shell.openExternal('steam://run/'+id); return {ok:true}; } catch { return {ok:false}; }
});
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
    const flush = await fetch('http://127.0.0.1:'+appPort+'/api/flush',{method:'POST'});
    if (!flush.ok) throw Error('Enregistrement de la session impossible.');
    await backupData(true);
    const error = await shell.openPath(target);
    if (error) throw Error('Impossible d’ouvrir l’installateur.');
    app.quit();
    return {message:'Installation en cours.'};
  } catch (err) { return {message:err.message || 'Vérification impossible.'}; }
  finally { updateBusy=false; }
});

ipcMain.handle('data:open-folder', async () => { const folder = path.join(dataDir, 'backups'); await mkdir(folder, { recursive: true }); const message = await shell.openPath(folder); return message ? { ok: false, message } : { ok: true }; });

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  dataDir = app.getPath('userData');
  await seedData();
  const restored = await recoverCorruptFiles();
  await prepareDataFiles();
  const invalid = [];
  for (const name of DATA_FILES) if (!(await readValid(path.join(dataDir, name), name))) invalid.push(name);
  if (invalid.length) { dialog.showErrorBox('Données à protéger', `Orbit n’a pas trouvé de sauvegarde valide pour : ${invalid.join(', ')}. Le fichier abîmé est conservé. Rien ne sera écrasé. Contacte-moi avant de relancer l’app.`); app.quit(); return; }
  await backupData(true);
  backupTimer = setInterval(() => backupData(true).catch(() => {}), 24 * 60 * 60 * 1000);
  const configPath = path.join(dataDir, 'config.json');
  const envPathFile = path.join(dataDir, 'discord-env-path.txt');
  let config = {};
  try { if (await exists(configPath)) config = JSON.parse(await readFile(configPath, 'utf8')); } catch {}
  try { if (await exists(envPathFile)) config.envFilePath = (await readFile(envPathFile, 'utf8')).trim(); } catch {}
  if (config.botToken || config.envFilePath) {
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
  Promise.race([Promise.resolve(flush), new Promise(resolve => setTimeout(resolve, 2500))]).then(() => fetch(`http://127.0.0.1:${appPort}/api/flush`, { method: 'POST' })).catch(() => {}).finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
