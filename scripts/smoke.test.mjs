import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Les scripts intégrés aux pages sont lisibles par JavaScript', async () => {
  for (const name of ['bibliotheque.html', 'setup.html']) {
    const html = await readFile(path.join(root, name), 'utf8');
    for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (script.trim()) new Script(script, { filename: name });
    }
  }
});

test('Premier lancement du pont avec une bibliothèque vide et sans identifiants', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'orbit-test-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const env = {
    BRIDGE_PORT: String(port),
    GAME_TRACKER_DATA_DIR: directory,
    GAME_TRACKER_ENV_FILE: path.join(directory, 'absent.env'),
    GAME_TRACKER_ASSET_DIR: root
  };
  for (const key of ['SystemRoot', 'PATH', 'TMP', 'TEMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const child = spawn(process.execPath, [path.join(root, 'bridge.js')], {
    cwd: directory, env, stdio: 'ignore', windowsHide: true
  });
  const closed = once(child, 'close');
  t.after(async () => {
    child.kill();
    await closed;
    await rm(directory, { recursive: true, force: true });
  });
  let state;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw Error('Le pont a quitté au démarrage.');
    try {
      const response = await fetch(base + '/api/state', {signal: AbortSignal.timeout(2000)});
      if (response.ok) { state = await response.json(); break; }
    } catch {}
    await delay(150);
  }
  assert.ok(state, 'Le pont doit répondre');
  assert.deepEqual(state.games, []);
  assert.deepEqual(state.sessions, []);
  assert.deepEqual(state.favorites, []);
  for (const route of ['/', '/launcher.js', '/launcher.css', '/icon.svg', '/sw.js', '/manifest.webmanifest', '/mentions-legales', '/confidentialite']) {
    assert.equal((await fetch(base + route)).status, 200, route);
  }
  const config = await (await fetch(base + '/app-config.json')).json();
  assert.ok(config.sections.some(section => section.id === 'orbit-play' && section.active));
});
