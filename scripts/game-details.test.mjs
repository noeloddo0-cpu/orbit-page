import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { stableGameId } from '../orbit-library.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const TOKEN = 'game-details-token';

async function waitForBridge(base, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Le pont s’est arrêté avec le code ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/state`);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('Le pont ne répond pas');
}

async function startBridge(dataDir) {
  const port = 44500 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, [path.join(root, 'bridge.js')], {
    cwd: root,
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      GAME_TRACKER_DATA_DIR: dataDir,
      GAME_TRACKER_ASSET_DIR: root,
      ORBIT_BRIDGE_TOKEN: TOKEN,
      ORBIT_LOG_CONSOLE: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForBridge(base, child);
  return {
    child,
    base,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        try {
          child.kill();
        } catch {
          resolve();
        }
        setTimeout(resolve, 3000).unref?.();
      })
  };
}

test('la fiche jeu expose l’édition complète, le focus et la lecture seule', async () => {
  const html = await readFile(path.join(root, 'bibliotheque.html'), 'utf8');
  for (const id of [
    'p-copy-title',
    'p-readonly',
    'p-details',
    'p-detail-list',
    'p-personal-note',
    'p-kind',
    'p-rating-input',
    'p-ownership',
    'p-format',
    'p-store',
    'p-purchase-date',
    'p-start-date',
    'p-end-date',
    'p-import-h',
    'p-import-m',
    'p-tags-input',
    'p-platforms-input',
    'p-review-input',
    'p-note-input',
    'p-save',
    'p-cancel',
    'p-save-state',
    'p-format-list',
    'p-store-list'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `élément ${id} manquant`);
  }
  for (const marker of [
    'savePanelEdits',
    'requestClosePanel',
    'trapPanelFocus',
    'setPanelBackgroundInert',
    'panelReadOnly',
    'Mode lecture seule',
    '/api/v1/games/',
    'Enregistrer la fiche',
    'Modifications non enregistrées'
  ]) {
    assert.ok(html.includes(marker), `marqueur ${marker} manquant`);
  }
  assert.match(
    html,
    /<aside id="panel"[^>]*tabindex="-1"[^>]*inert/,
    'le panneau doit rester adressable et inerte quand il est fermé'
  );
  assert.match(html, /aria-modal="true"[^>]*inert/, 'le panneau fermé doit être inerte');
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (script.trim()) new Script(script, { filename: 'bibliotheque.html' });
  }
});

test('la fiche jeu enregistre, recharge et valide tous ses champs', { timeout: 45000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'orbit-game-details-'));
  await mkdir(path.join(dataDir, 'covers'), { recursive: true });
  const now = Date.now();
  const gameId = stableGameId('Fiche complète');
  const game = {
    id: gameId,
    name: 'Fiche complète',
    n: 'Fiche complète',
    kind: 'game',
    status: 0,
    s: 0,
    completion: 0,
    c: 0,
    minutes: 0,
    m: 0,
    manualDelta: 0,
    firstPlayedAt: 0,
    firstPlayed: 0,
    lastPlayedAt: 0,
    t: 0,
    createdAt: now - 5000,
    updatedAt: now - 5000
  };
  const session = {
    id: 'session-fiche-1',
    gameId,
    game: game.name,
    gameNameSnapshot: game.name,
    start: now - 3600000,
    end: now - 1800000,
    durationMs: 1800000,
    minutes: 30,
    source: 'manual',
    createdAt: now - 3600000,
    updatedAt: now - 1800000
  };
  await writeFile(
    path.join(dataDir, 'library.json'),
    JSON.stringify({
      version: 2,
      schemaVersion: 2,
      games: [game],
      sessions: [session],
      deletedSessions: [],
      deletedGames: [],
      favorites: [gameId],
      favoriteOrphans: [],
      profiles: [{ id: 'main', name: 'Profil principal' }],
      activeProfileId: 'main'
    }),
    'utf8'
  );
  await writeFile(
    path.join(dataDir, 'meta.json'),
    JSON.stringify({
      _schema: 2,
      _aliases: {},
      _orphans: {},
      [gameId]: {
        title: game.name,
        description: 'Fiche existante.',
        playDetails: {
          kind: 'game',
          note: 'Ancienne note personnelle',
          collections: ['Ancien tag'],
          platforms: ['PC'],
          rating: 3,
          review: 'Ancienne critique'
        }
      }
    }),
    'utf8'
  );
  await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ version: 1 }), 'utf8');
  await writeFile(path.join(dataDir, 'recap.json'), JSON.stringify({ version: 1 }), 'utf8');
  await writeFile(path.join(dataDir, 'cinema.json'), JSON.stringify({ version: 1, items: [] }), 'utf8');

  let server = await startBridge(dataDir);
  t.after(async () => {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  const headers = { 'Content-Type': 'application/json', 'X-Orbit-Token': TOKEN };
  const request = async (method, target, body) => {
    const response = await fetch(server.base + target, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
  const readLibrary = async () => JSON.parse(await readFile(path.join(dataDir, 'library.json'), 'utf8'));
  const readMeta = async () => JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf8'));

  const initial = await request('GET', '/api/state');
  assert.equal(initial.status, 200);
  assert.equal(
    initial.data.playDetails['fiche complete'].rating,
    3,
    'le repli playDetails reste lisible avant migration'
  );

  const saved = await request('PATCH', `/api/v1/games/${gameId}`, {
    kind: 'game',
    status: 4,
    completion: 2,
    rating: 4.5,
    review: '  Critique enregistrée.  ',
    tags: [' Coop ', 'Rétro', 'Coop'],
    platforms: ['PC', 'Steam Deck'],
    ownership: 'physique',
    format: 'Disque',
    store: 'Fnac',
    purchaseDate: '2024-02-29',
    startDate: '2024-03-01',
    endDate: '2024-04-05',
    minutes: 615,
    importedMinutes: 120,
    personalNote: '  Note personnelle enregistrée.  '
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.game.id, gameId);
  for (const [key, value] of Object.entries({
    kind: 'game',
    status: 4,
    completion: 2,
    rating: 4.5,
    review: 'Critique enregistrée.',
    tags: ['Coop', 'Rétro'],
    platforms: ['PC', 'Steam Deck'],
    ownership: 'physique',
    format: 'Disque',
    store: 'Fnac',
    purchaseDate: '2024-02-29',
    startDate: '2024-03-01',
    endDate: '2024-04-05',
    minutes: 615,
    m: 615,
    importedMinutes: 120,
    personalNote: 'Note personnelle enregistrée.'
  })) {
    assert.deepEqual(saved.data.game[key], value, `champ ${key} dans la réponse`);
  }
  assert.equal(saved.data.game.manualDelta, 615);

  let library = await readLibrary();
  let stored = library.games.find((entry) => entry.id === gameId);
  for (const [key, value] of Object.entries({
    rating: 4.5,
    review: 'Critique enregistrée.',
    tags: ['Coop', 'Rétro'],
    platforms: ['PC', 'Steam Deck'],
    ownership: 'physique',
    format: 'Disque',
    store: 'Fnac',
    purchaseDate: '2024-02-29',
    startDate: '2024-03-01',
    endDate: '2024-04-05',
    importedMinutes: 120,
    personalNote: 'Note personnelle enregistrée.'
  })) {
    assert.deepEqual(stored[key], value, `champ ${key} dans library.json`);
  }
  assert.equal(stored.manualDelta, 615, 'le temps total met à jour manualDelta');
  assert.equal(library.sessions.length, 1);
  assert.deepEqual(library.favorites, [gameId]);

  let meta = await readMeta();
  assert.equal(meta[gameId].playDetails.rating, 4.5);
  assert.equal(meta[gameId].playDetails.review, 'Critique enregistrée.');
  assert.deepEqual(meta[gameId].playDetails.collections, ['Coop', 'Rétro']);
  assert.deepEqual(meta[gameId].playDetails.platforms, ['PC', 'Steam Deck']);
  assert.equal(meta[gameId].playDetails.note, 'Note personnelle enregistrée.');

  let state = await request('GET', '/api/state');
  let detail = state.data.playDetails['fiche complete'];
  assert.equal(detail.rating, 4.5);
  assert.deepEqual(detail.collections, ['Coop', 'Rétro']);
  assert.equal(detail.note, 'Note personnelle enregistrée.');

  await server.stop();
  server = await startBridge(dataDir);
  state = await request('GET', '/api/state');
  stored = state.data.games.find((entry) => entry.id === gameId);
  for (const [key, value] of Object.entries({
    rating: 4.5,
    review: 'Critique enregistrée.',
    tags: ['Coop', 'Rétro'],
    platforms: ['PC', 'Steam Deck'],
    ownership: 'physique',
    format: 'Disque',
    store: 'Fnac',
    purchaseDate: '2024-02-29',
    startDate: '2024-03-01',
    endDate: '2024-04-05',
    importedMinutes: 120,
    personalNote: 'Note personnelle enregistrée.'
  })) {
    assert.deepEqual(stored[key], value, `champ ${key} après redémarrage`);
  }
  assert.equal(state.data.playDetails['fiche complete'].rating, 4.5, 'playDetails rechargé après redémarrage');
  assert.equal(state.data.sessions.length, 1);
  assert.deepEqual(state.data.favorites, [gameId]);

  const beforeInvalid = await readLibrary();
  const invalids = [
    [{ rating: 7 }, 400, 'note invalide'],
    [{ tags: Array.from({ length: 21 }, (_, index) => `Tag ${index}`) }, 400, '20 noms maximum'],
    [{ purchaseDate: '2024-02-30' }, 400, 'date d’achat invalide'],
    [{ startDate: '2024-05-01', endDate: '2024-04-01' }, 400, 'date de fin'],
    [{ importedMinutes: -1 }, 400, 'temps importé invalide'],
    [{ personalNote: 42 }, 400, 'note personnelle invalide']
  ];
  for (const [body, status, message] of invalids) {
    const invalid = await request('PATCH', `/api/v1/games/${gameId}`, body);
    assert.equal(invalid.status, status, `validation ${JSON.stringify(body)}`);
    assert.match(invalid.data.error, new RegExp(message));
  }
  const afterInvalid = await readLibrary();
  const withoutTimestamp = (entry) => ({ ...entry, updatedAt: 0 });
  assert.deepEqual(
    afterInvalid.games.map(withoutTimestamp),
    beforeInvalid.games.map(withoutTimestamp),
    'aucune modification après une requête invalide'
  );
  assert.deepEqual(
    afterInvalid.sessions,
    beforeInvalid.sessions,
    'les sessions restent intactes après une requête invalide'
  );
  assert.deepEqual(
    afterInvalid.favorites,
    beforeInvalid.favorites,
    'les favoris restent intacts après une requête invalide'
  );

  const missing = await request('PATCH', '/api/v1/games/00000000-0000-5000-8000-000000000000', { rating: 2 });
  assert.equal(missing.status, 404);

  const orbitPlay = await request('PATCH', '/api/play/details', {
    gameId,
    details: {
      kind: 'app',
      note: 'Note Orbit Play',
      collections: ['Arcade'],
      platforms: ['PC'],
      rating: 3,
      review: 'Critique Orbit Play'
    }
  });
  assert.equal(orbitPlay.status, 200);
  library = await readLibrary();
  stored = library.games.find((entry) => entry.id === gameId);
  assert.equal(stored.kind, 'app');
  assert.equal(stored.rating, 3);
  assert.equal(stored.review, 'Critique Orbit Play');
  assert.deepEqual(stored.tags, ['Arcade']);
  assert.deepEqual(stored.platforms, ['PC']);
  assert.equal(stored.personalNote, 'Note Orbit Play');
  meta = await readMeta();
  assert.equal(meta[gameId].playDetails.note, 'Note Orbit Play');
  assert.deepEqual(meta[gameId].playDetails.collections, ['Arcade']);

  state = await request('GET', '/api/state');
  const gamesPayload = state.data.games.map((entry) => ({
    ...entry,
    personalNote: 'Note via état complet',
    ownership: 'numerique',
    importedMinutes: 33
  }));
  const pushed = await request('PUT', '/api/state', {
    games: gamesPayload,
    sessions: state.data.sessions,
    favorites: state.data.favorites
  });
  assert.equal(pushed.status, 200);
  library = await readLibrary();
  stored = library.games.find((entry) => entry.id === gameId);
  assert.equal(stored.personalNote, 'Note via état complet');
  assert.equal(stored.ownership, 'numerique');
  assert.equal(stored.importedMinutes, 33);
  assert.equal(stored.rating, 3, 'PUT /api/state conserve la note');
  assert.deepEqual(stored.tags, ['Arcade']);
  assert.equal(stored.format, 'Disque', 'PUT /api/state conserve le format');

  const cleared = await request('PATCH', `/api/v1/games/${gameId}`, {
    rating: 0,
    review: '',
    tags: [],
    platforms: [],
    ownership: '',
    format: '',
    store: '',
    purchaseDate: '',
    startDate: '',
    endDate: '',
    importedMinutes: 0,
    personalNote: ''
  });
  assert.equal(cleared.status, 200);
  library = await readLibrary();
  stored = library.games.find((entry) => entry.id === gameId);
  for (const key of [
    'rating',
    'review',
    'tags',
    'platforms',
    'ownership',
    'format',
    'store',
    'purchaseDate',
    'startDate',
    'endDate',
    'importedMinutes',
    'personalNote'
  ]) {
    assert.deepEqual(
      stored[key],
      key === 'rating' || key === 'importedMinutes' ? 0 : key === 'tags' || key === 'platforms' ? [] : '',
      `champ ${key} effacé`
    );
  }
  meta = await readMeta();
  assert.deepEqual(meta[gameId].playDetails.collections, []);
  assert.equal(meta[gameId].playDetails.note, '');
  assert.equal(meta[gameId].playDetails.rating, 0);

  await server.stop();
  server = await startBridge(dataDir);
  state = await request('GET', '/api/state');
  stored = state.data.games.find((entry) => entry.id === gameId);
  assert.equal(stored.personalNote, '', 'un effacement ne reprend pas l’ancienne note après redémarrage');
  assert.equal(stored.rating, 0, 'un effacement ne reprend pas l’ancienne note après redémarrage');
  assert.deepEqual(stored.tags, [], 'un effacement ne reprend pas les anciens tags après redémarrage');
  assert.equal(state.data.playDetails['fiche complete'].note, '');
  assert.equal(state.data.playDetails['fiche complete'].rating, 0);
  assert.deepEqual(state.data.playDetails['fiche complete'].collections, []);

  const renamed = await request('PATCH', `/api/v1/games/${gameId}`, { name: 'Fiche renommée' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.game.id, gameId);
  state = await request('GET', '/api/state');
  stored = state.data.games.find((entry) => entry.id === gameId);
  assert.equal(stored.name, 'Fiche renommée');
  assert.equal(stored.rating, 0, 'le renommage ne perd pas les champs de la fiche');
  assert.equal(state.data.sessions[0].game, 'Fiche renommée');
  assert.deepEqual(state.data.favorites, [gameId]);
  meta = await readMeta();
  assert.ok(Array.isArray(meta[gameId].previousTitles) && meta[gameId].previousTitles.includes('Fiche complète'));
});
