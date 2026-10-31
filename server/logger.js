import { mkdir, stat, rename, rm, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

// Only operational metadata can enter logs. Never accept request bodies, URLs,
// headers, email addresses, credentials, or provider error messages.
const fields = new Set(['requestId', 'method', 'route', 'statusCode', 'durationMs', 'userId', 'searchId', 'source', 'count', 'channel', 'attempt', 'errorName', 'database', 'host', 'port', 'enabled', 'signal']);
const levels = { info: 1, warn: 2, error: 3 };

export async function createLogger({ directory = process.env.LOG_DIR || 'data/logs', maxBytes = 10 * 1024 * 1024, files = 5, level = process.env.LOG_LEVEL || 'info', output = process.stdout } = {}) {
  let size = 0, queue = Promise.resolve(), pending = 0, closed = false, fileFailed = false;
  const file = directory && join(directory, 'scout.jsonl');
  if (file) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    size = await stat(file).then(s => s.size).catch(error => { if (error.code !== 'ENOENT') throw error; return 0; });
  }
  const write = (severity, event, metadata = {}) => {
    if (closed || levels[severity] < (levels[level] || 1)) return;
    const safe = Object.fromEntries(Object.entries(metadata).filter(([key, value]) => fields.has(key) && ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 180) : value]));
    const line = JSON.stringify({ time: new Date().toISOString(), level: severity, event: /^[a-z0-9_.-]{1,80}$/.test(event) ? event : 'invalid_event', ...safe }) + '\n';
    output.write(line);
    if (!file || fileFailed || pending >= 1000) return;
    pending++;
    queue = queue.then(async () => {
      const bytes = Buffer.byteLength(line);
      if (size && size + bytes > maxBytes) {
        await rm(`${file}.${files - 1}`, { force: true });
        for (let n = files - 2; n >= 0; n--) {
          await rename(n ? `${file}.${n}` : file, `${file}.${n + 1}`).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
        size = 0;
      }
      await appendFile(file, line, { mode: 0o600 }); size += bytes;
    }).catch(() => {
      if (!fileFailed) output.write(JSON.stringify({ time: new Date().toISOString(), level: 'error', event: 'logs.file_unavailable' }) + '\n');
      fileFailed = true;
    }).finally(() => { pending--; });
  };
  return {
    info: (event, metadata) => write('info', event, metadata),
    warn: (event, metadata) => write('warn', event, metadata),
    error: (event, metadata) => write('error', event, metadata),
    flush: () => queue,
    close: async () => { closed = true; await queue; },
  };
}
