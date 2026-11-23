import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { stableGameId } from '../orbit-library.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

async function waitForBridge(url, child) {
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

test('le centre de santé prévisualise, applique et annule sans perte', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'orbit-health-center-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await mkdir(path.join(dataDir, 'covers'), { recursive: true });

  const alphaId = stableGameId('Alpha');
  const betaId = stableGameId('Beta');
  const duplicateId = stableGameId('Doublon', 1);
  const orphanSessionId = crypto.randomUUID();
  const validSessionId = crypto.randomUUID();
  const now = Date.now();
  const alphaMeta = { title: 'Alpha', description: 'Fiche existante', playDetails: { kind: 'game' } };

  await writeFile(
    path.join(dataDir, 'library.json'),
    JSON.stringify({
      version: 2,
      schemaVersion: 2,
      games: [
        { id: alphaId, name: 'Alpha', n: 'Alpha', kind: 'game', s: 0, c: 0, m: 120, t: now - 1000 },
        { id: betaId, name: 'Beta', n: 'Beta', kind: 'game', s: 2, c: 0, m: 0, t: 0 },
        { id: duplicateId, name: 'Doublon', n: 'Doublon', kind: 'game', s: 2, c: 0, m: 0, t: 0 },
        { id: stableGameId('Doublon', 0), name: 'Doublon', n: 'Doublon', kind: 'game', s: 2, c: 0, m: 0, t: 0 }
      ],
      sessions: [
        {
          id: validSessionId,
          gameId: alphaId,
          game: 'Alpha',
          gameNameSnapshot: 'Alpha',
          start: now - 7200000,
          end: now - 3600000,
          durationMs: 3600000,
          source: 'manual'
        },
        {
          id: orphanSessionId,
          gameId: null,
          game: 'Jeu disparu',
          gameNameSnapshot: 'Jeu disparu',
          start: now - 1800000,
          end: now - 900000,
          durationMs: 900000,
          source: 'manual',
          orphan: true
        }
      ],
      favorites: [alphaId],
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
      _orphans: {
        'orphan-key': { title: 'Ancienne fiche', developers: ['Studio'], note: 'à rattacher' }
      },
      [alphaId]: alphaMeta
    }),
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
          addedAt: now
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

  const port = 41000 + Math.floor(Math.random() * 900);
  const token = 'health-center-token';
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
  const health = async () => (await fetch(base + '/api/health?refresh=1')).json();

  const initial = await waitForBridge(base, child);
  assert.equal(initial.data.schemaVersion, 2);
  assert.equal(initial.anomalies.orphanSessions, 1);
  assert.equal(initial.anomalies.orphanMeta, 1);
  assert.equal(initial.anomalies.gamesWithoutCover, 4);
  assert.equal(initial.anomalies.filmsWithoutPoster, 1);
  assert.equal(initial.anomalies.duplicateGames, 1);
  assert.equal(initial.anomalies.gamesWithoutKind, 0);
  assert.equal(initial.anomalies.items.duplicateGames[0].names.length, 2);
  assert.equal(initial.anomalies.items.orphanSessions[0].id, orphanSessionId);
  assert.equal(initial.anomalies.items.orphanMeta[0].key, 'orphan-key');

  const sessionPreview = await post('/api/health/preview', {
    type: 'orphanSessions',
    action: 'attach',
    ids: [orphanSessionId],
    targetGameId: alphaId
  });
  assert.equal(sessionPreview.response.status, 200);
  assert.equal(sessionPreview.data.changes.length, 1);
  assert.match(sessionPreview.data.changes[0].after, /Alpha/);

  const refused = await post('/api/health/apply', { id: sessionPreview.data.id });
  assert.equal(refused.response.status, 409);
  assert.equal(refused.data.requiresConfirmation, true);

  const sessionApplied = await post('/api/health/apply', { id: sessionPreview.data.id, confirm: true });
  assert.equal(sessionApplied.response.status, 200);
  let library = JSON.parse(await readFile(path.join(dataDir, 'library.json'), 'utf8'));
  let session = library.sessions.find((entry) => entry.id === orphanSessionId);
  assert.equal(session.gameId, alphaId);
  assert.equal(session.game, 'Alpha');
  assert.equal(session.orphan, undefined);
  assert.equal((await health()).anomalies.orphanSessions, 0);

  const sessionUndo = await post('/api/health/undo', { id: sessionApplied.data.undoId });
  assert.equal(sessionUndo.response.status, 200);
  library = JSON.parse(await readFile(path.join(dataDir, 'library.json'), 'utf8'));
  session = library.sessions.find((entry) => entry.id === orphanSessionId);
  assert.equal(session.gameId, null);
  assert.equal(session.game, 'Jeu disparu');
  assert.equal(session.orphan, true);
  assert.equal((await health()).anomalies.orphanSessions, 1);

  const metaPreview = await post('/api/health/preview', {
    type: 'orphanMeta',
    action: 'attach',
    keys: ['orphan-key'],
    targetGameId: alphaId
  });
  assert.equal(metaPreview.response.status, 200);
  assert.ok(metaPreview.data.warnings.some((warning) => warning.includes('Alpha')));

  const metaApplied = await post('/api/health/apply', { id: metaPreview.data.id, confirm: true });
  assert.equal(metaApplied.response.status, 200);
  let meta = JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf8'));
  assert.equal(meta._orphans['orphan-key'], undefined);
  assert.equal(meta[alphaId].description, 'Fiche existante');
  assert.equal(meta[alphaId].note, 'à rattacher');
  assert.equal(meta._archived.length, 1);
  assert.equal(meta._archived[0].reason, 'sante-rattachement');

  const metaUndo = await post('/api/health/undo', { id: metaApplied.data.undoId });
  assert.equal(metaUndo.response.status, 200);
  meta = JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf8'));
  assert.deepEqual(meta[alphaId], alphaMeta);
  assert.equal(meta._orphans['orphan-key'].title, 'Ancienne fiche');
  assert.equal(meta._archived, undefined);

  const archiveRefused = await post('/api/health/preview', {
    type: 'orphanMeta',
    action: 'archive',
    keys: ['orphan-key'],
    reason: 'x'
  });
  assert.equal(archiveRefused.response.status, 400);

  const archivePreview = await post('/api/health/preview', {
    type: 'orphanMeta',
    action: 'archive',
    keys: ['orphan-key'],
    reason: 'Fiche vérifiée comme obsolète'
  });
  assert.equal(archivePreview.response.status, 200);
  const archiveApplied = await post('/api/health/apply', { id: archivePreview.data.id, confirm: true });
  assert.equal(archiveApplied.response.status, 200);
  meta = JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf8'));
  assert.equal(meta._orphans['orphan-key'], undefined);
  assert.equal(meta._archived[0].reason, 'sante-archivage-manuel');
  assert.equal(meta._archived[0].note, 'Fiche vérifiée comme obsolète');
  const archiveUndo = await post('/api/health/undo', { id: archiveApplied.data.undoId });
  assert.equal(archiveUndo.response.status, 200);
  meta = JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf8'));
  assert.equal(meta._orphans['orphan-key'].title, 'Ancienne fiche');

  const ignore = await post('/api/health/ignore', {
    type: 'orphanSessions',
    target: orphanSessionId,
    reason: 'Faux positif vérifié'
  });
  assert.equal(ignore.response.status, 200);
  let ignored = await health();
  assert.equal(ignored.anomalies.orphanSessions, 0);
  assert.equal(ignored.anomalies.ignoredTotal, 1);
  const ignoredItem = ignored.anomalies.items.orphanSessions.find((entry) => entry.target === orphanSessionId);
  assert.equal(ignoredItem.ignored, true);
  assert.equal(ignoredItem.ignoreReason, 'Faux positif vérifié');
  const unignore = await post('/api/health/unignore', { id: ignore.data.id });
  assert.equal(unignore.response.status, 200);
  ignored = await health();
  assert.equal(ignored.anomalies.orphanSessions, 1);
  assert.equal(ignored.anomalies.ignoredTotal, 0);

  const kindPreview = await post('/api/health/preview', {
    type: 'gamesWithoutKind',
    action: 'classify',
    ids: [alphaId],
    kind: 'app'
  });
  assert.equal(kindPreview.response.status, 200);
  const kindApplied = await post('/api/health/apply', { id: kindPreview.data.id, confirm: true });
  assert.equal(kindApplied.response.status, 200);
  library = JSON.parse(await readFile(path.join(dataDir, 'library.json'), 'utf8'));
  meta = JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf8'));
  assert.equal(library.games.find((game) => game.id === alphaId).kind, 'app');
  assert.equal(meta[alphaId].playDetails.kind, 'app');
  const kindUndo = await post('/api/health/undo', { id: kindApplied.data.undoId });
  assert.equal(kindUndo.response.status, 200);
  library = JSON.parse(await readFile(path.join(dataDir, 'library.json'), 'utf8'));
  meta = JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf8'));
  assert.equal(library.games.find((game) => game.id === alphaId).kind, 'game');
  assert.deepEqual(meta[alphaId], alphaMeta);

  const csv = await fetch(base + '/api/health/export?format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /orbit-sante-.*\.csv/);
  const csvBytes = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csvText = new TextDecoder('utf-8').decode(csvBytes);
  assert.match(csvText, /Sessions orphelines/);
  assert.match(csvText, /Justification/);

  const exported = await fetch(base + '/api/health/export?format=json');
  assert.equal(exported.status, 200);
  const exportedData = await exported.json();
  assert.equal(exportedData.exportFormat, 'orbit-health-v1');
  assert.equal(exportedData.anomalies.items.orphanSessions.length, 1);
  assert.ok(!/health-center-token/.test(JSON.stringify(exportedData)));
});
