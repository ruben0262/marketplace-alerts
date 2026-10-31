import { z } from 'zod';
import { publicBot } from './telegram-bots.js';

export const regions = {
  GB: { name: 'United Kingdom', domain: 'co.uk', currency: 'GBP' },
  FR: { name: 'France', domain: 'fr', currency: 'EUR' },
  DE: { name: 'Germany', domain: 'de', currency: 'EUR' },
  HU: { name: 'Hungary', domain: 'hu', currency: 'HUF' },
  NL: { name: 'Netherlands', domain: 'nl', currency: 'EUR' },
  IT: { name: 'Italy', domain: 'it', currency: 'EUR' },
  ES: { name: 'Spain', domain: 'es', currency: 'EUR' },
  PL: { name: 'Poland', domain: 'pl', currency: 'PLN' },
};
export const secretNames = ['telegramBotToken', 'telegramChatId', 'ebayClientId', 'ebayClientSecret', 'ebayProxy', 'vintedProxy', 'deeplApiKey'];
export const defaults = () => ({ pollInterval: 120, vintedRegions: ['GB'], ebayRegions: ['GB'], notifications: true, browserNotifications: true, theme: 'light', translation: false, userAgent: '', vintedPages: 2, vintedPerPage: 15, vintedProbe: 5, vintedDetails: false, ebayPages: 2, ebayPerPage: 50, ebayDetails: true });
export const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/, 'Use 3–32 letters, numbers, or underscores.');
export const password = z.string().min(10, 'Use at least 10 characters.').max(128);
export const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email address.');
const words = z.array(z.string().trim().min(1).max(80)).max(30).default([]);
const price = z.number().min(0).max(1e7).nullable().default(null);
export const searchSchema = z.object({
  name: z.string().trim().min(1).max(80), query: z.string().trim().min(1).max(160),
  sources: z.array(z.enum(['vinted', 'ebay'])).min(1).max(2).transform(a => [...new Set(a)]).default(['vinted']),
  minPrice: price, maxPrice: price, maxAgeHours: z.number().int().min(1).max(8760).nullable().default(24),
  requiredBrands: words, excludedSizes: words, includeKeywords: words, excludeKeywords: words,
  includeAnyGroups: z.array(z.array(z.string().trim().min(1).max(80)).min(1).max(20)).max(20).default([]),
  ebayCategoryIds: z.array(z.string().regex(/^\d+$/)).max(20).default([]),
  vintedCatalogIds: z.array(z.string().regex(/^\d+$/)).max(20).default([]),
  active: z.boolean().default(true), notifyExisting: z.boolean().default(false),
  telegramBotIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(20).transform(ids => [...new Set(ids)]).optional(),
  emailAlerts: z.boolean().optional(), inAppNotifications: z.boolean().optional(),
}).strict().refine(v => v.minPrice === null || v.maxPrice === null || v.minPrice <= v.maxPrice, { message: 'Maximum price must be at least the minimum price.', path: ['maxPrice'] });

export const settingsSchema = z.object({
  pollInterval: z.number().int().min(60).max(3600),
  vintedRegions: z.array(z.enum(Object.keys(regions))).min(1).max(8),
  ebayRegions: z.array(z.enum(['GB', 'DE', 'FR', 'IT', 'ES', 'NL'])).min(1).max(6),
  notifications: z.boolean(), browserNotifications: z.boolean(), theme: z.enum(['light', 'dark']), translation: z.boolean(), userAgent: z.string().max(160),
  vintedPages: z.number().int().min(1).max(5), vintedPerPage: z.number().int().min(5).max(96),
  vintedProbe: z.number().int().min(0).max(96), vintedDetails: z.boolean(),
  ebayPages: z.number().int().min(1).max(5), ebayPerPage: z.number().int().min(1).max(200), ebayDetails: z.boolean(),
}).strict().partial();

const credential = z.string().trim().max(2048).nullable();
const proxy = credential.refine(v => !v || /^(?:https?:\/\/)?[^\s]+:\d+\/?$/.test(v), 'Use host:port or http://user:password@host:port.');
export const credentialsSchema = z.object({
  telegramBotToken: credential.refine(v => !v || /^\d+:[A-Za-z0-9_-]+$/.test(v), 'Enter a valid Telegram bot token.'),
  telegramChatId: credential.refine(v => !v || /^-?\d+$/.test(v), 'Enter a numeric chat ID.'),
  ebayClientId: credential, ebayClientSecret: credential, ebayProxy: proxy, vintedProxy: proxy, deeplApiKey: credential,
}).strict().partial();

export function publicUser(user) {
  const bots = user.telegramBots || [];
  return { id: user._id.toString(), username: user.username, createdAt: user.createdAt,
    email: user.email || '', emailVerified: !!user.emailVerifiedAt,
    settings: { ...defaults(), ...user.settings },
    configured: { ...Object.fromEntries(secretNames.map(key => [key, !!user.secrets?.[key]])), telegramBotToken: !!bots[0]?.botToken, telegramChatId: !!bots[0]?.chatId },
    connections: { ...user.connections, telegram: bots.find(bot => bot.connection?.ok)?.connection || bots[0]?.connection || { ok: false } },
    telegramBots: bots.map(publicBot), recoveryTelegramBotId: user.recoveryTelegramBotId || null,
  };
}
export const publicSearch = ({ userId, lockToken, lockUntil, knownProductIds, ...search }) => ({ ...search, telegramBotIds: search.telegramBotIds || [], emailAlerts: !!search.emailAlerts, inAppNotifications: search.inAppNotifications !== false, _id: search._id.toString() });

export const botSchema = z.object({
  name: z.string().trim().min(1).max(60),
  botToken: z.string().trim().max(2048).regex(/^\d+:[A-Za-z0-9_-]+$/, 'Enter a valid Telegram bot token.'),
  chatId: z.string().trim().max(30).regex(/^-?\d+$/, 'Enter a numeric chat ID.'),
}).strict();
