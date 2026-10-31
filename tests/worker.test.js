import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { setup, signup, send } from './helpers.js';
import { createWorker } from '../server/worker.js';

let env, account, searchId, rows, sent, worker, failScan, failSend, botId;
const listing = id => ({ productId: id, source: 'vinted', title: `Vintage jacket ${id}`, price: '28', currency: 'GBP', url: 'https://www.vinted.co.uk/items/123', attributes: { Size: 'M' }, image: null });
before(async () => { env = await setup({ sendTelegram: async () => ({ chat: { type: 'private' } }) }); });
after(async () => env?.close());
beforeEach(async () => {
  for (const name of ['users', 'sessions', 'rateLimits', 'searches', 'matches', 'deliveries', 'notifications']) await env.db.collection(name).deleteMany({});
  account = await signup(env.app, 'worker_user'); rows = [listing('one')]; sent = []; failScan = false; failSend = false;
  const createdBot = await send(account.agent, 'post', '/telegram-bots', { name: 'My bot', botToken: '123:token', chatId: '123' });
  botId = createdBot.body.bot.id;
  await send(account.agent, 'post', `/telegram-bots/${botId}/test`);
  const result = await send(account.agent, 'post', '/searches', { name: 'Jackets', query: 'vintage jacket', telegramBotIds: [botId] }); searchId = new ObjectId(result.body.search._id);
  worker = createWorker({ db: env.db, vault: env.vault, scan: async () => { if (failScan) throw new Error('Marketplace down'); return { items: rows, scanned: rows.length }; }, send: async (secrets, match) => { if (failSend) throw new Error('Telegram down'); sent.push({ secrets, match }); } });
});
async function due() { await env.db.collection('searches').updateMany({}, { $set: { nextRunAt: new Date(0) } }); }
async function retryDelivery() { await env.db.collection('deliveries').updateMany({}, { $set: { retryAt: new Date(0) } }); }

test('the first scan is quiet; new matches notify once even when seen on repeated scans', async () => {
  await worker.scanNext(); await worker.deliverNext(); assert.equal(sent.length, 0);
  assert.equal((await account.agent.get('/api/matches')).body.matches.length, 1);
  rows.push(listing('two')); await due(); await worker.scanNext(); await worker.deliverNext();
  assert.equal(sent.length, 1); assert.equal(sent[0].match.productId, 'two');
  await due(); await worker.scanNext(); await worker.deliverNext(); assert.equal(sent.length, 1);
  assert.equal((await account.agent.get('/api/dashboard')).body.delivered, 1);
});

test('a marketplace failure remains visible and does not consume first-scan initialization', async () => {
  failScan = true; await worker.scanNext();
  const search = (await account.agent.get('/api/searches')).body.searches[0];
  assert.equal(search.statuses.vinted.ok, false); assert.deepEqual(search.initializedSources, []);
  failScan = false; await due(); await worker.scanNext(); await worker.deliverNext(); assert.equal(sent.length, 0);
});

test('failed Telegram deliveries retry and are only marked delivered after acknowledgement', async () => {
  await env.db.collection('searches').updateOne({ _id: searchId }, { $set: { notifyExisting: true } });
  await worker.scanNext(); failSend = true; await worker.deliverNext();
  assert.equal((await account.agent.get('/api/dashboard')).body.delivered, 0);
  failSend = false; await retryDelivery(); await worker.deliverNext();
  assert.equal(sent.length, 1); assert.equal((await account.agent.get('/api/dashboard')).body.delivered, 1);
});

test('the same product across searches is delivered only once and appears under both searches', async () => {
  await env.db.collection('searches').updateOne({ _id: searchId }, { $set: { notifyExisting: true } });
  const second = await send(account.agent, 'post', '/searches', { name: 'Adidas', query: 'adidas', notifyExisting: true, telegramBotIds: [botId] });
  await worker.scanNext(); await worker.scanNext(); await worker.deliverNext(); await worker.deliverNext();
  assert.equal(sent.length, 1);
  assert.equal((await account.agent.get(`/api/matches?search=${second.body.search._id}`)).body.matches.length, 1);
  assert.equal((await account.agent.get(`/api/matches?search=${searchId}`)).body.matches.length, 1);
});

test('paused searches do not scan or deliver pending alerts; resume continues delivery', async () => {
  await env.db.collection('searches').updateOne({ _id: searchId }, { $set: { notifyExisting: true } });
  await worker.scanNext(); await send(account.agent, 'patch', `/searches/${searchId}`, { active: false });
  assert.equal(await worker.scanNext(), false); await worker.deliverNext(); assert.equal(sent.length, 0);
  await send(account.agent, 'patch', `/searches/${searchId}`, { active: true }); await retryDelivery(); await worker.deliverNext(); assert.equal(sent.length, 1);
});

test('multiple workers do not scan a search or send an alert concurrently', async () => {
  await env.db.collection('searches').updateOne({ _id: searchId }, { $set: { notifyExisting: true } });
  const results = await Promise.all([worker.scanNext(), worker.scanNext()]); assert.equal(results.filter(Boolean).length, 1);
  await Promise.all([worker.deliverNext(), worker.deliverNext()]); assert.equal(sent.length, 1);
});

test('new accounts never inherit the imported user’s Telegram credentials or listings', async () => {
  const other = await signup(env.app, 'second_account');
  await send(other.agent, 'post', '/searches', { name: 'My jackets', query: 'jacket', notifyExisting: true });
  await worker.scanNext(); await worker.scanNext(); await worker.deliverNext();
  const matches = (await other.agent.get('/api/matches')).body.matches;
  assert.equal(matches.length, 1); assert.equal(matches[0].alertState, 'web-only'); assert.equal(sent.length, 0);
});

test('deleting a search while it is scanning cannot publish its results', async () => {
  const interrupted = createWorker({ db: env.db, vault: env.vault, scan: async () => {
    await send(account.agent, 'delete', `/searches/${searchId}`); return { items: rows, scanned: 1 };
  } });
  await interrupted.scanNext(); assert.equal((await account.agent.get('/api/matches')).body.matches.length, 0);
});

test('abandoned leases expire and work can be recovered by another worker', async () => {
  await env.db.collection('searches').updateOne({ _id: searchId }, { $set: { lockToken: 'crashed-worker', lockUntil: new Date(0) } });
  assert.equal(await worker.scanNext(), true);
  assert.equal((await account.agent.get('/api/matches')).body.matches.length, 1);
});

test('editing a search while a scan is in progress discards obsolete results', async () => {
  const interrupted = createWorker({ db: env.db, vault: env.vault, scan: async () => {
    await send(account.agent, 'put', `/searches/${searchId}`, { name: 'Camera', query: 'camera' });
    return { items: rows, scanned: 1 };
  } });
  await interrupted.scanNext();
  assert.equal((await account.agent.get('/api/matches')).body.matches.length, 0);
  assert.equal(await worker.scanNext(), true, 'the edited search is immediately eligible for its fresh scan');
  assert.equal((await account.agent.get('/api/matches')).body.matches.length, 1);
});
