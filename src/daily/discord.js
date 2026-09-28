// discord.js — sends one message to the Discord webhook (D102, D105).
//
// Where it sits: the last step of a daily run (dailyJob.js), after the api was told about the new
// data. Reads: DISCORD_WEBHOOK_URL (from .env, through config.js). Writes: nothing (network only).
//
// The webhook address is a SECRET: it is never printed, logged or put in an error message (only
// "the Discord webhook" is named). Problems and what happens:
//   - no address set                       → not sent, clear message (nothing is retried)
//   - 2xx                                  → sent
//   - 429 "too many requests"              → waits as long as Discord asks, then tries again
//   - 5xx, a timeout or no network         → tries again after DISCORD_RETRY_WAITS_MS (5 s, 30 s)
//   - any other 4xx (e.g. 404 = the webhook was deleted, 401 = wrong token)
//                                          → not sent, no retry (trying again can't help)
// At most DISCORD_TRIES tries in all. It never throws: it returns { ok, error }.

import { config } from '../config.js';
import { sleep as realSleep } from '../shared/retry.js';

// How long Discord asked us to wait (429): `retry_after` in seconds from the answer's JSON, or the
// Retry-After header, or 5 s when neither can be read. Never more than DISCORD_MAX_RATE_LIMIT_WAIT_MS.
async function rateLimitWait(response) {
  let seconds = null;
  try {
    const body = await response.json();
    if (Number.isFinite(body?.retry_after)) seconds = body.retry_after;
  } catch { /* no JSON body */ }
  if (seconds === null) {
    const header = Number(response.headers?.get?.('retry-after'));
    if (Number.isFinite(header) && header >= 0) seconds = header;
  }
  const ms = Math.ceil((seconds ?? 5) * 1000);
  return Math.min(Math.max(ms, 0), config.DISCORD_MAX_RATE_LIMIT_WAIT_MS);
}

// Sends one message (the webhook JSON body). Returns { ok: true } or { ok: false, error }.
// `log` gets one line before each retry.
export async function sendDiscordMessage(body, {
  webhookUrl = config.DISCORD_WEBHOOK_URL,
  fetchImpl = globalThis.fetch,
  sleep = realSleep,
  tries = config.DISCORD_TRIES,
  retryWaitsMs = config.DISCORD_RETRY_WAITS_MS,
  timeoutMs = config.DISCORD_TIMEOUT_MS,
  log = console.warn,
} = {}) {
  if (!webhookUrl) {
    return { ok: false, error: 'DISCORD_WEBHOOK_URL is not set in .env, so the message was not sent' };
  }

  let lastError = 'not sent';
  for (let tryNumber = 1; tryNumber <= tries; tryNumber += 1) {
    let waitMs;
    try {
      const response = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return { ok: true };
      if (response.status === 429) {
        waitMs = await rateLimitWait(response);
        lastError = 'Discord answered 429 (too many requests)';
      } else if (response.status >= 500) {
        waitMs = retryWaitsMs[Math.min(tryNumber - 1, retryWaitsMs.length - 1)];
        lastError = `Discord answered ${response.status} (a problem on Discord's side)`;
      } else {
        const hint = response.status === 404 || response.status === 401
          ? ' The webhook was probably deleted or its address is wrong: check DISCORD_WEBHOOK_URL in .env.'
          : '';
        return { ok: false, error: `Discord refused the message (HTTP ${response.status}).${hint}` };
      }
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      // Only the error's code is used: its message could contain the webhook address.
      lastError = timedOut
        ? `Discord did not answer within ${Math.round(timeoutMs / 1000)} s`
        : `Discord could not be reached (${error?.cause?.code ?? error?.code ?? 'network error'})`;
      waitMs = retryWaitsMs[Math.min(tryNumber - 1, retryWaitsMs.length - 1)];
    }
    if (tryNumber < tries) {
      log(`${lastError}; trying again in ${Math.round(waitMs / 1000)} s (try ${tryNumber + 1} of ${tries}).`);
      await sleep(waitMs);
    }
  }
  return { ok: false, error: `${lastError}, after ${tries} tries` };
}
