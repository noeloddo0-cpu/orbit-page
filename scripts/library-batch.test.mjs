import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { stableGameId } from '../orbit-library.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

async function waitForBridge(url, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Le pont s’est arrêté avec le code ${child.exitCode}`);
    try {
      const response = await fetch(url + '/api/state');
      if (response.ok) return await response.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('Le pont ne répond pas');
}

test('l’interface P1-02 expose la sélection, les actions et les vues', async () => {
  const html = await readFile(path.join(root, 'bibliotheque.html'), 'utf8');
  for (const id of [
    'select-mode',
    'selection-bar',
    'selection-count',
    'selection-all',
    'bulk-status',
    'bulk-completion',
    'bulk-kind',
    'bulk-tags',
    'bulk-platforms',
    'bulk-favorite',
    'bulk-delete',
    'bulk-delete-dialog',
    'bulk-edit-dialog',
    'batch-undo',
    'views-toggle',
    'views-items',
    'view-dialog',
    'filter-summary',
    'active-filters',
    'results-count',
    'library-live',
    'type'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `élément ${id} manquant`);
  }
  assert.match(html, /\.tile-select\s*\{/);
  assert.match(html, /\.selection-bar\s*\{/);
  for (const marker of [
    '/api/v1/games/batch',
    '/api/v1/games/batch/undo',
    'selectionMode',
    'openBulkDelete',
    'showBatchUndo',
    'afterFilterChange',
    'libraryFilters',
    'libraryViews',
    'Ctrl'
  ]) {
    assert.ok(html.includes(marker), `marqueur ${marker} manquant`);
  }
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (script.trim()) new Script(script, { filename: 'bibliotheque.html' });
  }
});

test(
  'les lots modifient 50 jeux, s’annulent exactement et expirent après 10 secondes',
  { timeout: 30000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'orbit-library-batch-'));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    await mkdir(path.join(dataDir, 'covers'), { recursive: true });

    const now = Date.now();
    const games = Array.from({ length: 60 }, (_, index) => {
      const name = `Jeu lot ${index + 1}`;
      return {
        id: stableGameId(name),
        name,
        n: name,
        kind: 'game',
        status: index % 6,
        s: index % 6,
        completion: index % 3,
        c: index % 3,
        minutes: index * 15,
        m: index * 15,
        t: 0,
        createdAt: now - index
      };
    });
    const session = {
      id: crypto.randomUUID(),
      gameId: games[0].id,
      game: games[0].name,
      gameNameSnapshot: games[0].name,
      start: now - 3600000,
      end: now - 1800000,
      durationMs: 1800000,
      source: 'manual'
    };
    const favorites = [games[0].id, games[1].id];
    await writeFile(
      path.join(dataDir, 'library.json'),
      JSON.stringify({
        version: 2,
        schemaVersion: 2,
        games,
        sessions: [session],
        favorites,
        profiles: [{ id: 'main', name: 'Profil principal' }],
        activeProfileId: 'main'
      }),
      'utf8'
    );
    const metaBefore = {
      _schema: 2,
      _aliases: {},
      _orphans: {},
      [games[0].id]: { title: games[0].name, playDetails: { kind: 'game', collections: ['Existant'] } }
    };
    await writeFile(path.join(dataDir, 'meta.json'), JSON.stringify(metaBefore), 'utf8');
    await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ version: 1 }), 'utf8');
    await writeFile(path.join(dataDir, 'cinema.json'), JSON.stringify({ version: 1, items: [] }), 'utf8');
    await writeFile(
      path.join(dataDir, 'recap.json'),
      JSON.stringify({ version: 1, lastOpened: null, recent: [], gameStats: {} }),
      'utf8'
    );

    const port = 42000 + Math.floor(Math.random() * 800);
    const token = 'library-batch-token';
    const child = spawn(process.execPath, [path.join(root, 'bridge.js')], {
      cwd: root,
      env: {
        ...process.env,
        BRIDGE_PORT: String(port),
        GAME_TRACKER_DATA_DIR: dataDir,
        GAME_TRACKER_ASSET_DIR: root,
        ORBIT_BRIDGE_TOKEN: token,
        ORBIT_LOG_CONSOLE: '0'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(() => {
      try {
        child.kill();
      } catch {}
    });

    const base = `http://127.0.0.1:${port}`;
    const headers = { 'Content-Type': 'application/json', 'X-Orbit-Token': token };
    const post = async (target, body = {}) => {
      const response = await fetch(base + target, { method: 'POST', headers, body: JSON.stringify(body) });
      return { response, data: await response.json() };
    };
    const readLibrary = async () => JSON.parse(await readFile(path.join(dataDir, 'library.json'), 'utf8'));
    const readMeta = async () => JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf8'));

    const initial = await waitForBridge(base, child);
    assert.equal(initial.schemaVersion, 2);
    const beforeLibrary = await readLibrary();
    const beforeMeta = await readMeta();
    const ids = games.slice(0, 50).map((game) => game.id);

    const update = await post('/api/v1/games/batch', {
      action: 'update',
      ids,
      changes: {
        status: 4,
        completion: 2,
        kind: 'app',
        tags: ['Lot P1-02', 'Coop'],
        tagsMode: 'add',
        platforms: ['PC', 'Steam Deck'],
        platformsMode: 'add',
        favorite: true
      }
    });
    assert.equal(update.response.status, 200);
    assert.equal(update.data.changed, 50);
    assert.ok(update.data.undoId);
    assert.ok(update.data.undoExpiresAt - Date.now() <= 10000);

    let library = await readLibrary();
    let meta = await readMeta();
    for (const id of ids) {
      const game = library.games.find((entry) => entry.id === id);
      assert.equal(game.status, 4);
      assert.equal(game.completion, 2);
      assert.equal(game.kind, 'app');
      assert.deepEqual(game.tags, ['Lot P1-02', 'Coop']);
      assert.deepEqual(game.platforms, ['PC', 'Steam Deck']);
      assert.equal(meta[id].playDetails.kind, 'app');
      assert.deepEqual(meta[id].playDetails.collections, ['Lot P1-02', 'Coop']);
      assert.deepEqual(meta[id].playDetails.platforms, ['PC', 'Steam Deck']);
    }
    assert.equal(library.favorites.length, 50);
    assert.equal(library.sessions[0].gameId, games[0].id);

    const undo = await post('/api/v1/games/batch/undo', { id: update.data.undoId });
    assert.equal(undo.response.status, 200);
    assert.equal(undo.data.restored, 50);
    library = await readLibrary();
    meta = await readMeta();
    assert.deepEqual(library.games, beforeLibrary.games);
    assert.deepEqual(library.favorites, beforeLibrary.favorites);
    assert.deepEqual(
      library.sessions.map((entry) => ({
        id: entry.id,
        gameId: entry.gameId,
        start: entry.start,
        end: entry.end,
        durationMs: entry.durationMs
      })),
      beforeLibrary.sessions.map((entry) => ({
        id: entry.id,
        gameId: entry.gameId,
        start: entry.start,
        end: entry.end,
        durationMs: entry.durationMs
      }))
    );
    assert.deepEqual(meta, beforeMeta);

    const deleteIds = games.slice(3, 6).map((game) => game.id);
    const deletion = await post('/api/v1/games/batch', { action: 'delete', ids: deleteIds });
    assert.equal(deletion.response.status, 200);
    assert.equal(deletion.data.deleted, 3);
    library = await readLibrary();
    for (const id of deleteIds) {
      assert.equal(
        library.games.some((game) => game.id === id),
        false
      );
      assert.ok(library.deletedGames.some((entry) => entry.id === id));
    }
    assert.equal(library.sessions.length, beforeLibrary.sessions.length);

    const restore = await post('/api/v1/games/batch/undo', { id: deletion.data.undoId });
    assert.equal(restore.response.status, 200);
    library = await readLibrary();
    assert.deepEqual(library.games, beforeLibrary.games);
    assert.deepEqual(library.favorites, beforeLibrary.favorites);
    assert.deepEqual(library.deletedGames, beforeLibrary.deletedGames || []);

    const missing = await post('/api/v1/games/batch', { action: 'delete', ids: [crypto.randomUUID()] });
    assert.equal(missing.response.status, 404);
    assert.equal(missing.data.missing.length, 1);
    const unchanged = await readLibrary();
    assert.deepEqual(unchanged.games, beforeLibrary.games);
    assert.deepEqual(unchanged.favorites, beforeLibrary.favorites);
    assert.deepEqual(unchanged.deletedGames || [], beforeLibrary.deletedGames || []);
    assert.deepEqual(
      unchanged.sessions.map((entry) => entry.id),
      beforeLibrary.sessions.map((entry) => entry.id)
    );

    const empty = await post('/api/v1/games/batch', { action: 'update', ids: [], changes: { status: 0 } });
    assert.equal(empty.response.status, 400);
    const noChange = await post('/api/v1/games/batch', { action: 'update', ids: [games[0].id], changes: {} });
    assert.equal(noChange.response.status, 400);

    const expiring = await post('/api/v1/games/batch', {
      action: 'update',
      ids: [games[0].id],
      changes: { status: 3 }
    });
    assert.equal(expiring.response.status, 200);
    await sleep(10200);
    const expired = await post('/api/v1/games/batch/undo', { id: expiring.data.undoId });
    assert.equal(expired.response.status, 410);
    library = await readLibrary();
    assert.equal(library.games.find((game) => game.id === games[0].id).status, 3);
  }
);

test('les filtres et vues sauvegardées sont validés et rechargés', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'orbit-library-views-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(path.join(dataDir, 'covers'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'library.json'),
    JSON.stringify({
      version: 2,
      schemaVersion: 2,
      games: [],
      sessions: [],
      favorites: [],
      profiles: [{ id: 'main', name: 'Profil principal' }],
      activeProfileId: 'main'
    }),
    'utf8'
  );
  await writeFile(path.join(dataDir, 'meta.json'), JSON.stringify({ _schema: 2, _aliases: {}, _orphans: {} }), 'utf8');
  await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ version: 1 }), 'utf8');

  const port = 43000 + Math.floor(Math.random() * 800);
  const token = 'library-views-token';
  const child = spawn(process.execPath, [path.join(root, 'bridge.js')], {
    cwd: root,
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      GAME_TRACKER_DATA_DIR: dataDir,
      GAME_TRACKER_ASSET_DIR: root,
      ORBIT_BRIDGE_TOKEN: token,
      ORBIT_LOG_CONSOLE: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    try {
      child.kill();
    } catch {}
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForBridge(base, child);
  const headers = { 'Content-Type': 'application/json', 'X-Orbit-Token': token };

  const saved = await fetch(base + '/api/preferences', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      libraryFilters: { q: '  zelda  ', s: 3, c: '2', o: 'recent', fav: true, type: 'all' },
      libraryViews: [
        {
          id: 'vue-test',
          name: '  En cours PC  ',
          filter: { q: 'portal', s: 0, c: '', o: 'temps', fav: false, type: 'apps' },
          createdAt: 123
        },
        { id: 'vue-invalide', name: '   ', filter: {} }
      ]
    })
  });
  assert.equal(saved.status, 200);
  const settings = JSON.parse(await readFile(path.join(dataDir, 'settings.json'), 'utf8'));
  assert.deepEqual(settings.libraryFilters, { q: '  zelda  ', s: 3, c: '2', o: 'recent', fav: true, type: 'all' });
  assert.equal(settings.libraryViews.length, 1);
  assert.equal(settings.libraryViews[0].id, 'vue-test');
  assert.equal(settings.libraryViews[0].name, 'En cours PC');
  assert.deepEqual(settings.libraryViews[0].filter, { q: 'portal', s: 0, c: '', o: 'temps', fav: false, type: 'apps' });

  const page = await (await fetch(base + '/')).text();
  assert.match(page, /window\.__ORBIT_PREFERENCES=/);
  assert.match(page, /"libraryViews":/);
  assert.match(page, /"libraryFilters":/);
  assert.match(page, /En cours PC/);
  assert.match(page, /"type":"apps"/);
});
