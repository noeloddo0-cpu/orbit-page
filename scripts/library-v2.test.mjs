import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { legacyMetaKey, stableGameId } from '../orbit-library.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
const BRIDGE_TOKEN = 'library-v2-test-token';

function jpeg(width, height) {
  const bytes = Buffer.alloc(23);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  bytes.set([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9], 11);
  return bytes;
}

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'orbit-v2-'));
  await mkdir(path.join(dataDir, 'covers'), { recursive: true });
  const hadesId = stableGameId('Hades');
  const portalId = stableGameId('Portal 2');
  const now = Date.now();
  const sessions = [
    {
      id: 'session-hades-1',
      gameId: hadesId,
      game: 'Hades',
      gameNameSnapshot: 'Hades',
      start: now - 7200000,
      end: now - 3600000,
      durationMs: 3600000,
      minutes: 60,
      source: 'manual',
      note: 'session conservée',
      revision: 1,
      createdAt: now - 7200000,
      updatedAt: now - 3600000
    }
  ];
  const library = {
    version: 2,
    schemaVersion: 2,
    games: [
      {
        id: hadesId,
        name: 'Hades',
        n: 'Hades',
        kind: 'game',
        status: 0,
        s: 0,
        completion: 0,
        c: 0,
        minutes: 120,
        m: 120,
        manualDelta: 0,
        firstPlayedAt: 0,
        firstPlayed: 0,
        lastPlayedAt: 0,
        t: 0,
        rating: 0,
        review: '',
        tags: [],
        platforms: [],
        ownership: '',
        createdAt: now,
        updatedAt: now
      },
      {
        id: portalId,
        name: 'Portal 2',
        n: 'Portal 2',
        kind: 'game',
        status: 2,
        s: 2,
        completion: 0,
        c: 0,
        minutes: 0,
        m: 0,
        manualDelta: 0,
        firstPlayedAt: 0,
        firstPlayed: 0,
        lastPlayedAt: 0,
        t: 0,
        rating: 0,
        review: '',
        tags: [],
        platforms: [],
        ownership: '',
        createdAt: now,
        updatedAt: now
      }
    ],
    sessions,
    deletedSessions: [],
    deletedGames: [],
    favorites: [hadesId],
    favoriteOrphans: [],
    profiles: [{ id: 'main', name: 'Profil principal' }],
    activeProfileId: 'main',
    migratedAt: now,
    migratedFrom: 1
  };
  const meta = {
    _schema: 2,
    _aliases: { [legacyMetaKey('Hades')]: hadesId, [legacyMetaKey('Portal 2')]: portalId },
    _orphans: {},
    [hadesId]: {
      title: 'Hades',
      description: 'Fiche conservée après renommage.',
      checkedAt: now,
      artwork: { wide: { f: 'hades.jpg', v: 1 }, tall: { f: 'hades.png', v: 1 } },
      playDetails: { kind: 'game', rating: 4, collections: ['Favoris'], platforms: [], note: 'à garder' }
    },
    [portalId]: {
      title: 'Portal 2',
      description: 'Autre fiche.',
      checkedAt: now,
      playDetails: { kind: 'game', rating: 0, collections: [], platforms: [] }
    }
  };
  await writeFile(path.join(dataDir, 'library.json'), JSON.stringify(library, null, 2), 'utf8');
  await writeFile(path.join(dataDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ version: 1 }), 'utf8');
  await writeFile(path.join(dataDir, 'recap.json'), JSON.stringify({ version: 1 }), 'utf8');
  await writeFile(path.join(dataDir, 'cinema.json'), JSON.stringify({ version: 1, items: [] }), 'utf8');
  await writeFile(path.join(dataDir, 'covers', 'hades.jpg'), jpeg(920, 430));
  await writeFile(path.join(dataDir, 'covers', 'hades.png'), jpeg(600, 900));
  return { dataDir, hadesId, portalId };
}

async function start(dataDir) {
  const port = 43000 + Math.floor(Math.random() * 1200);
  const child = spawn(process.execPath, [path.join(root, 'bridge.js')], {
    cwd: root,
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      GAME_TRACKER_DATA_DIR: dataDir,
      GAME_TRACKER_ASSET_DIR: root,
      ORBIT_LOG_CONSOLE: '0',
      ORBIT_BRIDGE_TOKEN: BRIDGE_TOKEN
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  child.stdout.on('data', chunk => {
    stderr += chunk;
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Le pont s’est arrêté (${child.exitCode}) : ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return { port, child, stop: () => stop(child) };
    } catch {}
    await sleep(120);
  }
  throw new Error(`Le pont ne répond pas : ${stderr}`);
}

function stop(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      resolve();
    }, 1500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function api(port) {
  return async (method, target, body) => {
    const headers = { 'X-Orbit-Token': BRIDGE_TOKEN };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${port}${target}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data };
  };
}

test('renommer, favoriser, supprimer et restaurer un jeu v2 conserve ses données', async t => {
  const { dataDir, hadesId, portalId } = await fixture();
  let server = await start(dataDir);
  t.after(async () => {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = await api(server.port);

  let state = await request('GET', '/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.schemaVersion, 2);
  assert.equal(state.data.games.length, 2);
  assert.deepEqual(state.data.favorites, [hadesId]);
  assert.equal(state.data.covers.hades.f, 'hades.jpg');
  assert.equal(state.data.steamCovers.hades.f, 'hades.png');

  const renamed = await request('PATCH', `/api/v1/games/${hadesId}`, { name: 'Hades II' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.game.name, 'Hades II');
  assert.equal(renamed.data.game.id, hadesId);

  state = await request('GET', '/api/state');
  const hades = state.data.games.find(game => game.id === hadesId);
  assert.equal(hades.name, 'Hades II');
  assert.equal(state.data.sessions[0].game, 'Hades II');
  assert.equal(state.data.sessions[0].gameNameSnapshot, 'Hades');
  assert.ok(state.data.favorites.includes(hadesId));
  assert.equal(state.data.covers['hades ii'].f, 'hades.jpg');
  assert.equal(state.data.playDetails['hades ii'].rating, 4);

  const meta = await request('GET', `/api/meta?name=Hades%20II&gameId=${encodeURIComponent(hadesId)}`);
  assert.equal(meta.status, 200);
  assert.equal(meta.data.description, 'Fiche conservée après renommage.');
  assert.equal(meta.data.artwork.wide.f, 'hades.jpg');
  assert.equal(meta.data.playDetails.rating, 4);
  assert.deepEqual(meta.data.previousTitles, ['Hades'], 'le titre historique reste conservé');

  const duplicate = await request('PATCH', `/api/v1/games/${portalId}`, { name: 'Hades II' });
  assert.equal(duplicate.status, 409);

  const created = await request('POST', '/api/v1/sessions', {
    gameId: hadesId,
    start: Date.now() - 600000,
    durationMs: 600000,
    source: 'manual'
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.session.game, 'Hades II');
  assert.equal(created.data.session.gameId, hadesId);
  assert.ok(created.data.session.createdAt > 0);
  const createdId = created.data.session.id;

  assert.equal((await request('DELETE', `/api/v1/games/${hadesId}/favorite`)).status, 200);
  state = await request('GET', '/api/state');
  assert.deepEqual(state.data.favorites, []);
  assert.equal((await request('PUT', `/api/v1/games/${hadesId}/favorite`)).status, 200);
  state = await request('GET', '/api/state');
  assert.deepEqual(state.data.favorites, [hadesId]);

  const removed = await request('DELETE', `/api/v1/games/${hadesId}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.data.restorable, true);
  state = await request('GET', '/api/state');
  assert.equal(state.data.games.some(game => game.id === hadesId), false);
  assert.deepEqual(state.data.favorites, []);
  assert.equal(state.data.sessions.some(session => session.gameId === hadesId), true);

  const restored = await request('POST', `/api/v1/games/${hadesId}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.data.game.id, hadesId);
  assert.equal(restored.data.game.name, 'Hades II');
  state = await request('GET', '/api/state');
  assert.equal(state.data.games.filter(game => game.id === hadesId).length, 1);
  assert.equal(state.data.games.filter(game => game.name === 'Hades II').length, 1);
  assert.deepEqual(state.data.favorites, [hadesId]);
  assert.equal(state.data.sessions.find(session => session.id === createdId).game, 'Hades II');

  const stalePut = await request('PUT', '/api/state', {
    games: [{ id: portalId, name: 'Portal 2', s: 2, c: 0, m: 0 }],
    sessions: [],
    favorites: [portalId],
    profiles: [{ id: 'main', name: 'Profil principal' }],
    activeProfileId: 'main'
  });
  assert.equal(stalePut.status, 200);
  state = await request('GET', '/api/state');
  assert.equal(state.data.games.some(game => game.id === hadesId), true, 'un PUT partiel ne supprime pas un jeu');
  assert.equal(state.data.games.some(game => game.id === portalId), true);
  assert.deepEqual(state.data.favorites.sort(), [hadesId, portalId].sort(), 'les favoris sont fusionnés');
  assert.equal(state.data.sessions.length, 2, 'les sessions absentes du PUT restent présentes');

  assert.equal((await request('DELETE', `/api/v1/games/${hadesId}`)).status, 200);
  await server.stop();
  server = await start(dataDir);
  const restarted = await api(server.port);

  await restarted('PUT', '/api/state', {
    games: [
      { id: hadesId, name: 'Hades II', s: 0, c: 0, m: 120 },
      { id: portalId, name: 'Portal 2', s: 2, c: 0, m: 0 }
    ],
    sessions: [],
    favorites: [hadesId],
    profiles: [{ id: 'main', name: 'Profil principal' }],
    activeProfileId: 'main'
  });
  const afterRestart = await restarted('GET', '/api/state');
  assert.equal(afterRestart.data.games.some(game => game.id === hadesId), false, 'un client en retard ne ressuscite pas un jeu supprimé');
  assert.equal(afterRestart.data.sessions.some(session => session.id === createdId), true);
  assert.equal(afterRestart.data.favorites.includes(hadesId), false);

  const stillThere = await readFile(path.join(dataDir, 'library.json'), 'utf8');
  assert.equal(JSON.parse(stillThere).version, 2);
});
