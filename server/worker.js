import { deliverSupportTicket } from './support.js';
import { token } from './security.js';
import { decryptSecrets, scanMarketplace, sendAlert } from './integrations.js';
import { botSecrets, findBot, migrateTelegramUser } from './telegram-bots.js';
import { productEmail } from './mailer.js';
import { refreshDeliveryStates } from './deliveries.js';

const available = now => ({ $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lte: now } }] });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createWorker({ db, vault, scan = scanMarketplace, send = sendAlert, sendEmail = null, logger = { info() {}, warn() {}, error() {} } }) {
  const searches = db.collection('searches'), users = db.collection('users'), matches = db.collection('matches'), deliveries = db.collection('deliveries');
  let stopping = false, running;

  async function recordResults(user, search, source, result) {
    if (!result.items.length) return;
    const seed = !search.initializedSources.includes(source) && !search.notifyExisting;
    const selected = (search.telegramBotIds || []).map(id => findBot(user, id)).filter(Boolean);
    const state = seed ? 'seeded' : user.settings.notifications ? 'pending' : 'suppressed';
    const emailTarget = search.emailAlerts && user.email && user.emailVerifiedAt ? [{ id: 'email', revision: 0, email: user.email }] : [];
    const route = { state, inApp: search.inAppNotifications !== false && !seed, bots: [...selected.map(bot => ({ id: bot.id, revision: bot.revision })), ...emailTarget] };
    const filter = { userId: user._id, source, productId: { $in: result.items.map(item => item.productId) } };
    await matches.bulkWrite(result.items.map(item => ({ updateOne: {
      filter: { userId: user._id, source, productId: item.productId },
      update: { $setOnInsert: { ...item, userId: user._id, searchName: search.name, foundAt: new Date(), alertState: seed ? 'seeded' : selected.length && user.settings.notifications ? 'pending' : 'web-only' }, $addToSet: { searchIds: search._id } }, upsert: true,
    } })), { ordered: false });
    // Record each search's destinations only on its first observation of a product.
    // Changing a route sends future finds there without replaying the old feed.
    const routeKey = `routing.${search._id}`;
    await matches.updateMany({ ...filter, [routeKey]: { $exists: false } }, { $set: { [routeKey]: route } });
    const products = await matches.find(filter).toArray();
    const operations = products.flatMap(match => (match.routing?.[search._id]?.bots || []).map(bot => ({ updateOne: {
      filter: { userId: user._id, matchId: match._id, botId: bot.id },
      update: { $setOnInsert: { userId: user._id, matchId: match._id, botId: bot.id, botRevision: bot.revision, ...(bot.email && { email: bot.email }), state: match.routing[search._id].state, retryAt: new Date(), attempts: 0, createdAt: new Date() }, $addToSet: { searchIds: search._id } }, upsert: true,
    } })));
    if (operations.length) {
      await deliveries.bulkWrite(operations, { ordered: false });
      await refreshDeliveryStates(db, products.map(match => match._id));
    }
    const notifications = products.filter(match => match.routing?.[search._id]?.inApp).map(match => ({ updateOne: {
      filter: { userId: user._id, matchId: match._id },
      update: { $setOnInsert: { userId: user._id, matchId: match._id, title: match.title, body: `New ${match.source} match for ${search.name}`, url: match.url, source: match.source, searchName: search.name, foundAt: new Date(), readAt: null } }, upsert: true,
    } }));
    if (notifications.length) await db.collection('notifications').bulkWrite(notifications, { ordered: false });
  }

  async function scanNext(userId) {
    const now = new Date(), lockToken = token();
    let search = await searches.findOneAndUpdate({ ...(userId && { userId }), active: true, nextRunAt: { $lte: now }, ...available(now) },
      { $set: { lockToken, lockUntil: new Date(Date.now() + 300000) } }, { sort: { nextRunAt: 1 }, returnDocument: 'after' });
    if (!search) return false;
    const lock = { _id: search._id, lockToken }, snapshot = { ...lock, revision: search.revision ?? null };
    let delay = 120;
    try {
      let user = await users.findOne({ _id: search.userId });
      if (!user) { await searches.deleteOne(lock); return false; }
      user = await migrateTelegramUser(db, user);
      search = { ...search, telegramBotIds: (await searches.findOne(lock))?.telegramBotIds || [] };
      delay = user.settings.pollInterval;
      const secrets = decryptSecrets(user, vault);
      for (const source of search.sources) {
        if (stopping) break;
        const started = performance.now();
        const context = { userId: user._id.toString(), searchId: search._id.toString(), source };
        logger.info('scan.started', context);
        try {
          if (source === 'ebay' && (!secrets.ebayClientId || !secrets.ebayClientSecret)) throw new Error('Add your eBay credentials in Settings.');
          const result = await scan({ source, search, user, secrets });
          if (!await searches.findOne({ ...snapshot, active: true })) break;
          // Read current destinations: credentials may have changed during a slow scan.
          const latestUser = await users.findOne({ _id: user._id });
          if (!latestUser) break;
          await recordResults(latestUser, search, source, result);
          await searches.updateOne(snapshot, { $set: { [`knownProductIds.${source}`]: [...new Set([...(result.knownProductIds || []), ...(search.knownProductIds?.[source] || [])])].slice(0, 2000), [`statuses.${source}`]: { ok: !result.warning, message: result.warning || `${result.items.length} matches from ${result.scanned} listings`, checkedAt: new Date() } }, $addToSet: { initializedSources: source } });
          logger.info('scan.completed', { ...context, count: result.items.length, durationMs: Math.round(performance.now() - started) });
        } catch (error) {
          logger.warn('scan.failed', { ...context, durationMs: Math.round(performance.now() - started), errorName: error.name });
          delay = Math.max(delay, 900);
          await searches.updateOne(snapshot, { $set: { [`statuses.${source}`]: { ok: false, message: error.message, checkedAt: new Date() } } });
        }
      }
    } finally {
      const result = await searches.updateOne(snapshot, { $set: { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + delay * 1000) }, $unset: { lockToken: '', lockUntil: '' } });
      if (!result.matchedCount) await searches.updateOne(lock, { $unset: { lockToken: '', lockUntil: '' } });
    }
    return true;
  }

  async function deliverNext() {
    const now = new Date(), lockToken = token();
    const job = await deliveries.findOneAndUpdate({ state: 'pending', retryAt: { $lte: now }, ...available(now) },
      { $set: { lockToken, lockUntil: new Date(Date.now() + 60000) } }, { sort: { retryAt: 1 }, returnDocument: 'after' });
    if (!job) return false;
    const lock = { _id: job._id, lockToken };
    const context = { userId: job.userId.toString(), searchId: job.searchIds[0]?.toString(), channel: job.botId === 'email' ? 'email' : 'telegram', attempt: (job.attempts || 0) + 1 };
    try {
      const [user, match] = await Promise.all([users.findOne({ _id: job.userId }), matches.findOne({ _id: job.matchId, userId: job.userId })]);
      const isEmail = job.botId === 'email';
      const bot = user && findBot(user, job.botId);
      const eligible = user && await searches.find({ _id: { $in: job.searchIds }, userId: job.userId, sources: match?.source, ...(isEmail ? { emailAlerts: true } : { telegramBotIds: job.botId }) }).project({ active: 1 }).toArray();
      const validDestination = isEmail ? user?.email === job.email && !!user.emailVerifiedAt : bot && bot.revision === job.botRevision;
      if (!match || !validDestination || !eligible?.length) {
        await deliveries.updateOne(lock, { $set: { state: 'cancelled' } });
      } else if (!user.settings.notifications || (isEmail ? !sendEmail : !bot.connection?.ok) || !eligible.some(search => search.active)) {
        await deliveries.updateOne(lock, { $set: { retryAt: new Date(Date.now() + 60000) } });
      } else {
        if (isEmail) await sendEmail(productEmail(match, job.email));
        else await send(botSecrets(bot, vault), match);
        await deliveries.updateOne(lock, { $set: { state: 'sent', sentAt: new Date() }, $unset: { deliveryError: '' } });
        logger.info('delivery.sent', context);
      }
    } catch (error) {
      logger.warn('delivery.failed', { ...context, errorName: error.name });
      const attempts = (job.attempts || 0) + 1;
      await deliveries.updateOne(lock, { $set: { attempts, deliveryError: error.message, retryAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7))) } });
    } finally {
      await deliveries.updateOne(lock, { $unset: { lockToken: '', lockUntil: '' } });
      await refreshDeliveryStates(db, [job.matchId]);
    }
    return true;
  }

  async function loop(work, pace) {
    while (!stopping) {
      let didWork = false;
      try { didWork = await work(); } catch (error) { logger.error('worker.cycle_failed', { errorName: error.name }); }
      if (!stopping && (!didWork || pace)) await sleep(didWork ? pace : 1000);
    }
  }
  const deliverSupport = () => deliverSupportTicket(db, sendEmail, logger);
  // Slow marketplace requests no longer block notifications already in the outbox.
  return { scanNext, deliverNext, deliverSupport, start() { running ||= Promise.all([loop(scanNext, 0), loop(deliverNext, 1200), ...(sendEmail ? [loop(deliverSupport, 1200)] : [])]); }, async stop() { stopping = true; await running; } };
}
