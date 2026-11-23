import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { legacyMetaKey, migrateToV2 } from '../orbit-library.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const run = promisify(execFile);

function jpeg(width, height) {
  const bytes = Buffer.alloc(23);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  bytes.set([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9], 11);
  return bytes;
}

async function sha(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'orbit-migration-'));
  await mkdir(path.join(dataDir, 'covers'), { recursive: true });
  const meta = {
    deadbeef: { title: 'BioShock 2', description: 'métadonnée orpheline récupérable' },
    [legacyMetaKey('Ancien nom')]: {
      title: 'Ancien nom',
      description: 'métadonnée qui reste orpheline',
      playDetails: { kind: 'game', rating: 3 }
    }
  };
  const library = {
    version: 1,
    games: [
      { n: 'BioShock 2', s: 0, c: 0, m: 120, t: 10, firstPlayed: 5 },
      { n: 'Portal 2', s: 2, c: 1, m: 60, t: 20, firstPlayed: 6 }
    ],
    sessions: [
      { game: 'BioShock 2', start: 1000, end: 2000, durationMs: 1000, minutes: 0 },
      { game: 'Jeu disparu', start: 3000, end: 4000, durationMs: 1000, minutes: 0 }
    ],
    favorites: ['BioShock 2', 'Jeu disparu'],
    profiles: [{ id: 'main', name: 'Profil principal' }],
    activeProfileId: 'main'
  };
  await writeFile(path.join(dataDir, 'library.json'), JSON.stringify(library, null, 2), 'utf8');
  await writeFile(path.join(dataDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ version: 1 }), 'utf8');
  await writeFile(path.join(dataDir, 'recap.json'), JSON.stringify({ version: 1 }), 'utf8');
  await writeFile(path.join(dataDir, 'cinema.json'), JSON.stringify({ version: 1, items: [] }), 'utf8');
  await writeFile(path.join(dataDir, 'covers', 'BioShock 2.jpg'), jpeg(920, 430));
  await writeFile(path.join(dataDir, 'covers', 'BioShock 2.png'), jpeg(600, 900));
  return { dataDir, library, meta };
}

test('la migration v2 conserve les identifiants, les orphelins et les jaquettes', () => {
  const meta = {
    deadbeef: { title: 'BioShock 2', description: 'fiche récupérée par le titre' },
    [legacyMetaKey('Ancien nom')]: { title: 'Ancien nom', description: 'orpheline' }
  };
  const library = {
    version: 1,
    games: [
      { n: 'Hades', s: 0, c: 0, m: 120, t: 1, firstPlayed: 1 },
      { n: 'Hades', s: 2, c: 0, m: 0, t: 0 },
      { n: 'BioShock 2', s: 0, c: 0, m: 0, t: 0 }
    ],
    sessions: [
      { game: 'Hades', start: 1000, end: 2000, durationMs: 1000, minutes: 0 },
      { game: 'Jeu disparu', start: 3000, end: 4000, durationMs: 1000, minutes: 0 }
    ],
    favorites: ['Hades', 'Jeu disparu'],
    profiles: [{ id: 'main', name: 'Profil principal' }],
    activeProfileId: 'main'
  };
  const covers = [
    { name: 'Hades.jpg', width: 920, height: 430, mtime: 10 },
    { name: 'Hades.png', width: 600, height: 900, mtime: 20 }
  ];
  const first = migrateToV2({ library, meta, covers, now: 5000 });
  assert.equal(first.library.version, 2);
  assert.equal(first.library.games.length, 3);
  assert.equal(new Set(first.library.games.map((game) => game.id)).size, 3);
  assert.notEqual(first.library.games[0].id, first.library.games[1].id);
  assert.equal(first.report.duplicateGames.length, 1);
  assert.equal(first.report.duplicateGames[0].count, 2);

  const hades = first.library.games[0];
  const bioshock = first.library.games[2];
  const sessions = first.library.sessions;
  assert.equal(sessions[0].gameId, hades.id);
  assert.equal(sessions[0].gameNameSnapshot, 'Hades');
  assert.equal(sessions[1].gameId, null);
  assert.equal(sessions[1].orphan, true);
  assert.equal(sessions[1].game, 'Jeu disparu');
  assert.deepEqual(first.library.favorites, [hades.id]);
  assert.deepEqual(first.library.favoriteOrphans, ['Jeu disparu']);
  assert.equal(first.report.orphanSessions.length, 1);
  assert.equal(first.report.orphanMeta.length, 1);

  const metaDoc = first.meta;
  assert.equal(metaDoc._schema, 2);
  assert.equal(metaDoc._orphans[legacyMetaKey('Ancien nom')].title, 'Ancien nom');
  assert.equal(metaDoc[bioshock.id].description, 'fiche récupérée par le titre');
  assert.equal(metaDoc[bioshock.id].artwork, undefined);
  assert.equal(metaDoc[hades.id].artwork.wide.f, 'Hades.jpg');
  assert.equal(metaDoc[hades.id].artwork.tall.f, 'Hades.png');
  assert.equal(metaDoc[legacyMetaKey('Hades')].description, undefined);

  const second = migrateToV2({ library: first.library, meta: first.meta, covers, now: 9000 });
  assert.equal(second.report.changed, false);
  assert.equal(JSON.stringify(second.library), JSON.stringify(first.library));
  assert.equal(JSON.stringify(second.meta), JSON.stringify(first.meta));
});

test('la fiche du nom courant prime et les doublons sont archivés sans perte', () => {
  const library = {
    version: 1,
    games: [{ n: 'BioShock 2', s: 0, c: 0, m: 120, t: 10, firstPlayed: 5 }],
    sessions: [],
    favorites: [],
    profiles: [{ id: 'main', name: 'Profil principal' }],
    activeProfileId: 'main'
  };
  const meta = {
    [legacyMetaKey('BioShock 2')]: {
      title: 'BioShock® 2',
      description: 'fiche réellement utilisée',
      cover: '/covers/bioshock%202.jpg',
      checkedAt: 20
    },
    deadbeef: {
      title: 'BioShock 2',
      description: 'ancienne fiche récupérée par le titre',
      cover: '/covers/bioshock%201%202.png',
      checkedAt: 10,
      playDetails: { rating: 4, collections: ['Favoris'] }
    }
  };
  const result = migrateToV2({ library, meta, covers: [], now: 5000 });
  const id = result.library.games[0].id;
  assert.equal(result.meta[id].title, 'BioShock® 2');
  assert.equal(result.meta[id].description, 'fiche réellement utilisée');
  assert.equal(result.meta[id].cover, '/covers/bioshock%202.jpg');
  assert.equal(result.meta[id].checkedAt, 20);
  assert.equal(result.meta[id].playDetails.rating, 4, 'les champs absents de la fiche principale sont complétés');
  assert.equal(result.meta._archived.length, 1);
  assert.equal(result.meta._archived[0].key, 'deadbeef');
  assert.equal(result.meta._archived[0].value.description, 'ancienne fiche récupérée par le titre');
  assert.equal(result.meta[legacyMetaKey('BioShock 2')].description, 'fiche réellement utilisée');

  const second = migrateToV2({ library: result.library, meta: result.meta, covers: [], now: 9000 });
  assert.equal(second.report.changed, false);
  assert.equal(JSON.stringify(second.meta), JSON.stringify(result.meta));
  assert.equal(second.meta._archived.length, 1);
});

test('le script est dry-run par défaut, sauvegarde, applique et sait revenir en arrière', async (t) => {
  const { dataDir, library } = await fixture();
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const libraryPath = path.join(dataDir, 'library.json');
  const metaPath = path.join(dataDir, 'meta.json');
  const originalLibrary = await sha(libraryPath);
  const originalMeta = await sha(metaPath);
  const originalMtime = (await stat(libraryPath)).mtimeMs;

  const dry = await run(process.execPath, [path.join(root, 'scripts', 'migrate-v2.mjs'), '--data', dataDir], {
    cwd: root
  });
  assert.match(dry.stdout, /dry-run, aucune écriture/);
  assert.equal(await sha(libraryPath), originalLibrary);
  assert.equal(await sha(metaPath), originalMeta);
  assert.equal((await stat(libraryPath)).mtimeMs, originalMtime);
  assert.deepEqual(
    await readdir(dataDir).then((names) => names.filter((name) => name === 'backups')),
    []
  );

  const applied = await run(
    process.execPath,
    [path.join(root, 'scripts', 'migrate-v2.mjs'), '--data', dataDir, '--apply', '--json'],
    { cwd: root }
  );
  assert.match(applied.stdout, /"dataDir"/);
  const migrated = JSON.parse(await readFile(libraryPath, 'utf8'));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.games.length, library.games.length);
  assert.ok(migrated.games.every((game) => typeof game.id === 'string' && game.id.length > 10));
  assert.equal(migrated.favorites.length, 1);
  assert.equal(migrated.favoriteOrphans.length, 1);
  assert.equal(migrated.sessions[1].gameId, null);
  assert.equal(migrated.sessions[1].orphan, true);

  const metaDoc = JSON.parse(await readFile(metaPath, 'utf8'));
  assert.equal(metaDoc._schema, 2);
  assert.equal(metaDoc[migrated.games[0].id].artwork.wide.f, 'BioShock 2.jpg');
  assert.equal(metaDoc[migrated.games[0].id].artwork.tall.f, 'BioShock 2.png');

  const backups = (await readdir(path.join(dataDir, 'backups'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.equal(backups.length, 1);
  const manifest = JSON.parse(await readFile(path.join(dataDir, 'backups', backups[0], 'backup-manifest.json'), 'utf8'));
  assert.equal(manifest.reason, 'before-migration');
  assert.equal(manifest.verified, true);

  const migratedHash = await sha(libraryPath);
  const again = await run(process.execPath, [path.join(root, 'scripts', 'migrate-v2.mjs'), '--data', dataDir, '--apply'], {
    cwd: root
  });
  assert.match(again.stdout, /déjà en version 2/);
  assert.equal(await sha(libraryPath), migratedHash);

  const rollback = await run(
    process.execPath,
    [path.join(root, 'scripts', 'migrate-v2.mjs'), '--data', dataDir, '--rollback', 'latest'],
    { cwd: root }
  );
  assert.match(rollback.stdout, /Retour arrière effectué/);
  assert.equal(await sha(libraryPath), originalLibrary);
  assert.equal(await sha(metaPath), originalMeta);
  const restored = JSON.parse(await readFile(libraryPath, 'utf8'));
  assert.equal(restored.version, 1);
});
