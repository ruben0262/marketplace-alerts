import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../server/logger.js';

test('operational logs reach the terminal and bounded private files without credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scout-logs-'));
  let terminal = '';
  const logger = await createLogger({ directory, maxBytes: 420, files: 3, output: { write: line => { terminal += line; } } });
  try {
    for (let count = 0; count < 30; count++) logger.info('scan.completed', { count, source: 'vinted', password: 'never-log-this', body: { token: 'secret' }, uri: 'mongodb://secret' });
    logger.error('scan.failed', { errorName: 'ProviderError', message: 'private provider URL' });
    await logger.close();
    const files = await readdir(directory);
    assert.equal(files.length, 3);
    const stored = (await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')))).join('');
    for (const text of [terminal, stored]) {
      assert.ok(!/never-log-this|secret|private provider/.test(text));
      const records = text.trim().split('\n').map(line => JSON.parse(line));
      assert.ok(records.some(record => record.event === 'scan.failed' && record.level === 'error'));
      assert.ok(records.every(record => !Number.isNaN(Date.parse(record.time))));
    }
    assert.equal(terminal.trim().split('\n').length, 31);
    assert.ok(stored.includes('"count":29'));
    for (const file of files) {
      const info = await stat(join(directory, file));
      assert.ok(info.size <= 420);
      assert.equal(info.mode & 0o777, 0o600);
    }
  } finally { await logger.close(); await rm(directory, { recursive: true, force: true }); }
});

test('log level filters routine events and file-free logging is supported', async () => {
  let terminal = '';
  const logger = await createLogger({ directory: null, level: 'warn', output: { write: line => { terminal += line; } } });
  logger.info('server.ready'); logger.warn('delivery.failed', { attempt: 2 });
  await logger.close();
  const record = JSON.parse(terminal);
  assert.equal(record.event, 'delivery.failed'); assert.equal(record.attempt, 2);
});
