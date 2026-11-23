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
import {
  cleanTitle,
  entryFromRow,
  nameSimilarity,
  normalizeName,
  parseCompletion,
  parseMinutes,
  parseStatus,
  readCsvDocument,
  reportToCsv
} from '../orbit-import.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const ckey = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const metaKey = (value) => crypto.createHash('sha1').update(ckey(value)).digest('hex');

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

test('l’interface P1-04 expose l’aperçu, le mapping, le rapport et l’annulation', async () => {
  const html = await readFile(path.join(root, 'bibliotheque.html'), 'utf8');
  for (const id of [
    'add-dialog',
    'add-confirm',
    'import-mode-names',
    'import-mode-csv',
    'import-mode-steam',
    'import-csv-file',
    'import-csv-info',
    'import-mapping',
    'import-preview',
    'import-report',
    'import-undo',
    'import-undo-button'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `élément ${id} manquant`);
  }
  for (const marker of [
    '/api/v1/import/preview',
    '/api/v1/import/apply',
    '/api/v1/import/undo',
    'importMappingFromForm',
    'renderImportReport',
    'showImportUndo',
    'undoImportNow',
    'previewId: importState.preview.previewId',
    'event.key === "Escape"',
    'document.body.append($("add-veil"), $("add-dialog"))',
    'window.orbitImport'
  ]) {
    assert.ok(html.includes(marker), `marqueur ${marker} manquant`);
  }
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (script.trim()) new Script(script, { filename: 'bibliotheque.html' });
  }
  const launcher = await readFile(path.join(root, 'launcher.js'), 'utf8');
  assert.match(launcher, /window\.orbitImport\.open\('steam'\)/);
  assert.doesNotMatch(launcher, /fetch\('\/api\/steam\/import'/);
});

test('l’analyse normalise les accents, les homonymes et les lignes invalides', () => {
  assert.equal(normalizeName('Pokémon Écarlate'), normalizeName('Pokemon Ecarlate'));
  assert.equal(normalizeName('The Legend of Zelda™: Breath of the Wild'), 'the legend of zelda breath of the wild');
  assert.equal(cleanTitle('  Hades\u0000 II  '), 'Hades II');
  assert.equal(nameSimilarity('Pokémon Écarlate', 'Pokemon Ecarlate'), 1);
  assert.ok(nameSimilarity('Hades', 'Hades II') >= 0.78);
  assert.ok(nameSimilarity('Hades', 'Stardew Valley') < 0.5);
  assert.equal(parseStatus('Terminé').value, 3);
  assert.equal(parseStatus('3').value, 3);
  assert.equal(parseStatus('inconnu').error, 'statut inconnu');
  assert.equal(parseCompletion('100 % / Platine').value, 2);
  assert.equal(parseCompletion('Pas 100 %').value, 1);
  assert.equal(parseMinutes('12h30').value, 750);
  assert.equal(parseMinutes('2:15').value, 135);
  assert.equal(parseMinutes('-4').error, 'durée invalide');

  const quoted = readCsvDocument('Titre;Tags;Minutes\r\n"Jeu; spécial";"Coop, Rétro";1h30\r\n');
  assert.equal(quoted.mapping.title, 0);
  assert.equal(quoted.mapping.tags, 1);
  assert.equal(quoted.mapping.minutes, 2);
  const entry = entryFromRow(quoted.rows[0], quoted.mapping);
  assert.equal(entry.title, 'Jeu; spécial');
  assert.deepEqual(entry.tags, ['Coop', 'Rétro']);
  assert.equal(entry.minutes, 90);
  assert.deepEqual(entry.errors, []);

  const invalid = entryFromRow({ cells: ['Titre invalide', 'statut inconnu'], line: 8 }, { title: 0, status: 1 });
  assert.equal(invalid.errors.length, 1);
  assert.equal(invalid.errors[0].field, 'status');
  const missing = entryFromRow({ cells: ['', 'Terminé'], line: 9 }, { title: 0, status: 1 });
  assert.equal(missing.errors[0].field, 'title');

  const csv = reportToCsv({
    lines: [
      { line: 2, title: 'Pokémon "Écarlate"', action: 'add', result: 'added', name: 'Pokémon "Écarlate"' },
      { line: 3, title: 'Invalide', action: 'reject', result: 'rejected', error: 'statut inconnu' }
    ]
  });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"Pokémon ""Écarlate"""/);
  assert.match(csv, /"Ajouté"/);
  assert.match(csv, /"Rejeté"/);
});

test(
  'un import CSV de 200 lignes détecte les doublons, applique par transaction et s’annule',
  { timeout: 60000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'orbit-library-import-'));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    await mkdir(path.join(dataDir, 'covers'), { recursive: true });

    const now = Date.now();
    const pokemon = {
      id: stableGameId('Pokémon Écarlate'),
      name: 'Pokémon Écarlate',
      n: 'Pokémon Écarlate',
      kind: 'game',
      status: 2,
      s: 2,
      completion: 0,
      c: 0,
      minutes: 600,
      m: 600,
      t: 0,
      tags: [],
      platforms: [],
      createdAt: now - 3
    };
    const zelda = {
      id: stableGameId('The Legend of Zelda: Breath of the Wild'),
      name: 'The Legend of Zelda: Breath of the Wild',
      n: 'The Legend of Zelda: Breath of the Wild',
      kind: 'game',
      status: 0,
      s: 0,
      completion: 0,
      c: 0,
      minutes: 1200,
      m: 1200,
      t: 0,
      tags: [],
      platforms: [],
      createdAt: now - 2
    };
    const portal = {
      id: stableGameId('Portal 2'),
      name: 'Portal 2',
      n: 'Portal 2',
      kind: 'game',
      status: 3,
      s: 3,
      completion: 2,
      c: 2,
      minutes: 1200,
      m: 1200,
      t: 0,
      tags: [],
      platforms: [],
      createdAt: now - 1
    };
    const hades = {
      id: stableGameId('Hades'),
      name: 'Hades',
      n: 'Hades',
      kind: 'game',
      status: 0,
      s: 0,
      completion: 0,
      c: 0,
      minutes: 300,
      m: 300,
      t: 0,
      tags: [],
      platforms: [],
      createdAt: now
    };
    const games = [pokemon, zelda, portal, hades];
    const favorites = [portal.id];
    await writeFile(
      path.join(dataDir, 'library.json'),
      JSON.stringify({
        version: 2,
        schemaVersion: 2,
        games,
        sessions: [],
        favorites,
        profiles: [{ id: 'main', name: 'Profil principal' }],
        activeProfileId: 'main'
      }),
      'utf8'
    );
    const metaBefore = {
      _schema: 2,
      _aliases: { [metaKey('Zelda BOTW')]: zelda.id },
      _orphans: {},
      [pokemon.id]: { title: pokemon.name },
      [zelda.id]: { title: zelda.name },
      [metaKey('Zelda BOTW')]: { title: zelda.name },
      [portal.id]: { title: portal.name, appId: '620', localSteamId: '620' },
      [hades.id]: { title: hades.name }
    };
    await writeFile(path.join(dataDir, 'meta.json'), JSON.stringify(metaBefore), 'utf8');
    await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ version: 1 }), 'utf8');
    await writeFile(path.join(dataDir, 'cinema.json'), JSON.stringify({ version: 1, items: [] }), 'utf8');
    await writeFile(
      path.join(dataDir, 'recap.json'),
      JSON.stringify({ version: 1, lastOpened: null, recent: [], gameStats: {} }),
      'utf8'
    );

    const port = 44000 + Math.floor(Math.random() * 800);
    const token = 'library-import-token';
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

    const namesPreview = await post('/api/v1/import/preview', {
      mode: 'names',
      items: [
        { title: 'Pokémon Écarlate', status: 0, kind: 'game' },
        { title: 'Nouveau Jeu Test', status: 2, kind: 'app' }
      ]
    });
    assert.equal(namesPreview.response.status, 200);
    assert.equal(namesPreview.data.summary.total, 2);
    assert.equal(namesPreview.data.summary.add, 1);
    assert.equal(namesPreview.data.summary.ignore, 1);
    assert.equal(namesPreview.data.entries[0].duplicate.reason, 'exact');
    assert.equal(namesPreview.data.entries[1].action, 'add');

    const namesApply = await post('/api/v1/import/apply', {
      previewId: namesPreview.data.previewId,
      revision: namesPreview.data.revision
    });
    assert.equal(namesApply.response.status, 200);
    assert.equal(namesApply.data.report.added, 1);
    assert.equal(namesApply.data.report.ignored, 1);
    let library = await readLibrary();
    assert.equal(library.games.length, 5);
    assert.ok(library.games.some((game) => game.name === 'Nouveau Jeu Test' && game.kind === 'app'));

    const namesUndo = await post('/api/v1/import/undo', { id: namesApply.data.undoId });
    assert.equal(namesUndo.response.status, 200);
    library = await readLibrary();
    assert.deepEqual(library.games, beforeLibrary.games);
    assert.deepEqual(library.favorites, beforeLibrary.favorites);
    assert.deepEqual(await readMeta(), beforeMeta);

    const rows = [
      'Pokémon Écarlate;Terminé;100 % / Platine;12h30;Switch;RPG, Rétro;Jeu;',
      'Zelda BOTW;Terminé;Pas 100 %;40h;Switch;Aventure;Jeu;',
      'Portal 2;Terminé;100 %;20h;PC;Coop;Jeu;620',
      'Hades II;À faire;À définir;0;PC;Roguelike;Jeu;',
      'Titre invalide;Statut inconnu;0;1h;PC;;Jeu;',
      ';Terminé;0;1h;PC;;Jeu;'
    ];
    for (let index = 0; index < 194; index += 1) {
      const number = String(index + 1).padStart(3, '0');
      rows.push(`Jeu importé ${number};En cours;Pas 100 %;${index % 7}h;PC;Import;Jeu;`);
    }
    assert.equal(rows.length, 200);
    const csv = ['Titre;Statut;Complétion;Minutes;Plateformes;Tags;Type;appId Steam', ...rows].join('\r\n');

    const preview = await post('/api/v1/import/preview', { mode: 'csv', csv });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.data.summary.total, 200);
    assert.equal(preview.data.summary.duplicates, 4);
    assert.equal(preview.data.summary.similar, 1);
    assert.equal(preview.data.summary.invalid, 2);
    assert.equal(preview.data.summary.add, 194);
    assert.equal(preview.data.summary.merge, 3);
    assert.equal(preview.data.summary.ignore, 1);
    assert.equal(preview.data.summary.reject, 2);
    assert.equal(preview.data.mapping.title, 0);
    assert.equal(preview.data.mapping.status, 1);
    assert.equal(preview.data.mapping.minutes, 3);
    assert.equal(preview.data.mapping.appId, 7);

    const invalidDecision = await post('/api/v1/import/apply', {
      previewId: preview.data.previewId,
      revision: preview.data.revision,
      decisions: [{ index: 4, action: 'add' }]
    });
    assert.equal(invalidDecision.response.status, 400);
    library = await readLibrary();
    assert.deepEqual(library.games, beforeLibrary.games);
    assert.deepEqual(library.favorites, beforeLibrary.favorites);

    const conflictingPreview = await post('/api/v1/import/preview', {
      mode: 'names',
      items: [{ title: 'Conflit de révision' }]
    });
    assert.equal(conflictingPreview.response.status, 200);
    const created = await post('/api/v1/games', { name: 'Jeu concurrent' });
    assert.ok([200, 201].includes(created.response.status));
    const conflict = await post('/api/v1/import/apply', {
      previewId: conflictingPreview.data.previewId,
      revision: conflictingPreview.data.revision
    });
    assert.equal(conflict.response.status, 409);
    assert.match(conflict.data.error, /bibliothèque a changé/);
    library = await readLibrary();
    const concurrent = library.games.find((game) => game.name === 'Jeu concurrent');
    assert.ok(concurrent);
    await fetch(base + '/api/v1/games/' + encodeURIComponent(concurrent.id), {
      method: 'DELETE',
      headers
    });

    const freshPreview = await post('/api/v1/import/preview', { mode: 'csv', csv });
    assert.equal(freshPreview.response.status, 200);
    const decisions = freshPreview.data.entries
      .filter((entry) => entry.errors.length || entry.duplicate?.reason === 'similar')
      .map((entry) => ({
        index: entry.index,
        action: entry.errors.length && entry.title ? 'reject' : entry.errors.length ? 'ignore' : 'add'
      }));
    const applied = await post('/api/v1/import/apply', {
      previewId: freshPreview.data.previewId,
      revision: freshPreview.data.revision,
      decisions
    });
    assert.equal(applied.response.status, 200);
    assert.equal(applied.data.report.total, 200);
    assert.equal(applied.data.report.added, 195);
    assert.equal(applied.data.report.merged, 3);
    assert.equal(applied.data.report.ignored, 1);
    assert.equal(applied.data.report.rejected, 1);
    assert.equal(applied.data.report.duplicates, 4);
    assert.equal(applied.data.report.similar, 1);
    assert.ok(applied.data.undoId);
    assert.ok(applied.data.undoExpiresAt - Date.now() <= 30000);

    library = await readLibrary();
    const reportMeta = await readMeta();
    assert.equal(library.games.length, 199);
    assert.equal(library.favorites.length, 1);
    assert.equal(library.sessions.length, 0);
    const pokemonAfter = library.games.find((game) => game.id === pokemon.id);
    assert.equal(pokemonAfter.status, 3);
    assert.equal(pokemonAfter.completion, 2);
    assert.equal(pokemonAfter.minutes, 750);
    assert.equal(pokemonAfter.importedMinutes, 750);
    assert.deepEqual(pokemonAfter.tags, ['RPG', 'Rétro']);
    assert.deepEqual(pokemonAfter.platforms, ['Switch']);
    const zeldaAfter = library.games.find((game) => game.id === zelda.id);
    assert.equal(zeldaAfter.status, 3);
    assert.equal(zeldaAfter.completion, 1);
    assert.equal(zeldaAfter.minutes, 2400);
    const portalAfter = library.games.find((game) => game.id === portal.id);
    assert.equal(reportMeta[portal.id].appId, '620');
    assert.equal(reportMeta[portal.id].localSteamId, '620');
    assert.deepEqual(portalAfter.tags, ['Coop']);
    const hadesTwo = library.games.find((game) => game.name === 'Hades II');
    assert.ok(hadesTwo);
    assert.equal(hadesTwo.status, 2);
    assert.deepEqual(hadesTwo.tags, ['Roguelike']);
    assert.ok(library.games.some((game) => game.name === 'Jeu importé 194'));
    assert.equal(reportMeta._aliases[metaKey('Zelda BOTW')], zelda.id);

    const reportJson = await fetch(base + applied.data.reportUrl);
    assert.equal(reportJson.status, 200);
    const report = await reportJson.json();
    assert.equal(report.lines.length, 200);
    const reportCsv = await fetch(base + applied.data.reportUrl + '?format=csv');
    assert.equal(reportCsv.status, 200);
    const reportCsvBytes = Buffer.from(await reportCsv.arrayBuffer());
    assert.deepEqual([...reportCsvBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const reportCsvText = reportCsvBytes.toString('utf8').replace(/^\uFEFF/, '');
    assert.match(reportCsvText, /"Ligne","Titre","Action","Résultat","Jeu","Erreur"/);

    const afterImport = await readLibrary();
    const undo = await post('/api/v1/import/undo', { id: applied.data.undoId });
    assert.equal(undo.response.status, 200);
    library = await readLibrary();
    assert.deepEqual(library.games, beforeLibrary.games);
    assert.deepEqual(library.favorites, beforeLibrary.favorites);
    assert.deepEqual(library.sessions, afterImport.sessions);
    assert.deepEqual(await readMeta(), beforeMeta);
    const missingUndo = await post('/api/v1/import/undo', { id: applied.data.undoId });
    assert.equal(missingUndo.response.status, 404);
  }
);
