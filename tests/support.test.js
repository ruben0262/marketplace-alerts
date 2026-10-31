import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { setup, send } from './helpers.js';
import { createApp } from '../server/app.js';
import { createWorker } from '../server/worker.js';

let env, mail;
before(async () => { env = await setup({ sendEmail: async message => { mail.push(message); } }); });
after(async () => env?.close());
beforeEach(async () => { mail = []; await env.db.collection('supportTickets').deleteMany({}); await env.db.collection('rateLimits').deleteMany({}); });
const ticket = (changes = {}) => ({ requestId: randomUUID(), email: 'customer@example.com', subject: 'Search stopped updating', message: 'My saved jacket search has not shown a new result since yesterday.', ...changes });
const submit = input => send(request(env.app), 'post', '/support', input);
const worker = sendEmail => createWorker({ db: env.db, vault: env.vault, sendEmail });

test('public support accepts a ticket once and delivers it to the support inbox with the customer as Reply-To', async () => {
  const input = ticket(), response = await submit(input);
  assert.equal(response.status, 202);
  assert.match(response.body.reference, /^SC-[A-Z0-9]{12}$/);
  assert.deepEqual((await submit(input)).body, response.body);
  const deliver = worker(async message => { mail.push(message); });
  assert.equal(await deliver.deliverSupport(), true);
  assert.equal(await deliver.deliverSupport(), false);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'hello@flow-solutions.xyz');
  assert.equal(mail[0].replyTo, input.email);
  assert.ok(mail[0].subject.includes(response.body.reference));
  assert.ok(mail[0].text.includes(input.message));
  assert.equal((await submit({ ...input, message: 'This is a different request with the same identifier.' })).status, 409);
});

test('support delivery survives a mail outage and a worker restart without duplicating successful tickets', async () => {
  await submit(ticket());
  await worker(async () => { throw new Error('SMTP unavailable'); }).deliverSupport();
  const restarted = worker(async message => { mail.push(message); });
  assert.equal(await restarted.deliverSupport(), false);
  assert.equal(mail.length, 0);
  // Make the persisted retry due; no wall-clock sleeps or altered production timing.
  await env.db.collection('supportTickets').updateMany({}, { $set: { retryAt: new Date(0) } });
  assert.equal(await restarted.deliverSupport(), true);
  assert.equal(await restarted.deliverSupport(), false);
  assert.equal(mail.length, 1);
});

test('two workers cannot deliver the same support ticket concurrently', async () => {
  await submit(ticket());
  let release, started;
  const sending = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const deliver = worker(async message => { mail.push(message); started(); await gate; });
  const first = deliver.deliverSupport();
  await sending;
  try { assert.equal(await deliver.deliverSupport(), false); }
  finally { release(); await first; }
  assert.equal(mail.length, 1);
});

test('support validates content, rejects recipient overrides and cross-site requests, and limits submissions', async () => {
  for (const changes of [{ email: 'invalid' }, { subject: 'Hello\nBcc: other@example.com' }, { message: 'Short' }, { to: 'other@example.com' }]) assert.equal((await submit(ticket(changes))).status, 400);
  assert.equal((await request(env.app).post('/api/support').send(ticket())).status, 403);
  assert.equal((await request(env.app).post('/api/support').set('Origin', 'https://unrelated.example').set('X-Requested-With', 'marketplace-alerts').send(ticket())).status, 403);
  for (let i = 0; i < 3; i++) assert.equal((await submit(ticket())).status, 202);
  assert.equal((await submit(ticket())).status, 429);
  const deliver = worker(async message => { mail.push(message); });
  while (await deliver.deliverSupport()) {}
  assert.equal(mail.length, 3);
});

test('support reports unavailable delivery without falsely accepting a ticket', async () => {
  const app = await createApp({ db: env.db, vault: env.vault });
  const response = await send(request(app), 'post', '/support', ticket());
  assert.equal(response.status, 503);
  assert.match(response.body.error, /hello@flow-solutions.xyz/);
  assert.equal(await worker(async message => { mail.push(message); }).deliverSupport(), false);
});
