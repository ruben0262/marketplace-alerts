import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export function decryptSecrets(user, vault) {
  return Object.fromEntries(Object.entries(user.secrets || {}).map(([k, v]) => [k, vault.open(v)]));
}

// Credentials travel over stdin, never process arguments, logs, or a shared env.
export function scanMarketplace({ source, search, user, secrets }) {
  return new Promise((resolve, reject) => {
    const python = process.env.PYTHON_BIN || (existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3');
    const child = spawn(python, ['-m', 'listing_monitor.bridge'], { stdio: ['pipe', 'pipe', 'ignore'],
      env: { PATH: process.env.PATH, PYTHONUNBUFFERED: '1', PYTHONPATH: process.cwd(), HOME: process.env.HOME } });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('The marketplace timed out. The search will retry automatically.')); }, 120000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('The search worker could not start. Check the Python installation.')); });
    child.stdout.on('data', data => {
      output += data;
      if (output.length > 8 * 1024 * 1024) child.kill('SIGKILL');
    });
    child.stdin.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(output);
        if (code || result.error) reject(new Error(result.error || 'Marketplace search failed.'));
        else resolve(result);
      } catch { reject(new Error('The search worker returned an invalid response.')); }
    });
    child.stdin.end(JSON.stringify({ source, search, settings: user.settings, secrets, userId: user._id.toString() }));
  });
}

export async function telegram(secrets, method, payload) {
  if (!secrets.telegramBotToken || !secrets.telegramChatId) throw new Error('Add your Telegram bot token and chat ID first.');
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${secrets.telegramBotToken}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error('Telegram could not be reached. Try again shortly.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw Object.assign(new Error(response.status === 429 ? 'Telegram is rate limiting messages. Please wait a minute.' : 'Telegram rejected the request. Check your token and chat ID, and start a conversation with your bot.'), { status: response.status });
  return data.result;
}

export async function sendAlert(secrets, match, publish = telegram) {
  const price = match.price === null ? 'Price not supplied' : `${match.price} ${match.currency || ''}`;
  const details = Object.entries(match.attributes || {}).filter(([k]) => ['Brand', 'Size', 'Condition'].includes(k)).map(([k, v]) => `${k}: ${v}`);
  const text = [`New match · ${match.searchName}`, match.title, price, ...details, `Found on ${match.marketplace || match.source}`, ...(match.description ? ['', match.description] : [])].join('\n').slice(0, 4000);
  const payload = { chat_id: secrets.telegramChatId,
    ...(/^https:\/\//.test(match.url) ? { reply_markup: { inline_keyboard: [[{ text: 'View listing ↗', url: match.url }]] } } : {}),
  };
  if (match.image && /^https:\/\//.test(match.image)) {
    try { return await publish(secrets, 'sendPhoto', { ...payload, photo: match.image, caption: text.slice(0, 1024) }); }
    catch (error) { if (error.status !== 400) throw error; }
  }
  return publish(secrets, 'sendMessage', { ...payload, text });
}
