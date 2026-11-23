import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
const BRIDGE_TOKEN = 'sessions-test-token';

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'orbit-sessions-'));
  await mkdir(path.join(dataDir, 'covers'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'library.json'),
    JSON.stringify({
      version: 1,
      games: [
        { n: 'Game One', s: 0, c: 0, m: 120, t: 0 },
        { n: 'Game Two', s: 0, c: 0, m: 0, t: 0 }
      ],
      sessions: [],
      favorites: [],
      profiles: [{ id: 'main', name: 'Profil principal' }],
      activeProfileId: 'main'
    }),
    'utf8'
  );
  await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ version: 1 }), 'utf8');
  await writeFile(path.join(dataDir, 'recap.json'), JSON.stringify({ version: 1 }), 'utf8');
  await writeFile(path.join(dataDir, 'cinema.json'), JSON.stringify({ version: 1, items: [] }), 'utf8');
  return dataDir;
}

async function start(dataDir) {
  const port = 42000 + Math.floor(Math.random() * 1200);
  const child = spawn(process.execPath, [path.join(root, 'bridge.js')], {
    cwd: root,
    env: { ...process.env, BRIDGE_PORT: String(port), GAME_TRACKER_DATA_DIR: dataDir, GAME_TRACKER_ASSET_DIR: root, ORBIT_LOG_CONSOLE: '0', ORBIT_BRIDGE_TOKEN: BRIDGE_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => {
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

test('les sessions sont créées, listées, éditées et supprimées avec révision', async t => {
  const dataDir = await fixture();
  const server = await start(dataDir);
  t.after(async () => {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = await api(server.port);
  const base = Date.parse('2026-11-20T10:00:00Z');

  const created = await request('POST', '/api/v1/sessions', {
    game: 'game one',
    start: base,
    end: base + 3600000,
    source: 'manual',
    note: 'Première session'
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.session.game, 'Game One');
  assert.equal(created.data.session.durationMs, 3600000);
  assert.equal(created.data.session.minutes, 60);
  assert.equal(created.data.session.source, 'manual');
  assert.equal(created.data.session.revision, 1);
  assert.match(created.data.session.gameId, /^name-/);
  const id = created.data.session.id;

  let listed = await request('GET', '/api/v1/sessions?game=game%20one');
  assert.equal(listed.status, 200);
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.sessions[0].id, id);

  const edited = await request('PATCH', `/api/v1/sessions/${id}`, { note: 'Note corrigée', revision: 1 });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.session.note, 'Note corrigée');
  assert.equal(edited.data.session.durationMs, 3600000);
  assert.equal(edited.data.session.source, 'manual');
  assert.equal(edited.data.session.revision, 2);

  const conflict = await request('PATCH', `/api/v1/sessions/${id}`, { note: 'Ancienne fenêtre', revision: 1 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error, 'conflit de révision');

  const second = await request('POST', '/api/v1/sessions', {
    game: 'Game Two',
    start: base + 2 * 3600000,
    durationMs: 1800000,
    source: 'manual'
  });
  assert.equal(second.status, 201);
  assert.equal(second.data.session.end, base + 2 * 3600000 + 1800000);

  const filtered = await request('GET', `/api/v1/sessions?from=${base + 90 * 60000}&to=${base + 3 * 3600000}`);
  assert.equal(filtered.status, 200);
  assert.equal(filtered.data.total, 1);
  assert.equal(filtered.data.sessions[0].game, 'Game Two');

  const deleted = await request('DELETE', `/api/v1/sessions/${id}?revision=2`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.session.id, id);
  listed = await request('GET', '/api/v1/sessions?game=Game%20One');
  assert.equal(listed.data.total, 0);

  const idempotent = await request('DELETE', `/api/v1/sessions/${id}`);
  assert.equal(idempotent.status, 200);
  assert.equal(idempotent.data.alreadyDeleted, true);

  assert.equal((await request('POST', '/api/session/start', { name: 'Game Two' })).status, 200);
  await sleep(30);
  assert.equal((await request('POST', '/api/session/stop')).status, 200);
  const stopped = await request('GET', '/api/v1/sessions?game=Game%20Two');
  const tracked = stopped.data.sessions.find(session => session.source === 'manual' && session.durationMs < 60000);
  assert.ok(tracked, 'la session suivie doit être listée');
  assert.match(tracked.gameId, /^name-/);
  assert.equal(tracked.revision, 1);
  const trackedDelete = await request('DELETE', `/api/v1/sessions/${tracked.id}?revision=${tracked.revision}`);
  assert.equal(trackedDelete.status, 200);
});

test('une suppression survit au redémarrage et à un PUT ancien', async t => {
  const dataDir = await fixture();
  let server = await start(dataDir);
  t.after(async () => {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  let request = await api(server.port);
  const base = Date.parse('2026-11-21T09:00:00Z');
  const created = await request('POST', '/api/v1/sessions', { game: 'Game One', start: base, durationMs: 600000 });
  assert.equal(created.status, 201);
  const session = created.data.session;
  assert.equal((await request('DELETE', `/api/v1/sessions/${session.id}`)).status, 200);
  await server.stop();

  server = await start(dataDir);
  request = await api(server.port);
  let listed = await request('GET', '/api/v1/sessions');
  assert.equal(listed.data.total, 0);

  const stalePut = await request('PUT', '/api/state', {
    games: [{ n: 'Game One', s: 0, c: 0, m: 120 }],
    sessions: [session],
    favorites: [],
    profiles: [{ id: 'main', name: 'Profil principal' }],
    activeProfileId: 'main'
  });
  assert.equal(stalePut.status, 200);
  listed = await request('GET', '/api/v1/sessions');
  assert.equal(listed.data.total, 0);

  const undo = await request('POST', '/api/v1/sessions', { ...session, restore: true });
  assert.equal(undo.status, 201);
  assert.equal(undo.data.session.id, session.id);
  listed = await request('GET', '/api/v1/sessions');
  assert.equal(listed.data.total, 1);

  await request('DELETE', `/api/v1/sessions/${session.id}`);
  await server.stop();
  server = await start(dataDir);
  request = await api(server.port);
  listed = await request('GET', '/api/v1/sessions');
  assert.equal(listed.data.total, 0);
});

test('le découpage et la fusion ne doublent pas le temps', async t => {
  const dataDir = await fixture();
  const server = await start(dataDir);
  t.after(async () => {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = await api(server.port);
  const base = Date.parse('2026-11-22T08:00:00Z');
  const created = await request('POST', '/api/v1/sessions', { game: 'Game One', start: base, durationMs: 7200000, source: 'discord', note: 'À garder' });
  assert.equal(created.status, 201);
  const original = created.data.session;

  const split = await request('POST', `/api/v1/sessions/${original.id}/split`, { at: base + 3600000 });
  assert.equal(split.status, 201);
  assert.equal(split.data.sessions.length, 2);
  assert.equal(split.data.totalDurationMs, 7200000);
  assert.equal(split.data.sessions[0].source, 'discord');
  assert.equal(split.data.sessions[1].note, 'À garder');

  let listed = await request('GET', '/api/v1/sessions');
  assert.equal(listed.data.total, 2);
  const [first, second] = split.data.sessions;
  const merged = await request('POST', '/api/v1/sessions/merge', { ids: [first.id, second.id] });
  assert.equal(merged.status, 201);
  assert.equal(merged.data.session.durationMs, 7200000);
  assert.equal(merged.data.session.source, 'discord');
  listed = await request('GET', '/api/v1/sessions');
  assert.equal(listed.data.total, 1);

  const a = await request('POST', '/api/v1/sessions', { game: 'Game Two', start: base + 10 * 3600000, durationMs: 7200000, confirm: true });
  const b = await request('POST', '/api/v1/sessions', { game: 'Game Two', start: base + 11 * 3600000, durationMs: 7200000, confirm: true });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const overlapMerge = await request('POST', '/api/v1/sessions/merge', { ids: [a.data.session.id, b.data.session.id] });
  assert.equal(overlapMerge.status, 201);
  assert.equal(overlapMerge.data.session.durationMs, 3 * 3600000);
});

test('les chevauchements et les sessions de plus de 24 heures demandent confirmation', async t => {
  const dataDir = await fixture();
  const server = await start(dataDir);
  t.after(async () => {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = await api(server.port);
  const base = Date.parse('2026-11-23T07:00:00Z');

  const first = await request('POST', '/api/v1/sessions', { game: 'Game One', start: base, durationMs: 3600000 });
  assert.equal(first.status, 201);
  const overlap = await request('POST', '/api/v1/sessions', { game: 'Game One', start: base + 1800000, durationMs: 3600000 });
  assert.equal(overlap.status, 409);
  assert.equal(overlap.data.requiresConfirmation, true);
  assert.equal(overlap.data.conflicts.length, 1);
  const confirmed = await request('POST', '/api/v1/sessions', { game: 'Game One', start: base + 1800000, durationMs: 3600000, confirm: true });
  assert.equal(confirmed.status, 201);

  const long = await request('POST', '/api/v1/sessions', { game: 'Game Two', start: base + 10 * 3600000, durationMs: 25 * 3600000 });
  assert.equal(long.status, 409);
  assert.equal(long.data.longSession, true);
  const longConfirmed = await request('POST', '/api/v1/sessions', { game: 'Game Two', start: base + 10 * 3600000, durationMs: 25 * 3600000, confirm: true });
  assert.equal(longConfirmed.status, 201);

  const missing = await request('POST', '/api/v1/sessions', { game: 'Jeu inconnu', start: base, durationMs: 600000 });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.error, 'jeu inconnu');

  const file = JSON.parse(await readFile(path.join(dataDir, 'library.json'), 'utf8'));
  assert.equal(file.sessions.length, 3);
});
