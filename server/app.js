import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import { SUPPORT_EMAIL } from './support.js';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { resolve } from 'node:path';
import { hashPassword, verifyPassword, token, digest } from './security.js';
import { defaults, username, password, searchSchema, settingsSchema, credentialsSchema, publicUser, publicSearch, regions, secretNames, botSchema, email } from './schema.js';
import { decryptSecrets, scanMarketplace, telegram } from './integrations.js';
import { isSameOriginRequest } from './origins.js';
import { migrateTelegramAccounts, migrateTelegramUser, telegramMigration, newBot, findBot, botSecrets, publicBot } from './telegram-bots.js';
import { cancelDeliveries } from './deliveries.js';

const failure = (status, message) => Object.assign(new Error(message), { status });
const objectId = id => { if (!/^[a-f\d]{24}$/i.test(id)) throw failure(404, 'Not found.'); return new ObjectId(id); };
const SESSION_AGE = 7 * 86400000;

export async function createApp({ db, vault, appUrl = 'http://localhost:5173', secureCookies = false, trustProxy = false, scan = scanMarketplace, sendTelegram = telegram, clientDirectory = 'dist', sendEmail = null, logger = { info() {}, warn() {}, error() {} } }) {
  await migrateTelegramAccounts(db);
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use('/api', (req, res, next) => {
    const started = performance.now();
    req.requestId = token();
    res.set('X-Request-Id', req.requestId);
    res.on('finish', () => {
      if (req.route?.path === '/api/health' && res.statusCode < 400) return;
      logger.info('api.request', { requestId: req.requestId, method: req.method, route: req.route?.path || 'unmatched', statusCode: res.statusCode, durationMs: Math.round(performance.now() - started), ...(req.user && { userId: req.user._id.toString() }) });
    });
    next();
  });
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'https:', 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'"],
    upgradeInsecureRequests: secureCookies ? [] : null,
  } }, strictTransportSecurity: secureCookies }));
  app.use(express.json({ limit: '24kb' }), cookieParser());
  const users = db.collection('users'), sessions = db.collection('sessions'), searches = db.collection('searches'), matches = db.collection('matches');
  const dummyHash = await hashPassword(token());
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/', maxAge: SESSION_AGE };
  const origin = new URL(appUrl).origin;
  const safeUser = user => ({ ...publicUser(user), emailDeliveryAvailable: !!sendEmail });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !isSameOriginRequest(req, origin)) {
      return next(failure(403, 'This request could not be verified. Reload the page and try again.'));
    }
    next();
  });

  async function limit(key, maximum, windowMs = 900000) {
    const now = Date.now(), bucket = Math.floor(now / windowMs);
    const value = await db.collection('rateLimits').findOneAndUpdate({ _id: `${key}:${bucket}` }, {
      $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs) },
    }, { upsert: true, returnDocument: 'after' });
    if (value.count > maximum) throw failure(429, 'Too many attempts. Please try again later.');
  }
  const authLimit = async (req, res, next) => {
    await limit(`auth:${req.ip}`, 40);
    const identifier = req.body?.email || req.body?.username;
    if (typeof identifier === 'string') await limit(`account:${digest(identifier.trim().toLowerCase())}`, 15);
    next();
  };
  async function startSession(user, res) {
    const raw = token();
    await sessions.insertOne({ _id: digest(raw), userId: user._id, version: user.authVersion || 0, expiresAt: new Date(Date.now() + SESSION_AGE) });
    res.cookie('scout_session', raw, cookieOptions);
  }
  async function authenticate(req, res, next) {
    const raw = req.cookies.scout_session;
    const session = typeof raw === 'string' && raw.length < 128 && await sessions.findOne({ _id: digest(raw), expiresAt: { $gt: new Date() } });
    const user = session && await users.findOne({ _id: session.userId });
    if (!user || (user.authVersion || 0) !== session.version) throw failure(401, 'Please log in to continue.');
    req.user = await migrateTelegramUser(db, user);
    next();
  }

  app.get('/api/health', async (req, res) => { await db.command({ ping: 1 }); res.json({ ok: true }); });
  app.get('/api/meta', (req, res) => res.json({ regions, emailDeliveryAvailable: !!sendEmail }));
  async function sendVerification(user) {
    if (!sendEmail || !user.email) return false;
    const verificationToken = token();
    const updated = await users.updateOne({ _id: user._id, email: user.email }, { $set: { emailVerificationHash: digest(verificationToken), emailVerificationExpiresAt: new Date(Date.now() + 86400000) } });
    if (!updated.matchedCount) return false;
    try {
      await sendEmail({ to: user.email, subject: 'Verify your Scout email', text: `Verify your email to receive marketplace alerts:\n${origin}/verify-email#${verificationToken}\nThis link expires in 24 hours. If you did not request it, ignore this message.` });
      return true;
    } catch (error) { logger.warn('email.verification_failed', { errorName: error.name }); return false; }
  }
  app.post('/api/auth/signup', authLimit, async (req, res) => {
    const input = z.object({ email: email.optional(), username: username.optional(), password }).strict().refine(v => v.email || v.username, 'Enter your email address.').parse(req.body);
    const recoveryKey = token();
    const handle = input.username || `${input.email.split('@')[0].replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'scout'}_${token().replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
    const user = { _id: new ObjectId(), username: handle, ...(input.email && { email: input.email }), passwordHash: await hashPassword(input.password), recoveryHash: digest(recoveryKey), authVersion: 0, settings: defaults(), secrets: {}, connections: {}, telegramBots: [], telegramMigration, recoveryTelegramBotId: null, createdAt: new Date() };
    try { await users.insertOne(user); } catch (e) { if (e.code === 11000) throw failure(409, input.email ? 'An account with those details already exists. Try logging in or recovering your password.' : 'That username is already taken.'); throw e; }
    await startSession(user, res);
    const verificationSent = await sendVerification(user);
    res.status(201).json({ user: safeUser(user), recoveryKey, verificationSent });
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const input = z.object({ email: email.optional(), username: z.string().trim().min(1).max(254).optional(), password: z.string().min(1).max(128) }).strict().refine(v => v.email || v.username, 'Enter your email or username.').parse(req.body);
    const identifier = (input.email || input.username).toLowerCase();
    const user = await users.findOne(identifier.includes('@') ? { email: identifier } : { username: identifier });
    const valid = await verifyPassword(input.password, user?.passwordHash || dummyHash);
    if (!user || !valid) throw failure(401, 'Incorrect email, username, or password.');
    if (req.cookies.scout_session) await sessions.deleteOne({ _id: digest(req.cookies.scout_session) });
    await startSession(user, res);
    res.json({ user: safeUser(user) });
  });
  app.post('/api/auth/verify-email', authLimit, async (req, res) => {
    const input = z.object({ token: z.string().min(20).max(128) }).strict().parse(req.body);
    const user = await users.findOneAndUpdate({ emailVerificationHash: digest(input.token), emailVerificationExpiresAt: { $gt: new Date() } }, { $set: { emailVerifiedAt: new Date() }, $unset: { emailVerificationHash: '', emailVerificationExpiresAt: '' } }, { returnDocument: 'after' });
    if (!user) throw failure(400, 'This verification link is invalid or expired.');
    res.json({ message: 'Your email is verified. You can now choose email alerts on a search.' });
  });
  app.post('/api/auth/logout', async (req, res) => {
    if (typeof req.cookies.scout_session === 'string') await sessions.deleteOne({ _id: digest(req.cookies.scout_session) });
    res.clearCookie('scout_session', { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  });
  app.post('/api/auth/forgot', authLimit, async (req, res) => {
    const input = z.object({ email: email.optional(), username: username.optional() }).strict().refine(v => v.email || v.username, 'Enter your email or username.').parse(req.body);
    const user = await users.findOne(input.email ? { email: input.email } : { username: input.username });
    const recoveryBot = user && findBot(user, user.recoveryTelegramBotId);
    const canEmail = user?.email && sendEmail;
    const canTelegram = recoveryBot?.connection?.ok && recoveryBot.connection.chatType === 'private';
    if (canEmail || canTelegram) {
      const resetToken = token();
      const currentRecovery = !canEmail ? { recoveryTelegramBotId: recoveryBot.id, telegramBots: { $elemMatch: { id: recoveryBot.id, revision: recoveryBot.revision, 'connection.ok': true, 'connection.chatType': 'private' } } } : {};
      const updated = await users.updateOne({ _id: user._id, email: user.email ?? null, passwordHash: user.passwordHash, ...currentRecovery }, { $set: { resetHash: digest(resetToken), resetExpiresAt: new Date(Date.now() + 15 * 60000) } });
      const text = `Reset your Scout password (valid for 15 minutes):\n${origin}/reset-password#${resetToken}\nIf you did not request this, ignore this message.`;
      try {
        if (!updated.matchedCount) throw new Error('Account changed during recovery');
        if (canEmail) await sendEmail({ to: user.email, subject: 'Reset your Scout password', text });
        else { const secrets = botSecrets(recoveryBot, vault); await sendTelegram(secrets, 'sendMessage', { chat_id: secrets.telegramChatId, text }); }
      } catch (error) { logger.warn('email.recovery_failed', { errorName: error.name }); /* Keep existing and unknown accounts indistinguishable. */ }
    }
    res.json({ message: 'If this account has an available recovery method, instructions are on their way. You can also use your recovery key.' });
  });
  app.post('/api/auth/reset', authLimit, async (req, res) => {
    const input = z.object({ username: username.optional(), email: email.optional(), recoveryKey: z.string().min(20).max(128).optional(), resetToken: z.string().min(20).max(128).optional(), password }).strict()
      .refine(v => !!v.resetToken !== !!((v.username || v.email) && v.recoveryKey), { message: 'Use a reset link or your username and recovery key.' }).parse(req.body);
    const filter = input.resetToken ? { resetHash: digest(input.resetToken), resetExpiresAt: { $gt: new Date() } } : { ...(input.email ? { email: input.email } : { username: input.username }), recoveryHash: digest(input.recoveryKey) };
    const recoveryKey = token();
    const user = await users.findOneAndUpdate(filter, { $set: { passwordHash: await hashPassword(input.password), recoveryHash: digest(recoveryKey) }, $inc: { authVersion: 1 }, $unset: { resetHash: '', resetExpiresAt: '' } }, { returnDocument: 'after' });
    if (!user) throw failure(400, 'This recovery key or reset link is invalid or expired.');
    await sessions.deleteMany({ userId: user._id });
    await startSession(user, res);
    res.json({ user: safeUser(user), recoveryKey });
  });

  app.post('/api/support', async (req, res) => {
    const input = z.object({ requestId: z.uuid(), email, subject: z.string().trim().min(5).max(120).regex(/^[^\r\n]+$/), message: z.string().trim().min(20).max(4000) }).strict().parse(req.body);
    if (!sendEmail) throw failure(503, 'Support delivery is temporarily unavailable. Please email hello@flow-solutions.xyz.');
    await limit(`support-ip:${req.ip}`, 5, 3600000);
    await limit(`support-email:${digest(input.email)}`, 3, 3600000);
    const tickets = db.collection('supportTickets');
    const document = { ...input, to: SUPPORT_EMAIL, reference: `SC-${token().replace(/[^a-z0-9]/gi, '').slice(0, 12).toUpperCase()}`, state: 'pending', attempts: 0, retryAt: new Date(), createdAt: new Date(), expiresAt: new Date(Date.now() + 90 * 86400000) };
    try { await tickets.updateOne({ requestId: input.requestId }, { $setOnInsert: document }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    const saved = await tickets.findOne({ requestId: input.requestId });
    if (['email', 'subject', 'message'].some(key => saved[key] !== input[key])) throw failure(409, 'This message changed after it was received. Reload to send a new request.');
    res.status(202).json({ reference: saved.reference });
  });

  app.use('/api', authenticate);
  app.get('/api/me', (req, res) => res.json({ user: safeUser(req.user) }));
  app.post('/api/email/verification', async (req, res) => {
    await limit(`verify-email:${req.user._id}`, 3, 3600000);
    if (!sendEmail) throw failure(503, 'Email delivery is not configured on this server yet.');
    if (!req.user.email) throw failure(400, 'Add an email address to your account first.');
    if (req.user.emailVerifiedAt) return res.json({ message: 'Your email is already verified.' });
    if (!await sendVerification(req.user)) throw failure(502, 'The verification email could not be sent. Please try again later.');
    res.json({ message: 'Verification email sent. Check your inbox.' });
  });
  app.patch('/api/email', async (req, res) => {
    await limit(`change-email:${req.user._id}`, 10);
    const input = z.object({ email, currentPassword: z.string().max(128) }).strict().parse(req.body);
    if (!await verifyPassword(input.currentPassword, req.user.passwordHash)) throw failure(400, 'Your current password is incorrect.');
    if (input.email === req.user.email) return res.json({ user: safeUser(req.user) });
    let user;
    try { user = await users.findOneAndUpdate({ _id: req.user._id, passwordHash: req.user.passwordHash }, { $set: { email: input.email }, $unset: { emailVerifiedAt: '', emailVerificationHash: '', emailVerificationExpiresAt: '', resetHash: '', resetExpiresAt: '' } }, { returnDocument: 'after' }); }
    catch (error) { if (error.code === 11000) throw failure(409, 'That email address is already in use.'); throw error; }
    if (!user) throw failure(409, 'Your account changed in another session. Please log in again.');
    await cancelDeliveries(db, { userId: user._id, botId: 'email' });
    const verificationSent = await sendVerification(user);
    res.json({ user: safeUser(user), verificationSent });
  });
  app.post('/api/password', async (req, res) => {
    const input = z.object({ currentPassword: z.string().max(128), password }).strict().parse(req.body);
    await limit(`password:${req.user._id}`, 10);
    if (!await verifyPassword(input.currentPassword, req.user.passwordHash)) throw failure(400, 'Your current password is incorrect.');
    const recoveryKey = token();
    const user = await users.findOneAndUpdate({ _id: req.user._id, passwordHash: req.user.passwordHash }, {
      $set: { passwordHash: await hashPassword(input.password), recoveryHash: digest(recoveryKey) }, $inc: { authVersion: 1 }, $unset: { resetHash: '', resetExpiresAt: '' },
    }, { returnDocument: 'after' });
    if (!user) throw failure(409, 'Your password changed in another session. Please log in again.');
    await sessions.deleteMany({ userId: user._id });
    await startSession(user, res);
    res.json({ recoveryKey });
  });
  app.patch('/api/settings', async (req, res) => {
    const { settings, credentials, recoveryTelegramBotId } = z.object({ settings: settingsSchema.optional(), credentials: credentialsSchema.optional(), recoveryTelegramBotId: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional() }).strict().parse(req.body);
    const set = Object.fromEntries(Object.entries(settings || {}).map(([k, v]) => [`settings.${k}`, v]));
    const filter = { _id: req.user._id }, update = { $set: set };
    let changedBot;
    for (const [key, value] of Object.entries(credentials || {})) if (!key.startsWith('telegram')) set[`secrets.${key}`] = vault.seal(value);
    if (recoveryTelegramBotId !== undefined) {
      const bot = recoveryTelegramBotId && findBot(req.user, recoveryTelegramBotId);
      if (recoveryTelegramBotId && (!bot?.connection?.ok || bot.connection.chatType !== 'private')) throw failure(400, 'Choose one verified private Telegram destination for recovery.');
      set.recoveryTelegramBotId = recoveryTelegramBotId;
      if (bot) filter.telegramBots = { $elemMatch: { id: bot.id, revision: bot.revision, 'connection.ok': true, 'connection.chatType': 'private' } };
      update.$unset = { resetHash: '', resetExpiresAt: '' };
    }
    // Compatibility for clients that used the former single-destination settings.
    if (credentials && ('telegramBotToken' in credentials || 'telegramChatId' in credentials)) {
      const bot = req.user.telegramBots?.[0];
      const changes = { revision: (bot?.revision || 0) + 1, connection: { ok: false, message: 'Configuration updated. Test the connection.' } };
      if ('telegramBotToken' in credentials) changes.botToken = vault.seal(credentials.telegramBotToken);
      if ('telegramChatId' in credentials) changes.chatId = vault.seal(credentials.telegramChatId);
      if (bot) {
        if (recoveryTelegramBotId) throw failure(400, 'Test the updated destination before choosing it for recovery.');
        filter.telegramBots = { $elemMatch: { id: bot.id, revision: bot.revision } };
        Object.assign(set, Object.fromEntries(Object.entries(changes).map(([key, value]) => [`telegramBots.$.${key}`, value])));
        changedBot = bot.id;
      } else {
        filter['telegramBots.0'] = { $exists: false };
        update.$push = { telegramBots: { id: new ObjectId().toString(), name: 'My Telegram', createdAt: new Date(), ...changes } };
      }
    }
    for (const integration of ['ebay', 'vinted']) {
      if (Object.keys(credentials || {}).some(k => k.startsWith(integration)) || Object.keys(settings || {}).some(k => k.startsWith(integration))) {
        set[`connections.${integration}`] = { ok: false, message: 'Configuration updated. Test the connection.' };
      }
    }
    if (!Object.keys(set).length && !update.$push) throw failure(400, 'No settings were supplied.');
    let user = await users.findOneAndUpdate(filter, update, { returnDocument: 'after' });
    if (!user) throw failure(409, 'Your account changed in another session. Reload and try again.');
    if (changedBot) {
      await users.updateOne({ _id: user._id, recoveryTelegramBotId: changedBot }, { $set: { recoveryTelegramBotId: null }, $unset: { resetHash: '', resetExpiresAt: '' } });
      await cancelDeliveries(db, { userId: user._id, botId: changedBot });
      user = await users.findOne({ _id: user._id });
    }
    res.json({ user: safeUser(user) });
  });
  async function testBot(req, res, bot) {
    if (!bot) throw failure(404, 'Telegram destination not found.');
    await limit(`connection:${req.user._id}:telegram:${bot.id}`, 3, 60000);
    let status;
    try {
      const secrets = botSecrets(bot, vault);
      const result = await sendTelegram(secrets, 'sendMessage', { chat_id: secrets.telegramChatId, text: `Scout is connected ✓\nTest message for ${bot.name}. Choose this destination on a search to send its matches here.` });
      status = { ok: true, message: 'Test message delivered to Telegram.', chatType: result?.chat?.type || 'unknown', checkedAt: new Date() };
    } catch (error) { status = { ok: false, message: error.message, checkedAt: new Date() }; }
    const updated = await users.findOneAndUpdate({ _id: req.user._id, telegramBots: { $elemMatch: { id: bot.id, revision: bot.revision } } }, { $set: { 'telegramBots.$.connection': status } }, { returnDocument: 'after' });
    if (!updated) throw failure(409, 'This destination changed while it was being tested. Test it again.');
    res.status(status.ok ? 200 : 422).json({ ...status, user: safeUser(updated) });
  }
  app.post('/api/telegram-bots', async (req, res) => {
    const input = botSchema.parse(req.body);
    await limit(`create-bot:${req.user._id}`, 20, 60000);
    const bot = newBot(input, vault);
    const user = await users.findOneAndUpdate({ _id: req.user._id, 'telegramBots.19': { $exists: false } }, { $push: { telegramBots: bot } }, { returnDocument: 'after' });
    if (!user) throw failure(400, 'You can save up to 20 Telegram destinations.');
    res.status(201).json({ user: safeUser(user), bot: publicBot(bot) });
  });
  app.patch('/api/telegram-bots/:id', async (req, res) => {
    const input = botSchema.partial().refine(v => Object.keys(v).length, 'Supply at least one change.').parse(req.body);
    const bot = findBot(req.user, req.params.id);
    if (!bot) throw failure(404, 'Telegram destination not found.');
    const set = {};
    if (input.name !== undefined) set['telegramBots.$.name'] = input.name;
    for (const key of ['botToken', 'chatId']) if (input[key] !== undefined) set[`telegramBots.$.${key}`] = vault.seal(input[key]);
    const credentialsChanged = input.botToken !== undefined || input.chatId !== undefined;
    if (credentialsChanged) {
      set['telegramBots.$.connection'] = { ok: false, message: 'Configuration updated. Test the connection.' };
      set['telegramBots.$.revision'] = bot.revision + 1;
      if (req.user.recoveryTelegramBotId === bot.id) set.recoveryTelegramBotId = null;
    }
    let user = await users.findOneAndUpdate({ _id: req.user._id, telegramBots: { $elemMatch: { id: bot.id, revision: bot.revision } } }, { $set: set, ...(credentialsChanged && req.user.recoveryTelegramBotId === bot.id && { $unset: { resetHash: '', resetExpiresAt: '' } }) }, { returnDocument: 'after' });
    if (!user) throw failure(409, 'This destination changed in another session. Reload and try again.');
    if (credentialsChanged) {
      await users.updateOne({ _id: user._id, recoveryTelegramBotId: bot.id }, { $set: { recoveryTelegramBotId: null }, $unset: { resetHash: '', resetExpiresAt: '' } });
      await cancelDeliveries(db, { userId: user._id, botId: bot.id, botRevision: { $ne: bot.revision + 1 } });
      user = await users.findOne({ _id: user._id });
    }
    res.json({ user: safeUser(user) });
  });
  app.delete('/api/telegram-bots/:id', async (req, res) => {
    if (!findBot(req.user, req.params.id)) throw failure(404, 'Telegram destination not found.');
    let user = await users.findOneAndUpdate({ _id: req.user._id, 'telegramBots.id': req.params.id }, { $pull: { telegramBots: { id: req.params.id } } }, { returnDocument: 'after' });
    if (!user) throw failure(404, 'Telegram destination not found.');
    await Promise.all([
      searches.updateMany({ userId: user._id, telegramBotIds: req.params.id }, { $pull: { telegramBotIds: req.params.id }, $inc: { revision: 1 } }),
      cancelDeliveries(db, { userId: user._id, botId: req.params.id }),
      users.updateOne({ _id: user._id, recoveryTelegramBotId: req.params.id }, { $set: { recoveryTelegramBotId: null }, $unset: { resetHash: '', resetExpiresAt: '' } }),
    ]);
    user = await users.findOne({ _id: user._id });
    res.json({ user: safeUser(user) });
  });
  app.post('/api/telegram-bots/:id/test', (req, res) => testBot(req, res, findBot(req.user, req.params.id)));
  app.post('/api/connections/:source/test', async (req, res) => {
    const source = z.enum(['telegram', 'vinted', 'ebay']).parse(req.params.source);
    if (source === 'telegram') return testBot(req, res, req.user.telegramBots?.[0]);
    await limit(`connection:${req.user._id}:${source}`, 3, 60000);
    const secrets = decryptSecrets(req.user, vault);
    let status;
    try {
      if (source === 'ebay' && (!secrets.ebayClientId || !secrets.ebayClientSecret)) throw new Error('Add your eBay production App ID and Cert ID first.');
      const result = await scan({ source, user: req.user, secrets, search: searchSchema.parse({ name: 'Connection test', query: 'boxraw', sources: [source] }) });
      status = { ok: !result.warning, message: result.warning || `Connected. Search returned ${result.scanned} listings.` };
    } catch (error) { status = { ok: false, message: error.message }; }
    status.checkedAt = new Date();
    const filter = { _id: req.user._id };
    for (const key of secretNames) if (key.startsWith(source)) filter[`secrets.${key}`] = req.user.secrets?.[key] ?? null;
    filter[`settings.${source}Regions`] = req.user.settings[`${source}Regions`];
    await users.updateOne(filter, { $set: { [`connections.${source}`]: status } });
    res.status(status.ok ? 200 : 422).json(status);
  });
  const ownSearch = req => ({ _id: objectId(req.params.id), userId: req.user._id });
  function verifySources(input, user) {
    if (input.emailAlerts && (!sendEmail || !user.email || !user.emailVerifiedAt)) throw failure(400, !sendEmail ? 'Email delivery is not configured on this server yet.' : 'Verify your email address before choosing email alerts.');
    if (input.telegramBotIds?.some(id => !findBot(user, id)?.botToken || !findBot(user, id)?.chatId)) throw failure(400, 'Choose Telegram destinations saved in your account.');
    if (input.sources.includes('ebay') && (!user.secrets?.ebayClientId || !user.secrets?.ebayClientSecret)) throw failure(400, 'Connect your eBay credentials in Settings before adding an eBay search.');
  }
  app.get('/api/searches', async (req, res) => res.json({ searches: (await searches.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).toArray()).map(publicSearch) }));
  app.post('/api/searches', async (req, res) => {
    const input = searchSchema.parse(req.body);
    verifySources(input, req.user);
    await limit(`create-search:${req.user._id}`, 20, 60000);
    if (await searches.countDocuments({ userId: req.user._id }) >= 50) throw failure(400, 'You can have up to 50 searches.');
    const search = { ...input, telegramBotIds: input.telegramBotIds || [], emailAlerts: !!input.emailAlerts, inAppNotifications: input.inAppNotifications !== false, _id: new ObjectId(), userId: req.user._id, createdAt: new Date(), nextRunAt: new Date(), revision: 0, initializedSources: [], statuses: {} };
    await searches.insertOne(search);
    res.status(201).json({ search: publicSearch(search) });
  });
  app.put('/api/searches/:id', async (req, res) => {
    const input = searchSchema.parse(req.body);
    verifySources(input, req.user);
    const search = await searches.findOneAndUpdate(ownSearch(req), { $set: { ...input, nextRunAt: new Date(), knownProductIds: {} }, $inc: { revision: 1 } }, { returnDocument: 'after' });
    if (!search) throw failure(404, 'Search not found.');
    res.json({ search: publicSearch(search) });
  });
  app.patch('/api/searches/:id', async (req, res) => {
    const input = z.object({ active: z.boolean() }).strict().parse(req.body);
    const search = await searches.findOneAndUpdate(ownSearch(req), { $set: { active: input.active, nextRunAt: new Date() }, $inc: { revision: 1 } }, { returnDocument: 'after' });
    if (!search) throw failure(404, 'Search not found.');
    res.json({ search: publicSearch(search) });
  });
  app.post('/api/searches/:id/run', async (req, res) => {
    await limit(`run:${req.user._id}`, 5, 60000);
    const search = await searches.findOne(ownSearch(req));
    if (!search) throw failure(404, 'Search not found.');
    if (!search.active) throw failure(400, 'Resume this search before scanning.');
    if (search.lockUntil > new Date()) throw failure(409, 'This search is already scanning.');
    await searches.updateOne(ownSearch(req), { $set: { nextRunAt: new Date() } });
    res.status(202).json({ message: 'Search queued. Results will update automatically.' });
  });
  app.delete('/api/searches/:id', async (req, res) => {
    const result = await searches.deleteOne(ownSearch(req));
    if (!result.deletedCount) throw failure(404, 'Search not found.');
    res.json({ ok: true });
  });
  app.get('/api/matches', async (req, res) => {
    const input = z.object({ source: z.enum(['vinted', 'ebay']).optional(), search: z.string().optional(), before: z.string().optional(), limit: z.coerce.number().int().min(1).max(60).default(24) }).parse(req.query);
    const filter = { userId: req.user._id };
    if (input.source) filter.source = input.source;
    if (input.search) filter.searchIds = objectId(input.search);
    if (input.before) filter._id = { $lt: objectId(input.before) };
    const rows = await matches.find(filter, { projection: { userId: 0, lockToken: 0, lockUntil: 0, routing: 0 } }).sort({ _id: -1 }).limit(input.limit + 1).toArray();
    const more = rows.length > input.limit;
    if (more) rows.pop();
    res.json({ matches: rows, nextCursor: more ? rows.at(-1)._id.toString() : null });
  });
  app.get('/api/dashboard', async (req, res) => {
    const filter = { userId: req.user._id };
    const [totalSearches, activeSearches, totalMatches, delivered, latest] = await Promise.all([
      searches.countDocuments(filter), searches.countDocuments({ ...filter, active: true }), matches.countDocuments(filter),
      db.collection('deliveries').countDocuments({ ...filter, state: 'sent' }),
      matches.find(filter, { projection: { userId: 0, lockToken: 0, lockUntil: 0, routing: 0 } }).sort({ foundAt: -1 }).limit(6).toArray(),
    ]);
    res.json({ totalSearches, activeSearches, totalMatches, delivered, latest });
  });
  app.get('/api/notifications', async (req, res) => {
    const input = z.object({ before: z.string().optional(), unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(60).default(24) }).parse(req.query);
    const filter = { userId: req.user._id };
    if (input.before) filter._id = { $lt: objectId(input.before) };
    if (input.unread === 'true') filter.readAt = null;
    const [rows, unreadCount] = await Promise.all([
      db.collection('notifications').find(filter, { projection: { userId: 0, matchId: 0 } }).sort({ _id: -1 }).limit(input.limit + 1).toArray(),
      db.collection('notifications').countDocuments({ userId: req.user._id, readAt: null }),
    ]);
    const more = rows.length > input.limit;
    if (more) rows.pop();
    res.json({ notifications: rows, nextCursor: more ? rows.at(-1)._id.toString() : null, unreadCount });
  });
  app.post('/api/notifications/read', async (req, res) => {
    const input = z.union([z.object({ all: z.literal(true) }).strict(), z.object({ ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(100) }).strict()]).parse(req.body);
    const filter = { userId: req.user._id, readAt: null, ...(!input.all && { _id: { $in: input.ids.map(objectId) } }) };
    await db.collection('notifications').updateMany(filter, { $set: { readAt: new Date() } });
    res.json({ unreadCount: await db.collection('notifications').countDocuments({ userId: req.user._id, readAt: null }) });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(compression());
  app.use('/assets', express.static(resolve(clientDirectory, 'assets'), { maxAge: '1y', immutable: true, fallthrough: false }));
  app.use(express.static(resolve(clientDirectory), { index: false, maxAge: '1h', setHeaders: (res, path) => { if (path.endsWith('.js') || path.endsWith('/index.html')) res.set('Cache-Control', 'no-cache'); } }));
  app.get('/{*path}', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(resolve(clientDirectory, 'index.html')); });
  app.use((error, req, res, next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => i.message).join(' ') });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (!error.status || error.status >= 500) logger.error('api.failed', { requestId: req.requestId, errorName: error.name });
    if (error.status) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
