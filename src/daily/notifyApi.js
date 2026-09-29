// notifyApi.js — tells the api "there is new data" after a daily run (D106).
//
// Where it sits: a step of dailyJob.js, after the new mentions are in the database. The api then
// tells every open dashboard page, and the pages reload their data (useDataUpdates, D100).
// Reads: API_HOST / API_PORT (config.js). Writes: nothing (one local HTTP request).
//
// The call: POST http://127.0.0.1:<API_PORT>/api/internal/data-updated, no body, with the
// X-Press-Mentions: daily-job header. The api accepts it only from this computer with that header.
// It never throws. If the api is not running, that is fine: the data is already in the database,
// and a page shows it the next time it is opened, focused or refreshed. Returns { ok, pages, error }
// (pages = how many open pages were told).

import { config } from '../config.js';
import { DAILY_JOB_HEADER } from '../api/events.js';

// The address of the api's internal endpoint.
export function dataUpdatedUrl({ host = config.API_HOST, port = config.API_PORT } = {}) {
  return `http://${host}:${port}/api/internal/data-updated`;
}

// Sends the signal. Returns { ok: true, pages } or { ok: false, error } (a plain-language reason).
export async function notifyApi({
  url = dataUpdatedUrl(),
  fetchImpl = globalThis.fetch,
  timeoutMs = config.DAILY_NOTIFY_TIMEOUT_MS,
} = {}) {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { [DAILY_JOB_HEADER.name]: DAILY_JOB_HEADER.value },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, error: `the api answered HTTP ${response.status}` };
    let pages = null;
    try { pages = (await response.json())?.pages ?? null; } catch { /* the count is only for the log */ }
    return { ok: true, pages };
  } catch (error) {
    const code = error?.cause?.code ?? error?.code;
    if (code === 'ECONNREFUSED') return { ok: false, error: 'the dashboard api is not running' };
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return { ok: false, error: `the api did not answer within ${Math.round(timeoutMs / 1000)} s` };
    }
    return { ok: false, error: `the api could not be reached (${code ?? error?.message ?? 'network error'})` };
  }
}
