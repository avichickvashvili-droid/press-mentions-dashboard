// database.js — opens the SQLite database and creates its 6 tables.
//
// Where it sits: the first thing every command does (seed, collect, tests) is open the
// database through this file. All services share this one SQLite file. The api reads it
// through a read-only connection (openDatabaseReadOnly).
// Reads/writes: the SQLite file at config.DB_PATH (or any path given, e.g. a temp file in tests).
//
// Tables (see PLAN.md 1.3 "Core Entities"):
//   Company        one row per portfolio company, written by the seed loader
//   BufferQueue    articles waiting for the AI step (the queue between collector and classifier)
//   Mention        final relevant, classified mentions (written by the classifier, read by the dashboard)
//   JobRun         one row per collection run; also the lock ("only one run at a time")
//   JobRunCompany  the per-run checklist of companies (each with its group number)
//   JobRunGroup    the groups of a run (D83-D89): status, crashes in a row, failed rounds (D97), export time
//
// All dates are stored as ISO-8601 text in UTC, e.g. "2026-09-27T10:15:00.000Z".
//
// Columns added after the first version are added to an existing database file on open
// (addMissingColumns), so an older database keeps working: BufferQueue.suspect (D78) and
// JobRunCompany.group_number (D89), JobRunCompany.group_crashes and JobRunGroup.failed_rounds
// (D97). Indexes on such columns are created after that step
// (INDEXES_AFTER_COLUMNS_SQL), because an older file doesn't have the column before it.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

// The table definitions. "IF NOT EXISTS" makes this safe to run on every start.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS Company (
  id          TEXT PRIMARY KEY,                 -- slug, e.g. 'lambda'
  name        TEXT NOT NULL UNIQUE,             -- display/search name, annotation removed, e.g. 'Lambda'
  section     INTEGER NOT NULL CHECK (section BETWEEN 1 AND 13),
  hint        TEXT,                             -- search hint from company_hints.json, or NULL
  query_param TEXT NOT NULL                     -- the search without the date part
);

CREATE TABLE IF NOT EXISTS BufferQueue (
  id            INTEGER PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES Company(id),
  guid          TEXT NOT NULL,                  -- Google News article id; dedup key with company_id
  url           TEXT NOT NULL,                  -- the Google News link
  title         TEXT NOT NULL,                  -- the whole headline as Google gives it ("... - Publisher")
  publisher     TEXT,                           -- from <source>
  published_at  TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'relevant', 'failed')),
  sentiment     TEXT CHECK (sentiment IS NULL OR sentiment IN ('positive', 'negative', 'neutral')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  claimed_at    TEXT,
  claimed_by_pid INTEGER,                       -- process id of the classifier worker that claimed the row
  suspect       INTEGER NOT NULL DEFAULT 0,     -- 1 = was being worked on when a classifier died: asked alone (D78)
  UNIQUE (company_id, guid)
);

CREATE TABLE IF NOT EXISTS Mention (
  id            INTEGER PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES Company(id),
  guid          TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  publisher     TEXT,
  published_at  TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  sentiment     TEXT NOT NULL CHECK (sentiment IN ('positive', 'negative', 'neutral')),
  alerted_at    TEXT,
  UNIQUE (company_id, guid)
);

CREATE TABLE IF NOT EXISTS JobRun (
  id             INTEGER PRIMARY KEY,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  status         TEXT NOT NULL CHECK (status IN ('running', 'collected', 'done', 'failed')),
  last_heartbeat TEXT NOT NULL,
  owner_pid      INTEGER,
  last_error     TEXT,
  crashed_at     TEXT,
  -- Counters kept by the classifier (the collector only creates them as 0).
  classified_count INTEGER NOT NULL DEFAULT 0,
  relevant_count   INTEGER NOT NULL DEFAULT 0,
  irrelevant_count INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS JobRunCompany (
  run_id       INTEGER NOT NULL REFERENCES JobRun(id),
  company_id   TEXT NOT NULL REFERENCES Company(id),
  status       TEXT NOT NULL DEFAULT 'not_started'
               CHECK (status IN ('not_started', 'fetching', 'finished', 'failed')),
  error        TEXT,
  group_number INTEGER,                         -- the group the company is in (D83), set when the run starts
  group_crashes INTEGER NOT NULL DEFAULT 0,     -- how often its group process crashed / was killed while fetching it (D97)
  PRIMARY KEY (run_id, company_id)
);

-- One row per group per run (D83-D89): the groups run one after another, each in its own process.
CREATE TABLE IF NOT EXISTS JobRunGroup (
  run_id           INTEGER NOT NULL REFERENCES JobRun(id),
  group_number     INTEGER NOT NULL CHECK (group_number >= 1),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'in_progress', 'complete', 'failed')),
  crashes_in_a_row INTEGER NOT NULL DEFAULT 0,  -- group-process crashes with no progress in between (D84)
  failed_rounds    INTEGER NOT NULL DEFAULT 0,  -- how often it reached 5 crashes in a row; retried until > GROUP_FAILED_RETRIES (D97)
  started_at       TEXT,
  finished_at      TEXT,
  last_error       TEXT,                        -- why the group process last crashed
  exported_at      TEXT,                        -- when data/ was written after this group (D86)
  PRIMARY KEY (run_id, group_number)
);

-- Classifier: oldest pending/failed rows; move step: relevant rows.
CREATE INDEX IF NOT EXISTS idx_bufferqueue_status ON BufferQueue(status);
-- Backup duplicate check (D33): same company + same publisher + same title.
CREATE INDEX IF NOT EXISTS idx_bufferqueue_company_publisher_title ON BufferQueue(company_id, publisher, title);
CREATE INDEX IF NOT EXISTS idx_mention_company_publisher_title ON Mention(company_id, publisher, title);
-- Dashboard/status: a company's mentions, newest first. Daily digest: not yet alerted.
CREATE INDEX IF NOT EXISTS idx_mention_company_published ON Mention(company_id, published_at);
CREATE INDEX IF NOT EXISTS idx_mention_alerted ON Mention(alerted_at);
-- Collector: the next not_started company of a run.
CREATE INDEX IF NOT EXISTS idx_jobruncompany_run_status ON JobRunCompany(run_id, status);
`;

// Columns added after the first version of a table: [table, column, definition]. A database
// file created before a column existed gets it added on open (existing rows get the default).
const ADDED_COLUMNS = [
  ['BufferQueue', 'suspect', 'INTEGER NOT NULL DEFAULT 0'],
  ['JobRunCompany', 'group_number', 'INTEGER'],
  ['JobRunCompany', 'group_crashes', 'INTEGER NOT NULL DEFAULT 0'],
  ['JobRunGroup', 'failed_rounds', 'INTEGER NOT NULL DEFAULT 0'],
];

// Indexes that use a column from ADDED_COLUMNS: created only after those columns exist.
const INDEXES_AFTER_COLUMNS_SQL = `
-- Group process: the next not_started company of one group of a run.
CREATE INDEX IF NOT EXISTS idx_jobruncompany_run_group_status ON JobRunCompany(run_id, group_number, status);
`;

// Adds every column of ADDED_COLUMNS that the database file doesn't have yet.
function addMissingColumns(db) {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const hasColumn = db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
    if (!hasColumn) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

// Opens (and creates if needed) the database file and makes sure all tables and columns exist.
// WAL mode + a busy timeout let the collector, classifier and API share the file safely.
export function openDatabase(dbPath = config.DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA busy_timeout = ${Number(config.DB_BUSY_TIMEOUT_MS)};`);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  addMissingColumns(db);
  db.exec(INDEXES_AFTER_COLUMNS_SQL);
  return db;
}

// Opens an EXISTING database file for reading only (the api, D19: it never writes).
// SQLite itself refuses any write on this connection, so a bug can never change the data.
// It does not create tables: call openDatabase once first (the api does at start-up).
// The busy timeout lets a read wait while the collector or classifier is writing; in WAL mode
// readers and a writer don't block each other anyway.
export function openDatabaseReadOnly(dbPath = config.DB_PATH) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec(`PRAGMA busy_timeout = ${Number(config.DB_BUSY_TIMEOUT_MS)};`);
  return db;
}

// Runs `work(db)` as one transaction: either everything in it is saved, or nothing is.
// BEGIN IMMEDIATE takes the write lock at the start, so two services never deadlock halfway.
export function inTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = work(db);
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // The transaction was already rolled back by SQLite; nothing more to undo.
    }
    throw error;
  }
}

// True when the error was raised by SQLite itself (any database error, busy or not).
// Used to tell a database problem apart from other failures (e.g. a file that can't be written).
export function isDatabaseError(error) {
  return error?.code === 'ERR_SQLITE_ERROR';
}

// True when a database error only means "another service is writing right now" —
// a temporary condition that is worth retrying. It is the ONLY database error that is retried
// (D76, see src/shared/retry.js); every other one is thrown on.
export function isDatabaseBusyError(error) {
  const code = error?.errcode;
  // 5 = SQLITE_BUSY, 6 = SQLITE_LOCKED (the low byte of extended codes is the same).
  return (code & 0xff) === 5 || (code & 0xff) === 6 || /database is (locked|busy)/i.test(error?.message ?? '');
}

// Current time as ISO-8601 UTC text, the format every date column uses.
export function nowIso() {
  return new Date().toISOString();
}
