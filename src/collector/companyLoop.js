// companyLoop.js — the heart of the collector: goes through the run's companies one by one.
//
// Where it sits: started by `npm run collect` (runCollect.js) once it holds the lock.
// Reads:  JobRunCompany (the run's checklist), Company (each company's query_param),
//         JobRun (the run's start date, which fixes the 90 days).
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
// Every database write is one transaction; a failed write is logged and retried (never a company failure).

import { config } from '../config.js';
import { inTransaction, nowIso } from '../db/database.js';
import { buildWindowQuery, runRange, shouldSplit, splitWindow, formatDay } from './dateWindows.js';
import { sortItems } from './itemRules.js';
import { countQueue, createDeadRowReporter, insertChunk, waitForQueueSpace } from './bufferWriter.js';
import { PermanentFetchError } from './googleNews.js';
import { retryDbWrite, sleep as realSleep } from './waiting.js';

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

// Sets one company's checklist status (and error text) in one transaction, retried if the DB is busy.
async function setCompanyStatus(db, runId, companyId, status, error, { warn, wait }) {
  await retryDbWrite(
    () => inTransaction(db, () => {
      db.prepare('UPDATE JobRunCompany SET status = ?, error = ? WHERE run_id = ? AND company_id = ?')
        .run(status, error, runId, companyId);
    }),
    { label: `mark ${companyId} as ${status}`, warn, wait },
  );
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
      warn(`${company.name}: skipped an article with ${reason} (title: "${rawItem.title || '?'}", guid: "${rawItem.guid || '?'}").`);
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
          note: `queue full, waiting until it is down to ${formatThousands(config.QUEUE_RESUME_AT)}`,
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

// Formats a number with thousands separators for messages.
function formatThousands(count) {
  return Number(count).toLocaleString('en-US');
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
// over to the classifier (one transaction, retried if busy).
async function markRunCollected(db, runId, { warn, wait }) {
  await retryDbWrite(
    () => inTransaction(db, () => {
      db.prepare("UPDATE JobRun SET status = 'collected', finished_at = ?, owner_pid = NULL WHERE id = ? AND status = 'running'")
        .run(nowIso(), runId);
    }),
    { label: `mark run ${runId} as collected`, warn, wait },
  );
}

// Runs the whole company loop of one run until no 'not_started' company is left, then marks
// the run 'collected'. Unexpected errors (bugs) are not caught here: they reach the top-level
// handler, which writes the emergency heartbeat, so the run resumes on the next start.
// `stopHeartbeat` is called just before the run is marked 'collected'.
export async function runCompanyLoop({
  db, runId, client, progress, stats = createSessionStats(), wait = realSleep, stopHeartbeat = () => {},
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
    await setCompanyStatus(db, runId, company.id, 'fetching', null, { warn, wait });

    try {
      await collectCompany({ db, company, range, client, progress, stats, wait, reportDeadRows });
      await setCompanyStatus(db, runId, company.id, 'finished', null, { warn, wait });
    } catch (error) {
      if (!(error instanceof PermanentFetchError)) throw error;
      progress.error(`${company.name}: ${error.message}. Marked as failed; moving on.`);
      await setCompanyStatus(db, runId, company.id, 'failed', error.message, { warn, wait });
    }
  }

  stopHeartbeat();
  await markRunCollected(db, runId, { warn, wait });
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
