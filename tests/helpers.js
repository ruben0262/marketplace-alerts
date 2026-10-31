import { MongoMemoryServer } from 'mongodb-memory-server';
import { randomBytes } from 'node:crypto';
import { connectDatabase } from '../server/db.js';
import { vault } from '../server/security.js';
import { createApp } from '../server/app.js';
import request from 'supertest';

process.env.MONGOMS_DOWNLOAD_DIR ||= '/tmp/scout-mongodb-binaries';
export const testPassword = 'GoodTestPassword123!';
export async function setup(overrides = {}) {
  const mongo = await MongoMemoryServer.create();
  const { db, client } = await connectDatabase(mongo.getUri(), 'scout_tests');
  const secretVault = vault(randomBytes(32).toString('hex'));
  const app = await createApp({ db, vault: secretVault, clientDirectory: process.env.SCOUT_TEST_DIST || 'dist', ...overrides });
  return { db, vault: secretVault, app, async close() { await client.close(); await mongo.stop(); } };
}
export const send = (agent, method, path, body) => agent[method](`/api${path}`).set('X-Requested-With', 'marketplace-alerts').send(body);
export async function signup(app, name) {
  const agent = request.agent(app);
  const result = await send(agent, 'post', '/auth/signup', { username: name, password: testPassword });
  if (result.status !== 201) throw new Error(JSON.stringify(result.body));
  return { agent, user: result.body.user, recoveryKey: result.body.recoveryKey, cookie: result.headers['set-cookie'] };
}
