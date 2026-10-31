import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setup, signup, send, testPassword } from './helpers.js';
import { createApp } from '../server/app.js';

let env, sent;
before(async () => { sent = []; env = await setup({ sendTelegram: async (secrets, method, payload) => { sent.push({ secrets, method, payload }); return { chat: { type: 'private' } }; }, scan: async () => ({ items: [], scanned: 0 }) }); });
after(async () => env?.close());
beforeEach(async () => { sent.length = 0; for (const name of ['users', 'sessions', 'rateLimits', 'searches', 'matches', 'deliveries', 'notifications']) await env.db.collection(name).deleteMany({}); });

test('a new user signs up, gets Vinted defaults and a recovery key, and can log out and back in', async () => {
  const { agent, user, recoveryKey, cookie } = await signup(env.app, 'New_User');
  assert.equal(user.username, 'new_user'); assert.deepEqual(user.settings.vintedRegions, ['GB']);
  assert.equal(user.configured.ebayClientSecret, false); assert.ok(recoveryKey.length >= 40);
  assert.match(cookie[0], /HttpOnly/); assert.match(cookie[0], /SameSite=Lax/);
  const me = await agent.get('/api/me'); assert.equal(me.status, 200);
  assert.equal(me.body.user.passwordHash, undefined); assert.equal(me.body.user.secrets, undefined);
  assert.equal((await send(agent, 'post', '/auth/logout')).status, 200);
  assert.equal((await agent.get('/api/me')).status, 401);
  assert.equal((await send(agent, 'post', '/auth/login', { username: 'NEW_USER', password: testPassword })).status, 200);
});

test('duplicate usernames are case insensitive and invalid input cannot become a database query', async () => {
  await signup(env.app, 'scouter');
  const agent = request.agent(env.app);
  assert.equal((await send(agent, 'post', '/auth/signup', { username: 'SCOUTER', password: testPassword })).status, 409);
  for (const body of [{ username: { $ne: null }, password: testPassword }, { username: 'bad name', password: testPassword }, { username: 'short', password: 'short' }]) {
    assert.equal((await send(agent, 'post', '/auth/signup', body)).status, 400);
  }
  assert.equal((await send(agent, 'post', '/auth/login', { username: 'scouter', password: 'incorrect' })).status, 401);
});

test('cross-origin writes and requests without the required custom header are rejected', async () => {
  const { agent } = await signup(env.app, 'origin_test');
  const payload = { settings: { notifications: false } };
  assert.equal((await agent.patch('/api/settings').send(payload)).status, 403);
  assert.equal((await agent.patch('/api/settings').set('X-Requested-With', 'marketplace-alerts').set('Origin', 'https://evil.example').send(payload)).status, 403);
  assert.equal((await send(agent, 'patch', '/settings', payload)).status, 200);
});

test('settings persist across new application instances and are isolated; secrets are encrypted and never echoed', async () => {
  const a = await signup(env.app, 'account_a'), b = await signup(env.app, 'account_b');
  const secret = 'private-ebay-secret';
  const result = await send(a.agent, 'patch', '/settings', { settings: { pollInterval: 300, vintedRegions: ['FR', 'HU'] }, credentials: { ebayClientId: 'app-id', ebayClientSecret: secret, telegramBotToken: '123456:abc_secret', telegramChatId: '123456' } });
  assert.equal(result.status, 200); assert.ok(!JSON.stringify(result.body).includes(secret));
  const persisted = await env.db.collection('users').findOne({ username: 'account_a' });
  assert.notEqual(persisted.secrets.ebayClientSecret, secret); assert.equal(env.vault.open(persisted.secrets.ebayClientSecret), secret);
  assert.notEqual(persisted.passwordHash, testPassword);
  const restarted = await createApp({ db: env.db, vault: env.vault });
  const fresh = request.agent(restarted);
  await send(fresh, 'post', '/auth/login', { username: 'account_a', password: testPassword });
  assert.equal((await fresh.get('/api/me')).body.user.settings.pollInterval, 300);
  const other = (await b.agent.get('/api/me')).body.user;
  assert.equal(other.settings.pollInterval, 120); assert.equal(other.configured.ebayClientSecret, false);
  assert.equal((await send(a.agent, 'patch', '/settings', { settings: { pollInterval: 1 } })).status, 400);
  assert.equal((await send(a.agent, 'patch', '/settings', { credentials: { vintedProxy: 'file:///etc/passwd' } })).status, 400);
});

test('eBay is gated until both keys exist and a user can create, edit, pause, resume and delete a search', async () => {
  const { agent } = await signup(env.app, 'searcher');
  const input = { name: 'Vintage jacket', query: 'adidas jacket', sources: ['ebay'], maxPrice: 40 };
  assert.equal((await send(agent, 'post', '/searches', input)).status, 400);
  await send(agent, 'patch', '/settings', { credentials: { ebayClientId: 'app', ebayClientSecret: 'secret' } });
  const created = await send(agent, 'post', '/searches', input); assert.equal(created.status, 201);
  const id = created.body.search._id;
  assert.equal(created.body.search.userId, undefined);
  assert.equal((await send(agent, 'put', `/searches/${id}`, { ...input, query: 'nike jacket', minPrice: 10 })).status, 200);
  assert.equal((await send(agent, 'patch', `/searches/${id}`, { active: false })).body.search.active, false);
  assert.equal((await send(agent, 'post', `/searches/${id}/run`)).status, 400);
  assert.equal((await send(agent, 'patch', `/searches/${id}`, { active: true })).status, 200);
  assert.equal((await send(agent, 'post', `/searches/${id}/run`)).status, 202);
  assert.equal((await send(agent, 'delete', `/searches/${id}`)).status, 200);
  assert.equal((await agent.get('/api/searches')).body.searches.length, 0);
});

test('price, source, category and region input validation prevents malformed searches', async () => {
  const { agent } = await signup(env.app, 'validation');
  for (const fields of [{ minPrice: 100, maxPrice: 10 }, { sources: [] }, { sources: ['unknown'] }, { vintedCatalogIds: ['not-a-number'] }, { query: '' }, { active: 'yes' }]) {
    assert.equal((await send(agent, 'post', '/searches', { name: 'Test', query: 'camera', ...fields })).status, 400);
  }
  assert.equal((await send(agent, 'patch', '/settings', { settings: { vintedRegions: [] } })).status, 400);
  assert.equal((await send(agent, 'patch', '/settings', { settings: { vintedRegions: ['https://localhost'] } })).status, 400);
});

test('users cannot read, edit, run or delete another user’s searches or matches', async () => {
  const a = await signup(env.app, 'owner'), b = await signup(env.app, 'outsider');
  const created = await send(a.agent, 'post', '/searches', { name: 'Private search', query: 'camera' });
  const id = created.body.search._id;
  await env.db.collection('matches').insertOne({ userId: new ObjectId(a.user.id), source: 'vinted', productId: 'p1', title: 'Private result', searchIds: [new ObjectId(id)], foundAt: new Date() });
  assert.deepEqual((await b.agent.get('/api/searches')).body.searches, []);
  assert.deepEqual((await b.agent.get(`/api/matches?search=${id}`)).body.matches, []);
  assert.equal((await send(b.agent, 'put', `/searches/${id}`, { name: 'Hijack', query: 'x' })).status, 404);
  assert.equal((await send(b.agent, 'patch', `/searches/${id}`, { active: false })).status, 404);
  assert.equal((await send(b.agent, 'post', `/searches/${id}/run`)).status, 404);
  assert.equal((await send(b.agent, 'delete', `/searches/${id}`)).status, 404);
  assert.equal((await b.agent.get('/api/dashboard')).body.totalMatches, 0);
  assert.equal((await send(b.agent, 'delete', '/searches/not-an-id')).status, 404);
});

test('matches paginate without duplicates and filter by marketplace', async () => {
  const { agent, user } = await signup(env.app, 'feed');
  await env.db.collection('matches').insertMany(Array.from({ length: 7 }, (_, i) => ({ userId: new ObjectId(user.id), source: i % 2 ? 'ebay' : 'vinted', productId: `p${i}`, title: `Product ${i}`, foundAt: new Date() })));
  const first = (await agent.get('/api/matches?limit=3')).body;
  assert.equal(first.matches.length, 3); assert.ok(first.nextCursor);
  const second = (await agent.get(`/api/matches?limit=3&before=${first.nextCursor}`)).body;
  assert.equal(new Set([...first.matches, ...second.matches].map(m => m._id)).size, 6);
  assert.equal((await agent.get('/api/matches?source=ebay')).body.matches.length, 3);
  assert.equal((await agent.get('/api/matches?limit=9999')).status, 400);
});

test('a recovery key works once, rotates, and invalidates every previous session', async () => {
  const { agent, recoveryKey } = await signup(env.app, 'recover');
  const another = request.agent(env.app);
  await send(another, 'post', '/auth/login', { username: 'recover', password: testPassword });
  const reset = await send(request.agent(env.app), 'post', '/auth/reset', { username: 'recover', recoveryKey, password: 'ReplacementPassword123!' });
  assert.equal(reset.status, 200); assert.notEqual(reset.body.recoveryKey, recoveryKey);
  assert.equal((await agent.get('/api/me')).status, 401); assert.equal((await another.get('/api/me')).status, 401);
  assert.equal((await send(request.agent(env.app), 'post', '/auth/reset', { username: 'recover', recoveryKey, password: testPassword })).status, 400);
  assert.equal((await send(request.agent(env.app), 'post', '/auth/login', { username: 'recover', password: testPassword })).status, 401);
  assert.equal((await send(request.agent(env.app), 'post', '/auth/login', { username: 'recover', password: 'ReplacementPassword123!' })).status, 200);
});

test('password changes require the current password, revoke other sessions, and return a new recovery key', async () => {
  const { agent } = await signup(env.app, 'password_change');
  const other = request.agent(env.app); await send(other, 'post', '/auth/login', { username: 'password_change', password: testPassword });
  assert.equal((await send(agent, 'post', '/password', { currentPassword: 'wrong', password: 'DifferentPassword123!' })).status, 400);
  const result = await send(agent, 'post', '/password', { currentPassword: testPassword, password: 'DifferentPassword123!' });
  assert.equal(result.status, 200); assert.ok(result.body.recoveryKey);
  assert.equal((await agent.get('/api/me')).status, 200); assert.equal((await other.get('/api/me')).status, 401);
});

test('Telegram recovery is generic, tokens are expiring and single use, and a connection edit revokes verification', async () => {
  const { agent } = await signup(env.app, 'telegram_recovery');
  await send(agent, 'patch', '/settings', { credentials: { telegramBotToken: '123:token', telegramChatId: '123' } });
  const unknown = await send(agent, 'post', '/auth/forgot', { username: 'does_not_exist' });
  const unverified = await send(agent, 'post', '/auth/forgot', { username: 'telegram_recovery' });
  assert.deepEqual(unverified.body, unknown.body); assert.equal(sent.length, 0);
  assert.equal((await send(agent, 'post', '/connections/telegram/test')).status, 200);
  const botId = (await agent.get('/api/me')).body.user.telegramBots[0].id;
  await send(agent, 'patch', '/settings', { recoveryTelegramBotId: botId });
  const forgot = await send(agent, 'post', '/auth/forgot', { username: 'telegram_recovery' });
  assert.deepEqual(forgot.body, unknown.body);
  const resetToken = sent.at(-1).payload.text.match(/reset-password#([^\s]+)/)[1];
  const fresh = request.agent(env.app);
  assert.equal((await send(fresh, 'post', '/auth/reset', { resetToken, password: testPassword })).status, 200);
  assert.equal((await send(fresh, 'post', '/auth/reset', { resetToken, password: testPassword })).status, 400);
  await send(fresh, 'patch', '/settings', { credentials: { telegramChatId: '456' } });
  assert.equal((await fresh.get('/api/me')).body.user.connections.telegram.ok, false);
  await env.db.collection('users').updateOne({ username: 'telegram_recovery' }, { $set: { resetHash: 'expired', resetExpiresAt: new Date(0) } });
  assert.equal((await send(fresh, 'post', '/auth/reset', { resetToken: 'a'.repeat(43), password: testPassword })).status, 400);
});

test('repeated failed login attempts are rate limited across application instances', async () => {
  const agent = request.agent(env.app);
  for (let i = 0; i < 15; i++) assert.equal((await send(agent, 'post', '/auth/login', { username: 'nobody', password: 'bad' })).status, 401);
  const restarted = await createApp({ db: env.db, vault: env.vault });
  assert.equal((await send(request.agent(restarted), 'post', '/auth/login', { username: 'nobody', password: 'bad' })).status, 429);
});
