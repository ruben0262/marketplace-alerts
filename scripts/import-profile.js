import 'dotenv/config';
import { readFile, writeFile, access } from 'node:fs/promises';
import { ObjectId } from 'mongodb';
import { parse } from 'yaml';
import { connectDatabase } from '../server/db.js';
import { vault, hashPassword, digest, token } from '../server/security.js';
import { defaults, username, password, searchSchema, settingsSchema, regions } from '../server/schema.js';
import { migrateTelegramUser } from '../server/telegram-bots.js';

// Explicit, one-time import. Startup never creates or resets a default account.
export async function importProfile({ db, secretVault, env, raw, recoveryPath = '.profile-recovery-key' }) {
  const name = username.parse(env.IMPORT_USERNAME);
  if (await db.collection('users').findOne({ username: name })) return { created: false, username: name };
  const chosenPassword = password.parse(env.IMPORT_PASSWORD);
  const settings = defaults();
  settings.pollInterval = Math.max(60, raw.app?.poll_interval_seconds || 120);
  settings.translation = !!raw.translation?.enabled;
  settings.userAgent = env.MONITOR_USER_AGENT || '';
  const vinted = raw.sources?.vinted || {}, ebay = raw.sources?.ebay || {};
  const vintedRegions = (vinted.sites || []).map(s => Object.entries(regions).find(([, r]) => s.url?.replace(/\/$/, '') === `https://www.vinted.${r.domain}`)?.[0]).filter(Boolean);
  if (vintedRegions.length) settings.vintedRegions = vintedRegions;
  const ebayRegions = (ebay.marketplaces || []).map(m => m.id.replace('EBAY_', '')).filter(r => ['GB', 'DE', 'FR', 'IT', 'ES', 'NL'].includes(r));
  if (ebayRegions.length) settings.ebayRegions = ebayRegions;
  for (const [source, config] of [['vinted', vinted], ['ebay', ebay]]) {
    if (config.pages_per_search) settings[`${source}Pages`] = config.pages_per_search;
    if (config.results_per_page) settings[`${source}PerPage`] = config.results_per_page;
    if (config.fetch_item_details !== undefined) settings[`${source}Details`] = config.fetch_item_details;
  }
  if (vinted.probe_per_page !== undefined) settings.vintedProbe = vinted.probe_per_page;
  settingsSchema.parse(settings);
  const secrets = Object.fromEntries(Object.entries({ telegramBotToken: env.TELEGRAM_BOT_TOKEN, telegramChatId: env.TELEGRAM_CHAT_ID, ebayClientId: env.EBAY_CLIENT_ID, ebayClientSecret: env.EBAY_CLIENT_SECRET, ebayProxy: env.EBAY_PROXY, vintedProxy: env.VINTED_PROXY, deeplApiKey: env.DEEPL_API_KEY }).map(([k, v]) => [k, secretVault.seal(v)]));
  const userId = new ObjectId();
  const searches = (raw.searches || []).map(search => {
    const values = { name: search.name || search.query, query: search.query, sources: (search.sources || ['vinted', 'ebay']).filter(s => (s !== 'ebay' || (ebay.enabled !== false && env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET)) && (s !== 'vinted' || vinted.enabled !== false)), notifyExisting: !!raw.app?.send_existing_on_start };
    for (const [camel, snake] of Object.entries({ maxAgeHours: 'max_age_hours', minPrice: 'min_price', maxPrice: 'max_price', requiredBrands: 'required_brands', excludedSizes: 'excluded_sizes', includeKeywords: 'include_keywords', excludeKeywords: 'exclude_keywords', includeAnyGroups: 'include_any_groups', ebayCategoryIds: 'ebay_category_ids', vintedCatalogIds: 'vinted_catalog_ids' })) if (search[snake] !== undefined) values[camel] = search[snake];
    return { ...searchSchema.parse(values), _id: new ObjectId(), userId, createdAt: new Date(), nextRunAt: new Date(), statuses: {}, initializedSources: [] };
  });
  const recoveryKey = token();
  await writeFile(recoveryPath, `${name}\n${recoveryKey}\n`, { mode: 0o600, flag: 'wx' });
  await db.collection('users').insertOne({ _id: userId, username: name, passwordHash: await hashPassword(chosenPassword), recoveryHash: digest(recoveryKey), authVersion: 0, settings, secrets, connections: {}, createdAt: new Date() });
  if (searches.length) await db.collection('searches').insertMany(searches);
  await migrateTelegramUser(db, await db.collection('users').findOne({ _id: userId }));
  return { created: true, username: name, searches: searches.length };
}

if (process.argv[1]?.endsWith('/import-profile.js')) {
  let connection;
  try {
    let configPath = 'config.yaml';
    try { await access(configPath); } catch { configPath = 'config.example.yaml'; }
    const raw = parse(await readFile(configPath, 'utf8'));
    connection = await connectDatabase();
    const result = await importProfile({ db: connection.db, secretVault: vault(process.env.ENCRYPTION_KEY), env: process.env, raw });
    console.log(JSON.stringify({ ...result, configPath, recoveryKey: result.created ? 'Saved locally in .profile-recovery-key (mode 600).' : 'Existing account left unchanged.' }));
  } catch (error) { console.error('Profile import failed:', error.name, error.code || '', 'Check credentials, database access, and configuration.'); process.exitCode = 1; }
  finally { await connection?.client.close(); }
}
