// shared.test.js — tests of the helpers in src/shared/ and of the database helpers they rely on:
// retrying ONLY "database busy" errors (D76, with a real busy error from a second connection),
// the text helpers (cleaning headlines for logs, number format, error text), and adding a new
// column to an older database file (BufferQueue.suspect, D78). Offline, temporary SQLite files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDatabaseBusyError, isDatabaseError, openDatabase } from '../src/db/database.js';
import { retryDbWrite } from '../src/shared/retry.js';
import { cleanForLog, describeError, formatCount } from '../src/shared/text.js';
import { waitForQueueSpace } from '../src/collector/bufferWriter.js';
import { makeTempDb, makeTempDir } from './helpers.js';

test('retryDbWrite retries a real "database is locked" error and then succeeds', async (t) => {
  const { db, openOther } = makeTempDb(t);
  const other = openOther();
  other.exec('PRAGMA busy_timeout = 0;'); // fail at once instead of waiting 5 s
  db.exec('BEGIN IMMEDIATE;'); // the first connection holds the write lock
  const waits = [];
  const warnings = [];
  const result = await retryDbWrite(
    () => other.prepare("INSERT INTO Company (id, name, section, query_param) VALUES ('a', 'A', 1, 'q')").run().changes,
    {
      label: 'test insert',
      warn: (text) => warnings.push(text),
      wait: async (ms) => { waits.push(ms); db.exec('COMMIT;'); }, // the other writer finishes while we wait
    },
  );
  assert.equal(result, 1);
  assert.deepEqual(waits, [5000]);
  assert.match(warnings[0], /Database busy \(test insert\)/);
});

test('retryDbWrite throws any other database error at once, without waiting (D76)', async (t) => {
  const { db } = makeTempDb(t);
  const waits = [];
  await assert.rejects(
    retryDbWrite(() => db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES ('a', 'A', 99, 'q')").run(), {
      label: 'bad insert', warn: () => {}, wait: async (ms) => { waits.push(ms); },
    }),
    (error) => isDatabaseError(error) && !isDatabaseBusyError(error) && /CHECK constraint/.test(error.message),
  );
  assert.deepEqual(waits, []);
  await assert.rejects(retryDbWrite(() => { throw new Error('not a database error'); }, { wait: async () => assert.fail('no wait') }), /not a database error/);
});

test('waitForQueueSpace keeps checking on a busy count but throws any other database error (D76)', async () => {
  const busy = Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
  let calls = 0;
  const flakyDb = {
    prepare: () => ({
      get: () => {
        calls += 1;
        if (calls === 1) throw busy;
        return { total: 10, dead: 0 };
      },
    }),
  };
  const warnings = [];
  assert.equal(await waitForQueueSpace(flakyDb, 1, { sleep: async () => {}, warn: (text) => warnings.push(text) }), 10);
  assert.match(warnings[0], /Could not count the queue \(database is locked\)/);

  const brokenDb = { prepare: () => ({ get: () => { throw Object.assign(new Error('database disk image is malformed'), { code: 'ERR_SQLITE_ERROR', errcode: 11 }); } }) };
  await assert.rejects(waitForQueueSpace(brokenDb, 1, { sleep: async () => assert.fail('no wait') }), /malformed/);
});

test('cleanForLog removes control characters and cuts long text; formatCount and describeError', () => {
  assert.equal(cleanForLog('Harvey \u001b[31mraises\u0007 $100M\u009b'), 'Harvey [31mraises $100M');
  assert.equal(cleanForLog('line one\nline two\ttab'), 'line oneline twotab');
  const long = cleanForLog('x'.repeat(400));
  assert.equal(long, `${'x'.repeat(150)}…`);
  assert.equal(cleanForLog(null), '');
  assert.equal(cleanForLog('Café – “quoted” 日本'), 'Café – “quoted” 日本', 'normal text is kept');
  assert.equal(formatCount(10000), '10,000');
  assert.equal(describeError(new TypeError('boom')), 'TypeError: boom');
  assert.equal(describeError('plain'), 'plain');
});

test('an older database file without BufferQueue.suspect gets the column on open (D78)', (t) => {
  const dir = makeTempDir(t);
  const dbPath = path.join(dir, 'old.sqlite');
  const old = new DatabaseSync(dbPath);
  old.exec(`CREATE TABLE BufferQueue (id INTEGER PRIMARY KEY, company_id TEXT NOT NULL, guid TEXT NOT NULL, url TEXT NOT NULL,
            title TEXT NOT NULL, publisher TEXT, published_at TEXT NOT NULL, first_seen_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', sentiment TEXT, attempts INTEGER NOT NULL DEFAULT 0,
            claimed_at TEXT, claimed_by_pid INTEGER, UNIQUE (company_id, guid));
            INSERT INTO BufferQueue (company_id, guid, url, title, published_at, first_seen_at) VALUES ('a', 'g', 'u', 't', 'p', 'f');`);
  old.close();
  const db = openDatabase(dbPath);
  try {
    assert.equal(db.prepare('SELECT suspect FROM BufferQueue').get().suspect, 0);
  } finally {
    db.close();
  }
  const again = openDatabase(dbPath); // opening a second time changes nothing
  try {
    assert.equal(again.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('BufferQueue') WHERE name = 'suspect'").get().n, 1);
  } finally {
    again.close();
  }
});
