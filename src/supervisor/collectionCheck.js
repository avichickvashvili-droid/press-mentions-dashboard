// collectionCheck.js — decides at `npm start` whether the collector should be launched (D67).
//
// Where it sits: called once by the orchestrator before it starts the collector.
// The 90-day collection runs ONCE. After that, new articles are the daily job's work (Step 6,
// not built yet). So the collector is launched only when a collection never completed:
//   - a 'running' run exists (stopped or crashed earlier)  -> launch it, it resumes that run
//   - no run has ever reached 'collected' or 'done'       -> launch it, it starts the first run
//   - otherwise                                           -> do not launch; log when the last
//                                                            collection finished
// Reads: the JobRun table, READ-ONLY (it never creates or changes anything). If the database
// file does not exist yet, nothing was ever collected.
// Writes: nothing.

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

// Looks at JobRun and returns { start: true/false, reason: text for the log }.
// Throws if the database exists but cannot be read; the caller logs that.
export function checkCollectionNeeded({ dbPath = config.DB_PATH } = {}) {
  if (!fs.existsSync(dbPath)) {
    return { start: true, reason: 'No database yet: starting the first 90-day collection.' };
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${Number(config.DB_BUSY_TIMEOUT_MS)};`);
    const hasJobRunTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'JobRun'")
      .get();
    if (!hasJobRunTable) {
      return { start: true, reason: 'No collection has run yet: starting the first 90-day collection.' };
    }

    const unfinished = db
      .prepare("SELECT id FROM JobRun WHERE status = 'running' ORDER BY id DESC LIMIT 1")
      .get();
    if (unfinished) {
      return { start: true, reason: `Collection run ${unfinished.id} did not finish: starting the collector to resume it.` };
    }

    const completed = db
      .prepare("SELECT id, finished_at FROM JobRun WHERE status IN ('collected', 'done') ORDER BY id DESC LIMIT 1")
      .get();
    if (completed) {
      const when = completed.finished_at ?? 'an unknown time';
      return {
        start: false,
        reason: `Last collection finished at ${when} (run ${completed.id}); the collector is not started. ` +
          'The 90-day collection runs once; new articles will come from the daily job.',
      };
    }

    return { start: true, reason: 'No collection has completed yet: starting the 90-day collection.' };
  } finally {
    db.close();
  }
}
