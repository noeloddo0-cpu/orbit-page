#!/usr/bin/env node
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  createBackup,
  listBackups,
  readJson,
  restoreFilesFromBackup,
  verifyBackup
} from '../orbit-backup.mjs';
import { migrateToV2, LIBRARY_VERSION } from '../orbit-library.mjs';
import { imageSize } from '../steam-local.mjs';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function has(name) {
  return process.argv.includes(name);
}

function defaultDataDir() {
  if (process.env.GAME_TRACKER_DATA_DIR) return path.resolve(process.env.GAME_TRACKER_DATA_DIR);
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'orbit');
  return '';
}

function dimensions(buffer) {
  const basic = imageSize(buffer);
  if (basic) return basic;
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  switch (buffer.toString('ascii', 12, 16)) {
    case 'VP8X':
      return [1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3)];
    case 'VP8 ':
      return [buffer.readUInt16LE(26) & 16383, buffer.readUInt16LE(28) & 16383];
    case 'VP8L': {
      const value = buffer.readUInt32LE(21);
      return [(value & 16383) + 1, ((value >>> 14) & 16383) + 1];
    }
    default:
      return null;
  }
}

async function coverRecords(dataDir) {
  const directory = path.join(dataDir, 'covers');
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      const file = path.join(directory, entry.name);
      const [buffer, info] = await Promise.all([readFile(file), stat(file)]);
      const size = dimensions(buffer);
      records.push({
        name: entry.name,
        width: size?.[0] || 0,
        height: size?.[1] || 0,
        mtime: Math.round(info.mtimeMs)
      });
    } catch {}
  }
  return records;
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await rename(temp, file);
}

async function writeReport(dataDir, report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = option('--report') || path.join(dataDir, `migration-v2-report-${stamp}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, report);
  return file;
}

function summary(report, mode) {
  const lines = [];
  lines.push(`Orbit — migration ${report.sourceVersion} -> ${LIBRARY_VERSION} (${mode})`);
  lines.push(
    `Jeux ${report.counts.games} · sessions ${report.counts.sessions} · favoris ${report.counts.favorites} · jaquettes ${report.counts.covers}`
  );
  lines.push(
    `Doublons de jeux ${report.counts.duplicateGames} · sessions orphelines ${report.orphanSessions.length} · métadonnées orphelines ${report.orphanMeta.length}`
  );
  if (report.recoveredMeta.length) lines.push(`Métadonnées rattachées ${report.recoveredMeta.length}`);
  if (report.archivedMeta?.length) lines.push(`Doublons de métadonnées archivés ${report.archivedMeta.length}`);
  if (report.orphanFavorites.length) lines.push(`Favoris sans jeu ${report.orphanFavorites.length} (conservés)`);
  if (report.warnings.length) lines.push(`Avertissements ${report.warnings.length}`);
  return lines.join('\n');
}

async function migrate(dataDir) {
  const libraryPath = path.join(dataDir, 'library.json');
  const metaPath = path.join(dataDir, 'meta.json');
  const library = await readJson(libraryPath);
  if (!library || !Array.isArray(library.games)) throw new Error(`library.json illisible : ${libraryPath}`);
  const meta = (await readJson(metaPath, {})) || {};
  const covers = await coverRecords(dataDir);
  const result = migrateToV2({ library, meta, covers });
  const dryRun = !has('--apply');
  const output = {
    ...result.report,
    dryRun,
    dataDir,
    backup: null,
    reportFile: null
  };
  console.log(summary(result.report, dryRun ? 'dry-run, aucune écriture' : 'application'));
  if (dryRun) {
    const reportFile = option('--report') ? await writeReport(dataDir, output) : null;
    if (reportFile) console.log(`Rapport : ${reportFile}`);
    console.log('Aucune donnée modifiée. Relance avec --apply après vérification.');
    return { ...output, reportFile };
  }
  if (!result.report.changed) {
    console.log('Le fichier est déjà en version 2 et aucune correction n’est nécessaire.');
    const reportFile = option('--report') ? await writeReport(dataDir, output) : null;
    return { ...output, changed: false, reportFile };
  }
  if (library.version === LIBRARY_VERSION) {
    throw new Error('library.json annonce déjà la version 2 : migration refusée pour éviter un écrasement.');
  }

  const backup = await createBackup({ dataDir, reason: 'before-migration', appVersion: '1.0.32' });
  if (!backup.verified) throw new Error(`Sauvegarde non vérifiée : ${backup.directory}`);
  const verification = await verifyBackup(backup.directory);
  if (!verification.ok) throw new Error(`Sauvegarde invalide : ${backup.directory}`);
  output.backup = { directory: backup.directory, name: backup.name, verified: true, counts: backup.manifest.counts };

  await writeJsonAtomic(libraryPath, result.library);
  await writeJsonAtomic(metaPath, result.meta);
  const writtenLibrary = await readJson(libraryPath);
  const writtenMeta = await readJson(metaPath);
  if (writtenLibrary?.version !== LIBRARY_VERSION || writtenLibrary.games.length !== result.library.games.length) {
    throw new Error('La relecture de library.json après écriture ne correspond pas.');
  }
  if (writtenMeta?._schema !== 2) throw new Error('La relecture de meta.json après écriture ne correspond pas.');
  output.reportFile = await writeReport(dataDir, output);
  console.log(`Sauvegarde vérifiée : ${backup.directory}`);
  console.log(`Rapport : ${output.reportFile}`);
  console.log('Migration terminée. Un retour arrière reste possible avec --rollback.');
  return output;
}

async function rollback(dataDir) {
  const rootBackups = path.join(dataDir, 'backups');
  const requested = option('--rollback');
  let target = requested && requested !== 'latest' ? path.resolve(requested) : '';
  if (!target) {
    const backups = await listBackups(rootBackups);
    const candidates = backups.filter((backup) => ['before-migration', 'before-rollback'].includes(backup.reason));
    target = candidates[0]?.directory || '';
  }
  if (!target) throw new Error('Aucune sauvegarde de migration trouvée.');
  const verification = await verifyBackup(target);
  if (!verification.ok) throw new Error(`Sauvegarde invalide ou incomplète : ${target}`);
  const before = await createBackup({ dataDir, reason: 'before-rollback', appVersion: '1.0.32' });
  if (!before.verified) throw new Error('Impossible de sauvegarder l’état actuel avant le retour arrière.');
  await restoreFilesFromBackup(target, dataDir);
  const library = await readJson(path.join(dataDir, 'library.json'));
  console.log(`Retour arrière effectué depuis ${target}`);
  console.log(`Version restaurée : ${library?.version ?? 'inconnue'} · jeux ${library?.games?.length ?? 0}`);
  console.log(`État remplacé sauvegardé dans ${before.directory}`);
  return { ok: true, restoredFrom: target, before: before.directory, libraryVersion: library?.version ?? null };
}

async function main() {
  const dataDir = path.resolve(option('--data', defaultDataDir()));
  if (!dataDir) throw new Error('Indique --data <dossier> ou GAME_TRACKER_DATA_DIR.');
  if (!path.isAbsolute(dataDir)) throw new Error('Le dossier de données doit être absolu.');
  if (has('--rollback') || option('--rollback')) {
    const result = await rollback(dataDir);
    if (has('--json')) console.log(JSON.stringify(result, null, 2));
    return;
  }
  const result = await migrate(dataDir);
  if (has('--json')) console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`Migration impossible : ${error.message}`);
  process.exitCode = 1;
});
