// discord.test.js — sending one message to the Discord webhook (src/daily/discord.js, D105):
// success, "too many requests", Discord's own problems, a deleted webhook, no network, no address,
// and that the secret address never shows up in an error. Offline: a fake fetch, no real waiting.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sendDiscordMessage } from '../../src/daily/discord.js';

const WEBHOOK = 'https://discord.com/api/webhooks/123/SECRET-TOKEN';
const BODY = { embeds: [{ title: 'x' }], allowed_mentions: { parse: [] } };

// A fake fetch that answers from a list, one answer per call ('network' throws). Records the calls.
function fakeFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer === 'network') {
      const error = new TypeError(`fetch failed for ${url}`);
      error.cause = { code: 'ENOTFOUND' };
      throw error;
    }
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status, headers: answer.headers });
  };
  return { fetchImpl, calls };
}

// Common options: the fake fetch, no real waits (the waits are recorded), no log output.
function options(fake, extra = {}) {
  const waits = [];
  const lines = [];
  return {
    waits, lines,
    opts: { webhookUrl: WEBHOOK, fetchImpl: fake.fetchImpl, sleep: async (ms) => { waits.push(ms); }, log: (text) => lines.push(text), retryWaitsMs: [5000, 30000], tries: 3, ...extra },
  };
}

test('a 204 / 200 answer: sent, one request, the JSON body posted', async () => {
  const fake = fakeFetch([{ status: 204 }]);
  const { opts } = options(fake);
  assert.deepEqual(await sendDiscordMessage(BODY, opts), { ok: true });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].url, WEBHOOK);
  assert.equal(fake.calls[0].options.method, 'POST');
  assert.equal(fake.calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(fake.calls[0].options.body), BODY);
});

test('429: waits as long as Discord asks (retry_after, in seconds), then sends', async () => {
  const fake = fakeFetch([{ status: 429, body: { retry_after: 1.5 } }, { status: 200, body: {} }]);
  const { opts, waits } = options(fake);
  assert.deepEqual(await sendDiscordMessage(BODY, opts), { ok: true });
  assert.deepEqual(waits, [1500]);
});

test('5xx: tried again after 5 s and 30 s; still failing → not sent, with the reason', async () => {
  const fake = fakeFetch([{ status: 502 }]);
  const { opts, waits, lines } = options(fake);
  const result = await sendDiscordMessage(BODY, opts);
  assert.equal(result.ok, false);
  assert.match(result.error, /Discord answered 502.*after 3 tries/);
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(waits, [5000, 30000]);
  assert.equal(lines.length, 2);
});

test('404 (the webhook was deleted): not retried, and the message says what to check', async () => {
  const fake = fakeFetch([{ status: 404, body: { message: 'Unknown Webhook' } }]);
  const { opts, waits } = options(fake);
  const result = await sendDiscordMessage(BODY, opts);
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 404.*DISCORD_WEBHOOK_URL/);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(waits, []);
});

test('no network: retried, and the error never contains the secret webhook address', async () => {
  const fake = fakeFetch(['network', 'network', { status: 204 }]);
  const { opts, lines } = options(fake);
  assert.deepEqual(await sendDiscordMessage(BODY, opts), { ok: true });
  for (const line of lines) {
    assert.match(line, /could not be reached \(ENOTFOUND\)/);
    assert.ok(!line.includes('SECRET-TOKEN'));
  }
  const failed = await sendDiscordMessage(BODY, options(fakeFetch(['network']), {}).opts);
  assert.equal(failed.ok, false);
  assert.ok(!failed.error.includes('SECRET-TOKEN'));
});

test('no webhook address set: not sent, a clear message, no request', async () => {
  const fake = fakeFetch([{ status: 204 }]);
  const { opts } = options(fake, { webhookUrl: '' });
  const result = await sendDiscordMessage(BODY, opts);
  assert.deepEqual(result, { ok: false, error: 'DISCORD_WEBHOOK_URL is not set in .env, so the message was not sent' });
  assert.equal(fake.calls.length, 0);
});
