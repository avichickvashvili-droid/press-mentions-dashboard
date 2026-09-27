// companyLoop.js — the heart of the collector: goes through the run's companies one by one.
//
// Where it sits: started by `npm run collect` (runCollect.js) once it holds the lock.
// Reads:  JobRunCompany (the run's checklist), Company (each company's query_param),
//         JobRun (the run's start date, which fixes the 90 days, and its owner).
// Writes: JobRunCompany statuses, BufferQueue (through bufferWriter), and at the end
//         JobRun.status = 'collected' + finished_at.
//
// For each company (the next 'not_started' one, lowest rowid first = section order, then file order):
//   'not_started' -> 'fetching' -> search every date window -> 'finished'
//   or, on a permanent Google problem, -> 'failed' with the reason (D40).
// Date windows: start with the whole 90 days. A window that returns 95+ items is stored and
// then split in two halves, oldest half first, until windows are under 95 items or 1 day (D57).
// When no company is left, the heartbeat is stopped and the run becomes 'collected' with
// owner_pid = NULL (D52): the collector's work is over and the classifier takes the run from there.
//
// Ownership (D39, D71): every write on the run (a company's status, marking the run 'collected')
// first checks, in the same transaction, that this process still owns the run. If another
// process has taken the run over, nothing is written and LostOwnershipError is thrown: the
// collector must stop (runCollect.js exits with 3). The move to 'fetching' is also only done
// while the company is still 'not_started', so two collectors can never take the same company.
//
// Every database write is one transaction. A write that fails because the database is busy is
// logged and retried; any other database error is thrown on (D76, src/shared/retry.js).

import { config } from '../config.js';
import { inTransaction, nowIso } from '../db/database.js';
import { retryDbWrite, sleep as realSleep } from '../shared/retry.js';
import { cleanForLog, formatCount } from '../shared/text.js';
import { buildWindowQuery, runRange, shouldSplit, splitWindow, formatDay } from './dateWindows.js';
import { sortItems } from './itemRules.js';
import { countQueue, createDeadRowReporter, insertChunk, waitForQueueSpace } from './bufferWriter.js';
import { PermanentFetchError } from './googleNews.js';
import { LostOwnershipError, ownsRun } from './jobLock.js';

// A fresh set of counters for this session (shown in the final summary).
export function createSessionStats() {
  return { inserted: 0, duplicates: 0, badItems: 0, outsideRange: 0 };
}

// The next company to collect in this run (lowest rowid among 'not_started'), or undefined.
function findNextCompany(db, runId) {
  return db.prepare(`
    SELECT c.id, c.name, c.query_param
    FROM JobRunCompany jrc JOIN Company c ON c.id = jrc.company_id
    WHERE jrc.run_id = ? AND jrc.status = 'not_started'
    ORDER BY jrc.rowid
    LIMIT 1`).get(runId);
}

// How many companies this run has in total, and how many are already done (finished or failed).
function countCompanies(db, runId) {
  return db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status IN ('finished', 'failed') THEN 1 ELSE 0 END) AS done
    FROM JobRunCompany WHERE run_id = ?`).get(runId);
}

// Sets one company's checklist status (and error text) in one transaction, retried if the DB is
// busy. The write only happens while this process still owns the run (checked in the same
// transaction); otherwise LostOwnershipError is thrown. `onlyFrom` (optional) = the status the
// company must still have, e.g. 'not_started' when taking it (a compare-and-set).
// Returns true if the status was changed, false if the company no longer had `onlyFrom`.
async function setCompanyStatus(db, runId, companyId, status, error, { pid, onlyFrom = null, warn, wait }) {
  const outcome = await retryDbWrite(
    () => inTransaction(db, () => {
      if (!ownsRun(db, runId, pid)) return 'lost';
      const changes = onlyFrom === null
        ? db.prepare('UPDATE JobRunCompany SET status = ?, error = ? WHERE run_id = ? AND company_id = ?')
          .run(status, error, runId, companyId).changes
        : db.prepare('UPDATE JobRunCompany SET status = ?, error = ? WHERE run_id = ? AND company_id = ? AND status = ?')
          .run(status, error, runId, companyId, onlyFrom).changes;
      return changes === 1 ? 'changed' : 'unchanged';
    }),
    { label: `mark ${companyId} as ${status}`, warn, wait },
  );
  if (outcome === 'lost') throw new LostOwnershipError(runId);
  return outcome === 'changed';
}

// Searches all date windows of one company and stores the results.
// Throws PermanentFetchError if Google rejects a search (the caller marks the company failed).
// `reportDeadRows` (optional) receives the number of queue rows that failed for good at each CAP check.
export async function collectCompany({
  db, company, range, client, progress, stats, wait = realSleep, reportDeadRows = createDeadRowReporter((text) => progress.warn(text)),
}) {
  const warn = (text) => progress.warn(text);
  const pending = [{ start: range.start, end: range.end }]; // a stack: last pushed = next searched
  let windowNumber = 0;

  while (pending.length > 0) {
    const window = pending.pop();
    windowNumber += 1;
    progress.update({ phase: 'fetching', window: windowNumber, note: null });

    const query = buildWindowQuery(window, company.query_param);
    const { items: rawItems, itemCount } = await client.search(query);
    progress.update({ note: null });

    const { good, bad, outside } = sortItems(rawItems, range);
    for (const { rawItem, reason } of bad) {
      // Title and guid come from the internet: cleaned and shortened for the log only.
      warn(`${company.name}: skipped an article with ${reason} (title: "${cleanForLog(rawItem.title || '?')}", guid: "${cleanForLog(rawItem.guid || '?')}").`);
    }
    stats.badItems += bad.length;
    stats.outsideRange += outside;

    if (good.length > 0) {
      await waitForQueueSpace(db, good.length, {
        sleep: wait,
        warn,
        onDeadRows: reportDeadRows,
        onWaiting: (queueCount) => progress.update({
          phase: 'waiting',
          ...(queueCount === null ? {} : { queueCount }),
          note: `queue full, waiting until it is down to ${formatCount(config.QUEUE_RESUME_AT)}`,
        }),
      });
      progress.update({ phase: 'fetching', note: null });
      const firstSeenAt = nowIso();
      const result = await retryDbWrite(() => insertChunk(db, company.id, good, firstSeenAt), {
        label: `save ${good.length} articles of ${company.name}`,
        warn,
        wait,
      });
      stats.inserted += result.inserted;
      stats.duplicates += result.duplicates;
    }
    updateQueueCount(db, progress);

    if (shouldSplit(window, itemCount)) {
      const [older, newer] = splitWindow(window);
      pending.push(newer, older); // older is popped first: depth-first, oldest half first
    }
  }
}

// Shows the current queue size on the progress line (skipped quietly if the DB can't be read now).
function updateQueueCount(db, progress) {
  try {
    progress.update({ queueCount: countQueue(db) });
  } catch {
    // Only the display is affected; the real queue check happens before every insert.
  }
}

// Marks the run as 'collected' with its finish time and owner_pid = NULL, which hands the run
// over to the classifier (one transaction, retried if busy). Only while this process still owns
// the run; otherwise LostOwnershipError is thrown and the run is left to its new owner.
async function markRunCollected(db, runId, { pid, warn, wait }) {
  const changed = await retryDbWrite(
    () => inTransaction(db, () => db
      .prepare("UPDATE JobRun SET status = 'collected', finished_at = ?, owner_pid = NULL WHERE id = ? AND status = 'running' AND owner_pid = ?")
      .run(nowIso(), runId, pid).changes === 1),
    { label: `mark run ${runId} as collected`, warn, wait },
  );
  if (!changed) throw new LostOwnershipError(runId);
}

// Runs the whole company loop of one run until no 'not_started' company is left, then marks
// the run 'collected'. Unexpected errors (bugs) are not caught here: they reach the top-level
// handler, which writes the emergency heartbeat, so the run resumes on the next start.
// Throws LostOwnershipError when another process has taken the run over (D71).
// `pid` = the process id that owns the run (this process; tests pass the one they used).
// `stopHeartbeat` is called just before the run is marked 'collected'.
export async function runCompanyLoop({
  db, runId, client, progress, stats = createSessionStats(), wait = realSleep, stopHeartbeat = () => {}, pid = process.pid,
}) {
  const warn = (text) => progress.warn(text);
  const reportDeadRows = createDeadRowReporter(warn); // one reporter for the whole loop: no repeated warnings
  const run = db.prepare('SELECT started_at FROM JobRun WHERE id = ?').get(runId);
  const range = runRange(run.started_at);
  progress.info(`Run ${runId}: collecting articles from ${formatDay(range.start)} to ${formatDay(range.end)} (UTC).`);

  for (;;) {
    const company = findNextCompany(db, runId);
    if (!company) break;

    const { total, done } = countCompanies(db, runId);
    progress.update({ companyNumber: done + 1, companyTotal: total, companyName: company.name, phase: 'starting', window: null, note: null });
    const taken = await setCompanyStatus(db, runId, company.id, 'fetching', null, { pid, onlyFrom: 'not_started', warn, wait });
    if (!taken) continue; // no longer 'not_started': look for the next company

    try {
      await collectCompany({ db, company, range, client, progress, stats, wait, reportDeadRows });
      await setCompanyStatus(db, runId, company.id, 'finished', null, { pid, warn, wait });
    } catch (error) {
      if (!(error instanceof PermanentFetchError)) throw error;
      progress.error(`${company.name}: ${error.message}. Marked as failed; moving on.`);
      await setCompanyStatus(db, runId, company.id, 'failed', error.message, { pid, warn, wait });
    }
  }

  stopHeartbeat();
  await markRunCollected(db, runId, { pid, warn, wait });
  return stats;
}

// Builds the end-of-run summary text from the checklist (whole run) and this session's counters.
export function buildSummary(db, runId, stats) {
  const counts = db.prepare(`
    SELECT SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
           COUNT(*) AS total
    FROM JobRunCompany WHERE run_id = ?`).get(runId);
  const failures = db.prepare(`
    SELECT c.name, jrc.error FROM JobRunCompany jrc JOIN Company c ON c.id = jrc.company_id
    WHERE jrc.run_id = ? AND jrc.status = 'failed' ORDER BY jrc.rowid`).all(runId);

  const lines = [
    `Run ${runId} collected.`,
    `Companies: ${counts.finished ?? 0} finished, ${counts.failed ?? 0} failed (of ${counts.total}).`,
  ];
  for (const failure of failures) lines.push(`  failed: ${failure.name} — ${failure.error}`);
  lines.push(
    'This session:',
    `  articles added to the queue:        ${stats.inserted}`,
    `  skipped (already stored):           ${stats.duplicates}`,
    `  skipped (missing guid/link/title/date): ${stats.badItems}`,
    `  dropped (dated outside the 90 days): ${stats.outsideRange}`,
  );
  return lines.join('\n');
}
