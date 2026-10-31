import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import viteConfig from '../vite.config.js';
import { createWorker } from '../server/worker.js';
import { setup, testPassword } from './helpers.js';

test('account writes through the real Vite proxy accept the browser origin and reject cross-site requests', async t => {
  const fixture = await setup({ appUrl: 'http://localhost:5173' });
  t.after(() => fixture.close());
  const backend = await new Promise(resolve => { const server = fixture.app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => backend.close(resolve)));
  const target = `http://127.0.0.1:${backend.address().port}`;
  const configuredProxy = viteConfig.server.proxy['/api'];
  const proxy = await createServer({ ...viteConfig, configFile: false, logLevel: 'silent', server: {
    ...viteConfig.server, host: '127.0.0.1', port: 0, hmr: false,
    proxy: { '/api': typeof configuredProxy === 'string' ? target : { ...configuredProxy, target } },
  } });
  await proxy.listen();
  t.after(() => proxy.close());
  const origin = `http://127.0.0.1:${proxy.httpServer.address().port}`;
  let cookie;
  const write = (path, body, headers = {}, method = 'POST') => fetch(`${origin}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'marketplace-alerts', Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }), ...headers }, body: JSON.stringify(body),
  });
  const signup = await write('/auth/signup', { username: 'proxy_user', password: testPassword });
  assert.equal(signup.status, 201, await signup.clone().text());
  cookie = signup.headers.get('set-cookie').split(';')[0];
  assert.equal((await write('/searches', { name: 'Proxy search', query: 'jacket', notifyExisting: true })).status, 201);
  const worker = createWorker({ db: fixture.db, vault: fixture.vault, scan: async () => ({ scanned: 2, items: ['one', 'two'].map(productId => ({ source: 'vinted', productId, title: `Jacket ${productId}`, price: '28', currency: 'GBP', url: 'https://www.vinted.co.uk/items/123', attributes: {} })) }) });
  await worker.scanNext();
  const allRead = await write('/notifications/read', { all: true });
  assert.equal(allRead.status, 200);
  assert.equal((await allRead.json()).unreadCount, 0);
  const readBack = await fetch(`${origin}/api/notifications`, { headers: { Cookie: cookie } });
  const feed = await readBack.json();
  assert.equal(feed.notifications.length, 2);
  assert.ok(feed.notifications.every(item => item.readAt));
  assert.equal((await write('/settings', { settings: { theme: 'dark' } }, {}, 'PATCH')).status, 200);
  assert.equal((await write('/settings', { settings: { theme: 'light' } }, { Origin: 'https://untrusted.example', 'Sec-Fetch-Site': 'cross-site' }, 'PATCH')).status, 403);
  assert.equal((await write('/notifications/read', { all: true }, { 'X-Requested-With': '' })).status, 403);
  assert.equal((await write('/auth/logout', {})).status, 200);
  const login = await write('/auth/login', { username: 'proxy_user', password: testPassword });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.settings.theme, 'dark');
});
