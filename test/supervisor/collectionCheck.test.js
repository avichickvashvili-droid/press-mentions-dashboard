// collectionCheck.test.js — tests the "launch the collector or not?" check at `npm start` (D67):
// the 90-day collection runs once; it is resumed if unfinished, and not started again after it
// completed. Uses temporary SQLite files; the check itself only reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/db/database.js';
import { checkCollectionNeeded } from '../../src/supervisor/collectionCheck.js';

// A temporary database path (the folder is removed after the test).
function tempDbPath(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'press-supervisor-check-'));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      // left in the temp folder
    }
  });
  return path.join(dir, 'test.sqlite');
}

// Creates the database with the given JobRun rows ({ status, finished_at }).
function createDbWithRuns(dbPath, runs) {
  const db = openDatabase(dbPath);
  const insert = db.prepare('INSERT INTO JobRun (started_at, finished_at, status, last_heartbeat) VALUES (?, ?, ?, ?)');
  for (const run of runs) insert.run('2026-09-01T00:00:00.000Z', run.finished_at ?? null, run.status, '2026-09-01T00:00:00.000Z');
  db.close();
}

test('no database file yet: start the collector, and do not create the file', (t) => {
  const dbPath = tempDbPath(t);
  const decision = checkCollectionNeeded({ dbPath });
  assert.equal(decision.start, true);
  assert.equal(fs.existsSync(dbPath), false, 'the check only reads');
});

test('database without any run: start the collector', (t) => {
  const dbPath = tempDbPath(t);
  createDbWithRuns(dbPath, []);
  assert.equal(checkCollectionNeeded({ dbPath }).start, true);
});

test('an unfinished (running) run: start the collector to resume it', (t) => {
  const dbPath = tempDbPath(t);
  createDbWithRuns(dbPath, [{ status: 'running' }]);
  const decision = checkCollectionNeeded({ dbPath });
  assert.equal(decision.start, true);
  assert.match(decision.reason, /run 1 did not finish/);
});

test('a run is collected or done: do NOT start it again; say when it finished', (t) => {
  for (const status of ['collected', 'done']) {
    const dbPath = tempDbPath(t);
    createDbWithRuns(dbPath, [{ status, finished_at: '2026-09-20T08:00:00.000Z' }]);
    const decision = checkCollectionNeeded({ dbPath });
    assert.equal(decision.start, false, status);
    assert.match(decision.reason, /Last collection finished at 2026-09-20T08:00:00\.000Z \(run 1\)/);
  }
});

test('a done run and a newer running run (e.g. a later manual run): resume the running one', (t) => {
  const dbPath = tempDbPath(t);
  createDbWithRuns(dbPath, [{ status: 'done', finished_at: '2026-09-20T08:00:00.000Z' }, { status: 'running' }]);
  assert.equal(checkCollectionNeeded({ dbPath }).start, true);
});

test('an unreadable database file makes the check throw (the orchestrator then skips the collector)', (t) => {
  const dbPath = tempDbPath(t);
  fs.writeFileSync(dbPath, 'this is not a database, just some text that is long enough to not be empty');
  assert.throws(() => checkCollectionNeeded({ dbPath }));
});
