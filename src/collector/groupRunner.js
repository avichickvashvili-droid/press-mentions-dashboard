// groupRunner.js — the GROUP RUNNER: runs the groups of a run one after another, each in its
// own process (D83, D84, D86, D90).
//
// Where it sits: inside the collector's main process (runCollect.js), after it has taken (or
// resumed, or reopened for --groups) the run and its lock. The runner fetches nothing itself: it
// starts one group process (runGroup.js, through groupProcess.js) at a time and waits for it to
// end. It never starts the next group before the current one has exited.
// Reads/writes: JobRunGroup (group statuses, crash counts, errors), and reads JobRunCompany and
// Company (progress, end log). Every write checks, in the same transaction, that this process
// still owns the run (D71); otherwise LostOwnershipError is thrown.
//
// Which group next: first an 'in_progress' group (it was cut off: a resume), then the 'pending'
// ones by number. 'complete' and 'failed' groups are never started (D90).
//
// When a group process ends:
//   exit 0              -> group 'complete', finished_at, crashes_in_a_row = 0; next group.
//   exit 3              -> it refused (the run belongs to another process, D71): the runner stops too.
//   exit 130 / 143      -> while the runner itself is stopping: a stop, nothing is recorded (D90).
//                          Otherwise the runner waits STOP_SIGNAL_GRACE_MS (a Ctrl+C can reach the
//                          group process a moment before the runner), then counts it as a crash.
//   anything else       -> a crash: last_error = the exit code or signal + its last error line.
//   no "still alive" message for GROUP_STUCK_AFTER_MS (5 min) -> stuck: killed, counted as a crash.
// Crash count (D84, D90): if at least one company of the group became 'finished' or 'failed'
// since this start, the count goes back to 0 and this crash adds 1 (so it is 1); otherwise the
// crash adds 1. Below GROUP_MAX_CRASHES_IN_A_ROW (5) the runner waits (GROUP_RESTART_WAITS_MS:
// 1 s, 2 s, 5 s, 10 s, 30 s, then 30 s) and starts the same group again, which continues from its
// unfinished companies. At 5 the group has failed a round: it is tried again, with a fresh count,
// GROUP_FAILED_RETRIES (3) more times (D97); after that it is 'failed' (finished_at set) and the
// next group starts. The runner never stops because groups fail (D97 replaces D95's stop rule).
// Poison company (D97): the company that was 'fetching' when the group process crashed or was
// killed as stuck gets a crash counted (JobRunCompany.group_crashes). At COMPANY_MAX_GROUP_CRASHES
// (3) it is 'failed' ("crashed the group process 3 times") and the group goes on with its next
// company. That 'failed' does not count as progress for the group's crash count.
// A crash of the runner itself is not counted against the group (D90): after the orchestrator
// restarts the runner, it simply starts the 'in_progress' group again.
//
// Stopping (Ctrl+C, SIGTERM or the orchestrator's stop message): the group process is asked to
// stop, given GROUP_STOP_TIMEOUT_MS (6 s), and force-killed only if it is still running (D70). The
// caller then writes the runner's emergency heartbeat, all inside the orchestrator's own 10 s
// stop limit (STOP_TIMEOUT_MS; review G6).
//
// System log (orchestrator.log, D93): the runner calls `event(text)` for the story of the run,
// e.g. "Starting group 1 of 10 (companies 1–26)", "Group 2 done (26/26 finished) → starting
// group 3 (companies 53–78)", "Group 3 crashed (exit 1: …), 2 in a row → restarting in 2 s",
// "Group 4 failed after 5 crashes in a row (last: …) → retry 1 of 3 in 30 s",
// "Group 4 failed after 5 crashes in a row, also on 3 retries (last: …), skipped",
// "Company Acme Bio failed: crashed the group process 3 times (last: …)". It also passes on the event
// lines its group process sends ({ type: 'event', text }).

import { config } from '../config.js';
import { inTransaction, nowIso } from '../db/database.js';
import { retryDbWrite, sleep as realSleep } from '../shared/retry.js';
import { describeExit, formatWait, isStopCode, restartWait } from '../supervisor/restartRules.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { LostOwnershipError, ownsRun } from './jobLock.js';
import { startGroupProcess } from './groupProcess.js';
import { companyFailedEvent } from './groupEvents.js';

// Thrown when a group process refused to work (exit 3) although this runner still owns the run
// (e.g. its group was not 'in_progress'). The runner stops with exit 3; nothing is broken.
export class GroupRefusedError extends Error {
  constructor(groupNumber) {
    super(`Group ${groupNumber}'s process refused to work (exit 3; see its message above). The collector stops.`);
    this.name = 'GroupRefusedError';
    this.groupNumber = groupNumber;
  }
}

// The real clock (tests pass a fake one they can move forward by hand).
const realClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

// Writes a list of group numbers with runs of numbers joined: [1, 3, 4, 5, 7] -> "1, 3–5, 7".
// An empty list gives "none".
export function formatGroupNumbers(numbers) {
  if (numbers.length === 0) return 'none';
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const number of [...sorted.slice(1), null]) {
    if (number !== null && number === previous + 1) {
      previous = number;
      continue;
    }
    parts.push(start === previous ? `${start}` : `${start}–${previous}`);
    start = number;
    previous = number;
  }
  return parts.join(', ');
}

// Where each group sits in the run's company list: Map groupNumber -> { first, last, size },
// with first/last = company positions in run order (1-based), e.g. group 2 -> companies 27–52.
export function groupPositions(db, runId) {
  const rows = db.prepare(`SELECT group_number, COUNT(*) AS size FROM JobRunCompany
                           WHERE run_id = ? GROUP BY group_number ORDER BY group_number`).all(runId);
  const positions = new Map();
  let before = 0;
  for (const row of rows) {
    positions.set(row.group_number, { first: before + 1, last: before + row.size, size: row.size });
    before += row.size;
  }
  return positions;
}

// How many companies of a group are done (finished or failed). Read-only.
export function countGroupDone(db, runId, groupNumber) {
  return db.prepare(`SELECT COUNT(*) AS n FROM JobRunCompany
                     WHERE run_id = ? AND group_number = ? AND status IN ('finished', 'failed')`).get(runId, groupNumber).n;
}

// The next group to run: an 'in_progress' one first (a resume), then the lowest 'pending' one.
// Returns { groupNumber, status } or undefined when no group is left. Read-only.
export function findNextGroup(db, runId) {
  const row = db.prepare(`SELECT group_number, status FROM JobRunGroup
                          WHERE run_id = ? AND status IN ('in_progress', 'pending')
                          ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END, group_number
                          LIMIT 1`).get(runId);
  return row ? { groupNumber: row.group_number, status: row.status } : undefined;
}

// The progress line for a group, e.g. "Group 2 of 10 (companies 27–52): 12/26 done".
export function describeGroupProgress(db, runId, groupNumber) {
  const positions = groupPositions(db, runId);
  const place = positions.get(groupNumber) ?? { first: 0, last: 0, size: 0 };
  const total = db.prepare('SELECT COUNT(*) AS n FROM JobRunGroup WHERE run_id = ?').get(runId).n;
  const done = countGroupDone(db, runId, groupNumber);
  return `Group ${groupNumber} of ${total} (companies ${place.first}–${place.last}): ${done}/${place.size} done`;
}

// Runs one write on a group row in one transaction, retried if the database is busy, and only
// while `pid` still owns the run (checked in the same transaction). Throws LostOwnershipError
// otherwise. `write()` returns what the caller needs.
async function writeOnGroup(db, runId, label, write, { pid, warn, wait }) {
  const outcome = await retryDbWrite(
    () => inTransaction(db, () => (ownsRun(db, runId, pid) ? { value: write() } : 'lost')),
    { label, warn, wait },
  );
  if (outcome === 'lost') throw new LostOwnershipError(runId);
  return outcome.value;
}

// Marks a group 'in_progress' before its process starts. started_at is set the first time only,
// so it keeps the time the group first started, also across restarts.
export function markGroupStarted(db, runId, groupNumber, { pid = process.pid, warn = console.warn, wait = realSleep } = {}) {
  return writeOnGroup(db, runId, `mark group ${groupNumber} as started`, () => db.prepare(`
    UPDATE JobRunGroup SET status = 'in_progress', started_at = COALESCE(started_at, ?)
    WHERE run_id = ? AND group_number = ?`).run(nowIso(), runId, groupNumber), { pid, warn, wait });
}

// Marks a group 'complete' (its process ended with 0): finished_at, crashes_in_a_row = 0.
export function markGroupComplete(db, runId, groupNumber, { pid = process.pid, warn = console.warn, wait = realSleep } = {}) {
  return writeOnGroup(db, runId, `mark group ${groupNumber} as complete`, () => db.prepare(`
    UPDATE JobRunGroup SET status = 'complete', finished_at = ?, crashes_in_a_row = 0
    WHERE run_id = ? AND group_number = ?`).run(nowIso(), runId, groupNumber), { pid, warn, wait });
}

// The error saved for a company that crashed its group process too often (D97), e.g.
// "crashed the group process 3 times (last: exit 1: Error: boom)".
export function companyCrashError(crashes, reason) {
  return `crashed the group process ${crashes} times (last: ${reason})`;
}

// Records a crash of a group process (D84, D90, D97), all in ONE transaction:
//   1. the company that was in progress (still 'fetching': the group process died while working
//      on it, or was killed as stuck) gets 1 more crash in group_crashes; at `maxCompanyCrashes`
//      (3) it becomes 'failed' ("crashed the group process 3 times"), so the next start of the
//      group goes on with the next company. This does NOT count as progress (`progressMade` is
//      measured by the caller before this write);
//   2. the group: saves the reason in last_error and counts the crash: after progress
//      (`progressMade`: a company finished or failed since this start) the count is 1, otherwise
//      it goes up by 1. At `maxCrashes` (5) the round is over: if the group still has retries
//      left (failed_rounds < `failedRetries`), failed_rounds goes up by 1, the count starts again
//      at 0 and the group stays 'in_progress' (it is tried again); otherwise the group becomes
//      'failed' with finished_at.
// Returns { crashesInARow, failed, retry, failedRounds, companiesFailed: [{ name, error }] }
// (retry = a round is over and the group is tried again; failedRounds = the rounds over so far).
export function recordGroupCrash(db, runId, groupNumber, {
  reason, progressMade, maxCrashes = config.GROUP_MAX_CRASHES_IN_A_ROW, maxCompanyCrashes = config.COMPANY_MAX_GROUP_CRASHES,
  failedRetries = config.GROUP_FAILED_RETRIES, pid = process.pid, warn = console.warn, wait = realSleep,
}) {
  return writeOnGroup(db, runId, `record the crash of group ${groupNumber}`, () => {
    const companiesFailed = [];
    const inProgress = db.prepare(`SELECT j.company_id, j.group_crashes, c.name FROM JobRunCompany j JOIN Company c ON c.id = j.company_id
                                   WHERE j.run_id = ? AND j.group_number = ? AND j.status = 'fetching'`).all(runId, groupNumber);
    for (const company of inProgress) {
      const crashes = company.group_crashes + 1;
      if (crashes >= maxCompanyCrashes) {
        const error = companyCrashError(crashes, reason);
        db.prepare("UPDATE JobRunCompany SET group_crashes = ?, status = 'failed', error = ? WHERE run_id = ? AND company_id = ?")
          .run(crashes, error, runId, company.company_id);
        companiesFailed.push({ name: company.name, error });
      } else {
        db.prepare('UPDATE JobRunCompany SET group_crashes = ? WHERE run_id = ? AND company_id = ?').run(crashes, runId, company.company_id);
      }
    }

    const row = db.prepare('SELECT crashes_in_a_row, failed_rounds FROM JobRunGroup WHERE run_id = ? AND group_number = ?').get(runId, groupNumber);
    const crashesInARow = progressMade ? 1 : row.crashes_in_a_row + 1;
    const roundOver = crashesInARow >= maxCrashes;
    const failed = roundOver && row.failed_rounds >= failedRetries;
    const retry = roundOver && !failed;
    const failedRounds = row.failed_rounds + (roundOver ? 1 : 0);
    db.prepare(`UPDATE JobRunGroup SET crashes_in_a_row = ?, failed_rounds = ?, last_error = ?,
                status = CASE WHEN ? THEN 'failed' ELSE status END,
                finished_at = CASE WHEN ? THEN ? ELSE finished_at END
                WHERE run_id = ? AND group_number = ?`)
      .run(retry ? 0 : crashesInARow, failedRounds, String(reason), failed ? 1 : 0, failed ? 1 : 0, nowIso(), runId, groupNumber);
    return { crashesInARow, failed, retry, failedRounds, companiesFailed };
  }, { pid, warn, wait });
}

// The system-log line at the end of the collection (D93), e.g.
// "Collection done: groups complete 1–3, 5–10 · failed 4; companies 255 finished, 3 failed → classifier finishing"
export function buildCollectionDoneEvent(db, runId) {
  const groups = db.prepare('SELECT group_number, status FROM JobRunGroup WHERE run_id = ? ORDER BY group_number').all(runId);
  const numbersWith = (status) => groups.filter((group) => group.status === status).map((group) => group.group_number);
  const counts = countCompanyOutcomes(db, runId);
  return `Collection done: groups complete ${formatGroupNumbers(numbersWith('complete'))} · failed ${formatGroupNumbers(numbersWith('failed'))}; ` +
    `companies ${counts.finished} finished, ${counts.failed} failed → classifier finishing`;
}

// How many companies of a run (or of one of its groups) are finished / failed, and how many there
// are in total. Read-only.
function countCompanyOutcomes(db, runId, groupNumber = null) {
  const row = db.prepare(`SELECT SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished,
                                 SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                                 COUNT(*) AS total
                          FROM JobRunCompany WHERE run_id = ? AND (? IS NULL OR group_number = ?)`).get(runId, groupNumber, groupNumber);
  return { finished: row.finished ?? 0, failed: row.failed ?? 0, total: row.total };
}

// The system-log text for a group that ended well, e.g. "Group 2 done (26/26 finished)" or
// "Group 2 done (25/26 finished, 1 failed)".
function groupDoneText(db, runId, groupNumber) {
  const counts = countCompanyOutcomes(db, runId, groupNumber);
  return `Group ${groupNumber} done (${counts.finished}/${counts.total} finished${counts.failed ? `, ${counts.failed} failed` : ''})`;
}

// Builds the end log of the collection (D86), e.g.
//   Run 5 collected.
//   Companies: 250 finished, 2 failed (of 258).
//   Groups: complete 1, 3–10 · failed 2
//     group 2: 14 of 26 companies not collected; last error: exit 1: Error: boom
//   Companies failed: [Acme Bio, Foo Labs]
//     Acme Bio — Google rejected the search (HTTP 400), 3 tries 1 min apart
export function buildEndLog(db, runId) {
  const groups = db.prepare('SELECT group_number, status, last_error FROM JobRunGroup WHERE run_id = ? ORDER BY group_number').all(runId);
  const complete = groups.filter((group) => group.status === 'complete').map((group) => group.group_number);
  const failedGroups = groups.filter((group) => group.status === 'failed');
  const counts = db.prepare(`SELECT SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished,
                                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                                    COUNT(*) AS total
                             FROM JobRunCompany WHERE run_id = ?`).get(runId);
  const failedCompanies = db.prepare(`SELECT c.name, j.error FROM JobRunCompany j JOIN Company c ON c.id = j.company_id
                                      WHERE j.run_id = ? AND j.status = 'failed' ORDER BY j.rowid`).all(runId);

  const lines = [
    `Run ${runId} collected.`,
    `Companies: ${counts.finished ?? 0} finished, ${counts.failed ?? 0} failed (of ${counts.total}).`,
    `Groups: complete ${formatGroupNumbers(complete)} · failed ${formatGroupNumbers(failedGroups.map((group) => group.group_number))}`,
  ];
  for (const group of failedGroups) {
    const size = db.prepare('SELECT COUNT(*) AS n FROM JobRunCompany WHERE run_id = ? AND group_number = ?').get(runId, group.group_number).n;
    const notCollected = size - countGroupDone(db, runId, group.group_number);
    lines.push(`  group ${group.group_number}: ${notCollected} of ${size} companies not collected; last error: ${group.last_error ?? 'unknown'}`);
  }
  lines.push(`Companies failed: ${failedCompanies.length ? `[${failedCompanies.map((company) => company.name).join(', ')}]` : 'none'}`);
  for (const company of failedCompanies) lines.push(`  ${company.name} — ${company.error}`);
  return lines.join('\n');
}

// Creates the group runner for a run this process owns. Everything it touches from outside can
// be replaced in tests: `startGroup` (default: a real group process), `clock`, `sleep` (for busy
// database retries), `settings` (config values). `event(text)` receives the system-log lines
// (see the top; default: nowhere).
// Returns { run(), stop() }:
//   run()  -> runs groups until none is left and resolves 'done', or resolves 'stopped' after
//             stop(); throws LostOwnershipError (another process owns the run) or
//             GroupRefusedError (a group process refused although we own the run).
//   stop() -> asks the current group process to stop (force-kill after GROUP_STOP_TIMEOUT_MS) and
//             resolves once it has ended; no new group starts after it.
export function createGroupRunner({
  db,
  runId,
  pid = process.pid,
  log = console.log,
  warn = console.warn,
  event = () => {},
  startGroup = startGroupProcess,
  clock = realClock,
  sleep = realSleep,
  settings = config,
}) {
  let stopping = false;
  let current = null;       // { handle, ended: Promise } of the running group process
  let wakeUp = null;        // ends a restart wait early when stop() is called

  // Waits `ms` (the restart wait), or less if stop() is called meanwhile. Returns at once if
  // stop() was already called (review G7).
  function waitUnlessStopped(ms) {
    if (stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = clock.setTimeout(() => { wakeUp = null; resolve(); }, ms);
      wakeUp = () => { clock.clearTimeout(timer); wakeUp = null; resolve(); };
    });
  }

  // Starts one group process and waits for it to end. Kills it if it sends no "still alive"
  // message for GROUP_STUCK_AFTER_MS. Resolves { result, stuck, lastErrorLine }.
  function runGroupProcess(groupNumber) {
    let handle;
    try {
      handle = startGroup({ runId, groupNumber, runnerPid: pid });
    } catch (error) {
      return Promise.resolve({ result: { code: null, signal: null, error }, stuck: false, lastErrorLine: null });
    }
    log(`Group ${groupNumber}: process ${handle.pid ?? '?'} started.`);
    let lastSignalAt = clock.now();
    let stuck = false;
    let stuckTimer = null;

    // Checks, when the time is up, whether the process is stuck; if not, checks again later.
    const scheduleStuckCheck = () => {
      const due = lastSignalAt + settings.GROUP_STUCK_AFTER_MS - clock.now();
      stuckTimer = clock.setTimeout(() => {
        if (clock.now() - lastSignalAt >= settings.GROUP_STUCK_AFTER_MS) {
          stuck = true;
          warn(`Group ${groupNumber}: no "still alive" signal for ${formatWait(settings.GROUP_STUCK_AFTER_MS)}; the process is stuck and is killed.`);
          handle.forceKill();
        } else {
          scheduleStuckCheck();
        }
      }, Math.max(due, 0));
    };

    const ended = new Promise((resolve) => {
      handle.onMessage?.((message) => {
        if (message && message.type === 'alive') lastSignalAt = clock.now();
        if (message && message.type === 'event' && typeof message.text === 'string') sendEvent(message.text);
      });
      handle.onExit((result) => {
        if (stuckTimer !== null) clock.clearTimeout(stuckTimer);
        resolve({ result, stuck, lastErrorLine: handle.lastErrorLine?.() ?? null });
      });
    });
    scheduleStuckCheck();
    current = { handle, ended };
    return ended.finally(() => { current = null; });
  }

  // Decides what a group process end means: 'finished' | 'refused' | 'stopped' | 'crash'
  // (with a reason for a crash). See the table at the top.
  async function judgeEnd({ result, stuck, lastErrorLine }) {
    if (stopping) return { kind: 'stopped' };
    if (stuck) return { kind: 'crash', reason: `stuck: no "still alive" signal for ${formatWait(settings.GROUP_STUCK_AFTER_MS)}, killed` };
    if (result.error) return { kind: 'crash', reason: describeExit(result) };
    if (result.code === EXIT_CODES.FINISHED) return { kind: 'finished' };
    if (result.code === EXIT_CODES.REFUSED) return { kind: 'refused' };
    if (isStopCode(result.code)) {
      // A Ctrl+C may reach the group process a moment before the runner: wait briefly.
      await new Promise((resolve) => clock.setTimeout(resolve, settings.STOP_SIGNAL_GRACE_MS));
      if (stopping) return { kind: 'stopped' };
    }
    return { kind: 'crash', reason: `${describeExit(result)}${lastErrorLine ? `: ${lastErrorLine}` : ''}` };
  }

  // Hands one line to `event`; a failing event sender must never stop the runner.
  function sendEvent(text) {
    try {
      event(text);
    } catch {
      // a lost system-log line is not worth stopping the collection for
    }
  }

  // Runs groups until none is left (see the top of this file).
  async function run() {
    const writeOptions = { pid, warn, wait: sleep };
    let endedText = null;       // "Group 2 done (…)", sent together with the next group's start
    let lastStartedGroup = null; // a restart of the same group is not a new "starting" line
    // Sends a line still waiting for the next group (at the end, or when stopping).
    const flushEnded = () => {
      if (endedText !== null) sendEvent(endedText);
      endedText = null;
    };
    for (;;) {
      if (stopping) {
        flushEnded();
        return 'stopped';
      }
      const next = findNextGroup(db, runId);
      if (!next) {
        flushEnded();
        return 'done';
      }
      const { groupNumber } = next;

      await markGroupStarted(db, runId, groupNumber, writeOptions);
      // stop() may have been called while we waited for that write: then no group process is
      // started at all, because nobody would ever ask it to stop (review G7).
      if (stopping) {
        flushEnded();
        return 'stopped';
      }
      log(`${describeGroupProgress(db, runId, groupNumber)} · starting its process.`);
      if (groupNumber !== lastStartedGroup) {
        const place = groupPositions(db, runId).get(groupNumber) ?? { first: 0, last: 0 };
        const total = db.prepare('SELECT COUNT(*) AS n FROM JobRunGroup WHERE run_id = ?').get(runId).n;
        const starting = `group ${groupNumber} of ${total} (companies ${place.first}–${place.last})`;
        sendEvent(endedText !== null ? `${endedText} → starting ${starting}` : `Starting ${starting}`);
        endedText = null;
        lastStartedGroup = groupNumber;
      }
      const doneBefore = countGroupDone(db, runId, groupNumber);
      const end = await judgeEnd(await runGroupProcess(groupNumber));

      if (end.kind === 'stopped') return 'stopped';
      if (end.kind === 'refused') {
        if (!ownsRun(db, runId, pid)) throw new LostOwnershipError(runId);
        throw new GroupRefusedError(groupNumber);
      }
      if (end.kind === 'finished') {
        await markGroupComplete(db, runId, groupNumber, writeOptions);
        log(`${describeGroupProgress(db, runId, groupNumber)} · group complete.`);
        endedText = groupDoneText(db, runId, groupNumber);
        continue;
      }

      // Measured BEFORE the crash is recorded: a company marked 'failed' by that write (it crashed
      // the group process too often, D97) is not progress.
      const progressMade = countGroupDone(db, runId, groupNumber) > doneBefore;
      const { crashesInARow, failed, retry, failedRounds, companiesFailed } = await recordGroupCrash(db, runId, groupNumber, {
        reason: end.reason, progressMade, maxCrashes: settings.GROUP_MAX_CRASHES_IN_A_ROW,
        maxCompanyCrashes: settings.COMPANY_MAX_GROUP_CRASHES, failedRetries: settings.GROUP_FAILED_RETRIES, ...writeOptions,
      });
      for (const company of companiesFailed) {
        warn(`${company.name}: ${company.error}. Marked as failed; group ${groupNumber} goes on with its next company.`);
        sendEvent(companyFailedEvent(company.name, company.error));
      }
      if (failed) {
        const retries = failedRounds - 1;
        const retriesText = retries > 0 ? `, also on ${retries} ${retries === 1 ? 'retry' : 'retries'}` : '';
        warn(`Group ${groupNumber} FAILED: its process crashed ${crashesInARow} times in a row with no progress${retriesText} ` +
          `(last: ${end.reason}). It is skipped; re-run it later with: npm start -- --groups ${groupNumber}`);
        endedText = `Group ${groupNumber} failed after ${crashesInARow} crashes in a row${retriesText} (last: ${end.reason}), skipped`;
        continue;
      }
      const waitMs = restartWait(crashesInARow - 1, settings.GROUP_RESTART_WAITS_MS);
      if (retry) {
        // A round of crashes is over but the group has retries left (D97): it starts again with a
        // fresh crash count, from its unfinished companies.
        const retryText = `retry ${failedRounds} of ${settings.GROUP_FAILED_RETRIES}`;
        sendEvent(`Group ${groupNumber} failed after ${crashesInARow} crashes in a row (last: ${end.reason}) → ${retryText} in ${formatWait(waitMs)}`);
        warn(`Group ${groupNumber}'s process crashed ${crashesInARow} times in a row with no progress (last: ${end.reason}). ` +
          `Trying the group again (${retryText}) in ${formatWait(waitMs)}; it continues from its unfinished companies.`);
        await waitUnlessStopped(waitMs);
        continue;
      }
      sendEvent(`Group ${groupNumber} crashed (${end.reason}), ${crashesInARow} in a row → restarting in ${formatWait(waitMs)}`);
      warn(`Group ${groupNumber}'s process crashed (${end.reason}); ${crashesInARow} crash(es) in a row` +
        `${progressMade ? ' (it made progress first)' : ''}. Starting it again in ${formatWait(waitMs)}; it continues from its unfinished companies.`);
      await waitUnlessStopped(waitMs);
      // (a stop during the wait, or during the crash write before it, is seen at the top of the loop)
    }
  }

  // Stops the runner: no new group starts, the current group process is asked to stop and, if it
  // is still running after GROUP_STOP_TIMEOUT_MS, force-killed. Resolves once it has ended.
  async function stop() {
    stopping = true;
    if (wakeUp) wakeUp();
    const running = current;
    if (!running) return;
    if (!running.handle.requestStop()) warn('The group process could not be asked to stop (no message channel); waiting for it to end.');
    let timer = null;
    const timedOut = await Promise.race([
      running.ended.then(() => false),
      new Promise((resolve) => { timer = clock.setTimeout(() => resolve(true), settings.GROUP_STOP_TIMEOUT_MS); }),
    ]);
    clock.clearTimeout(timer);
    if (timedOut) {
      warn(`The group process is still running after ${formatWait(settings.GROUP_STOP_TIMEOUT_MS)}; it is force-killed.`);
      running.handle.forceKill();
      await running.ended;
    }
  }

  return { run, stop };
}
