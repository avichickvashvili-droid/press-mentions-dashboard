// googleNews.js — asks Google News for one search and returns the articles it found.
//
// Where it sits: called by the company loop once per date window. It knows nothing about
// the database; it only turns a search text into a list of raw items.
// Reads: the Google News RSS search feed over the internet (D23), e.g.
//        https://news.google.com/rss/search?q=<search>&hl=en-US&gl=US&ceid=US:en
// Writes: nothing.
//
// Rules (D40, D42, D54, D77):
//  - Pace: at most one request per second, plus a small random extra wait.
//  - Temporary problems are retried with the SAME request until it works:
//      no internet, timeout (30 s), HTTP 408, 429, 5xx, or an HTML page instead of RSS
//      (usually a CAPTCHA) -> growing waits 5 s, 10 s, 30 s, 1 min, 2 min, 5 min, 10 min, 10 min...
//      HTTP 403 (blocked) -> logged and retried: the first 3 403s in a row wait a fixed 5 s each;
//      after that each further 403 uses the growing waits above (5 s, 10 s ... 10 min), so a
//      real block is not hammered every 5 s. Any successful answer starts the 403 count again.
//  - Permanent problems throw PermanentFetchError (the company is then marked failed):
//      any other 4xx, or XML that cannot be read or has no <channel>.

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { config } from '../config.js';
import { backoffDelay, describeWait, sleep as realSleep } from '../shared/retry.js';

// Thrown when retrying cannot help (e.g. HTTP 400, broken XML). The reason is for the run summary.
export class PermanentFetchError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'PermanentFetchError';
  }
}

// Builds the Google News RSS address for a search text.
export function buildSearchUrl(query) {
  return `${config.GOOGLE_NEWS_URL}?q=${encodeURIComponent(query)}&${config.GOOGLE_NEWS_LANGUAGE_PARAMS}`;
}

// The XML reader. Tag values are kept as text (so a headline like "2024" stays text), and
// <item> is always a list, even when the feed has only one article.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
  htmlEntities: true,
  isArray: (tagName) => tagName === 'item',
});

// Gets the plain text of an XML value: tags with attributes (like <source url="...">) come
// back as objects, repeated tags as lists. Returns '' when there is no text.
function textOf(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === 'object') return textOf(value['#text']);
  return String(value).trim();
}

// True when the answer looks like a web page (for example a CAPTCHA) or anything else that
// is not XML. That is treated as temporary: Google is limiting us, not rejecting the search.
export function looksLikeNonRss(body) {
  const start = body.replace(/^﻿/, '').trimStart().slice(0, 200).toLowerCase();
  if (start === '') return true;
  if (!start.startsWith('<')) return true;
  return start.startsWith('<!doctype html') || start.startsWith('<html');
}

// Reads an RSS feed (text) into raw items: { guid, link, title, publisher, pubDate }, all text.
// Also returns how many <item>s the feed had (used to decide if a window must be split).
// Throws PermanentFetchError when the XML is broken or has no <channel>.
export function parseFeed(xmlText) {
  const validation = XMLValidator.validate(xmlText);
  if (validation !== true) {
    const detail = validation?.err ? `${validation.err.msg} (line ${validation.err.line})` : 'unknown problem';
    throw new PermanentFetchError(`Google News sent XML that cannot be read: ${detail}`);
  }
  let parsed;
  try {
    parsed = xmlParser.parse(xmlText);
  } catch (error) {
    throw new PermanentFetchError(`Google News sent XML that cannot be read: ${error.message}`);
  }
  const rss = parsed?.rss;
  if (rss === undefined || rss === null || typeof rss !== 'object' || !('channel' in rss)) {
    throw new PermanentFetchError('Google News sent XML without an RSS <channel>.');
  }
  const channel = rss.channel && typeof rss.channel === 'object' ? rss.channel : {};
  const rawItems = Array.isArray(channel.item) ? channel.item : [];
  const items = rawItems.map((item) => ({
    guid: textOf(item?.guid),
    link: textOf(item?.link),
    title: textOf(item?.title),
    publisher: textOf(item?.source),
    pubDate: textOf(item?.pubDate),
  }));
  return { items, itemCount: rawItems.length };
}

// Decides what an HTTP answer means. Returns one of:
//   { kind: 'ok' }                      -> read the feed
//   { kind: 'forbidden', reason }      -> 403: fixed 5 s wait (first 3 in a row), then growing waits
//   { kind: 'temporary', reason }      -> growing wait, retry
//   { kind: 'permanent', reason }      -> give up on this company
export function classifyHttpStatus(status, statusText = '') {
  const label = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 403) return { kind: 'forbidden', reason: `Google blocked the request (${label})` };
  if (status === 408 || status === 429 || status >= 500) {
    return { kind: 'temporary', reason: `Google is busy or limiting us (${label})` };
  }
  return { kind: 'permanent', reason: `Google rejected the search (${label})` };
}

// The wait after a 403 (D77): the first FORBIDDEN_FIXED_RETRIES 403s in a row wait the fixed
// FORBIDDEN_RETRY_MS; later ones use the growing waits, starting again from the first step.
// `forbiddenCount` = how many 403s in a row so far, including this one (1 = the first).
export function forbiddenWait(forbiddenCount) {
  if (forbiddenCount <= config.FORBIDDEN_FIXED_RETRIES) return config.FORBIDDEN_RETRY_MS;
  return backoffDelay(forbiddenCount - config.FORBIDDEN_FIXED_RETRIES - 1);
}

// Creates a Google News client. Everything it touches from the outside world (the network,
// the clock, waiting, randomness) can be replaced, so tests run offline and instantly.
//   onRetry({ reason, waitMs }) is called before each wait after a problem (for progress + logs).
export function createGoogleNewsClient({
  fetchImpl = globalThis.fetch,
  sleep = realSleep,
  now = Date.now,
  random = Math.random,
  onRetry = () => {},
} = {}) {
  let lastRequestAt = null;
  let forbiddenInARow = 0; // 403 answers since Google last answered normally (counted across searches)

  // Keeps the fixed pace: waits until at least 1 s (+ random 0-300 ms) has passed since the last request.
  async function waitForTurn() {
    if (lastRequestAt !== null) {
      const earliest = lastRequestAt + config.REQUEST_INTERVAL_MS + Math.floor(random() * (config.REQUEST_JITTER_MS + 1));
      const waitMs = earliest - now();
      if (waitMs > 0) await sleep(waitMs);
    }
    lastRequestAt = now();
  }

  // Sends one request and reads its whole body. Returns { outcome, body }.
  // Network errors and timeouts are reported as temporary, never thrown.
  async function requestOnce(url) {
    let response;
    let body;
    try {
      response = await fetchImpl(url, {
        headers: { 'User-Agent': config.USER_AGENT },
        signal: AbortSignal.timeout(config.FETCH_TIMEOUT_MS),
      });
      body = await response.text();
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      const reason = timedOut
        ? `Google did not answer within ${describeWait(config.FETCH_TIMEOUT_MS)}`
        : `Google unreachable (${error?.cause?.code ?? error?.message ?? 'network error'})`;
      return { outcome: { kind: 'temporary', reason } };
    }
    const outcome = classifyHttpStatus(response.status, response.statusText);
    if (outcome.kind === 'ok' && looksLikeNonRss(body)) {
      return { outcome: { kind: 'temporary', reason: 'Google sent a web page instead of the news feed (probably a CAPTCHA)' } };
    }
    return { outcome, body };
  }

  // Runs one search. Retries temporary problems until it works; throws PermanentFetchError
  // for permanent ones. Returns { items, itemCount }.
  async function search(query) {
    const url = buildSearchUrl(query);
    let retryIndex = 0;
    for (;;) {
      await waitForTurn();
      const { outcome, body } = await requestOnce(url);

      if (outcome.kind === 'ok') {
        forbiddenInARow = 0; // Google answered normally: the next 403 starts from the fixed 5 s again
        return parseFeed(body);
      }
      if (outcome.kind === 'permanent') throw new PermanentFetchError(outcome.reason);

      let waitMs;
      if (outcome.kind === 'forbidden') {
        forbiddenInARow += 1;
        waitMs = forbiddenWait(forbiddenInARow);
      } else {
        waitMs = backoffDelay(retryIndex);
        retryIndex += 1;
      }
      onRetry({ reason: outcome.reason, waitMs });
      await sleep(waitMs);
    }
  }

  return { search };
}
