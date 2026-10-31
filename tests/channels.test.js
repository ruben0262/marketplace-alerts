import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { setup, signup, send, testPassword } from './helpers.js';
import { createApp } from '../server/app.js';
import { createWorker } from '../server/worker.js';

let env, mail, telegramMessages;
const product = id => ({ source: 'vinted', productId: id, title: `Jacket ${id}`, price: '28', currency: 'GBP', url: 'https://www.vinted.co.uk/items/123', attributes: {} });
before(async () => {
  env = await setup({ sendEmail: async message => { mail.push(message); }, sendTelegram: async (secrets, method, payload) => { telegramMessages.push(payload); return { chat: { type: secrets.telegramChatId.startsWith('-') ? 'supergroup' : 'private' } }; } });
});
after(async () => env?.close());
beforeEach(async () => {
  mail = []; telegramMessages = [];
  for (const name of ['users', 'sessions', 'rateLimits', 'searches', 'matches', 'deliveries', 'notifications']) await env.db.collection(name).deleteMany({});
});
async function addBot(account, name, chatId = '123') {
  const result = await send(account.agent, 'post', '/telegram-bots', { name, botToken: `123:${name.replace(/\W/g, '_')}`, chatId });
  assert.equal(result.status, 201);
  const id = result.body.bot.id;
  assert.equal((await send(account.agent, 'post', `/telegram-bots/${id}/test`)).status, 200);
  return id;
}
async function addSearch(account, changes = {}) {
  const result = await send(account.agent, 'post', '/searches', { name: 'Jackets', query: 'jacket', notifyExisting: true, ...changes });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.search;
}
async function emailSignup(address) {
  const agent = request.agent(env.app);
  const result = await send(agent, 'post', '/auth/signup', { email: address, password: testPassword });
  assert.equal(result.status, 201);
  return { agent, ...result.body, user: result.body.user };
}
async function verifyLatestEmail(agent) {
  const token = mail.at(-1).text.match(/verify-email#([^\s]+)/)[1];
  assert.equal((await send(agent, 'post', '/auth/verify-email', { token })).status, 200);
  return token;
}
const due = () => env.db.collection('searches').updateMany({}, { $set: { nextRunAt: new Date(0) } });
const retry = () => env.db.collection('deliveries').updateMany({ state: 'pending' }, { $set: { retryAt: new Date(0) } });

test('login accepts the actual local origin even when APP_URL names another local host or port', async () => {
  const account = await signup(env.app, 'origin_account');
  for (const host of ['127.0.0.1:3000', 'localhost:3000', '127.0.0.1:5173']) {
    const result = await account.agent.post('/api/auth/login').set('Host', host).set('Origin', `http://${host}`).set('Sec-Fetch-Site', 'same-origin').set('X-Requested-With', 'marketplace-alerts').send({ username: 'origin_account', password: testPassword });
    assert.equal(result.status, 200, host);
  }
  for (const headers of [
    { Host: '127.0.0.1:3000', Origin: 'https://attacker.example', 'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'https' },
    { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Sec-Fetch-Site': 'cross-site' },
    { Host: 'localhost:3000', Origin: 'null' },
  ]) assert.equal((await account.agent.post('/api/auth/login').set(headers).set('X-Requested-With', 'marketplace-alerts').send({ username: 'origin_account', password: testPassword })).status, 403);
});

test('verified proxy origins work but password-reset links use the configured canonical origin', async () => {
  const account = await emailSignup('canonical@example.com');
  const app = await createApp({ db: env.db, vault: env.vault, appUrl: 'https://scout.example', trustProxy: true, sendEmail: async message => mail.push(message) });
  const proxy = request.agent(app);
  assert.equal((await proxy.post('/api/auth/login').set('Origin', 'https://scout.example').set('X-Forwarded-Host', 'scout.example').set('X-Forwarded-Proto', 'https').set('X-Requested-With', 'marketplace-alerts').send({ email: account.user.email, password: testPassword })).status, 200);
  await proxy.post('/api/auth/forgot').set('Host', 'attacker.example').set('Origin', 'http://attacker.example').set('X-Requested-With', 'marketplace-alerts').send({ email: account.user.email });
  assert.match(mail.at(-1).text, /https:\/\/scout\.example\/reset-password#/);
  assert.ok(!mail.at(-1).text.includes('attacker.example'));
});

test('Telegram destinations remain private, encrypted, and unusable across accounts', async () => {
  const owner = await signup(env.app, 'bot_owner'), other = await signup(env.app, 'bot_outsider');
  const id = await addBot(owner, 'Clothing', '100001');
  const me = (await owner.agent.get('/api/me')).body.user;
  assert.equal(me.telegramBots[0].name, 'Clothing');
  assert.equal(me.telegramBots[0].configured, true);
  assert.ok(!JSON.stringify(me).includes('100001')); assert.ok(!JSON.stringify(me).includes('123:Clothing'));
  const saved = await env.db.collection('users').findOne({ username: 'bot_owner' });
  assert.notEqual(saved.telegramBots[0].botToken, '123:Clothing');
  assert.deepEqual((await other.agent.get('/api/me')).body.user.telegramBots, []);
  assert.equal((await send(other.agent, 'patch', `/telegram-bots/${id}`, { name: 'Steal' })).status, 404);
  assert.equal((await send(other.agent, 'delete', `/telegram-bots/${id}`)).status, 404);
  assert.equal((await send(other.agent, 'post', `/telegram-bots/${id}/test`)).status, 404);
  assert.equal((await send(other.agent, 'post', '/searches', { name: 'Theft', query: 'jacket', telegramBotIds: [id] })).status, 400);
});

test('one failed destination retries independently without re-sending to a successful bot', async () => {
  const account = await signup(env.app, 'fanout');
  const one = await addBot(account, 'One', '101'), two = await addBot(account, 'Two', '202');
  await addSearch(account, { telegramBotIds: [one, two] });
  const sent = []; let failure = true;
  const worker = createWorker({ db: env.db, vault: env.vault, scan: async () => ({ items: [product('one')], scanned: 1 }), send: async secrets => { if (secrets.telegramChatId === '202' && failure) throw new Error('Unavailable'); sent.push(secrets.telegramChatId); } });
  await worker.scanNext(); await worker.deliverNext(); await worker.deliverNext();
  assert.deepEqual(sent, ['101']);
  failure = false; await retry(); await worker.deliverNext(); await worker.deliverNext();
  assert.deepEqual(sent, ['101', '202']);
  await due(); await worker.scanNext(); await worker.deliverNext(); assert.deepEqual(sent, ['101', '202']);
});

test('concurrent overlapping searches route the same product to different bots, once per bot', async () => {
  const account = await signup(env.app, 'overlapping');
  const one = await addBot(account, 'One', '101'), two = await addBot(account, 'Two', '202');
  await addSearch(account, { telegramBotIds: [one] });
  await addSearch(account, { name: 'Second', telegramBotIds: [one, two] });
  const sent = [];
  const worker = createWorker({ db: env.db, vault: env.vault, scan: async () => ({ items: [product('same')], scanned: 1 }), send: async secrets => sent.push(secrets.telegramChatId) });
  await Promise.all([worker.scanNext(), worker.scanNext()]);
  await Promise.all([worker.deliverNext(), worker.deliverNext(), worker.deliverNext()]);
  assert.deepEqual(sent.sort(), ['101', '202']);
  assert.equal((await account.agent.get('/api/matches')).body.matches.length, 1);
});

test('changing selected destinations affects future finds and cancels old unselected delivery', async () => {
  const account = await signup(env.app, 'routing');
  const one = await addBot(account, 'One', '101'), two = await addBot(account, 'Two', '202');
  const search = await addSearch(account, { telegramBotIds: [one] });
  let rows = [product('old')]; const sent = [];
  const worker = createWorker({ db: env.db, vault: env.vault, scan: async () => ({ items: rows, scanned: rows.length }), send: async (secrets, match) => sent.push([secrets.telegramChatId, match.productId]) });
  await worker.scanNext();
  await send(account.agent, 'put', `/searches/${search._id}`, { name: 'Jackets', query: 'jacket', telegramBotIds: [two], notifyExisting: true });
  await worker.deliverNext(); assert.equal(sent.length, 0);
  await worker.scanNext(); await worker.deliverNext(); assert.equal(sent.length, 0);
  rows.push(product('new')); await due(); await worker.scanNext(); await worker.deliverNext();
  assert.deepEqual(sent, [['202', 'new']]);
});

test('editing credentials or deleting a destination never delivers its already-queued finds to a new recipient', async () => {
  const account = await signup(env.app, 'edit_bot');
  const id = await addBot(account, 'One', '101');
  await addSearch(account, { telegramBotIds: [id] });
  const sent = []; const worker = createWorker({ db: env.db, vault: env.vault, scan: async () => ({ items: [product('old')], scanned: 1 }), send: async secrets => sent.push(secrets.telegramChatId) });
  await worker.scanNext();
  await send(account.agent, 'patch', `/telegram-bots/${id}`, { chatId: '202' });
  assert.equal((await account.agent.get('/api/matches')).body.matches[0].alertState, 'web-only');
  await send(account.agent, 'post', `/telegram-bots/${id}/test`);
  await worker.deliverNext(); assert.equal(sent.length, 0);
  await send(account.agent, 'delete', `/telegram-bots/${id}`);
  assert.deepEqual((await account.agent.get('/api/searches')).body.searches[0].telegramBotIds, []);
  assert.deepEqual((await account.agent.get('/api/me')).body.user.telegramBots, []);
});

test('only an explicitly selected verified private Telegram chat can receive password recovery', async () => {
  const account = await signup(env.app, 'recovery_routes');
  const group = await addBot(account, 'Group', '-100'), privateId = await addBot(account, 'Private', '101');
  assert.equal((await send(account.agent, 'patch', '/settings', { recoveryTelegramBotId: group })).status, 400);
  const before = telegramMessages.length;
  await send(account.agent, 'post', '/auth/forgot', { username: 'recovery_routes' }); assert.equal(telegramMessages.length, before);
  assert.equal((await send(account.agent, 'patch', '/settings', { recoveryTelegramBotId: privateId })).status, 200);
  await send(account.agent, 'post', '/auth/forgot', { username: 'recovery_routes' }); assert.equal(telegramMessages.at(-1).chat_id, '101');
  const resetToken = telegramMessages.at(-1).text.match(/reset-password#([^\s]+)/)[1];
  await send(account.agent, 'patch', `/telegram-bots/${privateId}`, { chatId: '303' });
  assert.equal((await account.agent.get('/api/me')).body.user.recoveryTelegramBotId, null);
  assert.equal((await send(account.agent, 'post', '/auth/reset', { resetToken, password: 'RevokedReset123!' })).status, 400);
});

test('email-only signup, verification, login and recovery work without requiring a username', async () => {
  const account = await emailSignup('Alice@Example.com');
  assert.equal(account.user.email, 'alice@example.com'); assert.equal(account.user.emailVerified, false); assert.equal(account.verificationSent, true);
  assert.equal(account.user.settings.browserNotifications, true); assert.equal(account.user.settings.theme, 'light');
  assert.equal((await send(account.agent, 'post', '/searches', { name: 'Email', query: 'jacket', emailAlerts: true })).status, 400);
  const verificationToken = await verifyLatestEmail(account.agent);
  assert.equal((await send(account.agent, 'post', '/auth/verify-email', { token: verificationToken })).status, 400);
  assert.equal((await account.agent.get('/api/me')).body.user.emailVerified, true);
  await addSearch(account, { emailAlerts: true });
  await send(account.agent, 'post', '/auth/logout');
  assert.equal((await send(account.agent, 'post', '/auth/login', { email: 'ALICE@example.com', password: testPassword })).status, 200);
  const unknown = await send(account.agent, 'post', '/auth/forgot', { email: 'missing@example.com' });
  const forgot = await send(account.agent, 'post', '/auth/forgot', { email: 'alice@example.com' }); assert.deepEqual(unknown.body, forgot.body);
  const resetToken = mail.at(-1).text.match(/reset-password#([^\s]+)/)[1];
  assert.equal((await send(account.agent, 'post', '/auth/reset', { resetToken, password: 'ResetPassword123!' })).status, 200);
  assert.equal((await send(account.agent, 'post', '/auth/login', { email: 'alice@example.com', password: testPassword })).status, 401);
  assert.equal((await send(account.agent, 'post', '/auth/login', { email: 'alice@example.com', password: 'ResetPassword123!' })).status, 200);
});

test('email recovery keys work, email updates require a password, and verification is tied to the current address', async () => {
  const account = await emailSignup('first@example.com');
  const oldToken = mail.at(-1).text.match(/verify-email#([^\s]+)/)[1];
  assert.equal((await send(account.agent, 'patch', '/email', { email: 'new@example.com', currentPassword: 'wrong' })).status, 400);
  assert.equal((await send(account.agent, 'patch', '/email', { email: 'new@example.com', currentPassword: testPassword })).status, 200);
  assert.equal((await send(account.agent, 'post', '/auth/verify-email', { token: oldToken })).status, 400);
  assert.equal((await send(request.agent(env.app), 'post', '/auth/reset', { email: 'new@example.com', recoveryKey: account.recoveryKey, password: 'RecoveredPassword123!' })).status, 200);
});

test('a server without SMTP reports unavailability without claiming to send verification or exposing tokens', async () => {
  const app = await createApp({ db: env.db, vault: env.vault });
  const agent = request.agent(app);
  const result = await send(agent, 'post', '/auth/signup', { email: 'no_smtp@example.com', password: testPassword });
  assert.equal(result.status, 201); assert.equal(result.body.verificationSent, false); assert.equal(result.body.user.emailDeliveryAvailable, false);
  assert.equal(result.body.verificationToken, undefined);
  assert.equal((await send(agent, 'post', '/email/verification')).status, 503);
  assert.equal((await send(agent, 'post', '/searches', { name: 'Mail', query: 'jacket', emailAlerts: true })).status, 400);
});

test('email and Telegram delivery retry independently and in-app notifications stay private and deduplicated', async () => {
  const account = await emailSignup('alerts@example.com'); await verifyLatestEmail(account.agent);
  const other = await signup(env.app, 'notification_outsider');
  const bot = await addBot(account, 'Bot', '101');
  await addSearch(account, { telegramBotIds: [bot], emailAlerts: true });
  const sent = []; let emailFails = true;
  const worker = createWorker({ db: env.db, vault: env.vault, scan: async () => ({ items: [product('both')], scanned: 1 }), send: async () => sent.push('telegram'), sendEmail: async message => { if (emailFails) throw new Error('SMTP unavailable'); sent.push(message.to); } });
  await worker.scanNext(); await worker.deliverNext(); await worker.deliverNext(); assert.deepEqual(sent, ['telegram']);
  emailFails = false; await retry(); await worker.deliverNext(); assert.deepEqual(sent, ['telegram', 'alerts@example.com']);
  await due(); await worker.scanNext(); await worker.deliverNext(); assert.equal(sent.length, 2);
  const feed = (await account.agent.get('/api/notifications')).body; assert.equal(feed.unreadCount, 1); assert.equal(feed.notifications.length, 1);
  assert.equal((await other.agent.get('/api/notifications')).body.unreadCount, 0);
  await send(other.agent, 'post', '/notifications/read', { ids: [feed.notifications[0]._id] });
  assert.equal((await account.agent.get('/api/notifications')).body.unreadCount, 1);
  await send(account.agent, 'post', '/notifications/read', { ids: [feed.notifications[0]._id] });
  assert.equal((await account.agent.get('/api/notifications')).body.unreadCount, 0);
});

test('quiet first scans do not create in-app notifications, while later finds do by default', async () => {
  const account = await signup(env.app, 'quiet_notifications');
  await addSearch(account, { notifyExisting: false });
  let rows = [product('seed')];
  const worker = createWorker({ db: env.db, vault: env.vault, scan: async () => ({ items: rows, scanned: rows.length }) });
  await worker.scanNext(); assert.equal((await account.agent.get('/api/notifications')).body.unreadCount, 0);
  rows.push(product('new')); await due(); await worker.scanNext();
  assert.equal((await account.agent.get('/api/notifications')).body.unreadCount, 1);
  await send(account.agent, 'post', '/notifications/read', { all: true });
  assert.equal((await account.agent.get('/api/notifications')).body.unreadCount, 0);
});

test('the legacy Telegram profile migration preserves routing and sent/seeded history without replay', async () => {
  const account = await signup(env.app, 'legacy_profile');
  const search = await addSearch(account);
  const userId = new ObjectId(account.user.id), searchId = new ObjectId(search._id);
  await env.db.collection('users').updateOne({ _id: userId }, { $unset: { telegramMigration: '', telegramBots: '' }, $set: { 'secrets.telegramBotToken': env.vault.seal('123:legacy'), 'secrets.telegramChatId': env.vault.seal('101'), 'connections.telegram': { ok: true } } });
  await env.db.collection('searches').updateOne({ _id: searchId }, { $unset: { telegramBotIds: '' } });
  await env.db.collection('matches').insertMany(['sent', 'seeded', 'pending'].map(state => ({ ...product(state), userId, searchIds: [searchId], alertState: state, searchName: 'Jackets', foundAt: new Date() })));
  await createApp({ db: env.db, vault: env.vault }); await createApp({ db: env.db, vault: env.vault });
  const me = (await account.agent.get('/api/me')).body.user;
  assert.equal(me.telegramBots.length, 1); assert.equal(me.telegramBots[0].name, 'My Telegram');
  assert.deepEqual((await account.agent.get('/api/searches')).body.searches[0].telegramBotIds, [me.telegramBots[0].id]);
  let rows = ['sent', 'seeded', 'pending'].map(product);
  const sent = [], worker = createWorker({ db: env.db, vault: env.vault, scan: async () => ({ items: rows, scanned: rows.length }), send: async (secrets, match) => sent.push(match.productId) });
  await worker.deliverNext(); await worker.deliverNext(); assert.deepEqual(sent, ['pending']);
  assert.equal(await env.db.collection('deliveries').countDocuments({ userId }), 3);
  await worker.scanNext(); await worker.deliverNext();
  assert.deepEqual(sent, ['pending']);
  assert.equal((await account.agent.get('/api/notifications')).body.unreadCount, 0);
  rows.push(product('new')); await due(); await worker.scanNext(); await worker.deliverNext();
  assert.deepEqual(sent, ['pending', 'new']);
  assert.equal((await account.agent.get('/api/notifications')).body.unreadCount, 1);
});

test('verification and recovery links expire, replacement links revoke old ones, and password changes revoke reset links', async () => {
  const account = await emailSignup('lifecycle@example.com');
  const userId = new ObjectId(account.user.id);
  const oldVerification = mail.at(-1).text.match(/verify-email#([^\s]+)/)[1];
  await send(account.agent, 'post', '/email/verification');
  assert.equal((await send(account.agent, 'post', '/auth/verify-email', { token: oldVerification })).status, 400);
  const expired = mail.at(-1).text.match(/verify-email#([^\s]+)/)[1];
  await env.db.collection('users').updateOne({ _id: userId }, { $set: { emailVerificationExpiresAt: new Date(0) } });
  assert.equal((await send(account.agent, 'post', '/auth/verify-email', { token: expired })).status, 400);
  await send(account.agent, 'post', '/email/verification'); await verifyLatestEmail(account.agent);
  await send(account.agent, 'post', '/auth/forgot', { email: account.user.email });
  const oldReset = mail.at(-1).text.match(/reset-password#([^\s]+)/)[1];
  await send(account.agent, 'post', '/auth/forgot', { email: account.user.email });
  const newReset = mail.at(-1).text.match(/reset-password#([^\s]+)/)[1];
  assert.equal((await send(account.agent, 'post', '/auth/reset', { resetToken: oldReset, password: testPassword })).status, 400);
  await env.db.collection('users').updateOne({ _id: userId }, { $set: { resetExpiresAt: new Date(0) } });
  assert.equal((await send(account.agent, 'post', '/auth/reset', { resetToken: newReset, password: testPassword })).status, 400);
  await send(account.agent, 'post', '/auth/forgot', { email: account.user.email });
  const revoked = mail.at(-1).text.match(/reset-password#([^\s]+)/)[1];
  assert.equal((await send(account.agent, 'post', '/password', { currentPassword: testPassword, password: 'ChangedPassword123!' })).status, 200);
  assert.equal((await send(account.agent, 'post', '/auth/reset', { resetToken: revoked, password: testPassword })).status, 400);
});

test('changing an email cancels queued mail without replaying old products at the new address', async () => {
  const account = await emailSignup('old_alerts@example.com'); await verifyLatestEmail(account.agent);
  await addSearch(account, { emailAlerts: true });
  let rows = [product('old')]; const delivered = [];
  const worker = createWorker({ db: env.db, vault: env.vault, scan: async () => ({ items: rows, scanned: rows.length }), sendEmail: async message => delivered.push(message) });
  await worker.scanNext();
  assert.equal((await send(account.agent, 'patch', '/email', { email: 'new_alerts@example.com', currentPassword: testPassword })).status, 200);
  await verifyLatestEmail(account.agent);
  assert.equal((await account.agent.get('/api/matches')).body.matches[0].alertState, 'web-only');
  await worker.deliverNext(); await due(); await worker.scanNext(); await worker.deliverNext();
  assert.equal(delivered.length, 0);
  rows.push(product('new')); await due(); await worker.scanNext(); await worker.deliverNext();
  assert.equal(delivered.length, 1); assert.equal(delivered[0].to, 'new_alerts@example.com'); assert.match(delivered[0].text, /Jacket new/);
});

test('notification pagination and mark-all-read remain private, while preferences persist after login', async () => {
  const account = await signup(env.app, 'feed_owner'), other = await signup(env.app, 'feed_other');
  await addSearch(account); await addSearch(other);
  const worker = createWorker({ db: env.db, vault: env.vault, scan: async () => ({ items: ['1', '2', '3'].map(product), scanned: 3 }) });
  await worker.scanNext(); await worker.scanNext();
  const first = (await account.agent.get('/api/notifications?limit=2')).body;
  const second = (await account.agent.get(`/api/notifications?limit=2&before=${first.nextCursor}`)).body;
  assert.equal(first.notifications.length, 2); assert.equal(second.notifications.length, 1); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.notifications, ...second.notifications].map(row => row._id)).size, 3);
  assert.equal((await send(account.agent, 'post', '/notifications/read', { all: true })).body.unreadCount, 0);
  assert.equal((await other.agent.get('/api/notifications')).body.unreadCount, 3);
  assert.equal((await account.agent.get('/api/notifications?unread=true')).body.notifications.length, 0);
  assert.equal((await send(account.agent, 'patch', '/settings', { settings: { theme: 'dark', browserNotifications: false } })).status, 200);
  await send(account.agent, 'post', '/auth/logout');
  const login = await send(account.agent, 'post', '/auth/login', { username: 'feed_owner', password: testPassword });
  assert.equal(login.body.user.settings.theme, 'dark'); assert.equal(login.body.user.settings.browserNotifications, false);
});

test('version-two accounts gain missing history markers without suppressing genuine new notifications', async () => {
  const account = await signup(env.app, 'already_migrated');
  const search = await addSearch(account), userId = new ObjectId(account.user.id), searchId = new ObjectId(search._id);
  const worker = createWorker({ db: env.db, vault: env.vault, scan: async () => ({ items: [product('recent'), product('historic')], scanned: 2 }) });
  await env.db.collection('matches').insertOne({ ...product('historic'), userId, searchIds: [searchId], alertState: 'web-only' });
  await env.db.collection('users').updateOne({ _id: userId }, { $set: { telegramMigration: 2 } });
  await createApp({ db: env.db, vault: env.vault });
  await worker.scanNext();
  let feed = (await account.agent.get('/api/notifications')).body;
  assert.equal(feed.notifications.length, 1); assert.equal(feed.notifications[0].title, 'Jacket recent');
  await env.db.collection('users').updateOne({ _id: userId }, { $set: { telegramMigration: 2 } });
  await createApp({ db: env.db, vault: env.vault });
  await due(); await worker.scanNext();
  feed = (await account.agent.get('/api/notifications')).body;
  assert.equal(feed.notifications.length, 1); assert.equal(feed.unreadCount, 1);
});

test('API and worker logs identify operations without recording credentials, bodies, raw URLs or provider errors', async () => {
  const logs = [];
  const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (event, fields) => logs.push({ event, fields })]));
  const app = await createApp({ db: env.db, vault: env.vault, logger });
  const account = await signup(app, 'logged_account');
  const me = await account.agent.get('/api/me?private=never-log-query').set('X-Request-Id', 'never-log-header');
  assert.notEqual(me.headers['x-request-id'], 'never-log-header');
  await account.agent.get('/api/never-log-path?token=never-log-token');
  await account.agent.get('/api/health');
  await addSearch(account);
  const worker = createWorker({ db: env.db, vault: env.vault, logger, scan: async () => { throw new Error('never-log-provider-secret'); } });
  await worker.scanNext();
  const broken = await createApp({ db: { collection: name => env.db.collection(name), command: async () => { throw new Error('never-log-database-uri'); } }, vault: env.vault, logger });
  assert.equal((await request(broken).get('/api/health')).status, 500);
  assert.ok(logs.some(row => row.event === 'api.request' && row.fields.route === '/api/me' && row.fields.userId === account.user.id));
  assert.ok(logs.some(row => row.event === 'api.request' && row.fields.route === 'unmatched'));
  assert.ok(logs.some(row => row.event === 'scan.failed' && row.fields.errorName === 'Error'));
  assert.ok(logs.some(row => row.event === 'api.failed' && row.fields.errorName === 'Error'));
  assert.ok(!logs.some(row => row.fields.route === '/api/health' && row.fields.statusCode === 200));
  assert.ok(!JSON.stringify(logs).includes('never-log')); assert.ok(!JSON.stringify(logs).includes(testPassword));
});
