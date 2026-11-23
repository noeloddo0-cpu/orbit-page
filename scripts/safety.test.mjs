import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createBackup,
  listBackups,
  preserveCorrupt,
  pruneBackups,
  restoreFilesFromBackup,
  verifyBackup
} from '../orbit-backup.mjs';
import { createLogger, logRedactionSelfTest, redact } from '../orbit-log.mjs';

const temporary = (prefix) =>
  path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);

async function fixture() {
  const root = temporary('orbit-safety');
  await mkdir(path.join(root, 'covers'), { recursive: true });
  await writeFile(
    path.join(root, 'library.json'),
    JSON.stringify({
      version: 1,
      games: [{ n: 'Game' }],
      sessions: [{ game: 'Game', start: 1, durationMs: 60000 }],
      favorites: ['game']
    }),
    'utf8'
  );
  await writeFile(path.join(root, 'settings.json'), JSON.stringify({ version: 1, theme: 'papier' }), 'utf8');
  await writeFile(path.join(root, 'recap.json'), JSON.stringify({ version: 1, recent: [] }), 'utf8');
  await writeFile(
    path.join(root, 'cinema.json'),
    JSON.stringify({ version: 1, items: [{ type: 'film' }, { type: 'series' }] }),
    'utf8'
  );
  await writeFile(path.join(root, 'meta.json'), JSON.stringify({ hash: { title: 'Game' } }), 'utf8');
  await writeFile(path.join(root, 'psn-reference.json'), JSON.stringify({ game: 42 }), 'utf8');
  await writeFile(path.join(root, 'covers', 'game.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return root;
}

test('une sauvegarde est vérifiable et contient les compteurs', async () => {
  const root = await fixture();
  const result = await createBackup({ dataDir: root, reason: 'manual', appVersion: '1.0.32' });
  assert.equal(result.verified, true);
  assert.equal(result.manifest.counts.games, 1);
  assert.equal(result.manifest.counts.sessions, 1);
  assert.equal(result.manifest.counts.films, 1);
  assert.equal(result.manifest.counts.series, 1);
  assert.equal(result.manifest.covers, 1);
  const verification = await verifyBackup(result.directory);
  assert.equal(verification.ok, true);
  assert.equal(verification.checked, 7);
  const listed = await listBackups(path.join(root, 'backups'));
  assert.equal(listed.length, 1);
  assert.equal(listed[0].reason, 'manual');
  assert.equal(listed[0].verified, true);
  assert.ok(listed[0].size > 0);
});

test('une sauvegarde altérée est détectée avant restauration', async () => {
  const root = await fixture();
  const result = await createBackup({ dataDir: root, reason: 'automatic' });
  await appendFile(path.join(result.directory, 'library.json'), ' ', 'utf8');
  const verification = await verifyBackup(result.directory);
  assert.equal(verification.ok, false);
  assert.equal(verification.errors[0].file, 'library.json');
});

test('les sauvegardes manuelles sont protégées par la rotation', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'backups'), { recursive: true });
  const now = Date.now();
  for (let index = 0; index < 12; index += 1) {
    const name = new Date(now - (index + 20) * 60000).toISOString().replace(/[:.]/g, '-');
    const directory = path.join(root, 'backups', name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'backup-manifest.json'),
      JSON.stringify({ format: 'orbit-backup-manifest', version: 1, files: [], reason: 'automatic' }),
      'utf8'
    );
  }
  for (let index = 0; index < 6; index += 1) {
    const name = new Date(now - (index + 60) * 60000).toISOString().replace(/[:.]/g, '-');
    const directory = path.join(root, 'backups', name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'backup-manifest.json'),
      JSON.stringify({ format: 'orbit-backup-manifest', version: 1, files: [], reason: 'manual' }),
      'utf8'
    );
  }
  const removed = await pruneBackups(path.join(root, 'backups'), { keepAutomatic: 10, keepManual: 5 });
  assert.equal(removed.length, 3);
  const remaining = await listBackups(path.join(root, 'backups'));
  assert.equal(remaining.filter((item) => item.reason === 'manual').length, 5);
  assert.equal(remaining.filter((item) => item.reason === 'automatic').length, 10);
});

test('un fichier corrompu est conservé avant restauration', async () => {
  const root = await fixture();
  const file = path.join(root, 'library.json');
  await writeFile(file, '{ pas du json', 'utf8');
  const copy = await preserveCorrupt(file);
  assert.ok(copy && copy.includes('.corrupt-'));
  assert.equal(await readFile(copy, 'utf8'), '{ pas du json');
  assert.ok((await stat(copy)).size > 0);
});

test('le journal redige les secrets et tourne sans exposer les jetons', async () => {
  assert.equal(logRedactionSelfTest(), true);
  assert.equal(
    JSON.stringify(redact({ token: 'abc', nested: { apiKey: 'def' } })),
    '{"token":"[redacted]","nested":{"apiKey":"[redacted]"}}'
  );
  const root = temporary('orbit-log');
  const logger = createLogger({ dir: root, component: 'test' });
  logger.error('Connexion refusée', { token: 'super-secret', url: 'http://127.0.0.1/?token=secret', safe: 'ok' });
  logger.info('Démarrage', { apiKey: 'hidden' });
  const files = await readdir(path.join(root, 'logs'));
  const content = await readFile(path.join(root, 'logs', files[0]), 'utf8');
  assert.ok(!content.includes('super-secret'));
  assert.ok(!content.includes('secret'));
  assert.ok(!content.includes('hidden'));
  assert.ok(content.includes('"safe":"ok"'));
  const recent = logger.recent(10);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].message, 'Connexion refusée');
  assert.equal(recent[1].message, 'Démarrage');
});

test('la restauration de secours remet les fichiers en place', async () => {
  const root = await fixture();
  const result = await createBackup({ dataDir: root, reason: 'before-restore' });
  await writeFile(path.join(root, 'library.json'), JSON.stringify({ version: 1, games: [] }), 'utf8');
  await restoreFilesFromBackup(result.directory, root);
  const library = JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8'));
  assert.equal(library.games.length, 1);
});
