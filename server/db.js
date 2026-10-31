import { MongoClient } from 'mongodb';

export function databaseUri(env = process.env) {
  if (!env.MONGODB_URI) throw new Error('Set MONGODB_URI in .env.');
  return env.MONGODB_URI.replace(/<(?:db_)?username>/g, encodeURIComponent(env.MONGODB_USERNAME || ''))
    .replace(/<(?:db_)?password>/g, encodeURIComponent(env.MONGODB_PASSWORD || ''));
}

export async function connectDatabase(uri = databaseUri(), name = process.env.MONGODB_DB || 'marketplace_alerts', logger) {
  const started = Date.now();
  logger?.info('mongodb.connecting', { database: name });
  const client = new MongoClient(uri, { maxPoolSize: 12, serverSelectionTimeoutMS: 10000, waitQueueTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(name);
    await db.command({ ping: 1 });
    logger?.info('mongodb.connected', { database: name, durationMs: Date.now() - started });
    await Promise.all([
      db.collection('supportTickets').createIndex({ requestId: 1 }, { unique: true }),
      db.collection('supportTickets').createIndex({ state: 1, retryAt: 1, lockUntil: 1 }),
      db.collection('supportTickets').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('users').createIndex({ username: 1 }, { unique: true }),
      db.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true }),
      db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('sessions').createIndex({ userId: 1 }),
      db.collection('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('searches').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('searches').createIndex({ active: 1, nextRunAt: 1, lockUntil: 1 }),
      db.collection('matches').createIndex({ userId: 1, source: 1, productId: 1 }, { unique: true }),
      db.collection('matches').createIndex({ userId: 1, foundAt: -1 }),
      db.collection('matches').createIndex({ userId: 1, _id: -1 }),
      db.collection('matches').createIndex({ alertState: 1, retryAt: 1, lockUntil: 1 }),
      db.collection('deliveries').createIndex({ userId: 1, matchId: 1, botId: 1 }, { unique: true }),
      db.collection('deliveries').createIndex({ state: 1, retryAt: 1, lockUntil: 1 }),
      db.collection('deliveries').createIndex({ userId: 1, botId: 1, state: 1 }),
      db.collection('notifications').createIndex({ userId: 1, matchId: 1 }, { unique: true }),
      db.collection('notifications').createIndex({ userId: 1, _id: -1 }),
      db.collection('notifications').createIndex({ userId: 1, readAt: 1 }),
    ]);
    logger?.info('mongodb.indexes_ready', { database: name });
    return { db, client };
  } catch (error) {
    logger?.error('mongodb.connection_failed', { database: name, errorName: error.name, durationMs: Date.now() - started });
    await client.close(); throw error;
  }
}
