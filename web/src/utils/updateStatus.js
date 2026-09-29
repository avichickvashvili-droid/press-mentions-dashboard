// updateStatus.js — how fresh the data is, from the daily job's runs (D113; moved here from the
// old Header for the hero and the side menu, D118).
//
// Where it sits: used by the Hero (the Live pill) and the Sidebar (the status box).
//   ok       the last daily run finished less than STALE_AFTER_MS ago
//   running  a daily run is going on now (the numbers are still the last finished run's)
//   failed   the newest daily run failed (the numbers are the last finished run's)
//   stale    the last finished run is older than STALE_AFTER_MS (e.g. `npm run daily` is not open)
//   none     no daily run yet (the data is from the 90-day collection)

// The daily job runs every day at 03:00: a last update older than 26 hours means one was missed.
export const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

// Which status to show: { tone, title }. `dailyRun` = { latest, lastDone } from the api.
export function updateStatus(dailyRun, now = Date.now()) {
  const latest = dailyRun?.latest;
  const lastDone = dailyRun?.lastDone;
  if (latest?.status === 'running') return { tone: 'running', title: 'Daily run in progress' };
  if (latest?.status === 'failed') return { tone: 'failed', title: 'The last daily run failed' };
  if (!lastDone) return { tone: 'none', title: 'No daily run yet' };
  if (now - Date.parse(lastDone.finishedAt) > STALE_AFTER_MS) return { tone: 'stale', title: 'Last data update (over a day ago)' };
  return { tone: 'ok', title: 'Last data update' };
}
