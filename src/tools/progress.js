// progress.js — `npm run progress`: a short, read-only dashboard of the latest run in the terminal.
//
// Where it sits: a helper command for the owner, next to the services. It is never started by the
// orchestrator and changes nothing: it opens the database READ-ONLY, runs the main queries of
// queries/progress.sql and prints them as small tables: the run line, the groups, the group that
// is running now (with its companies), failed companies and groups, the queue and the mentions.
// With `--all` it also lists every company of the run.
// Reads: the SQLite file at config.DB_PATH (tables JobRun, JobRunGroup, JobRunCompany, Company,
// BufferQueue, Mention). Writes: the terminal only.
//
// Safe while a run is going: the database is in WAL mode, so a reader never blocks the
// collector or the classifier.
//
// Failures are handled one by one: no database file yet → a friendly note and exit 0; a table
// that doesn't exist yet → that section says so and the rest is still printed; any other error in
// one section → that section shows the error, the rest is still printed, and the exit code is 1.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { cleanForLog, describeError, formatCount } from '../shared/text.js';

// Longest text shown in one table cell (errors can be long); longer text is cut with "…".
const MAX_CELL_CHARS = 60;

// The friendly message when there is no database file yet.
export const NO_DATABASE_MESSAGE = 'No database yet — start a run with `npm start`.';

// ------------------------------------------------------------------------------------------------
// Opening the database
// ------------------------------------------------------------------------------------------------

// Opens the database file READ-ONLY. Returns null when the file doesn't exist (nothing has run
// yet), so no empty database is ever created by this command.
export function openReadOnly(dbPath = config.DB_PATH) {
  if (!fs.existsSync(dbPath)) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  // If a service is writing at this moment, wait a little instead of failing at once.
  db.exec(`PRAGMA busy_timeout = ${Number(config.DB_BUSY_TIMEOUT_MS)};`);
  return db;
}

// The names of the tables that exist in the database, e.g. Set { 'Company', 'JobRun', ... }.
// Used to say "table X doesn't exist yet" instead of failing on a query.
export function listTables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
}

// ------------------------------------------------------------------------------------------------
// Queries (the same questions as queries/progress.sql)
// ------------------------------------------------------------------------------------------------

// The latest run (highest id), or null when no run has started yet.
export function getLatestRun(db) {
  return db.prepare(`SELECT id, status, started_at, finished_at, last_heartbeat, owner_pid, last_error,
      classified_count, relevant_count, irrelevant_count, failed_count
    FROM JobRun ORDER BY id DESC LIMIT 1`).get() ?? null;
}

// Every group of a run with its company counts: done (finished), failed, left (not_started +
// fetching) and total. One object per group, in group order.
export function getGroups(db, runId) {
  return db.prepare(`SELECT g.group_number, g.status, g.crashes_in_a_row, g.started_at, g.finished_at,
      g.exported_at, g.last_error,
      COALESCE(SUM(j.status = 'finished'), 0)                   AS done,
      COALESCE(SUM(j.status = 'failed'), 0)                     AS failed,
      COALESCE(SUM(j.status IN ('not_started', 'fetching')), 0) AS left,
      COUNT(j.company_id)                                       AS total
    FROM JobRunGroup g
    LEFT JOIN JobRunCompany j ON j.run_id = g.run_id AND j.group_number = g.group_number
    WHERE g.run_id = ?
    GROUP BY g.group_number
    ORDER BY g.group_number`).all(runId).map((row) => ({ ...row }));
}

// The companies of one group of a run, in list order (the order they were added to the run).
export function getGroupCompanies(db, runId, groupNumber) {
  return db.prepare(`SELECT c.name, j.status, j.error
    FROM JobRunCompany j JOIN Company c ON c.id = j.company_id
    WHERE j.run_id = ? AND j.group_number = ?
    ORDER BY j.rowid`).all(runId, groupNumber).map((row) => ({ ...row }));
}

// The group that is running now ('in_progress'), with its counts, its first and last company
// (its range in the list) and its companies. Null when no group is running.
export function getCurrentGroup(db, runId) {
  const current = getGroups(db, runId).find((group) => group.status === 'in_progress');
  if (!current) return null;
  const companies = getGroupCompanies(db, runId, current.group_number);
  return {
    ...current,
    firstCompany: companies[0]?.name ?? null,
    lastCompany: companies.at(-1)?.name ?? null,
    companies,
  };
}

// How many companies of a run are finished / failed / fetching / not_started, and the total.
export function getCompanyCounts(db, runId) {
  const row = db.prepare(`SELECT
      COALESCE(SUM(status = 'finished'), 0)    AS finished,
      COALESCE(SUM(status = 'failed'), 0)      AS failed,
      COALESCE(SUM(status = 'fetching'), 0)    AS fetching,
      COALESCE(SUM(status = 'not_started'), 0) AS not_started,
      COUNT(*)                                 AS total
    FROM JobRunCompany WHERE run_id = ?`).get(runId);
  return { ...row };
}

// The failed companies of a run: name, group and the reason.
export function getFailedCompanies(db, runId) {
  return db.prepare(`SELECT c.name, j.group_number, j.error
    FROM JobRunCompany j JOIN Company c ON c.id = j.company_id
    WHERE j.run_id = ? AND j.status = 'failed'
    ORDER BY j.group_number, c.name`).all(runId).map((row) => ({ ...row }));
}

// The failed groups of a run: number, crashes in a row and the last error.
export function getFailedGroups(db, runId) {
  return db.prepare(`SELECT group_number, crashes_in_a_row, last_error
    FROM JobRunGroup WHERE run_id = ? AND status = 'failed'
    ORDER BY group_number`).all(runId).map((row) => ({ ...row }));
}

// Every company of a run (for --all): group, name, status, error and its number of mentions.
export function getAllCompanies(db, runId) {
  return db.prepare(`SELECT j.group_number, c.name, j.status, j.error,
      (SELECT COUNT(*) FROM Mention m WHERE m.company_id = j.company_id) AS mentions
    FROM JobRunCompany j JOIN Company c ON c.id = j.company_id
    WHERE j.run_id = ?
    ORDER BY j.group_number, j.rowid`).all(runId).map((row) => ({ ...row }));
}

// The queue (BufferQueue) by state. A claimed row is "being classified now"; a failed row with
// fewer than MAX_ATTEMPTS tries will be retried; with MAX_ATTEMPTS or more it failed for good (D59).
export function getQueueCounts(db, maxAttempts = config.MAX_ATTEMPTS) {
  const row = db.prepare(`SELECT
      COALESCE(SUM(claimed_at IS NULL AND status = 'pending'), 0)                    AS waiting,
      COALESCE(SUM(claimed_at IS NOT NULL), 0)                                       AS claimed,
      COALESCE(SUM(claimed_at IS NULL AND status = 'failed' AND attempts < ?), 0)    AS retry,
      COALESCE(SUM(claimed_at IS NULL AND status = 'failed' AND attempts >= ?), 0)   AS failed_for_good,
      COALESCE(SUM(claimed_at IS NULL AND status = 'relevant'), 0)                   AS relevant,
      COUNT(*)                                                                       AS total
    FROM BufferQueue`).get(maxAttempts, maxAttempts);
  return { ...row };
}

// The mentions: total, per sentiment, how many companies have at least one and how many have none.
export function getMentionCounts(db) {
  const row = db.prepare(`SELECT
      COUNT(*)                                  AS total,
      COALESCE(SUM(sentiment = 'positive'), 0)  AS positive,
      COALESCE(SUM(sentiment = 'negative'), 0)  AS negative,
      COALESCE(SUM(sentiment = 'neutral'), 0)   AS neutral,
      COUNT(DISTINCT company_id)                AS companies_with_mentions
    FROM Mention`).get();
  const companies = db.prepare('SELECT COUNT(*) AS n FROM Company').get().n;
  return { ...row, companies_without_mentions: companies - row.companies_with_mentions };
}

// ------------------------------------------------------------------------------------------------
// Formatting
// ------------------------------------------------------------------------------------------------

// Shows an ISO time as "2026-09-27 10:15" (UTC), or "-" when there is none.
export function formatTime(iso) {
  if (!iso) return '-';
  const text = String(iso);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) ? `${text.slice(0, 10)} ${text.slice(11, 16)}` : cleanForLog(text, MAX_CELL_CHARS);
}

// How long ago an ISO time was, e.g. "2.4 min ago" or "3.1 h ago". "-" when unknown.
export function formatAgo(iso, now = Date.now()) {
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return '-';
  const minutes = Math.max(0, (now - time) / 60000);
  return minutes < 120 ? `${minutes.toFixed(1)} min ago` : `${(minutes / 60).toFixed(1)} h ago`;
}

// A warning line when a 'running' run has not written a heartbeat for longer than STALE_AFTER_MS
// (15 minutes = 3 missed beats, D39): its collector has probably crashed or is stuck.
// Returns [] when all is well (or the run is not running), so it can be spread into the report.
export function staleHeartbeatWarning(run, now = Date.now(), staleAfterMs = config.STALE_AFTER_MS) {
  if (run?.status !== 'running') return [];
  const beat = Date.parse(run.last_heartbeat ?? '');
  if (Number.isNaN(beat) || now - beat <= staleAfterMs) return [];
  const minutes = Math.floor((now - beat) / 60000);
  return [`  WARNING: No heartbeat for ${formatCount(minutes)} min: the collector may have crashed or be stuck.`];
}

// Turns a cell value into safe, short text: numbers get thousands separators, empty = "-".
function cellText(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number' || typeof value === 'bigint') return formatCount(value);
  return cleanForLog(value, MAX_CELL_CHARS);
}

// Builds a text table. `columns` = [{ title, value(row), right? }]; right = right-aligned (numbers).
// Example:
//   Group  Status       Done
//   -----  -----------  ----
//       1  complete       26
export function formatTable(columns, rows) {
  const cells = rows.map((row) => columns.map((column) => cellText(column.value(row))));
  const widths = columns.map((column, index) => Math.max(column.title.length, ...cells.map((line) => line[index].length)));
  const pad = (text, index) => (columns[index].right ? text.padStart(widths[index]) : text.padEnd(widths[index]));
  const lines = [
    columns.map((column, index) => pad(column.title, index)).join('  '),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...cells.map((line) => line.map(pad).join('  ')),
  ];
  return lines.map((line) => `  ${line.trimEnd()}`);
}

// ------------------------------------------------------------------------------------------------
// The report
// ------------------------------------------------------------------------------------------------

// Runs one section of the report. A missing table → a clear note; any other error → the error
// is shown, the other sections still run, and `state.hadError` is set (exit code 1).
function section(lines, state, title, neededTables, build) {
  lines.push('', title);
  const missing = neededTables.filter((table) => !state.tables.has(table));
  if (missing.length > 0) {
    const several = missing.length > 1;
    lines.push(`  (${several ? 'tables' : 'table'} ${missing.join(', ')} ${several ? "don't" : "doesn't"} exist yet — ` +
      `${several ? 'they are' : 'it is'} created when a run starts)`);
    return;
  }
  try {
    lines.push(...build());
  } catch (error) {
    state.hadError = true;
    lines.push(`  ERROR: could not read this part: ${cleanForLog(describeError(error), 200)}`);
  }
}

// Builds the whole dashboard as a list of lines. `all` adds the list of every company.
// Returns { lines, hadError }.
export function buildReport(db, { all = false, now = Date.now(), dbPath = config.DB_PATH } = {}) {
  const lines = [`Press Mentions — run progress (database: ${dbPath}, opened read-only; times in UTC)`];
  const state = { tables: listTables(db), hadError: false };
  let run = null;

  // --- The run line ---
  section(lines, state, 'RUN', ['JobRun'], () => {
    run = getLatestRun(db);
    if (!run) return ['  No run yet — start one with `npm start`.'];
    return [
      `  Run ${run.id} · ${run.status} · started ${formatTime(run.started_at)}` +
        (run.finished_at ? ` · finished ${formatTime(run.finished_at)}` : '') +
        ` · last heartbeat ${formatTime(run.last_heartbeat)} (${formatAgo(run.last_heartbeat, now)})` +
        ` · process ${run.owner_pid ?? '-'}`,
      `  AI step: ${formatCount(run.classified_count)} classified · ${formatCount(run.relevant_count)} relevant · ` +
        `${formatCount(run.irrelevant_count)} irrelevant · ${formatCount(run.failed_count)} failed`,
      `  Last error: ${run.last_error ? cleanForLog(run.last_error, 200) : 'none'}`,
      ...staleHeartbeatWarning(run, now),
    ];
  });

  // The run-based sections only make sense once a run exists.
  if (run) {
    section(lines, state, 'COMPANIES', ['JobRunCompany'], () => {
      const counts = getCompanyCounts(db, run.id);
      return [`  ${formatCount(counts.finished)} finished · ${formatCount(counts.failed)} failed · ` +
        `${formatCount(counts.fetching)} fetching · ${formatCount(counts.not_started)} not started · ` +
        `${formatCount(counts.total)} total`];
    });

    section(lines, state, 'GROUPS', ['JobRunGroup', 'JobRunCompany'], () => {
      const groups = getGroups(db, run.id);
      if (groups.length === 0) return ['  This run has no groups.'];
      const count = (status) => groups.filter((group) => group.status === status).length;
      return [
        `  ${count('complete')} complete · ${count('failed')} failed · ${count('in_progress')} in progress · ` +
          `${count('pending')} pending · ${groups.length} total`,
        ...formatTable([
          { title: 'Group', value: (g) => g.group_number, right: true },
          { title: 'Status', value: (g) => g.status },
          { title: 'Done', value: (g) => g.done, right: true },
          { title: 'Failed', value: (g) => g.failed, right: true },
          { title: 'Left', value: (g) => g.left, right: true },
          { title: 'Total', value: (g) => g.total, right: true },
          { title: 'Crashes', value: (g) => g.crashes_in_a_row, right: true },
          { title: 'Started', value: (g) => formatTime(g.started_at) },
          { title: 'Finished', value: (g) => formatTime(g.finished_at) },
          { title: 'Exported', value: (g) => formatTime(g.exported_at) },
          { title: 'Last error', value: (g) => g.last_error },
        ], groups),
      ];
    });

    section(lines, state, 'RUNNING NOW', ['JobRunGroup', 'JobRunCompany', 'Company'], () => {
      const current = getCurrentGroup(db, run.id);
      if (!current) return ['  No group is running now.'];
      return [
        `  Group ${current.group_number} (${current.firstCompany ?? '-'} … ${current.lastCompany ?? '-'}): ` +
          `${current.done} done · ${current.failed} failed · ${current.left} left of ${current.total}` +
          ` · crashes in a row: ${current.crashes_in_a_row}`,
        ...formatTable([
          { title: 'Company', value: (c) => c.name },
          { title: 'Status', value: (c) => c.status },
          { title: 'Error', value: (c) => c.error },
        ], current.companies),
      ];
    });

    section(lines, state, 'FAILED COMPANIES', ['JobRunCompany', 'Company'], () => {
      const failed = getFailedCompanies(db, run.id);
      if (failed.length === 0) return ['  None.'];
      return formatTable([
        { title: 'Company', value: (c) => c.name },
        { title: 'Group', value: (c) => c.group_number, right: true },
        { title: 'Error', value: (c) => c.error },
      ], failed);
    });

    section(lines, state, 'FAILED GROUPS', ['JobRunGroup'], () => {
      const failed = getFailedGroups(db, run.id);
      if (failed.length === 0) return ['  None.'];
      return formatTable([
        { title: 'Group', value: (g) => g.group_number, right: true },
        { title: 'Crashes', value: (g) => g.crashes_in_a_row, right: true },
        { title: 'Last error', value: (g) => g.last_error },
      ], failed);
    });
  }

  // --- Queue and mentions: not tied to one run ---
  section(lines, state, 'QUEUE (articles waiting for the AI step)', ['BufferQueue'], () => {
    const queue = getQueueCounts(db);
    return [`  ${formatCount(queue.waiting)} waiting · ${formatCount(queue.claimed)} being classified · ` +
      `${formatCount(queue.retry)} to retry · ${formatCount(queue.failed_for_good)} failed for good · ` +
      `${formatCount(queue.relevant)} relevant, waiting to be moved · ${formatCount(queue.total)} total`];
  });

  section(lines, state, 'MENTIONS', ['Mention', 'Company'], () => {
    const mentions = getMentionCounts(db);
    return [
      `  ${formatCount(mentions.total)} total · ${formatCount(mentions.positive)} positive · ` +
        `${formatCount(mentions.negative)} negative · ${formatCount(mentions.neutral)} neutral`,
      `  ${formatCount(mentions.companies_with_mentions)} companies with mentions · ` +
        `${formatCount(mentions.companies_without_mentions)} with none`,
    ];
  });

  if (all && run) {
    section(lines, state, 'ALL COMPANIES OF THE RUN', ['JobRunCompany', 'Company', 'Mention'], () => formatTable([
      { title: 'Group', value: (c) => c.group_number, right: true },
      { title: 'Company', value: (c) => c.name },
      { title: 'Status', value: (c) => c.status },
      { title: 'Mentions', value: (c) => c.mentions, right: true },
      { title: 'Error', value: (c) => c.error },
    ], getAllCompanies(db, run.id)));
  }

  lines.push('', 'More ready-made queries: queries/progress.sql');
  return { lines, hadError: state.hadError };
}

// Runs the command: opens the database read-only, prints the report and returns the exit code
// (0 = shown, 1 = the database could not be read or a part of the report failed).
// `out` / `err` receive the text (the terminal by default; tests pass their own).
export function runProgress({ argv = process.argv.slice(2), dbPath = config.DB_PATH, out = console.log, err = console.error, now = Date.now() } = {}) {
  const unknown = argv.filter((arg) => arg !== '--all');
  if (unknown.length > 0) {
    err(`ERROR: unknown option ${unknown.join(' ')}. Use: npm run progress [-- --all]`);
    return EXIT_CODES.CRASHED;
  }
  let db = null;
  try {
    db = openReadOnly(dbPath);
    if (!db) {
      out(NO_DATABASE_MESSAGE);
      return EXIT_CODES.FINISHED;
    }
    const { lines, hadError } = buildReport(db, { all: argv.includes('--all'), now, dbPath });
    out(lines.join('\n'));
    return hadError ? EXIT_CODES.CRASHED : EXIT_CODES.FINISHED;
  } catch (error) {
    err(`ERROR: could not read the database ${dbPath}: ${describeError(error)}`);
    return EXIT_CODES.CRASHED;
  } finally {
    try { db?.close(); } catch { /* closing can only fail if already closed */ }
  }
}

// Run the command only when this file is started directly (not when a test imports it).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runProgress();
}
