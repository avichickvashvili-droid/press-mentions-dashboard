// googleNews.test.js — tests of the Google News client (src/collector/googleNews.js) with a
// fake fetch: how each kind of answer is handled (repeated 403s D77; broken XML, 400 and other 4xx
// D85/D90; the "still fetching" signal D90), the pace, and feed parsing. No real requests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import {
  BrokenFeedError, PermanentFetchError, buildSearchUrl, classifyHttpStatus, createGoogleNewsClient, forbiddenWait, parseFeed,
} from '../src/collector/googleNews.js';
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

test('403 again and again (D77): 3 fixed 5 s waits, then the growing waits; a success starts the count again', async () => {
  const forbidden = { status: 403 };
  const { client, retries } = clientWithAnswers([
    forbidden, forbidden, forbidden, forbidden, forbidden, forbidden, GOOD, // first search
    forbidden, GOOD, // second search, after Google answered normally
  ]);
  await client.search('q1');
  assert.deepEqual(retries.map((r) => r.waitMs), [5000, 5000, 5000, 5000, 10000, 30000]);
  await client.search('q2');
  assert.deepEqual(retries.slice(6).map((r) => r.waitMs), [5000], 'the count started again after the success');
  assert.ok(retries.every((r) => /403/.test(r.reason)));
});

test('the 403 count goes on across searches until Google answers normally (a block is not per search)', async () => {
  const forbidden = { status: 403 };
  const bad = { status: 400 };
  const { client, retries } = clientWithAnswers([forbidden, forbidden, bad, bad, bad, forbidden, forbidden, GOOD]);
  await assert.rejects(client.search('q1'), PermanentFetchError); // 403, 403, then 400 three times
  await client.search('q2'); // 403, 403, then OK
  assert.deepEqual(retries.map((r) => r.waitMs), [5000, 5000, 60000, 60000, 5000, 5000], '4 403s in a row: the 4th uses the first growing wait (5 s)');
  assert.equal(forbiddenWait(5), 10000);
  assert.equal(forbiddenWait(3 + config.RETRY_BACKOFF_MS.length + 5), 600000, 'never more than 10 min');
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

test('D85: broken XML is temporary: growing waits, then a good answer is used', async () => {
  const broken = { status: 200, body: readFixture('broken.xml') };
  const { client, fetchImpl, retries } = clientWithAnswers([broken, broken, GOOD]);
  const result = await client.search('q', { companyName: 'Harvey' });
  assert.equal(result.itemCount, 3);
  assert.equal(fetchImpl.calls.length, 3);
  assert.deepEqual(retries.map((r) => r.waitMs), [5000, 10000]);
  assert.match(retries[0].reason, /cannot be read.*\(HTTP 200\)/);
  assert.deepEqual([retries[0].status, retries[0].companyName], [200, 'Harvey']);
});

test('D85: XML without a <channel> is temporary too', async () => {
  const { client, retries } = clientWithAnswers([{ status: 200, body: readFixture('no-channel.xml') }, GOOD]);
  assert.equal((await client.search('q')).itemCount, 3);
  assert.match(retries[0].reason, /channel/);
});

test('parseFeed throws BrokenFeedError (not a permanent error) for broken XML', () => {
  assert.throws(() => parseFeed(readFixture('broken.xml')), (error) => error instanceof BrokenFeedError && !(error instanceof PermanentFetchError));
});

test('D85: three 400s, 1 minute apart -> PermanentFetchError with the reason; every try is reported', async () => {
  const { client, fetchImpl, retries } = clientWithAnswers([{ status: 400 }]);
  await assert.rejects(client.search('q', { companyName: 'Acme Bio' }),
    (error) => error instanceof PermanentFetchError && error.message === 'Google rejected the search (HTTP 400), 3 tries 1 min apart');
  assert.equal(fetchImpl.calls.length, 3);
  assert.deepEqual(retries.map((r) => [r.waitMs, r.status, r.companyName, r.tryNumber, r.tries]),
    [[60000, 400, 'Acme Bio', 1, 3], [60000, 400, 'Acme Bio', 2, 3]]);
});

test('D85: 400, 400, then success -> the items are returned', async () => {
  const { client, fetchImpl } = clientWithAnswers([{ status: 400 }, { status: 400 }, GOOD]);
  assert.equal((await client.search('q')).itemCount, 3);
  assert.equal(fetchImpl.calls.length, 3);
});

test('D90: other 4xx (404, 410) are handled like 400; 403, 408 and 429 keep their own handling', async () => {
  for (const status of [404, 410]) {
    const { client, fetchImpl, retries } = clientWithAnswers([{ status }]);
    await assert.rejects(client.search('q'), (error) => error instanceof PermanentFetchError && error.message.includes(String(status)));
    assert.equal(fetchImpl.calls.length, 3);
    assert.deepEqual(retries.map((r) => r.waitMs), [60000, 60000]);
  }
  const { client, retries } = clientWithAnswers([{ status: 403 }, { status: 408 }, { status: 429 }, GOOD]);
  await client.search('q');
  assert.deepEqual(retries.map((r) => [r.status, r.waitMs, r.tryNumber]), [[403, 5000, undefined], [408, 5000, undefined], [429, 10000, undefined]]);
});

test('D90: "still fetching" before each request and every 30 s of a retry wait', async () => {
  const fetchImpl = makeFakeFetch((url, callNumber) => (callNumber === 1 ? { status: 400 } : GOOD));
  const alive = [];
  const waits = [];
  let clock = 0;
  const client = createGoogleNewsClient({
    fetchImpl, sleep: async (ms) => { waits.push(ms); clock += ms; }, now: () => clock, random: () => 0, onAlive: (state) => alive.push(state),
  });
  await client.search('q');
  assert.deepEqual(waits, [30000, 30000], 'the 1-minute wait is cut in 30 s pieces');
  assert.deepEqual(alive, ['fetching', 'fetching', 'fetching', 'fetching'], 'request 1, two wait pieces, request 2');
  assert.deepEqual(classifyHttpStatus(302).kind, 'temporary', 'an unexpected non-4xx answer is not a rejection');
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
