import fs from 'node:fs';
import path from 'node:path';

const SECRET_KEY =
  /(token|secret|password|passwd|api[-_]?key|authorization|cookie|bearer|bot[-_]?token|discord[-_]?token)/i;
const SECRET_TEXT = [
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]'],
  [/([?&](?:token|key|api_key|apikey|secret)=)[^&\s]+/gi, '$1[redacted]'],
  [/((?:DISCORD|BOT|TMDB|RAWG)[A-Z0-9_]*\s*=\s*)\S+/gi, '$1[redacted]'],
  [/((?:token|secret|password|api[-_]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]']
];

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_KEEP = 5;

export function redact(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[profondeur limitée]';
  if (typeof value === 'string') {
    let text = value;
    for (const [pattern, replacement] of SECRET_TEXT) text = text.replace(pattern, replacement);
    return text.length > 4000 ? text.slice(0, 4000) + '…' : text;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circulaire]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1, seen));
  if (value instanceof Error) return { name: value.name, message: redact(value.message), code: value.code };
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(item, depth + 1, seen);
  }
  return output;
}

function stampDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function rotateFile(file, keep) {
  for (let index = keep - 1; index >= 1; index -= 1) {
    const source = index === 1 ? file : `${file}.${index - 1}`;
    const target = `${file}.${index}`;
    try {
      if (fs.existsSync(source)) fs.renameSync(source, target);
    } catch {}
  }
}

export function createLogger({
  dir,
  component = 'app',
  maxBytes = DEFAULT_MAX_BYTES,
  keep = DEFAULT_KEEP,
  console: consoleOutput = false
} = {}) {
  if (!dir) throw new Error('createLogger : dossier manquant');
  const logsDir = path.join(dir, 'logs');
  let day = stampDay();

  function currentFile(date = new Date()) {
    const nextDay = stampDay(date);
    if (nextDay !== day) {
      day = nextDay;
    }
    return path.join(logsDir, `orbit-${nextDay}.jsonl`);
  }

  function append(level, message, context) {
    const at = new Date();
    const entry = {
      at: at.toISOString(),
      level,
      component,
      message: redact(String(message ?? '')).slice(0, 2000)
    };
    if (context !== undefined) entry.context = redact(context);
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      const file = currentFile(at);
      try {
        if (fs.statSync(file).size >= maxBytes) rotateFile(file, keep);
      } catch {}
      fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
    } catch {}
    if (consoleOutput) {
      const line = `[orbit:${component}] ${entry.message}`;
      if (level === 'error') globalThis.console.error(line, entry.context || '');
      else if (level === 'warn') globalThis.console.warn(line, entry.context || '');
      else globalThis.console.log(line, entry.context || '');
    }
    return entry;
  }

  function recent(limit = 20, levels = null) {
    const wanted = levels ? new Set([].concat(levels)) : null;
    const entries = [];
    try {
      const files = fs
        .readdirSync(logsDir)
        .filter((name) => /^orbit-\d{4}-\d{2}-\d{2}\.jsonl(?:\.\d+)?$/.test(name))
        .sort()
        .reverse();
      for (const name of files) {
        const lines = fs.readFileSync(path.join(logsDir, name), 'utf8').split('\n').filter(Boolean);
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          try {
            const entry = JSON.parse(lines[index]);
            if (wanted && !wanted.has(entry.level)) continue;
            entries.push(entry);
            if (entries.length >= limit) return entries.reverse();
          } catch {}
        }
      }
    } catch {}
    return entries.reverse();
  }

  return {
    dir: logsDir,
    debug: (message, context) => append('debug', message, context),
    info: (message, context) => append('info', message, context),
    warn: (message, context) => append('warn', message, context),
    error: (message, context) => append('error', message, context),
    recent
  };
}

export function logRedactionSelfTest() {
  const sample = {
    token: 'abc123',
    nested: { apiKey: 'xyz', safe: 'Bearer super-secret' },
    line: 'DISCORD_TOKEN=very-secret TMDB_API_KEY=also-secret',
    url: 'http://127.0.0.1/?token=secret-value&x=1'
  };
  const text = JSON.stringify(redact(sample));
  return !/abc123|xyz|super-secret|very-secret|also-secret|secret-value/.test(text);
}
