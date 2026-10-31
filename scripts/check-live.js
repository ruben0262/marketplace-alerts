import 'dotenv/config';
import { ObjectId } from 'mongodb';
import { connectDatabase } from '../server/db.js';
import { vault } from '../server/security.js';
import { createApp } from '../server/app.js';
import { createWorker } from '../server/worker.js';
import { createMailer } from '../server/mailer.js';
import request from 'supertest';

// Never run from the test suite. Real messages and queued product deliveries
// require separate flags; ordinary checks still contact real marketplaces.
const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !['--browser-only', '--send-tests', '--scan-and-queue'].includes(flag)) || flags.has('--browser-only') && flags.size > 1) {
  console.error('Usage: npm run check:live -- [--send-tests] [--scan-and-queue], or --browser-only');
  process.exitCode = 1;
} else if (flags.has('--browser-only')) {
  await import('./check-profile-browser.js');
} else {
  let connection, agent, stage = 'configuration';
  const send = (method, path, body) => agent[method](path).set('X-Requested-With', 'marketplace-alerts').send(body);
  try {
    const identifier = (process.env.CHECK_LOGIN || process.env.IMPORT_USERNAME || '').trim();
    const password = process.env.CHECK_PASSWORD || process.env.IMPORT_PASSWORD;
    if (!identifier || !password) throw new Error('Missing check credentials');
    connection = await connectDatabase();
    const secretVault = vault(process.env.ENCRYPTION_KEY), sendEmail = createMailer();
    const app = await createApp({ db: connection.db, vault: secretVault, appUrl: process.env.APP_URL, sendEmail });
    agent = request.agent(app);
    stage = 'profile login';
    const login = await send('post', '/api/auth/login', { [identifier.includes('@') ? 'email' : 'username']: identifier, password });
    if (login.status !== 200) throw new Error('Profile login failed');
    const me = await agent.get('/api/me');
    if (me.status !== 200) throw new Error('Profile lookup failed');
    const user = me.body.user;
    console.log(JSON.stringify({ check: 'profile', ok: true, telegramDestinations: user.telegramBots.length, emailDeliveryConfigured: !!sendEmail, emailVerified: !!user.emailVerified }));
    for (const source of ['vinted', 'ebay']) {
      if (source === 'ebay' && !(user.configured.ebayClientId && user.configured.ebayClientSecret)) {
        console.log(JSON.stringify({ source, skipped: 'Credentials not configured' })); continue;
      }
      stage = `${source} connection`;
      const result = await send('post', `/api/connections/${source}/test`);
      const ok = result.status === 200 && result.body.ok === true;
      console.log(JSON.stringify({ source, ok, status: result.status }));
      if (!ok) process.exitCode = 1;
    }
    if (flags.has('--send-tests')) {
      console.log('Sending one real Telegram test to each configured destination.');
      for (const [index, bot] of user.telegramBots.entries()) {
        stage = 'Telegram destination test';
        const result = await send('post', `/api/telegram-bots/${encodeURIComponent(bot.id)}/test`);
        const ok = result.status === 200 && result.body.ok === true;
        console.log(JSON.stringify({ source: 'telegram', destination: index + 1, ok, status: result.status, chatType: ['private', 'group', 'supergroup', 'channel'].includes(result.body.chatType) ? result.body.chatType : 'unknown' }));
        if (!ok) process.exitCode = 1;
      }
    } else console.log('Telegram sends skipped; opt in with --send-tests.');
    if (flags.has('--scan-and-queue')) {
      stage = 'profile scan';
      const userId = new ObjectId(user.id), searches = connection.db.collection('searches');
      console.log('Scanning one active search; this can queue real Telegram/email alerts for the running worker.');
      await searches.findOneAndUpdate({ userId, active: true }, { $set: { nextRunAt: new Date() } }, { sort: { nextRunAt: 1 } });
      const worker = createWorker({ db: connection.db, vault: secretVault, sendEmail });
      const started = new Date(), scanned = await worker.scanNext(userId);
      const rows = await searches.find({ userId }, { projection: { sources: 1, statuses: 1, lastRunAt: 1 } }).toArray();
      console.log(JSON.stringify({ check: 'scan', scanned, searches: rows.map((row, index) => ({ search: index + 1, sources: ['vinted', 'ebay'].filter(source => row.sources.includes(source)).map(source => ({ source, ok: typeof row.statuses?.[source]?.ok === 'boolean' ? row.statuses[source].ok : null })) })), matches: await connection.db.collection('matches').countDocuments({ userId }) }));
      if (scanned && rows.some(row => row.lastRunAt >= started && Object.values(row.statuses || {}).some(status => status.ok === false))) process.exitCode = 1;
    }
  } catch {
    // Provider messages and API responses may include private account details.
    console.error(`Live check failed during ${stage}. Check account, database and integration configuration.`);
    process.exitCode = 1;
  } finally {
    if (agent) {
      try {
        await send('post', '/api/auth/logout');
        const ok = (await agent.get('/api/me')).status === 401;
        console.log(JSON.stringify({ check: 'logout', ok }));
        if (!ok) process.exitCode = 1;
      } catch { console.error('Live check session cleanup failed.'); process.exitCode = 1; }
    }
    await connection?.client.close().catch(() => { console.error('Live check database cleanup failed.'); process.exitCode = 1; });
  }
}
