import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { setup, testPassword } from './helpers.js';

test('production serves compressed, immutable assets but revalidates HTML and keeps API responses private', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scout-static-'));
  await mkdir(join(directory, 'assets'));
  const javascript = 'console.log("Scout");\n'.repeat(300), html = '<!doctype html><title>Scout</title>';
  await writeFile(join(directory, 'assets', 'app-hash.js'), javascript);
  await writeFile(join(directory, 'index.html'), html);
  await writeFile(join(directory, 'sw.js'), '// Service worker');
  const env = await setup({ clientDirectory: directory });
  try {
    const asset = await request(env.app).get('/assets/app-hash.js').set('Accept-Encoding', 'gzip');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers['content-encoding'], 'gzip');
    assert.match(asset.headers['cache-control'], /max-age=31536000.*immutable/);
    assert.equal(asset.text, javascript);
    for (const path of ['/', '/index.html', '/app/settings', '/reset-password']) {
      const page = await request(env.app).get(path);
      assert.equal(page.status, 200);
      assert.equal(page.headers['cache-control'], 'no-cache');
      assert.equal(page.text, html);
    }
    assert.equal((await request(env.app).get('/sw.js')).headers['cache-control'], 'no-cache');
    assert.equal((await request(env.app).get('/api/meta')).headers['cache-control'], 'no-store');
    assert.equal((await request(env.app).get('/assets/missing.js')).status, 404);
  } finally { await env.close(); await rm(directory, { recursive: true, force: true }); }
});

test('onboarding behind the HTTPS tunnel uses secure cookies and the public domain in email links', async () => {
  const mail = [], origin = 'https://scout.rubenlekli.com';
  const env = await setup({ appUrl: origin, secureCookies: true, trustProxy: true, sendEmail: async message => { mail.push(message); } });
  const post = (path, body) => request(env.app).post(`/api${path}`).set({ Host: '127.0.0.1:3000', Origin: origin, 'X-Forwarded-Host': 'scout.rubenlekli.com', 'X-Forwarded-Proto': 'https', 'X-Requested-With': 'marketplace-alerts' }).send(body);
  try {
    const signup = await post('/auth/signup', { email: 'onboarding@example.com', password: testPassword });
    assert.equal(signup.status, 201);
    assert.match(signup.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/);
    assert.ok(mail[0].text.includes(`${origin}/verify-email#`));
    assert.equal((await post('/auth/forgot', { email: 'onboarding@example.com' })).status, 200);
    assert.ok(mail[1].text.includes(`${origin}/reset-password#`));
  } finally { await env.close(); }
});
