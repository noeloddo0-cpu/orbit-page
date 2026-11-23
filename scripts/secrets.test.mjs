import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  initSecrets,
  migrateSecrets,
  getSecret,
  setSecret,
  deleteSecret,
  secretsAvailable
} from '../orbit-secrets.mjs';

function fakeSafeStorage() {
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from('enc:' + value, 'utf8'),
    decryptStringAsync: async (buffer) => {
      const value = buffer.toString('utf8');
      if (!value.startsWith('enc:')) throw new Error('valeur non chiffrée');
      return { result: value.slice(4), shouldReEncrypt: false };
    }
  };
}

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orbit-secrets-'));
  const configPath = path.join(dir, 'config.json');
  const tmdbKeyPath = path.join(dir, 'tmdb-api-key.txt');
  writeFileSync(
    configPath,
    JSON.stringify({ botToken: 'discord-secret-123', discordUserId: '42', guildId: '7' }),
    'utf8'
  );
  writeFileSync(tmdbKeyPath, 'tmdb-secret-456', 'utf8');
  return { dir, configPath, tmdbKeyPath };
}

test('les secrets historiques sont chiffrés, vérifiés et retirés des fichiers en clair', async () => {
  const { dir, configPath, tmdbKeyPath } = fixture();
  assert.deepEqual(await initSecrets({ dataDir: dir, safeStorage: fakeSafeStorage() }), {
    available: true,
    file: path.join(dir, 'secrets.json')
  });
  assert.equal(secretsAvailable(), true);

  const first = await migrateSecrets({ configPath, tmdbKeyPath });
  assert.deepEqual(first.migrated.sort(), ['discordToken', 'tmdbKey']);
  assert.equal(await getSecret('discordToken'), 'discord-secret-123');
  assert.equal(await getSecret('tmdbKey'), 'tmdb-secret-456');

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.botToken, undefined);
  assert.equal(config.discordUserId, '42');
  assert.equal(config.guildId, '7');
  assert.equal(existsSync(tmdbKeyPath), false);

  const raw = readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.ok(!raw.includes('discord-secret-123'));
  assert.ok(!raw.includes('tmdb-secret-456'));

  const second = await migrateSecrets({ configPath, tmdbKeyPath });
  assert.deepEqual(second.migrated, []);

  assert.equal(await setSecret('discordToken', 'nouveau-secret'), true);
  assert.equal(await getSecret('discordToken'), 'nouveau-secret');
  assert.equal(await deleteSecret('discordToken'), true);
  assert.equal(await getSecret('discordToken'), null);
});

test('un coffre illisible est signalé et jamais écrasé', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orbit-secrets-'));
  const vault = path.join(dir, 'secrets.json');
  writeFileSync(vault, '{ pas du json', 'utf8');
  await initSecrets({ dataDir: dir, safeStorage: fakeSafeStorage() });
  assert.equal(await getSecret('discordToken'), null);
  await assert.rejects(() => setSecret('discordToken', 'nouveau'), /illisible/);
  assert.equal(readFileSync(vault, 'utf8'), '{ pas du json');
});

test('sans chiffrement disponible, les fichiers existants ne sont pas touchés', async () => {
  const { dir, configPath, tmdbKeyPath } = fixture();
  assert.deepEqual(await initSecrets({ dataDir: dir }), { available: false, file: path.join(dir, 'secrets.json') });
  assert.equal(secretsAvailable(), false);
  assert.equal(await setSecret('discordToken', 'refusé'), false);
  const result = await migrateSecrets({ configPath, tmdbKeyPath });
  assert.deepEqual(result.migrated, []);
  assert.equal(result.skipped, 'encryption-unavailable');
  assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).botToken, 'discord-secret-123');
  assert.equal(readFileSync(tmdbKeyPath, 'utf8'), 'tmdb-secret-456');
});
