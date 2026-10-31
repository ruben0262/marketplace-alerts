import 'dotenv/config';
import { connectDatabase } from '../server/db.js';
import { createMailer } from '../server/mailer.js';
import { vault } from '../server/security.js';

// Readiness only: authenticates SMTP and pings MongoDB; sends no email.
let connection, stage = 'configuration';
try {
  const origin = new URL(process.env.DOCKER_APP_URL || process.env.APP_URL);
  if (origin.protocol !== 'https:') throw new Error('Use the public HTTPS origin');
  if ((process.env.DOCKER_COOKIE_SECURE || process.env.COOKIE_SECURE) !== 'true') throw new Error('Enable secure cookies');
  if ((process.env.DOCKER_TRUST_PROXY || process.env.TRUST_PROXY) !== 'true') throw new Error('Enable the trusted tunnel proxy');
  if (process.env.WORKER_ENABLED === 'false') throw new Error('Enable the delivery worker');
  vault(process.env.ENCRYPTION_KEY);
  console.log(JSON.stringify({ check: stage, ok: true, origin: origin.origin }));
  stage = 'database';
  connection = await connectDatabase();
  console.log(JSON.stringify({ check: stage, ok: true }));
  stage = 'SMTP authentication and TLS';
  const mailer = createMailer();
  if (!mailer) throw new Error('Configure SMTP');
  await mailer.verify();
  console.log(JSON.stringify({ check: stage, ok: true, messagesSent: 0 }));
} catch (error) {
  console.error(JSON.stringify({ check: stage, ok: false, errorName: error.name, code: error.code }));
  process.exitCode = 1;
} finally { await connection?.client.close(); }
