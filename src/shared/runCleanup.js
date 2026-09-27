// runCleanup.js — removes the old runs when a NEW run is created (D93, D94).
//
// Where it sits: deleteOldRuns() is called by acquireRun (src/collector/jobLock.js) inside the
// same transaction that inserts the new run, and only for a new run (never on a resume, a
// take-over or a `--groups` re-open). removeOldLogFolders() is called by the collector
// (runCollect.js) right after, before it writes its first log line in the new run's folder.
// Works the same under `npm start` and with `npm run collect` alone.
//
// What is removed:
//   - the database rows of every other run: JobRunGroup, JobRunCompany, then JobRun (the child
//     tables first, because they point to JobRun);
//   - in the logs folder, ONLY folders named run-<number> (e.g. run-4) and no-run/ (D95, review
//     G1): the old run folders, and a folder with the new run's name that is already there (left
//     by an earlier database whose run numbers started at 1 too), so the new run's files start
//     clean. Anything else in the logs folder (other folders, loose files) is NEVER touched, even
//     if LOGS_DIR in .env points at a folder that holds other things: such folders are only
//     listed back, so the caller can warn once.
// What is kept: Mention, Company and BufferQueue are never touched (the collected articles and
// mentions stay). At that moment every other run is 'done' (acquireRun refuses a new run while
// one is 'collected' or held by a live collector, and takes over a dead 'running' one instead of
// creating a new one), so nothing is still working on them.
// A folder that can't be removed (e.g. a file open in another program on Windows) is reported
// back; the caller warns once and carries on. It is removed at the next new run.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Deletes every run except `keepRunId` from JobRunGroup, JobRunCompany and JobRun. Must be called
// inside the transaction that created the new run. Returns how many runs were deleted.
export function deleteOldRuns(db, keepRunId) {
  db.prepare('DELETE FROM JobRunGroup WHERE run_id <> ?').run(keepRunId);
  db.prepare('DELETE FROM JobRunCompany WHERE run_id <> ?').run(keepRunId);
  return Number(db.prepare('DELETE FROM JobRun WHERE id <> ?').run(keepRunId).changes);
}

// True for a folder name the clean-up may remove: "run-<number>" or the no-run folder (D95, G1).
export function isLogRunFolder(name, { noRunFolder = config.LOG_NO_RUN_FOLDER } = {}) {
  return /^run-\d+$/.test(name) || name === noRunFolder;
}

// Removes every run folder (run-<number>, no-run/) in `logsDir` except `keepFolder`, and empties
// `keepFolder` itself if it is already there (a stale folder with the new run's name). Any other
// folder and every loose file in `logsDir` is left alone and only reported in `unknown` (G1).
// Never throws. Returns { removed: [folder names], failed: [{ name, error }], unknown: [names] }.
export function removeOldLogFolders({ keepFolder, logsDir = config.LOGS_DIR, fileSystem = fs }) {
  const result = { removed: [], failed: [], unknown: [] };
  let entries;
  try {
    entries = fileSystem.readdirSync(logsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') result.failed.push({ name: logsDir, error });
    return result; // no logs folder yet: nothing to remove
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isLogRunFolder(entry.name)) {
      result.unknown.push(entry.name); // not ours: never removed
      continue;
    }
    try {
      fileSystem.rmSync(path.join(logsDir, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      if (entry.name !== keepFolder) result.removed.push(entry.name);
    } catch (error) {
      result.failed.push({ name: entry.name, error });
    }
  }
  return result;
}

// The system-log line for the clean-up, e.g. "New run 2: removed 1 old run and its logs".
export function describeCleanup(runId, removedRuns, folders) {
  if (removedRuns > 0) {
    return `New run ${runId}: removed ${removedRuns} old ${removedRuns === 1 ? 'run and its' : 'runs and their'} logs`;
  }
  const extra = folders.removed.length ? ` (old log folders removed: ${folders.removed.join(', ')})` : '';
  return `New run ${runId}: no old runs to remove${extra}`;
}
