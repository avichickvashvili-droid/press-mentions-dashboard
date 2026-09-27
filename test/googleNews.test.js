// googleNews.test.js — tests of the Google News client (src/collector/googleNews.js) with a
// fake fetch: how each kind of answer is handled, the pace, and feed parsing. No real requests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { PermanentFetchError, buildSearchUrl, createGoogleNewsClient, parseFeed } from '../src/collector/googleNews.js';
import { makeFakeFetch, makeFakeSleep, readFixture } from './helpers.js';

// Builds a client around a fake fetch that gives the listed answers in order (the last one repeats).
function clientWithAnswers(answers) {
  const fetchImpl = makeFakeFetch((url, callNumber) => {
    const answer = answers[Math.min(callNumber, answers.length) - 1];
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const sleep = makeFakeSleep();
  const retries = [];
  let clock = 0;
  const client = createGoogleNewsClient({
    fetchImpl,
    sleep: async (ms) => { clock += ms; await sleep(ms); },
    now: () => clock,
    random: () => 0,
    onRetry: (info) => retries.push(info),
  });
  return { client, fetchImpl, sleep, retries };
}

const GOOD = { status: 200, body: readFixture('feed-basic.xml') };

test('the search URL follows the agreed format', () => {
  assert.equal(
    buildSearchUrl('after:2026-06-29 before:2026-09-28 "Harvey AI"'),
    'https://news.google.com/rss/search?q=after%3A2026-06-29%20before%3A2026-09-28%20%22Harvey%20AI%22&hl=en-US&gl=US&ceid=US:en',
  );
});

test('parseFeed reads guid, link, title, publisher and date; entities decoded', () => {
  const { items, itemCount } = parseFeed(readFixture('feed-basic.xml'));
  assert.equal(itemCount, 3);
  assert.deepEqual(items[0], {
    guid: 'CBMiAAA',
    link: 'https://news.google.com/rss/articles/CBMiAAA?oc=5',
    title: 'Harvey raises $300M at a $3B valuation - Reuters',
    publisher: 'Reuters',
    pubDate: 'Mon, 21 Sep 2026 07:00:00 GMT',
  });
  assert.equal(items[1].title, "Harvey's legal AI & the law firms - TechCrunch");
  assert.equal(items[2].publisher, '');
});

test('a feed with a channel but no items is a normal empty result', () => {
  assert.deepEqual(parseFeed(readFixture('feed-empty.xml')), { items: [], itemCount: 0 });
});

test('200 with a good feed: returns the items', async () => {
  const { client, fetchImpl } = clientWithAnswers([GOOD]);
  const result = await client.search('"Harvey AI"');
  assert.equal(result.itemCount, 3);
  assert.equal(fetchImpl.calls.length, 1);
});

test('403: logged, fixed 5 s wait, same request retried', async () => {
  const { client, fetchImpl, retries } = clientWithAnswers([{ status: 403 }, { status: 403 }, { status: 403 }, GOOD]);
  const result = await client.search('q');
  assert.equal(result.itemCount, 3);
  assert.equal(fetchImpl.calls.length, 4);
  assert.deepEqual(retries.map((r) => r.waitMs), [5000, 5000, 5000]);
  assert.match(retries[0].reason, /403/);
  assert.ok(fetchImpl.calls.every((url) => url === fetchImpl.calls[0]), 'the same request each time');
});

test('429, 5xx, 408 and network errors: growing waits, same request retried until it works', async () => {
  const { client, fetchImpl, retries } = clientWithAnswers([
    { status: 429 }, { status: 503 }, { status: 408 }, new TypeError('fetch failed'),
    { status: 500 }, { status: 502 }, { status: 504 }, { status: 429 }, GOOD,
  ]);
  const result = await client.search('q');
  assert.equal(result.itemCount, 3);
  assert.equal(fetchImpl.calls.length, 9);
  assert.deepEqual(retries.map((r) => r.waitMs), [5000, 10000, 30000, 60000, 120000, 300000, 600000, 600000]);
});

test('a timeout counts as temporary', async () => {
  const timeout = new DOMException('The operation timed out.', 'TimeoutError');
  const { client, retries } = clientWithAnswers([timeout, GOOD]);
  await client.search('q');
  assert.equal(retries.length, 1);
  assert.match(retries[0].reason, /did not answer/);
});

test('an HTML page (CAPTCHA) instead of RSS counts as temporary', async () => {
  const { client, retries } = clientWithAnswers([{ status: 200, body: readFixture('captcha.html') }, GOOD]);
  const result = await client.search('q');
  assert.equal(result.itemCount, 3);
  assert.match(retries[0].reason, /CAPTCHA/);
  assert.equal(retries[0].waitMs, 5000);
});

test('broken XML is permanent', async () => {
  const { client, fetchImpl } = clientWithAnswers([{ status: 200, body: readFixture('broken.xml') }]);
  await assert.rejects(client.search('q'), (error) => error instanceof PermanentFetchError && /cannot be read/.test(error.message));
  assert.equal(fetchImpl.calls.length, 1);
});

test('XML without a <channel> is permanent', async () => {
  const { client } = clientWithAnswers([{ status: 200, body: readFixture('no-channel.xml') }]);
  await assert.rejects(client.search('q'), (error) => error instanceof PermanentFetchError && /channel/.test(error.message));
});

test('other 4xx (400, 404) are permanent', async () => {
  for (const status of [400, 404]) {
    const { client, fetchImpl } = clientWithAnswers([{ status }]);
    await assert.rejects(client.search('q'), (error) => error instanceof PermanentFetchError && error.message.includes(String(status)));
    assert.equal(fetchImpl.calls.length, 1);
  }
});

test('pace: at least 1 s (+ jitter) between two requests', async () => {
  const fetchImpl = makeFakeFetch(() => GOOD);
  const waits = [];
  let clock = 0;
  const client = createGoogleNewsClient({
    fetchImpl,
    sleep: async (ms) => { waits.push(ms); clock += ms; },
    now: () => clock,
    random: () => 0.999, // the largest jitter
  });
  await client.search('a');
  clock += 200; // the first request "took" 200 ms
  await client.search('b');
  assert.deepEqual(waits, [config.REQUEST_INTERVAL_MS + config.REQUEST_JITTER_MS - 200]);
});
