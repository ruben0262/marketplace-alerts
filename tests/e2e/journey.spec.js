import { test, expect } from '@playwright/test';

const password = 'BrowserPassword123!';
// Tests share a local fixture, but each starts with an independent rate-limit window.
test.beforeEach(async ({ request }) => { await request.post('/__test/reset-rate-limits'); });
async function register(page, testInfo) {
  const username = `browser_${testInfo.project.name}_${Date.now().toString(36)}`, email = `${username}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await expect(page.getByRole('heading', { name: 'Keep a way back in.' })).toBeVisible();
  const recoveryKey = await page.getByTestId('recovery-key').innerText();
  await page.getByRole('button', { name: 'I’ve saved it. Continue' }).click();
  await expect(page.getByRole('heading', { name: `Hey, ${username}.` })).toBeVisible();
  return { username, email, recoveryKey };
}
async function navigate(page, label) {
  await expect(page).toHaveURL(/\/app(?:\/|$)/);
  if (test.info().project.use.isMobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  if (label === 'Account & preferences') {
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
  }
  else await page.getByRole('navigation', { name: 'App navigation' }).getByRole('link', { name: label, exact: false }).click();
}

async function connections(page, name) {
  await navigate(page, 'Connections');
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
}

test('landing page has a working primary action and stays within the viewport', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'The good ones don’t wait.' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByRole('link', { name: 'Start your first search' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByText('Do I need a Vinted account?', { exact: true }).click();
  await expect(page.getByText('No. Scout searches public Vinted listings.', { exact: false })).toBeVisible();
  await page.getByRole('heading', { name: 'Posted. Matched. In your pocket.' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Posted. Matched. In your pocket.' })).toBeVisible();
  await page.getByRole('heading', { name: 'Less refreshing. More finding.' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/landing-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('link', { name: 'Start your first search' }).click();
  await expect(page.getByRole('heading', { name: 'Your next find starts here.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a new user builds, edits, pauses, resumes and deletes a search, connects Telegram and sees matches', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await register(page, testInfo);
  await page.getByRole('link', { name: 'New search', exact: true }).click();
  await page.getByLabel('Search name', { exact: true }).fill('Weekend jacket');
  await page.getByLabel('Search for', { exact: true }).fill('vintage adidas jacket');
  await expect(page.getByRole('button', { name: /eBay Add keys/ })).toBeDisabled();
  await page.getByLabel('Maximum price', { exact: true }).fill('40');
  await page.getByText('More precise filters', { exact: true }).click();
  await page.getByLabel('Only these brands', { exact: true }).fill('Adidas');
  await page.getByLabel('Skip these sizes', { exact: true }).fill('XS, S');
  await page.getByRole('button', { name: 'Start scouting' }).click();
  await expect(page.getByRole('heading', { name: 'Weekend jacket', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause Weekend jacket' }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume Weekend jacket' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit Weekend jacket' }).click();
  await expect(page.getByLabel('Maximum price', { exact: true })).toHaveValue('40');
  await page.getByLabel('Search name', { exact: true }).fill('My track jacket');
  await page.getByRole('button', { name: 'Save search' }).click();
  await expect(page.getByRole('heading', { name: 'My track jacket', exact: true })).toBeVisible();
  await expect(page.getByText(/matches from \d+ listings/)).toBeVisible({ timeout: 20000 });
  await navigate(page, 'Latest finds');
  await expect(page.getByRole('heading', { name: 'Vintage Adidas track jacket', exact: true })).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('#main > div')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: `test-results/finds-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });
  await connections(page, 'Telegram');
  await page.getByLabel('Destination name', { exact: true }).fill('My phone');
  await page.getByLabel('Bot token', { exact: true }).fill('12345:browser_token');
  await page.getByLabel('Chat ID', { exact: true }).fill('12345');
  await page.getByRole('button', { name: 'Add destination', exact: true }).click();
  const phone = page.getByRole('article', { name: 'My phone', exact: true });
  await phone.getByRole('button', { name: 'Send test message', exact: true }).click();
  await expect(phone.getByText('Verified', { exact: true })).toBeVisible();
  await page.getByLabel('Password recovery destination', { exact: true }).selectOption({ label: 'My phone' });
  await page.getByRole('button', { name: 'Save recovery destination', exact: true }).click();
  await expect(page.getByRole('status').last()).toHaveText('Password recovery will use this private chat.');
  await page.reload();
  await phone.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Bot token', { exact: true })).toHaveAttribute('placeholder', 'Saved securely · enter to replace');
  await expect(page.getByLabel('Bot token', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Chat ID', { exact: true })).toHaveValue('');
  await phone.getByRole('button', { name: 'Cancel', exact: true }).click();
  await navigate(page, 'My searches');
  await page.getByRole('button', { name: 'Delete My track jacket' }).click();
  await page.getByRole('button', { name: 'Keep search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My track jacket', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete My track jacket' }).click();
  await page.getByRole('button', { name: 'Delete search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What’s on your wish list?' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('recovery and password change work through the pages and old passwords stop working', async ({ page }, testInfo) => {
  const { username, email, recoveryKey } = await register(page, testInfo);
  await page.goto('/forgot-password');
  await page.getByRole('button', { name: 'Use my recovery key instead' }).click();
  await page.getByLabel('Email or username', { exact: true }).fill(email);
  await page.getByLabel('Recovery key', { exact: true }).fill(recoveryKey);
  await page.getByLabel('New password', { exact: true }).fill('RecoveryPassword123!');
  await page.getByLabel('Confirm password', { exact: true }).fill('RecoveryPassword123!');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByTestId('recovery-key')).not.toHaveText(recoveryKey);
  await page.getByRole('button', { name: 'I’ve saved it. Continue' }).click();
  await navigate(page, 'Account & preferences');
  await page.getByLabel('Current password', { exact: true }).fill('RecoveryPassword123!');
  await page.getByLabel('New password', { exact: true }).fill('ChangedPassword123!');
  await page.getByLabel('Confirm new password', { exact: true }).fill('ChangedPassword123!');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep a way back in.' })).toBeVisible();
  await page.getByRole('button', { name: 'I’ve saved it. Continue' }).click();
  if (testInfo.project.use.isMobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.goto('/login');
  await page.getByLabel('Email or username', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect email, username, or password.');
  await page.getByLabel('Password', { exact: true }).fill('ChangedPassword123!');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Hey, ${username}.` })).toBeVisible();
});

test('eBay keys unlock the marketplace and a saved proxy can be removed without deleting the keys', async ({ page }, testInfo) => {
  await register(page, testInfo);
  await connections(page, 'eBay');
  const ebay = page.locator('#ebay');
  await page.getByLabel('Production App ID (Client ID)', { exact: true }).fill('browser-ebay-app');
  await page.getByLabel('Production Cert ID (Client secret)', { exact: true }).fill('browser-ebay-secret');
  await page.getByLabel('eBay proxy (optional)', { exact: true }).fill('http://user:pass@proxy.example:8080');
  await ebay.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByLabel('Production Cert ID (Client secret)', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Clear eBay proxy (optional)', exact: true }).click();
  await ebay.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByLabel('eBay proxy (optional)', { exact: true })).toHaveAttribute('placeholder', 'Not configured');
  await ebay.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(ebay.getByText('Connected', { exact: true })).toBeVisible();
  await navigate(page, 'Account & preferences');
  await page.getByLabel('Check for new listings', { exact: true }).selectOption('300');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('status').last()).toContainText('Preferences saved.');
  await page.reload();
  await expect(page.getByLabel('Check for new listings', { exact: true })).toHaveValue('300');
  await page.goto('/app/searches/new');
  const chooseEbay = page.getByRole('button', { name: /eBay Your keys/ });
  await expect(chooseEbay).toBeEnabled();
  await chooseEbay.click();
  await expect(chooseEbay).toHaveAttribute('aria-pressed', 'true');
});

test('a user routes a search to multiple private destinations, changes the selection, and safely removes a bot', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await register(page, testInfo);
  await connections(page, 'Telegram');
  for (const [name, token, chat] of [['My phone', '12345:phone_test', '12345'], ['Trainers group', '54321:group_test', '-98765']]) {
    if (name !== 'My phone') await page.getByRole('button', { name: 'Add Telegram destination', exact: true }).click();
    await page.getByLabel('Destination name', { exact: true }).fill(name);
    await page.getByLabel('Bot token', { exact: true }).fill(token);
    await page.getByLabel('Chat ID', { exact: true }).fill(chat);
    await page.getByRole('button', { name: 'Add destination', exact: true }).click();
    const destination = page.getByRole('article', { name, exact: true });
    await destination.getByRole('button', { name: 'Send test message', exact: true }).click();
    await expect(destination.getByText('Verified', { exact: true })).toBeVisible();
  }
  const recovery = page.getByLabel('Password recovery destination', { exact: true });
  await expect(recovery.getByRole('option', { name: 'Trainers group', exact: true })).toHaveCount(0);
  await recovery.selectOption({ label: 'My phone' });
  await page.getByRole('button', { name: 'Save recovery destination', exact: true }).click();
  await expect(page.getByRole('status').last()).toHaveText('Password recovery will use this private chat.');
  const group = page.getByRole('article', { name: 'Trainers group', exact: true });
  await group.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Bot token', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Chat ID', { exact: true })).toHaveValue('');
  await page.getByLabel('Destination name', { exact: true }).fill('Team finds');
  await page.getByRole('button', { name: 'Save destination', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Team finds', exact: true }).getByText('Verified', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/telegram-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });

  await page.goto('/app/searches/new');
  await page.getByLabel('Search name', { exact: true }).fill('Trainer alerts');
  await page.getByLabel('Search for', { exact: true }).fill('adidas trainers');
  await expect(page.getByRole('checkbox', { name: 'My phone', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Team finds', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'My phone', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Team finds', exact: true }).check();
  await page.getByRole('button', { name: 'Start scouting', exact: true }).click();
  await expect(page.getByText('In-app notifications · Telegram → My phone, Team finds', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit Trainer alerts', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'My phone', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Team finds', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Team finds', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save search', exact: true }).click();
  await expect(page.getByText('In-app notifications · Telegram → My phone', { exact: true })).toBeVisible();

  await connections(page, 'Telegram');
  const phone = page.getByRole('article', { name: 'My phone', exact: true });
  await phone.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(phone.getByText('Telegram account recovery will also be turned off.', { exact: false })).toBeVisible();
  await phone.getByRole('button', { name: 'Keep destination', exact: true }).click();
  await expect(phone).toBeVisible();
  await phone.getByRole('button', { name: 'Delete', exact: true }).click();
  await phone.getByRole('button', { name: 'Delete destination', exact: true }).click();
  await expect(phone).toHaveCount(0);
  await expect(recovery).toHaveValue('');
  await page.reload();
  await expect(recovery).toHaveValue('');
  await expect(page.getByRole('article', { name: 'Team finds', exact: true })).toBeVisible();
  await navigate(page, 'My searches');
  await expect(page.getByText('In-app notifications · No Telegram destinations', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit Trainer alerts', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'My phone', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Team finds', exact: true })).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('notification preferences and the account theme persist, while new matches can be marked read', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await register(page, testInfo);
  await navigate(page, 'Account & preferences');
  await expect(page.getByRole('checkbox', { name: /Allow browser alerts/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Switch to dark mode', exact: true })).toBeVisible();
  const savedTheme = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH' && response.ok());
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await savedTheme;
  await expect(page.getByRole('button', { name: 'Switch to light mode', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /Allow browser alerts/ }).uncheck();
  await expect(page.getByRole('status')).toHaveText('Browser alerts turned off. Your in-app notifications stay available.');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('status').last()).toContainText('Preferences saved.');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to light mode', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Allow browser alerts/ })).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/account-dark-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });

  await page.goto('/app/searches/new');
  await expect(page.getByRole('checkbox', { name: /In-app notifications/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Email alerts/ })).toBeDisabled();
  await page.getByLabel('Search name', { exact: true }).fill('Fresh jacket notifications');
  await page.getByLabel('Search for', { exact: true }).fill('adidas jacket');
  await page.getByRole('checkbox', { name: /Include existing matches in my first alerts/ }).check();
  await page.getByRole('button', { name: 'Start scouting', exact: true }).click();
  await expect(page.getByText(/matches from \d+ listings/)).toBeVisible({ timeout: 20000 });
  await navigate(page, 'Notifications');
  const notification = page.getByRole('article', { name: 'Vintage Adidas track jacket', exact: true });
  await expect(notification).toBeVisible({ timeout: 20000 });
  await expect(notification.getByLabel('Unread', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/notifications-dark-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });
  await notification.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(notification.getByLabel('Read', { exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(notification.getByLabel('Read', { exact: true })).toBeAttached();
  await expect(notification.getByRole('button', { name: 'Mark as read', exact: true })).toHaveCount(0);
  if (testInfo.project.use.isMobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await register(page, testInfo);
  await navigate(page, 'Notifications');
  await expect(page.getByRole('heading', { name: 'You’re all caught up.', exact: true })).toBeVisible();
  await expect(notification).toHaveCount(0);
  await navigate(page, 'Account & preferences');
  await expect(page.getByRole('button', { name: 'Switch to dark mode', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('email verification unlocks optional email alerts without changing the default in-app channel', async ({ page }, testInfo) => {
  const { email } = await register(page, testInfo);
  await page.goto('/app/searches/new');
  await expect(page.getByRole('checkbox', { name: /Email alerts/ })).toBeDisabled();
  const messages = await (await page.request.get(`/__test/mailbox?email=${encodeURIComponent(email)}`)).json();
  const verification = messages.find(message => message.subject === 'Verify your Scout email');
  expect(verification).toBeTruthy();
  const link = verification.text.match(/http[^\s]+\/verify-email#[^\s]+/)[0];
  await page.goto(link);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Email verified.', exact: true })).toBeVisible();
  await page.goto('/app/searches/new');
  const emailAlerts = page.getByRole('checkbox', { name: /Email alerts/ });
  await expect(emailAlerts).toBeEnabled();
  await expect(emailAlerts).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /In-app notifications/ })).toBeChecked();
  await page.getByLabel('Search name', { exact: true }).fill('Email jacket alerts');
  await page.getByLabel('Search for', { exact: true }).fill('jacket');
  await emailAlerts.check();
  await page.getByRole('button', { name: 'Start scouting', exact: true }).click();
  await expect(page.getByText('In-app notifications · Email · No Telegram destinations', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit Email jacket alerts', exact: true }).click();
  await expect(emailAlerts).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /In-app notifications/ })).toBeChecked();
});

test('new matches produce browser alerts only after an explicit permission action', async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Browser/OS notification APIs are an external boundary. Capture their visible
  // output without depending on the host OS permission defaults or notification tray.
  await page.addInitScript(() => {
    window.permissionRequests = 0;
    window.browserAlerts = [];
    class BrowserNotification {
      static permission = 'default';
      static async requestPermission() { window.permissionRequests++; this.permission = 'granted'; return 'granted'; }
      constructor(title, options) { window.browserAlerts.push({ title, body: options.body }); }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: BrowserNotification });
    ServiceWorkerRegistration.prototype.showNotification = async function(title, options) {
      if (Notification.permission !== 'granted') throw new DOMException('Permission denied', 'NotAllowedError');
      window.browserAlerts.push({ title, body: options.body });
    };
  });
  await register(page, testInfo);
  await navigate(page, 'Account & preferences');
  await expect(page.getByRole('button', { name: 'Enable browser notifications', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.permissionRequests)).toBe(0);
  expect(await page.evaluate(() => window.browserAlerts)).toEqual([]);
  await page.getByRole('button', { name: 'Enable browser notifications', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Browser permission granted. New matching notifications can appear while Scout is open.');
  expect(await page.evaluate(() => window.permissionRequests)).toBe(1);
  await navigate(page, 'My searches');
  await page.getByRole('link', { name: 'New search', exact: true }).click();
  await page.getByLabel('Search name', { exact: true }).fill('Browser delivery');
  await page.getByLabel('Search for', { exact: true }).fill('vintage adidas jacket');
  await page.getByRole('checkbox', { name: /Include existing matches in my first alerts/ }).check();
  await page.getByRole('button', { name: 'Start scouting', exact: true }).click();
  await navigate(page, 'Notifications');
  await expect(page.getByRole('article', { name: 'Vintage Adidas track jacket', exact: true })).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => window.browserAlerts), { timeout: 20000 }).toEqual([{ title: 'Vintage Adidas track jacket', body: 'New vinted match for Browser delivery' }]);
  await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function openAccountMenu(page, testInfo) {
  if (testInfo.project.use.isMobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  return page.getByRole('region', { name: 'Account options', exact: true });
}

test('account menu changes theme quietly, persists it, supports keyboard dismissal and opens settings', async ({ page }, testInfo) => {
  await register(page, testInfo);
  let options = await openAccountMenu(page, testInfo);
  await expect(options.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH' && response.ok());
  await options.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await saved;
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: `test-results/account-menu-${testInfo.project.name}.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(options).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Hey,/ })).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  options = await openAccountMenu(page, testInfo);
  await options.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account & preferences', exact: true })).toBeVisible();
  for (const name of ['Appearance', 'Notifications', 'Search preferences', 'Your account']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const savedLight = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH' && response.ok());
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await savedLight;
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to dark mode', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/account-light-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });
});

test('a failed theme save has an inline retry that saves the chosen theme', async ({ page }, testInfo) => {
  await register(page, testInfo);
  await navigate(page, 'Account & preferences');
  await page.route('**/api/settings', route => route.abort('failed'), { times: 1 });
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.getByRole('status')).toContainText('Couldn’t save it to your account.');
  await page.getByRole('button', { name: 'Retry saving theme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch to light mode', exact: true })).toBeEnabled();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to light mode', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
});

for (const permission of ['denied', 'default', 'granted', 'blocked', 'error']) {
  test(`browser notification permission ${permission} gives accurate feedback`, async ({ page }, testInfo) => {
    // The browser permission prompt is an external boundary, not application state.
    await page.addInitScript(result => {
      class BrowserNotification {
        static permission = 'default';
        static async requestPermission() {
          if (result === 'error') throw new Error('Browser permission request failed.');
          this.permission = result === 'blocked' ? 'denied' : result;
          return result === 'blocked' ? 'granted' : result;
        }
      }
      Object.defineProperty(window, 'Notification', { configurable: true, value: BrowserNotification });
    }, permission);
    await register(page, testInfo);
    await navigate(page, 'Account & preferences');
    await page.getByRole('button', { name: 'Enable browser notifications', exact: true }).click();
    if (permission === 'error') {
      await expect(page.getByRole('alert')).toHaveText('Browser permission request failed.');
      await expect(page.getByRole('status')).toHaveCount(0);
    } else if (permission === 'granted') {
      await expect(page.getByRole('status')).toHaveText('Browser permission granted. New matching notifications can appear while Scout is open.');
      await expect(page.getByRole('status', { name: 'Warning' })).toHaveCount(0);
    } else {
      await expect(page.getByRole('status', { name: 'Warning' })).toHaveText('Permission was not granted. Your notifications will still appear in Scout.');
      await expect(page.getByText('Browser permission granted.', { exact: false })).toHaveCount(0);
      if (permission === 'denied' || permission === 'blocked') await expect(page.getByText('Notifications are blocked in this browser.', { exact: false })).toBeVisible();
      if (permission === 'default') await expect(page.getByRole('button', { name: 'Enable browser notifications', exact: true })).toBeEnabled();
      await page.screenshot({ path: `test-results/permission-${permission}-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });
    }
    await expect(page.getByRole('checkbox', { name: /Allow browser alerts/ })).toBeChecked();
  });
}

test('mark all as read handles a failed request and persists a successful retry', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await register(page, testInfo);
  await page.getByRole('link', { name: 'New search', exact: true }).click();
  await page.getByLabel('Search name', { exact: true }).fill('Read all test');
  await page.getByLabel('Search for', { exact: true }).fill('jacket');
  await page.getByRole('checkbox', { name: /Include existing matches in my first alerts/ }).check();
  await page.getByRole('button', { name: 'Start scouting', exact: true }).click();
  await expect(page.getByText(/matches from \d+ listings/)).toBeVisible({ timeout: 20000 });
  await navigate(page, 'Notifications');
  const item = page.getByRole('article', { name: 'Vintage Adidas track jacket', exact: true });
  await expect(item.getByLabel('Unread', { exact: true })).toBeVisible();
  await page.route('**/api/notifications/read', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Could not update notifications. Please try again.' }) }), { times: 1 });
  await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Could not update notifications. Please try again.');
  await expect(item.getByLabel('Unread', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(item.getByLabel('Read', { exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(item.getByLabel('Read', { exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toHaveCount(0);
});

test('a forgotten password can be reset from its email and the old password no longer works', async ({ page, request }, testInfo) => {
  const { email, username } = await register(page, testInfo);
  await page.goto('/forgot-password');
  await page.getByLabel('Email or username', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('instructions are on their way');
  const mail = await (await request.get(`/__test/mailbox?email=${encodeURIComponent(email)}`)).json();
  const reset = mail.find(message => message.subject === 'Reset your Scout password');
  expect(reset).toBeTruthy();
  const link = reset.text.match(/http[^\s]+\/reset-password#[^\s]+/)[0];
  await page.goto(link);
  await page.getByLabel('New password', { exact: true }).fill('FreshEmailPassword123!');
  await page.getByLabel('Confirm password', { exact: true }).fill('FreshEmailPassword123!');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep a way back in.' })).toBeVisible();
  await page.getByRole('button', { name: 'I’ve saved it. Continue' }).click();
  if (testInfo.project.use.isMobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const account = page.getByRole('button', { name: 'Account menu', exact: true });
  await expect(account).toContainText(username);
  await account.click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.goto('/login');
  await page.getByLabel('Email or username', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect email, username, or password.');
  await page.getByLabel('Password', { exact: true }).fill('FreshEmailPassword123!');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Hey, ${username}.` })).toBeVisible();
  await navigate(page, 'Support');
  await expect(page.getByLabel('Your email', { exact: true })).toHaveValue(email);
  await page.goto(link);
  await page.getByLabel('New password', { exact: true }).fill('AnotherPassword123!');
  await page.getByLabel('Confirm password', { exact: true }).fill('AnotherPassword123!');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('This recovery key or reset link is invalid or expired.');
});

test('public support retains the message after a lost response and delivers a retry only once', async ({ page, request }, testInfo) => {
  const subject = `Help with my search ${testInfo.project.name} ${Date.now()}`;
  await page.goto('/login');
  await page.getByRole('link', { name: 'Need help? Contact support' }).click();
  await expect(page.getByRole('heading', { name: 'Support', exact: true })).toBeVisible();
  await page.getByLabel('Your email', { exact: true }).fill('support-customer@example.com');
  await page.getByLabel('Subject', { exact: true }).fill(subject);
  await page.getByLabel('Message', { exact: true }).fill('I need help finding the latest listings for my saved jacket search.');
  await page.route('**/api/support', async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Connection interrupted. Please try again.' }) });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toHaveText('Connection interrupted. Please try again.');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue(subject);
  await expect(page.getByRole('heading', { name: 'Message received.' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('heading', { name: 'Message received.' })).toBeVisible();
  const receipt = await page.getByRole('status').innerText();
  const reference = receipt.match(/SC-[A-Z0-9]{12}/)[0];
  await expect.poll(async () => {
    const mail = await (await request.get('/__test/mailbox?email=hello%40flow-solutions.xyz')).json();
    return mail.filter(message => message.subject.includes(reference)).length;
  }).toBe(1);
  const mail = await (await request.get('/__test/mailbox?email=hello%40flow-solutions.xyz')).json();
  expect(mail.find(message => message.subject.includes(reference)).replyTo).toBe('support-customer@example.com');
});
