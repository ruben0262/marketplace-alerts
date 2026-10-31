import { setup } from './helpers.js';
import { createWorker } from '../server/worker.js';
import { createServer } from 'node:http';

const mailbox = new Map();
const fixture = await setup({ appUrl: 'http://127.0.0.1:3100', clientDirectory: process.env.BROWSER_CLIENT_DIRECTORY || 'dist',
  sendTelegram: async (secrets, _method, payload) => ({ chat: { type: String(payload?.chat_id || secrets.telegramChatId).startsWith('-') ? 'group' : 'private' } }),
  sendEmail: async message => { mailbox.set(message.to, [...(mailbox.get(message.to) || []), message]); },
  scan: async () => ({ items: [], scanned: 2 }),
});
const worker = createWorker({ db: fixture.db, vault: fixture.vault, scan: async ({ source }) => ({
  scanned: 1, items: [{ source, productId: 'jacket-123', title: 'Vintage Adidas track jacket', price: '28', currency: 'GBP', url: 'https://www.vinted.co.uk/items/123', image: null, attributes: { Brand: 'Adidas', Size: 'M' } }],
}), send: async () => ({}), sendEmail: async message => { mailbox.set(message.to, [...(mailbox.get(message.to) || []), message]); } });
worker.start();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3100');
  // Only this isolated fixture exposes its fake mailbox; production has no such route.
  if (url.pathname === '/__test/reset-rate-limits' && req.method === 'POST') { await fixture.db.collection('rateLimits').deleteMany({}); res.end('{}'); return; }
  if (url.pathname === '/__test/mailbox') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(mailbox.get(url.searchParams.get('email')) || [])); return; }
  fixture.app(req, res);
}).listen(3100, '127.0.0.1', () => console.log('Browser test app ready'));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; server.close(); await worker.stop(); await fixture.close(); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
