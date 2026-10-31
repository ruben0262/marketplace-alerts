import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setup, send, testPassword } from './helpers.js';
import { importProfile } from '../scripts/import-profile.js';
import request from 'supertest';

test('legacy import migrates configuration once without resetting an existing account', async () => {
  const env = await setup();
  try {
    const recoveryPath = join(await mkdtemp(join(tmpdir(), 'scout-import-')), 'recovery');
    const input = { db: env.db, secretVault: env.vault, recoveryPath,
      env: { IMPORT_USERNAME: 'existing_owner', IMPORT_PASSWORD: testPassword, EBAY_CLIENT_ID: 'personal-app', EBAY_CLIENT_SECRET: 'personal-secret', TELEGRAM_BOT_TOKEN: '123:ownbot', TELEGRAM_CHAT_ID: '123', EBAY_PROXY: 'http://user:pass@proxy.example:8080' },
      raw: { app: { poll_interval_seconds: 120 }, sources: { vinted: { enabled: true, sites: [{ url: 'https://www.vinted.hu' }], results_per_page: 15 }, ebay: { enabled: true, marketplaces: [{ id: 'EBAY_GB' }] } }, searches: [{ name: 'BOXRAW', query: 'boxraw', required_brands: ['boxraw'], excluded_sizes: ['s', 'xs'] }] },
    };
    assert.equal((await importProfile(input)).created, true);
    const agent = request.agent(env.app);
    assert.equal((await send(agent, 'post', '/auth/login', { username: 'existing_owner', password: testPassword })).status, 200);
    const me = (await agent.get('/api/me')).body.user;
    assert.deepEqual(me.settings.vintedRegions, ['HU']); assert.equal(me.configured.ebayProxy, true);
    const searches = (await agent.get('/api/searches')).body.searches;
    assert.equal(searches.length, 1); assert.deepEqual(searches[0].requiredBrands, ['boxraw']); assert.deepEqual(searches[0].sources, ['vinted', 'ebay']);
    assert.equal((await stat(recoveryPath)).mode & 0o777, 0o600);
    const recovery = await readFile(recoveryPath, 'utf8'); assert.ok(recovery.includes('existing_owner'));
    assert.equal((await importProfile({ ...input, env: { ...input.env, IMPORT_PASSWORD: 'DoNotResetMe123!' } })).created, false);
    assert.equal((await send(agent, 'post', '/auth/login', { username: 'existing_owner', password: testPassword })).status, 200);
    assert.equal((await agent.get('/api/searches')).body.searches.length, 1);
  } finally { await env.close(); }
});
