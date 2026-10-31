import 'dotenv/config';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, chmod } from 'node:fs/promises';
import { connectDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createMailer } from '../server/mailer.js';
import { vault } from '../server/security.js';

// Explicit profile preview: no worker, test messages, or settings/search writes.
// Login/logout and idempotent account migrations still touch the real database.
const identifier = (process.env.CHECK_LOGIN || process.env.IMPORT_USERNAME || '').trim();
const password = process.env.CHECK_PASSWORD || process.env.IMPORT_PASSWORD;
let connection, browser, server, stage = 'configuration';
try {
  if (!identifier || !password) throw new Error('Missing check credentials');
  connection = await connectDatabase();
  server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', await createApp({ db: connection.db, vault: vault(process.env.ENCRYPTION_KEY), appUrl: origin, sendEmail: createMailer() }));
  browser = await chromium.launch({ headless: true });
  await mkdir('data', { recursive: true, mode: 0o700 });
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    let browserErrors = 0;
    page.on('pageerror', () => browserErrors++);
    const screenshot = async label => {
      await expect(page.locator('#main > div')).toHaveCSS('opacity', '1');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const path = `data/${label}-${name}.png`, fullPage = label !== 'matches';
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.evaluate(async captureWholePage => {
        const images = [...document.images].filter(image => {
          const rect = image.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (captureWholePage || rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth);
        });
        // A full-page screenshot includes images below the viewport too.
        await Promise.all(images.map(image => new Promise(resolve => {
          const done = () => { clearTimeout(deadline); image.removeEventListener('load', done); image.removeEventListener('error', done); resolve(); };
          const deadline = setTimeout(done, 5000);
          image.addEventListener('load', done, { once: true });
          image.addEventListener('error', done, { once: true });
          image.loading = 'eager';
          if (image.complete) done();
        })));
      }, fullPage);
      await page.screenshot({ path, fullPage, animations: 'disabled' });
      await chmod(path, 0o600);
    };
    try {
      stage = 'profile login';
      await page.goto(`${origin}/login`);
      await page.getByLabel('Email or username', { exact: true }).fill(identifier);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/app`);
      const response = await page.request.get(`${origin}/api/me`);
      if (response.status() !== 200) throw new Error('Authentication failed');
      const { user } = await response.json();
      await expect(page.getByRole('heading', { name: `Hey, ${user.email?.split('@')[0] || user.username}.`, exact: true })).toBeVisible();
      await screenshot('profile');

      stage = 'saved searches';
      const { searches } = await (await page.request.get(`${origin}/api/searches`)).json();
      await page.goto(`${origin}/app/searches`);
      await expect(page.getByRole('heading', { name: 'My searches', exact: true })).toBeVisible();
      if (searches.length) {
        const search = searches[0];
        await page.getByRole('link', { name: `Edit ${search.name}`, exact: true }).first().click();
        await expect(page.getByLabel('Search for', { exact: true })).toHaveValue(search.query);
        await page.getByText('More precise filters', { exact: true }).click();
        await expect(page.getByLabel('Only these brands', { exact: true })).toHaveValue(search.requiredBrands.join(', '));
        const occurrences = new Map();
        for (const bot of user.telegramBots) {
          const index = occurrences.get(bot.name) || 0; occurrences.set(bot.name, index + 1);
          await expect(page.getByRole('checkbox', { name: bot.name, exact: true }).nth(index)).toBeChecked({ checked: search.telegramBotIds.includes(bot.id) });
        }
      }

      stage = 'private Connections';
      await page.goto(`${origin}/app/connections`);
      await expect(page.getByRole('tab', { name: 'Vinted', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByLabel('Vinted proxy (optional)', { exact: true })).toHaveValue('');
      await page.getByRole('tab', { name: 'eBay', exact: true }).click();
      await expect(page.getByLabel('Production Cert ID (Client secret)', { exact: true })).toHaveValue('');
      if (user.configured.ebayClientSecret) await expect(page.getByLabel('Production Cert ID (Client secret)', { exact: true })).toHaveAttribute('placeholder', 'Saved securely · enter to replace');
      await page.getByRole('tab', { name: 'Telegram', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Telegram destinations', exact: true })).toBeVisible();
      for (const bot of user.telegramBots) await expect(page.getByRole('article', { name: bot.name, exact: true }).first()).toBeVisible();
      if (user.telegramBots.length) {
        const card = page.getByRole('article', { name: user.telegramBots[0].name, exact: true }).first();
        await card.getByRole('button', { name: 'Edit', exact: true }).click();
        for (const label of ['Bot token', 'Chat ID']) {
          await expect(card.getByLabel(label, { exact: true })).toHaveValue('');
          await expect(card.getByLabel(label, { exact: true })).toHaveAttribute('type', 'password');
          await expect(card.getByLabel(label, { exact: true })).toHaveAttribute('placeholder', 'Saved securely · enter to replace');
        }
        await card.getByRole('button', { name: 'Cancel', exact: true }).click();
      }
      const recovery = page.getByLabel('Password recovery destination', { exact: true });
      await expect(recovery).toHaveValue(user.recoveryTelegramBotId || '');
      await expect(recovery.getByRole('option')).toHaveCount(1 + user.telegramBots.filter(bot => bot.connection?.ok && bot.connection.chatType === 'private').length);
      await screenshot('connections');

      stage = 'account and notification preferences';
      await page.goto(`${origin}/app/settings`);
      await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: user.email ? 'Change email address' : 'Add email address', exact: true })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /Allow browser alerts/ })).toBeChecked({ checked: !!user.settings.browserNotifications });
      await screenshot('settings');
      await page.goto(`${origin}/app/notifications`);
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
      await screenshot('notifications');
      stage = 'matching listings';
      await page.goto(`${origin}/app/matches`);
      await expect(page.getByRole('heading', { name: 'Latest finds', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: /^View / }).first().or(page.getByRole('heading', { name: 'A little quiet on the radar.', exact: true }))).toBeVisible();
      await screenshot('matches');
      if (browserErrors) throw new Error('Browser application error');
      console.log(`${name}: login, searches, private Connections, account preferences, notifications and layout passed.`);
    } finally {
      await page.request.post(`${origin}/api/auth/logout`, { headers: { 'X-Requested-With': 'marketplace-alerts' } }).catch(() => {});
      await context.close();
    }
  }
} catch {
  // Playwright errors can contain account values; never print exception details.
  console.error(`Profile browser check failed during ${stage}. Check the compiled app, account credentials and database access.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await connection?.client.close().catch(() => { console.error('Profile browser database cleanup failed.'); process.exitCode = 1; });
}
