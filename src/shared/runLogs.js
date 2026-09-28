// runLogs.js — which run folder a log line belongs to (D92, D93).
//
// Where it sits: used by every process that writes a log file (src/shared/logFile.js) when it
// does not get its run from somewhere else:
//   - the classifier writes to the folder of the latest run (it can outlive a run);
//   - the orchestrator and the collector runner use it when they end without knowing their run
//     (e.g. the collector refused to start), so their held lines are still written somewhere.
// "The latest run" = the JobRun row with the highest id. No run at all -> logs/no-run/.
// Reads: the JobRun table (read-only). Writes: nothing.

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { runFolderName } from './logFile.js';

// The latest run's id read from an open database, or null when there is no run (or no JobRun
// table yet). Throws if the database can't be read; the callers below catch it.
function readLatestRunId(db) {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'JobRun'").get();
  if (!hasTable) return null;
  return db.prepare('SELECT MAX(id) AS id FROM JobRun').get().id ?? null;
}

// The log folder of the latest run: "run-5", or config.LOG_NO_RUN_FOLDER when no run exists.
// Uses the open database `db` if given, otherwise opens `dbPath` read-only for a moment.
// Returns null when the database can't be read now (the caller keeps its current folder, or
// uses the no-run folder if it has none). Never throws.
export function latestRunFolder({ db = null, dbPath = config.DB_PATH } = {}) {
  try {
    let runId;
    if (db) {
      runId = readLatestRunId(db);
    } else {
      if (!fs.existsSync(dbPath)) return config.LOG_NO_RUN_FOLDER;
      const readOnly = new DatabaseSync(dbPath, { readOnly: true });
      try {
        readOnly.exec(`PRAGMA busy_timeout = ${Number(config.DB_BUSY_TIMEOUT_MS)};`);
        runId = readLatestRunId(readOnly);
      } finally {
        readOnly.close();
      }
    }
    return runId === null ? config.LOG_NO_RUN_FOLDER : runFolderName(runId);
  } catch {
    return null;
  }
}

// Gives a log file that is still holding its lines (it never learnt its run) a folder: the
// latest run's, or the no-run folder. Does nothing if the file already has a folder.
export function settleLogFolder(logFile, options = {}) {
  if (logFile.folder() !== null) return;
  logFile.setFolder(latestRunFolder(options) ?? config.LOG_NO_RUN_FOLDER);
}
