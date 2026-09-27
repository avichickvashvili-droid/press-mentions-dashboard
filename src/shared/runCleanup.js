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
//   - every folder in the logs folder except the new run's: old run-<id> folders and no-run/.
//     A folder with the new run's name that is already there (left by an earlier database whose
//     run numbers started at 1 too) is emptied, so the new run's files start clean.
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

// Removes every folder in `logsDir` except `keepFolder`, and empties `keepFolder` itself if it is
// already there (a stale folder with the new run's name). Loose files in `logsDir` are left alone.
// Never throws. Returns { removed: [folder names], failed: [{ name, error }] }.
export function removeOldLogFolders({ keepFolder, logsDir = config.LOGS_DIR, fileSystem = fs }) {
  const result = { removed: [], failed: [] };
  let entries;
  try {
    entries = fileSystem.readdirSync(logsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') result.failed.push({ name: logsDir, error });
    return result; // no logs folder yet: nothing to remove
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
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
