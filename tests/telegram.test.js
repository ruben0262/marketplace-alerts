import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendAlert } from '../server/integrations.js';

const match = { source: 'vinted', searchName: 'Jackets', title: 'Vintage jacket', price: '28', currency: 'GBP', image: 'https://images.example/jacket.jpg', url: 'https://www.vinted.co.uk/items/123', description: 'Very good condition', attributes: { Size: 'M' } };
test('a product notification includes its photo, price, size and a direct listing button', async () => {
  const calls = [];
  await sendAlert({ telegramChatId: '123' }, match, async (...args) => calls.push(args));
  assert.equal(calls.length, 1); assert.equal(calls[0][1], 'sendPhoto');
  assert.match(calls[0][2].caption, /28 GBP/); assert.match(calls[0][2].caption, /Size: M/);
  assert.equal(calls[0][2].reply_markup.inline_keyboard[0][0].url, match.url);
});
test('a rejected photo falls back to text, but a rate limit or ambiguous network failure does not double-send', async () => {
  const calls = [];
  await sendAlert({ telegramChatId: '123' }, match, async (secrets, method) => {
    calls.push(method); if (method === 'sendPhoto') throw Object.assign(new Error('Bad image'), { status: 400 });
  });
  assert.deepEqual(calls, ['sendPhoto', 'sendMessage']);
  for (const status of [429, undefined]) {
    let count = 0;
    await assert.rejects(sendAlert({}, match, async () => { count++; throw Object.assign(new Error('Unavailable'), { status }); }));
    assert.equal(count, 1);
  }
});
