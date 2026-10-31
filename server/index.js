import 'dotenv/config';
import { connectDatabase } from './db.js';
import { vault } from './security.js';
import { createApp } from './app.js';
import { createWorker } from './worker.js';
import { createMailer } from './mailer.js';
import { createLogger } from './logger.js';

let client, logger;
try {
  logger = await createLogger();
  const connection = await connectDatabase(undefined, undefined, logger);
  client = connection.client;
  const secrets = vault(process.env.ENCRYPTION_KEY);
  const sendEmail = createMailer();
  logger.info('email.configured', { enabled: !!sendEmail });
  const app = await createApp({ db: connection.db, vault: secrets, appUrl: process.env.APP_URL, secureCookies: process.env.COOKIE_SECURE === 'true', trustProxy: process.env.TRUST_PROXY === 'true', sendEmail, logger });
  const worker = createWorker({ db: connection.db, vault: secrets, sendEmail, logger });
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, host, () => resolve(listener));
    listener.once('error', reject);
  });
  logger.info('server.ready', { host, port });
  if (process.env.WORKER_ENABLED !== 'false') worker.start();
  logger.info('worker.configured', { enabled: process.env.WORKER_ENABLED !== 'false' });
  let shuttingDown = false;
  const shutdown = async signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('server.stopping', { signal });
    const deadline = setTimeout(() => process.exit(1), 140000).unref();
    const drained = new Promise(resolve => server.close(resolve));
    await Promise.all([worker.stop(), drained]);
    await client.close();
    logger.info('server.stopped');
    await logger.close();
    clearTimeout(deadline);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} catch (error) {
  if (logger) logger.error('server.startup_failed', { errorName: error.name });
  else console.error(JSON.stringify({ time: new Date().toISOString(), level: 'error', event: 'logs.startup_failed', errorName: error.name }));
  await client?.close();
  await logger?.close();
  process.exitCode = 1;
}
