// events.test.js — the api's live-updates channel and the daily job's signal (D106):
// GET /api/events, POST /api/internal/data-updated (src/api/events.js, src/api/app.js) and the
// daily job's sender (src/daily/notifyApi.js). Offline: a temporary database, the app on a free
// port on 127.0.0.1, the built-in fetch.

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { addStandardData, makeApiDb, startApi } from './apiHelpers.js';
import { createEventHub, isLocalRequest } from '../../src/api/events.js';
import { dataUpdatedUrl, notifyApi } from '../../src/daily/notifyApi.js';

// Starts the app with its own event hub. Returns { baseUrl, events }.
async function setup(t) {
  const { db, openReadOnly, onCleanup } = makeApiDb(t);
  addStandardData(db);
  const events = createEventHub({ keepAliveMs: 50 });
  onCleanup(() => events.closeAll());
  const api = await startApi(onCleanup, { db: openReadOnly(), events });
  return { ...api, events, onCleanup };
}

// Opens GET /api/events like a page does. Returns { response, next(), close() }, where next()
// waits for the next text block the server writes.
async function openEvents(baseUrl, onCleanup) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async () => {
    while (!buffer.includes('\n\n')) {
      const { value, done } = await reader.read();
      if (done) throw new Error('the stream ended');
      buffer += decoder.decode(value, { stream: true });
    }
    const end = buffer.indexOf('\n\n');
    const block = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    return block;
  };
  const close = () => { try { controller.abort(); } catch { /* already closed */ } };
  onCleanup(close);
  return { response, next, close };
}

// Waits until `check()` is true (checked every 10 ms, at most 2 s).
async function waitFor(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Sends the signal the way the daily job does (or without the header).
function postSignal(baseUrl, { withHeader = true } = {}) {
  return fetch(`${baseUrl}/api/internal/data-updated`, {
    method: 'POST',
    headers: withHeader ? { 'X-Press-Mentions': 'daily-job' } : {},
  });
}

test('GET /api/events: stays open as an event stream and first sends the reconnect time', async (t) => {
  const { baseUrl, events, onCleanup } = await setup(t);
  const stream = await openEvents(baseUrl, onCleanup);
  assert.equal(stream.response.status, 200);
  assert.match(stream.response.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(stream.response.headers.get('cache-control'), 'no-store');
  assert.match(await stream.next(), /^retry: \d+\n: connected$/);
  await waitFor(() => events.count() === 1);
});

test('GET /api/events: a keep-alive line keeps an idle connection open', async (t) => {
  const { baseUrl, onCleanup } = await setup(t);
  const stream = await openEvents(baseUrl, onCleanup);
  await stream.next(); // retry + connected
  assert.equal(await stream.next(), ': keep-alive');
});

test('the daily job signal reaches every open page as "data-updated", and the answer counts them', async (t) => {
  const { baseUrl, events, onCleanup } = await setup(t);
  const first = await openEvents(baseUrl, onCleanup);
  const second = await openEvents(baseUrl, onCleanup);
  await first.next();
  await second.next();
  await waitFor(() => events.count() === 2);

  const response = await postSignal(baseUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { pages: 2 });
  const readEvent = async (stream) => { for (;;) { const block = await stream.next(); if (!block.startsWith(':')) return block; } };
  assert.equal(await readEvent(first), 'event: data-updated\ndata: {}');
  assert.equal(await readEvent(second), 'event: data-updated\ndata: {}');
});

test('a page that closes its connection is forgotten', async (t) => {
  const { baseUrl, events, onCleanup } = await setup(t);
  const stream = await openEvents(baseUrl, onCleanup);
  await stream.next();
  await waitFor(() => events.count() === 1);
  stream.close();
  await waitFor(() => events.count() === 0);
  const response = await postSignal(baseUrl);
  assert.deepEqual(await response.json(), { pages: 0 });
});

test('the signal without the daily job header is refused (403)', async (t) => {
  const { baseUrl, events, onCleanup } = await setup(t);
  const stream = await openEvents(baseUrl, onCleanup);
  await stream.next();
  await waitFor(() => events.count() === 1);
  const response = await postSignal(baseUrl, { withHeader: false });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /daily job/);
});

test('the signal is only a POST: a GET gets the JSON 404', async (t) => {
  const { baseUrl } = await setup(t);
  const response = await fetch(`${baseUrl}/api/internal/data-updated`);
  assert.equal(response.status, 404);
});

test('isLocalRequest: only 127.0.0.1 and ::1 count as this computer', () => {
  const request = (remoteAddress) => ({ socket: { remoteAddress } });
  assert.equal(isLocalRequest(request('127.0.0.1')), true);
  assert.equal(isLocalRequest(request('::1')), true);
  assert.equal(isLocalRequest(request('::ffff:127.0.0.1')), true);
  assert.equal(isLocalRequest(request('192.168.1.20')), false);
  assert.equal(isLocalRequest(request('::ffff:10.0.0.5')), false);
  assert.equal(isLocalRequest({ socket: {} }), false);
});

test('notifyApi: sends the signal to the running api and returns how many pages got it', async (t) => {
  const { baseUrl, events, onCleanup } = await setup(t);
  const stream = await openEvents(baseUrl, onCleanup);
  await stream.next();
  await waitFor(() => events.count() === 1);
  const result = await notifyApi({ url: `${baseUrl}/api/internal/data-updated` });
  assert.deepEqual(result, { ok: true, pages: 1 });
});

test('notifyApi: an api that is not running is a plain "not running" (no throw)', async () => {
  const port = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const { port: free } = server.address(); server.close(() => resolve(free)); });
  });
  const result = await notifyApi({ url: dataUpdatedUrl({ port }) });
  assert.deepEqual(result, { ok: false, error: 'the dashboard api is not running' });
});

test('notifyApi: an error answer and a timeout are reported, not thrown', async () => {
  const refused = await notifyApi({ fetchImpl: async () => new Response('{}', { status: 403 }) });
  assert.deepEqual(refused, { ok: false, error: 'the api answered HTTP 403' });
  const slow = await notifyApi({
    timeoutMs: 1000,
    fetchImpl: async () => { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error; },
  });
  assert.deepEqual(slow, { ok: false, error: 'the api did not answer within 1 s' });
});

test('dataUpdatedUrl: 127.0.0.1 and the api port', () => {
  assert.equal(dataUpdatedUrl({ port: 3999 }), 'http://127.0.0.1:3999/api/internal/data-updated');
});
