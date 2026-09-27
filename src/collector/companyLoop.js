// companyLoop.js — the heart of the collector: goes through one group's companies one by one.
//
// Where it sits: runGroupLoop is the work of a group process (runGroup.js, D83): it collects the
// companies of ONE group. A group process doesn't hold the lock itself: the group runner does, so
// every ownership check uses the runner's process id. finishCollection is called by the group
// runner (groupRunner.js) when no group is left.
// Reads:  JobRunCompany (the run's checklist), Company (each company's query_param),
//         JobRun (the run's start date, which fixes the 90 days, and its owner).
// Writes: JobRunCompany statuses, BufferQueue (through bufferWriter), and at the end of the
//         collection (finishCollection) JobRun.status = 'collected' + finished_at.
//
// For each company (the next 'not_started' one, lowest rowid first = section order, then file order):
//   'not_started' -> 'fetching' -> search every date window -> 'finished'
//   or, on a permanent Google problem, -> 'failed' with the reason (D40).
// Date windows: start with the whole 90 days. A window that returns 95+ items is stored and
// then split in two halves, oldest half first, until windows are under 95 items or 1 day (D57).
// finishCollection: the heartbeat is stopped and the run becomes 'collected' with owner_pid = NULL
// (D52, D89): the collector's work is over and the classifier takes the run from there.
// runGroupLoop: first puts any 'fetching' company of the group back to 'not_started' (it was cut
// off by a crash and is redone), then collects the group's companies and simply returns when none
// is left. It never changes the run's or the group's status: that is the group runner's job.
//
// Ownership (D39, D71): every write on the run (a company's status, marking the run 'collected')
// first checks, in the same transaction, that this process still owns the run. If another
// process has taken the run over, nothing is written and LostOwnershipError is thrown: the
// group process exits with 3, and so does the runner. The move to 'fetching' is also only done
// while the company is still 'not_started', so two collectors can never take the same company.
//
// Every database write is one transaction. A write that fails because the database is busy is
// logged and retried; any other database error is thrown on (D76, src/shared/retry.js).
//
// Log lines (D92, D93): each finished company gets one line in the group's log file only
// ("Company 5/26 Harvey: finished · 3 windows · 42 new, 7 duplicates · 1 min 12 s"); the
// terminal does not show it. The system-log events (`events`: queue full / has room again, a
// company failed) are sent by the caller (runGroup.js) to the orchestrator.

import { config } from '../config.js';
import { inTransaction, nowIso } from '../db/database.js';
import { retryDbWrite, sleep as realSleep } from '../shared/retry.js';
import { cleanForLog, describeDuration, formatCount } from '../shared/text.js';
import { buildWindowQuery, runRange, shouldSplit, splitWindow, formatDay } from './dateWindows.js';
import { sortItems } from './itemRules.js';
import { countQueue, createDeadRowReporter, insertChunk, waitForQueueSpace } from './bufferWriter.js';
import { PermanentFetchError } from './googleNews.js';
import { LostOwnershipError, ownsRun } from './jobLock.js';

// A fresh set of counters for this session (shown in the final summary).
export function createSessionStats() {
  return { inserted: 0, duplicates: 0, badItems: 0, outsideRange: 0 };
}

// The next company of one group to collect (lowest rowid among its 'not_started' ones), or undefined.
function findNextCompany(db, runId, groupNumber) {
  return db.prepare(`
    SELECT c.id, c.name, c.query_param
    FROM JobRunCompany jrc JOIN Company c ON c.id = jrc.company_id
    WHERE jrc.run_id = ? AND jrc.group_number = ? AND jrc.status = 'not_started'
    ORDER BY jrc.rowid
    LIMIT 1`).get(runId, groupNumber);
}

// How many companies one group has in total, and how many are already done (finished or failed).
function countCompanies(db, runId, groupNumber) {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status IN ('finished', 'failed') THEN 1 ELSE 0 END) AS done
    FROM JobRunCompany WHERE run_id = ? AND group_number = ?`).get(runId, groupNumber);
  return { total: row.total, done: row.done ?? 0 };
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
// `onAlive('waiting')` is called on every queue check while the queue is full (every 5 s, D90).
// `onQueueFull(queueCount)` is called on every check while the queue is full, and
// `onQueueResumed(queueCount)` once when such a wait is over (for the system log, D93).
// Returns { windows } = how many date windows were searched.
export async function collectCompany({
  db, company, range, client, progress, stats, wait = realSleep, reportDeadRows = createDeadRowReporter((text) => progress.warn(text)),
  onAlive = () => {}, onQueueFull = () => {}, onQueueResumed = () => {},
}) {
  const warn = (text) => progress.warn(text);
  const pending = [{ start: range.start, end: range.end }]; // a stack: last pushed = next searched
  let windowNumber = 0;

  while (pending.length > 0) {
    const window = pending.pop();
    windowNumber += 1;
    progress.update({ phase: 'fetching', window: windowNumber, note: null });

    const query = buildWindowQuery(window, company.query_param);
    const { items: rawItems, itemCount } = await client.search(query, { companyName: company.name });
    progress.update({ note: null });

    const { good, bad, outside } = sortItems(rawItems, range);
    for (const { rawItem, reason } of bad) {
      // Title and guid come from the internet: cleaned and shortened for the log only.
      warn(`${company.name}: skipped an article with ${reason} (title: "${cleanForLog(rawItem.title || '?')}", guid: "${cleanForLog(rawItem.guid || '?')}").`);
    }
    stats.badItems += bad.length;
    stats.outsideRange += outside;

    if (good.length > 0) {
      let waited = false;
      const queueCountAfterWait = await waitForQueueSpace(db, good.length, {
        sleep: wait,
        warn,
        onDeadRows: reportDeadRows,
        onWaiting: (queueCount) => {
          waited = true;
          onQueueFull(queueCount);
          onAlive('waiting');
          progress.update({
            phase: 'waiting',
            ...(queueCount === null ? {} : { queueCount }),
            note: `queue full, waiting until it is down to ${formatCount(config.QUEUE_RESUME_AT)}`,
          });
        },
      });
      if (waited) onQueueResumed(queueCountAfterWait);
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
  return { windows: windowNumber };
}

// Shows the current queue size on the progress line (skipped quietly if the DB can't be read now).
function updateQueueCount(db, progress) {
  try {
    progress.update({ queueCount: countQueue(db) });
  } catch {
    // Only the display is affected; the real queue check happens before every insert.
  }
}

// The end of the collection, called by the group runner once no group is left: stops the
// heartbeat, then marks the run 'collected' with its finish time and owner_pid = NULL, which
// hands the run over to the classifier (D52, D63; one transaction, retried if busy). Only while
// `pid` still owns the run; otherwise LostOwnershipError is thrown and the run is left to its
// new owner (D71).
export async function finishCollection(db, runId, { pid = process.pid, stopHeartbeat = () => {}, warn = console.warn, wait = realSleep } = {}) {
  stopHeartbeat();
  const changed = await retryDbWrite(
    () => inTransaction(db, () => db
      .prepare("UPDATE JobRun SET status = 'collected', finished_at = ?, owner_pid = NULL WHERE id = ? AND status = 'running' AND owner_pid = ?")
      .run(nowIso(), runId, pid).changes === 1),
    { label: `mark run ${runId} as collected`, warn, wait },
  );
  if (!changed) throw new LostOwnershipError(runId);
}

// Collects the companies of one group one by one until no 'not_started' one is left.
// `pid` = the process id that must own the run for every write (the group runner's).
// `onAlive(state)` is told 'fetching' / 'waiting' whenever the loop works (D90).
// Throws LostOwnershipError when the run is no longer owned by `pid` (D71); other unexpected
// errors (bugs) are thrown on as well. A permanent Google error only fails that company.
async function collectCompanies({ db, runId, groupNumber, client, progress, stats, wait, pid, onAlive, events, now }) {
  const warn = (text) => progress.warn(text);
  const reportDeadRows = createDeadRowReporter(warn); // one reporter for the whole loop: no repeated warnings
  const run = db.prepare('SELECT started_at FROM JobRun WHERE id = ?').get(runId);
  const range = runRange(run.started_at);
  progress.info(`Run ${runId}, group ${groupNumber}: collecting articles from ${formatDay(range.start)} to ${formatDay(range.end)} (UTC).`);

  for (;;) {
    const company = findNextCompany(db, runId, groupNumber);
    if (!company) break;

    const { total, done } = countCompanies(db, runId, groupNumber);
    progress.update({ companyNumber: done + 1, companyTotal: total, companyName: company.name, phase: 'starting', window: null, note: null });
    const taken = await setCompanyStatus(db, runId, company.id, 'fetching', null, { pid, onlyFrom: 'not_started', warn, wait });
    if (!taken) continue; // no longer 'not_started': look for the next company

    const startedAt = now();
    const before = { inserted: stats.inserted, duplicates: stats.duplicates };
    try {
      const { windows } = await collectCompany({
        db, company, range, client, progress, stats, wait, reportDeadRows, onAlive,
        onQueueFull: (count) => events.queueFull?.(count),
        onQueueResumed: (count) => events.queueResumed?.(count),
      });
      await setCompanyStatus(db, runId, company.id, 'finished', null, { pid, warn, wait });
      progress.record?.(`Company ${done + 1}/${total} ${cleanForLog(company.name)}: finished · ${windows} ${windows === 1 ? 'window' : 'windows'} · ` +
        `${formatCount(stats.inserted - before.inserted)} new, ${formatCount(stats.duplicates - before.duplicates)} duplicates · ` +
        `${describeDuration(now() - startedAt)}`);
    } catch (error) {
      if (!(error instanceof PermanentFetchError)) throw error;
      progress.error(`${company.name}: ${error.message}. Marked as failed; moving on.`);
      await setCompanyStatus(db, runId, company.id, 'failed', error.message, { pid, warn, wait });
      events.companyFailed?.(company.name, error.message);
    }
  }
}

// Puts every 'fetching' company of one group back to 'not_started' (a group process that died
// left it half done; it is searched again and duplicates are skipped by guid). One transaction,
// retried if the database is busy, and only while `runnerPid` still owns the run; otherwise
// LostOwnershipError is thrown and nothing is changed. Returns how many companies were reset.
export async function resetFetchingInGroup(db, runId, groupNumber, { runnerPid, warn, wait = realSleep }) {
  const outcome = await retryDbWrite(
    () => inTransaction(db, () => {
      if (!ownsRun(db, runId, runnerPid)) return 'lost';
      return db.prepare("UPDATE JobRunCompany SET status = 'not_started' WHERE run_id = ? AND group_number = ? AND status = 'fetching'")
        .run(runId, groupNumber).changes;
    }),
    { label: `reset the unfinished company of group ${groupNumber}`, warn, wait },
  );
  if (outcome === 'lost') throw new LostOwnershipError(runId);
  return outcome;
}

// The work of one group process (D83): puts the group's 'fetching' company back, then collects
// the group's 'not_started' companies one by one and returns when none is left. It changes
// neither the run row nor the group row (the group runner does that). Every ownership check uses
// `runnerPid`, the group runner's process id, because the runner holds the lock, not the group
// process. `onAlive(state)` receives the "still alive" states (D90). Unexpected errors (bugs) are
// not caught here. Throws LostOwnershipError when the runner no longer owns the run (D71).
// `events` (optional, for the system log, D93): { queueFull(count), queueResumed(count),
// companyFailed(name, reason) }. `now` = the clock for the "company finished" line's time.
// Returns { stats, reset } (reset = how many 'fetching' companies were put back at the start).
export async function runGroupLoop({
  db, runId, groupNumber, runnerPid, client, progress, stats = createSessionStats(), wait = realSleep, onAlive = () => {},
  events = {}, now = Date.now,
}) {
  const warn = (text) => progress.warn(text);
  const reset = await resetFetchingInGroup(db, runId, groupNumber, { runnerPid, warn, wait });
  if (reset > 0) progress.info(`Group ${groupNumber}: ${reset} company was cut off last time and is searched again.`);
  await collectCompanies({ db, runId, groupNumber, client, progress, stats, wait, pid: runnerPid, onAlive, events, now });
  return { stats, reset };
}

// Builds the summary a group process prints when its group is done: the group's companies
// (finished / failed, with the reasons) and this process's article counters.
export function buildGroupSummary(db, runId, groupNumber, stats) {
  const counts = db.prepare(`
    SELECT SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
           COUNT(*) AS total
    FROM JobRunCompany WHERE run_id = ? AND group_number = ?`).get(runId, groupNumber);
  const failures = db.prepare(`
    SELECT c.name, jrc.error FROM JobRunCompany jrc JOIN Company c ON c.id = jrc.company_id
    WHERE jrc.run_id = ? AND jrc.group_number = ? AND jrc.status = 'failed' ORDER BY jrc.rowid`).all(runId, groupNumber);

  const lines = [`Group ${groupNumber} done: ${counts.finished ?? 0} finished, ${counts.failed ?? 0} failed (of ${counts.total}).`];
  for (const failure of failures) lines.push(`  failed: ${failure.name} — ${failure.error}`);
  lines.push(
    'This group process:',
    `  articles added to the queue:        ${stats.inserted}`,
    `  skipped (already stored):           ${stats.duplicates}`,
    `  skipped (missing guid/link/title/date): ${stats.badItems}`,
    `  dropped (dated outside the 90 days): ${stats.outsideRange}`,
  );
  return lines.join('\n');
}
