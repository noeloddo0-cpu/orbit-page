import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

async function ready(url, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Le pont s’est arrêté avec le code ${child.exitCode}`);
    try {
      const response = await fetch(url + '/api/health');
      if (response.ok) return await response.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('Le pont ne répond pas');
}

test('le pont expose un rapport de santé sans secrets', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'orbit-health-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(path.join(dataDir, 'covers'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'library.json'),
    JSON.stringify({
      version: 1,
      games: [
        { n: 'Game One', s: 0, c: 0, m: 120 },
        { n: 'Game Two', s: 3, c: 2, m: 60 }
      ],
      sessions: [{ game: 'Jeu supprimé', start: Date.now() - 3600000, durationMs: 3600000 }],
      favorites: [],
      profiles: [{ id: 'main', name: 'Profil principal' }],
      activeProfileId: 'main'
    }),
    'utf8'
  );
  await writeFile(
    path.join(dataDir, 'meta.json'),
    JSON.stringify({ 'cle-orpheline': { title: 'Ancien jeu' } }),
    'utf8'
  );
  await writeFile(
    path.join(dataDir, 'cinema.json'),
    JSON.stringify({
      version: 1,
      items: [
        {
          id: 'film-1',
          title: 'Film sans affiche',
          type: 'film',
          status: 'watchlist',
          year: 2020,
          rating: 0,
          poster: '',
          addedAt: Date.now()
        },
        {
          id: 'serie-1',
          title: 'Série',
          type: 'series',
          status: 'watching',
          year: 2021,
          rating: 0,
          poster: 'https://example.com/p.jpg',
          season: 1,
          episode: 2,
          addedAt: Date.now()
        }
      ]
    }),
    'utf8'
  );
  await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ version: 1 }), 'utf8');
  await writeFile(
    path.join(dataDir, 'recap.json'),
    JSON.stringify({ version: 1, lastOpened: null, recent: [], gameStats: {} }),
    'utf8'
  );

  const port = 39000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, [path.join(root, 'bridge.js')], {
    cwd: root,
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      GAME_TRACKER_DATA_DIR: dataDir,
      GAME_TRACKER_ASSET_DIR: root,
      ORBIT_LOG_CONSOLE: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    try {
      child.kill();
    } catch {}
  });

  const health = await ready(`http://127.0.0.1:${port}`, child);
  const packageVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  assert.equal(health.app.version, packageVersion);
  assert.equal(health.data.games, 2);
  assert.equal(health.data.sessions, 1);
  assert.equal(health.data.films, 1);
  assert.equal(health.data.series, 1);
  assert.equal(health.anomalies.orphanSessions, 1);
  assert.equal(health.anomalies.orphanMeta, 1);
  assert.equal(health.anomalies.gamesWithoutCover, 2);
  assert.equal(health.anomalies.filmsWithoutPoster, 1);
  assert.equal(health.anomalies.gamesWithoutKind, 2);
  assert.equal(health.anomalies.sessionsWithoutId, 1);

  const diagnosticsResponse = await fetch(`http://127.0.0.1:${port}/api/diagnostics`);
  assert.equal(diagnosticsResponse.status, 200);
  const diagnostics = await diagnosticsResponse.json();
  assert.ok(Array.isArray(diagnostics.logs));
  assert.ok(diagnostics.logs.some((entry) => entry.message === 'Pont démarré'));
  const text = JSON.stringify(diagnostics);
  assert.ok(!/DISCORD_TOKEN|BOT_TOKEN|TMDB_API_KEY|super-secret/i.test(text));

  const stateResponse = await fetch(`http://127.0.0.1:${port}/api/state`);
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.games.length, 2);
  assert.equal(state.sessions.length, 1);
});
