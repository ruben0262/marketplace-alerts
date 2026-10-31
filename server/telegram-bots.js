import { ObjectId } from 'mongodb';

export const botSecrets = (bot, vault) => ({ telegramBotToken: vault.open(bot.botToken), telegramChatId: vault.open(bot.chatId) });
export const publicBot = bot => ({ id: bot.id, name: bot.name, configured: !!(bot.botToken && bot.chatId), connection: bot.connection || { ok: false, message: 'Send a test message to verify this destination.' } });
export const findBot = (user, id) => user.telegramBots?.find(bot => bot.id === id);
export const telegramMigration = 3;

// Deterministic IDs and upserts make interrupted migrations safe to resume.
export async function migrateTelegramUser(db, user) {
  if (user.telegramMigration === telegramMigration) return user;
  const users = db.collection('users'), searches = db.collection('searches');
  const legacyId = user._id.toString();
  const hasLegacyBot = user.secrets?.telegramBotToken && user.secrets?.telegramChatId;
  if (hasLegacyBot) {
    const bot = { id: legacyId, name: 'My Telegram', botToken: user.secrets.telegramBotToken, chatId: user.secrets.telegramChatId, revision: 0, connection: user.connections?.telegram || { ok: false, message: 'Send a test message to verify this destination.' }, createdAt: new Date() };
    await users.updateOne({ _id: user._id, 'telegramBots.id': { $ne: legacyId } }, { $push: { telegramBots: bot } });
    await searches.updateMany({ userId: user._id, telegramBotIds: { $exists: false } }, { $set: { telegramBotIds: [legacyId] } });
  }
  const cursor = db.collection('matches').find({ userId: user._id });
  const batch = [], routes = [];
  const flush = async () => {
    if (batch.length) await db.collection('deliveries').bulkWrite(batch.splice(0), { ordered: false });
    if (routes.length) await db.collection('matches').bulkWrite(routes.splice(0), { ordered: false });
  };
  for await (const match of cursor) {
    const state = ['pending', 'sent', 'seeded'].includes(match.alertState) ? match.alertState : 'suppressed';
    if (hasLegacyBot) {
      batch.push({ updateOne: { filter: { userId: user._id, matchId: match._id, botId: legacyId }, update: { $setOnInsert: { userId: user._id, matchId: match._id, botId: legacyId, botRevision: 0, searchIds: match.searchIds || [], state, retryAt: match.retryAt || new Date(), attempts: match.attempts || 0, ...(match.sentAt && { sentAt: match.sentAt }) } }, upsert: true } });
    }
    // Old finds are already observed, including accounts that had no Telegram.
    // Preserve that history when adding in-app/email destinations later.
    for (const searchId of match.searchIds || []) {
      const key = `routing.${searchId}`;
      routes.push({ updateOne: { filter: { _id: match._id, [key]: { $exists: false } }, update: { $set: { [key]: { state, inApp: false, bots: hasLegacyBot ? [{ id: legacyId, revision: 0 }] : [] } } } } });
    }
    if (batch.length >= 200 || routes.length >= 200) await flush();
  }
  await flush();
  await searches.updateMany({ userId: user._id, telegramBotIds: { $exists: false } }, { $set: { telegramBotIds: [] } });
  await users.updateOne({ _id: user._id }, { $set: { telegramMigration }, $unset: { 'secrets.telegramBotToken': '', 'secrets.telegramChatId': '', 'connections.telegram': '' } });
  return users.findOne({ _id: user._id });
}

export async function migrateTelegramAccounts(db) {
  for await (const user of db.collection('users').find({ telegramMigration: { $ne: telegramMigration } })) await migrateTelegramUser(db, user);
}

export function newBot({ name, botToken, chatId }, vault) {
  return { id: new ObjectId().toString(), name, botToken: vault.seal(botToken), chatId: vault.seal(chatId), revision: 0, connection: { ok: false, message: 'Send a test message to verify this destination.' }, createdAt: new Date() };
}
