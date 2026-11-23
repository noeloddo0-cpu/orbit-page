import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const TOKEN = 'security-test-token';

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'orbit-security-'));
  await mkdir(path.join(dataDir, 'covers'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'library.json'),
    JSON.stringify({
      version: 1,
      games: [{ n: 'Game One', s: 0, c: 0, m: 0, t: 0 }],
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
  const port = 44000 + Math.floor(Math.random() * 1200);
  const child = spawn(process.execPath, [path.join(root, 'bridge.js')], {
    cwd: root,
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      GAME_TRACKER_DATA_DIR: dataDir,
      GAME_TRACKER_ASSET_DIR: root,
      ORBIT_LOG_CONSOLE: '0',
      ORBIT_BRIDGE_TOKEN: TOKEN
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Le pont s’est arrêté (${child.exitCode}) : ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return { port, child };
    } catch {}
    await sleep(120);
  }
  throw new Error(`Le pont ne répond pas : ${stderr}`);
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    try {
      child.kill();
    } catch {
      resolve();
    }
    setTimeout(resolve, 1500);
  });
}

test('le pont refuse les mutations sans jeton, les origines inconnues et les images déguisées', async (t) => {
  const dataDir = await fixture();
  const server = await start(dataDir);
  t.after(async () => {
    await stop(server.child);
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.port}`;
  const request = async (method, target, { body, token = true, tokenValue = TOKEN, origin, contentType } = {}) => {
    const headers = {};
    if (token) headers['X-Orbit-Token'] = tokenValue;
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = contentType || 'application/json';
    const response = await fetch(base + target, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    let data = null;
    try {
      data = await response.json();
    } catch {}
    return { status: response.status, data, headers: response.headers };
  };

  assert.equal((await request('GET', '/api/health', { token: false })).status, 200);

  const withoutToken = await request('POST', '/api/v1/sessions', {
    token: false,
    body: { game: 'Game One', start: Date.now() - 60000 }
  });
  assert.equal(withoutToken.status, 403);
  assert.equal(withoutToken.data.code, 'token_required');

  const wrongToken = await request('POST', '/api/v1/sessions', {
    tokenValue: 'mauvais-jeton',
    body: { game: 'Game One', start: Date.now() - 60000 }
  });
  assert.equal(wrongToken.status, 403);

  const evilOrigin = await request('POST', '/api/v1/sessions', {
    origin: 'https://evil.example',
    body: { game: 'Game One', start: Date.now() - 60000 }
  });
  assert.equal(evilOrigin.status, 403);

  const evilRead = await request('GET', '/api/state', { token: false, origin: 'https://evil.example' });
  assert.equal(evilRead.status, 403);

  const created = await request('POST', '/api/v1/sessions', {
    body: { game: 'Game One', start: Date.now() - 60000, end: Date.now() }
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const pageResponse = await fetch(base + '/');
  assert.equal(pageResponse.status, 200);
  const csp = pageResponse.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src 'self' 'nonce-/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.equal(pageResponse.headers.get('x-frame-options'), 'DENY');
  const page = await pageResponse.text();
  assert.match(page, /name="orbit-bridge-token"/);
  assert.ok(page.includes(TOKEN));
  assert.match(page, /X-Orbit-Token/);
  assert.match(page, /<script nonce="/);
  assert.equal(
    (page.match(/<script\b(?![^>]*\bsrc=)(?![^>]*\bnonce=)[^>]*>/gi) || []).length,
    0,
    'scripts inline sans nonce'
  );

  const disguised = await request('PUT', '/api/cover?key=disguised', {
    body: 'ceci n’est pas une image',
    contentType: 'image/jpeg'
  });
  assert.equal(disguised.status, 415);

  const coverTraversal = await request('GET', '/covers/..%2F..%2Fpackage.json', { token: false });
  assert.ok([400, 404].includes(coverTraversal.status));
  const themeTraversal = await request('GET', '/themes/..%2F..%2Fpackage.json', { token: false });
  assert.ok([400, 404].includes(themeTraversal.status));

  for (let index = 0; index < 121; index += 1) {
    const response = await request('GET', '/api/cinema', { token: false });
    if (response.status === 429) {
      assert.equal(index, 120);
      assert.equal(response.headers.get('retry-after'), '60');
      return;
    }
    assert.equal(response.status, 200);
  }
  assert.fail('La limitation de débit aurait dû répondre 429.');
});
