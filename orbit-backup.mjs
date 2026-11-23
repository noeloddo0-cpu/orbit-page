import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BACKUP_DATA_FILES = ['library.json', 'settings.json', 'recap.json', 'cinema.json'];
export const BACKUP_OPTIONAL_FILES = ['meta.json', 'psn-reference.json'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export async function sha256File(file) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await rename(temp, file);
}

async function directorySize(directory) {
  let total = 0;
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) total += await directorySize(target);
      else {
        try {
          total += (await stat(target)).size;
        } catch {}
      }
    }
  } catch {}
  return total;
}

function countsFrom(library, cinema) {
  return {
    games: Array.isArray(library?.games) ? library.games.length : 0,
    sessions: Array.isArray(library?.sessions) ? library.sessions.length : 0,
    favorites: Array.isArray(library?.favorites) ? library.favorites.length : 0,
    films: Array.isArray(cinema?.items) ? cinema.items.filter((item) => item?.type === 'film').length : 0,
    series: Array.isArray(cinema?.items) ? cinema.items.filter((item) => item?.type === 'series').length : 0
  };
}

async function verifyFiles(directory, files) {
  const errors = [];
  for (const file of files) {
    const target = path.join(directory, file.name);
    try {
      const info = await stat(target);
      if (info.size !== file.size) {
        errors.push({ file: file.name, error: 'taille différente', expected: file.size, actual: info.size });
        continue;
      }
      const digest = await sha256File(target);
      if (digest !== file.sha256)
        errors.push({ file: file.name, error: 'empreinte différente', expected: file.sha256, actual: digest });
    } catch {
      errors.push({ file: file.name, error: 'fichier absent' });
    }
  }
  return { ok: errors.length === 0, checked: files.length, errors };
}

export async function verifyBackup(directory) {
  const manifest = await readJson(path.join(directory, 'backup-manifest.json'));
  if (!manifest || manifest.format !== 'orbit-backup-manifest' || !Array.isArray(manifest.files)) {
    return { ok: false, legacy: true, error: 'Manifeste absent ou invalide', checked: 0, errors: [] };
  }
  const verification = await verifyFiles(directory, manifest.files);
  return { ...verification, manifest, legacy: false };
}

export async function listBackups(root) {
  const output = [];
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return output;
  }
  const names = entries
    .filter((entry) => entry.isDirectory() && STAMP.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of names) {
    const directory = path.join(root, name);
    const manifest = await readJson(path.join(directory, 'backup-manifest.json'));
    let mtime = 0;
    try {
      mtime = (await stat(directory)).mtimeMs;
    } catch {}
    output.push({
      name,
      directory,
      createdAt: manifest?.createdAt || new Date(mtime).toISOString(),
      mtime,
      reason: manifest?.reason || 'automatic',
      appVersion: manifest?.appVersion || '',
      verified: manifest?.verified === true,
      hasManifest: !!manifest,
      counts: manifest?.counts || {},
      covers: manifest?.covers || 0,
      files: Array.isArray(manifest?.files) ? manifest.files.length : 0,
      size: await directorySize(directory)
    });
  }
  return output;
}

export async function pruneBackups(root, { keepAutomatic = 10, keepManual = 5 } = {}) {
  const backups = await listBackups(root);
  const automatic = backups.filter(
    (backup) =>
      !['manual', 'before-restore', 'before-import', 'before-update', 'before-migration', 'before-rollback'].includes(
        backup.reason
      )
  );
  const manual = backups.filter((backup) =>
    ['manual', 'before-restore', 'before-import', 'before-update', 'before-migration', 'before-rollback'].includes(
      backup.reason
    )
  );
  const remove = [...automatic.slice(Math.max(0, keepAutomatic)), ...manual.slice(Math.max(0, keepManual))];
  const removed = [];
  for (const backup of remove) {
    try {
      await rm(backup.directory, { recursive: true, force: true });
      removed.push(backup.name);
    } catch {}
  }
  return removed;
}

export async function createBackup({
  dataDir,
  reason = 'automatic',
  appVersion = '',
  keepAutomatic = 10,
  keepManual = 5,
  logger = null
} = {}) {
  if (!dataDir) throw new Error('createBackup : dossier de données manquant');
  const root = path.join(dataDir, 'backups');
  await mkdir(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(root, stamp);
  await mkdir(destination, { recursive: true });

  let priorCovers = '';
  try {
    const prior = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && STAMP.test(entry.name) && entry.name !== stamp)
      .map((entry) => entry.name)
      .sort()
      .reverse()[0];
    if (prior) priorCovers = path.join(root, prior, 'covers');
  } catch {}

  const files = [];
  async function record(relative) {
    const target = path.join(destination, relative);
    const info = await stat(target);
    files.push({ name: relative, size: info.size, sha256: await sha256File(target) });
  }

  for (const name of [...BACKUP_DATA_FILES, ...BACKUP_OPTIONAL_FILES]) {
    const source = path.join(dataDir, name);
    if (!(await exists(source))) continue;
    await copyFile(source, path.join(destination, name));
    await record(name);
  }

  const coversSource = path.join(dataDir, 'covers');
  let covers = 0;
  try {
    const names = (await readdir(coversSource, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort();
    await mkdir(path.join(destination, 'covers'), { recursive: true });
    for (const name of names) {
      const source = path.join(coversSource, name);
      const target = path.join(destination, 'covers', name);
      let linked = false;
      if (priorCovers) {
        const candidate = path.join(priorCovers, name);
        try {
          if ((await stat(candidate)).size === (await stat(source)).size) {
            const [sourceHash, candidateHash] = await Promise.all([sha256File(source), sha256File(candidate)]);
            if (sourceHash === candidateHash) {
              await link(candidate, target);
              linked = true;
            }
          }
        } catch {}
      }
      if (!linked) await copyFile(source, target);
      await record('covers/' + name);
      covers += 1;
    }
  } catch {}

  const library = await readJson(path.join(destination, 'library.json'));
  const cinema = await readJson(path.join(destination, 'cinema.json'));
  const manifest = {
    format: 'orbit-backup-manifest',
    version: 1,
    createdAt: new Date().toISOString(),
    reason,
    appVersion,
    schemaVersion: Number(library?.version) || 1,
    files,
    covers,
    counts: countsFrom(library, cinema),
    verified: false
  };
  await writeJsonAtomic(path.join(destination, 'backup-manifest.json'), manifest);
  const verification = await verifyFiles(destination, files);
  manifest.verified = verification.ok;
  manifest.verifiedAt = new Date().toISOString();
  manifest.verificationErrors = verification.errors.slice(0, 20);
  await writeJsonAtomic(path.join(destination, 'backup-manifest.json'), manifest);
  const removed = await pruneBackups(root, { keepAutomatic, keepManual });
  const result = {
    ok: true,
    directory: destination,
    name: stamp,
    manifest,
    verified: verification.ok,
    errors: verification.errors,
    removed
  };
  if (logger) {
    if (verification.ok)
      logger.info('Sauvegarde vérifiée', {
        backup: stamp,
        reason,
        covers,
        files: files.length,
        removed: removed.length
      });
    else
      logger.error('Sauvegarde créée mais non vérifiée', {
        backup: stamp,
        reason,
        errors: verification.errors.slice(0, 5)
      });
  }
  return result;
}

export async function latestBackup(root) {
  const backups = await listBackups(root);
  return backups[0] || null;
}

export async function preserveCorrupt(file) {
  if (!(await exists(file))) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let target = `${file}.corrupt-${stamp}`;
  let index = 1;
  while (await exists(target)) target = `${file}.corrupt-${stamp}-${index++}`;
  await copyFile(file, target);
  return target;
}

export async function restoreFilesFromBackup(backupDirectory, dataDir) {
  for (const name of BACKUP_DATA_FILES) {
    const source = path.join(backupDirectory, name);
    if (await exists(source)) await copyFile(source, path.join(dataDir, name));
  }
  for (const name of BACKUP_OPTIONAL_FILES) {
    const source = path.join(backupDirectory, name);
    if (await exists(source)) await copyFile(source, path.join(dataDir, name));
  }
  const coversSource = path.join(backupDirectory, 'covers');
  const coversTarget = path.join(dataDir, 'covers');
  if (await exists(coversSource)) {
    await mkdir(coversTarget, { recursive: true });
    for (const entry of await readdir(coversSource, { withFileTypes: true })) {
      if (!entry.isFile() || !IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      await copyFile(path.join(coversSource, entry.name), path.join(coversTarget, entry.name));
    }
  }
}
