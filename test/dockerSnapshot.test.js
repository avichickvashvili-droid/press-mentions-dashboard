// dockerSnapshot.test.js — `npm run docker:snapshot` (D116): the copy has every row, including
// the ones still waiting in the -wal file; the source file is never changed; a missing source
// fails without touching the old snapshot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeTempDb, makeTempDir } from './helpers.js';
import { makeSnapshot } from '../src/tools/makeDockerSnapshot.js';

test('the snapshot holds every row (also those only in the -wal file) and the source stays unchanged', (t) => {
  const { db, dbPath } = makeTempDb(t);
  db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES ('a', 'Alpha', 1, 'q'), ('b', 'Beta', 1, 'q')").run();
  const before = fs.readFileSync(dbPath);
  const target = path.join(makeTempDir(t), 'seed', 'snap.sqlite');

  const result = makeSnapshot({ source: dbPath, target });

  assert.equal(result.companies, 2);
  assert.equal(result.mentions, 0);
  assert.ok(result.bytes > 0);
  assert.deepEqual(fs.readFileSync(dbPath), before, 'the source file is not changed');
  assert.equal(fs.existsSync(`${target}.tmp`), false);
  const copy = new DatabaseSync(target, { readOnly: true });
  t.after(() => copy.close());
  assert.equal(copy.prepare('PRAGMA journal_mode').get().journal_mode, 'delete', 'one file, no -wal needed');
});

test('no source database: an error, and the old snapshot is kept', (t) => {
  const dir = makeTempDir(t);
  const target = path.join(dir, 'snap.sqlite');
  fs.writeFileSync(target, 'old snapshot');
  assert.throws(() => makeSnapshot({ source: path.join(dir, 'missing.sqlite'), target }), /no database/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old snapshot');
});
