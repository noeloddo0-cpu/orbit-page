import fs from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'secrets.json';
const NAME_PATTERN = /^[a-z][a-zA-Z0-9]{0,30}$/;
let context = null;

function normalizeName(name) {
  if (!NAME_PATTERN.test(String(name || ''))) throw new Error('Nom de secret invalide.');
  return String(name);
}

function readDocument() {
  if (!context) return { version: 1, secrets: {} };
  let raw;
  try {
    raw = fs.readFileSync(context.file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, secrets: {} };
    throw new Error('Coffre de secrets illisible.');
  }
  try {
    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('format inattendu');
    return {
      version: 1,
      ...stored,
      secrets:
        stored.secrets && typeof stored.secrets === 'object' && !Array.isArray(stored.secrets) ? stored.secrets : {}
    };
  } catch {
    throw new Error('Coffre de secrets illisible.');
  }
}

function writeDocument(document) {
  if (!context) throw new Error('Coffre de secrets non initialisé.');
  fs.mkdirSync(context.dir, { recursive: true, mode: 0o700 });
  const temp = context.file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(document, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, context.file);
  try {
    fs.chmodSync(context.file, 0o600);
  } catch {}
}

function reportError(message, error) {
  try {
    context?.logger?.warn?.(message, { error: error?.message || String(error) });
  } catch {}
}

function createAdapter(safeStorage) {
  if (!safeStorage) return null;
  if (typeof safeStorage.encryptStringAsync === 'function' && typeof safeStorage.decryptStringAsync === 'function') {
    return {
      encrypt: async (value) => Buffer.from(await safeStorage.encryptStringAsync(value)),
      decrypt: async (buffer) => {
        const result = await safeStorage.decryptStringAsync(buffer);
        return result && typeof result === 'object' && 'result' in result ? result.result : result;
      }
    };
  }
  if (typeof safeStorage.encryptString === 'function' && typeof safeStorage.decryptString === 'function') {
    return {
      encrypt: async (value) => safeStorage.encryptString(value),
      decrypt: async (buffer) => safeStorage.decryptString(buffer)
    };
  }
  return null;
}

/**
 * Initialise le coffre. `safeStorage` est fourni par Electron ; sans lui
 * (mode `node bridge.js`), le coffre est indisponible et les fichiers
 * historiques restent utilisés par le pont.
 */
export async function initSecrets({ dataDir, safeStorage, logger } = {}) {
  if (!dataDir) throw new Error('Dossier de données manquant.');
  let adapter = null;
  try {
    const available =
      typeof safeStorage?.isAsyncEncryptionAvailable === 'function'
        ? await safeStorage.isAsyncEncryptionAvailable()
        : safeStorage?.isEncryptionAvailable?.() === true;
    if (available) adapter = createAdapter(safeStorage);
  } catch (error) {
    reportError('Chiffrement Windows indisponible', error);
  }
  context = { dir: dataDir, file: path.join(dataDir, FILE_NAME), adapter, logger: logger || null };
  return { available: Boolean(adapter), file: context.file };
}

export function secretsAvailable() {
  return Boolean(context?.adapter);
}

export async function getSecret(name) {
  if (!context?.adapter) return null;
  const key = normalizeName(name);
  let document;
  try {
    document = readDocument();
  } catch (error) {
    reportError('Coffre de secrets illisible', error);
    return null;
  }
  const encrypted = document.secrets[key];
  if (typeof encrypted !== 'string' || !encrypted) return null;
  try {
    const value = await context.adapter.decrypt(Buffer.from(encrypted, 'base64'));
    return typeof value === 'string' && value ? value : null;
  } catch (error) {
    reportError(`Impossible de déchiffrer le secret ${key}`, error);
    return null;
  }
}

export async function setSecret(name, value) {
  if (!context?.adapter) return false;
  const key = normalizeName(name);
  const document = readDocument();
  const text = String(value ?? '');
  if (text) document.secrets[key] = (await context.adapter.encrypt(text)).toString('base64');
  else delete document.secrets[key];
  document.updatedAt = Date.now();
  writeDocument(document);
  return true;
}

export async function deleteSecret(name) {
  return setSecret(name, '');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonPrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.tmp-secret';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

/**
 * Déplace les secrets historiques (config.json botToken, tmdb-api-key.txt)
 * vers le coffre chiffré, uniquement après avoir relu la valeur chiffrée.
 * Ne supprime jamais un original si la vérification échoue.
 */
export async function migrateSecrets({ configPath, tmdbKeyPath } = {}) {
  if (!context?.adapter) return { migrated: [], skipped: 'encryption-unavailable' };
  const migrated = [];

  if (configPath && fs.existsSync(configPath)) {
    const config = readJson(configPath);
    const legacyToken = typeof config?.botToken === 'string' ? config.botToken.trim() : '';
    if (config && legacyToken) {
      const existing = await getSecret('discordToken');
      if (
        !existing &&
        (await setSecret('discordToken', legacyToken)) &&
        (await getSecret('discordToken')) === legacyToken
      ) {
        migrated.push('discordToken');
      }
      if (await getSecret('discordToken')) {
        delete config.botToken;
        writeJsonPrivate(configPath, config);
      }
    }
  }

  if (tmdbKeyPath && fs.existsSync(tmdbKeyPath)) {
    let legacyKey = '';
    try {
      legacyKey = fs.readFileSync(tmdbKeyPath, 'utf8').trim();
    } catch {}
    if (legacyKey) {
      const existing = await getSecret('tmdbKey');
      if (!existing && (await setSecret('tmdbKey', legacyKey)) && (await getSecret('tmdbKey')) === legacyKey) {
        migrated.push('tmdbKey');
      }
      if (await getSecret('tmdbKey')) {
        try {
          fs.unlinkSync(tmdbKeyPath);
        } catch (error) {
          reportError('Ancienne clé TMDB non supprimée', error);
        }
      }
    }
  }

  return { migrated };
}
