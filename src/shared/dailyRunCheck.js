// dailyRunCheck.js — "is a daily run going on right now?" (Step 6, Prompt 298, review #4).
//
// Where it sits: `npm start` (runSupervisor.js, through collectionCheck.js) and `npm run collect`
// (runCollect.js) ask this before they start a 90-day collection. While a daily run is going on
// they refuse (exit 3): otherwise the daily job would also classify the collection's articles and
// its Discord message would list them all as new.
// Reads: the DailyRun table (read-only). Writes: nothing.
//
// Going on = a DailyRun row with status 'running' whose process (owner_pid) is still alive. A
// 'running' row whose process is gone was cut off by a crash: it does not count.

import { isProcessAlive } from './runLock.js';

// The daily run that is going on ({ id, owner_pid, started_at }), or null. A database without the
// DailyRun table (older than the daily job) has none.
export function findLiveDailyRun(db, { isAlive = isProcessAlive } = {}) {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'DailyRun'").get();
  if (!hasTable) return null;
  const rows = db.prepare("SELECT id, owner_pid, started_at FROM DailyRun WHERE status = 'running' ORDER BY id DESC").all();
  const live = rows.find((row) => isAlive(row.owner_pid));
  return live ? { ...live } : null;
}

// The message shown when a 90-day collection can't start because of `run` (a live daily run).
export function describeDailyRunGoingOn(run) {
  return `A daily run is going on (daily run ${run.id}, process ${run.owner_pid}, started ${run.started_at}). ` +
    'The 90-day collection does not start now, so the two don\'t mix. Try again when the daily run has ended ' +
    '(usually 10–20 minutes; its window says "Daily run ... done").';
}
