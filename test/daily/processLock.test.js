// processLock.test.js — only one `npm run daily` at a time (src/daily/processLock.js, Step 6
// review #3, Prompt 296): the lock file daily.lock next to the database. Offline: a temporary folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../helpers.js';
import { lockFilePath, releaseProcessLock, takeProcessLock } from '../../src/daily/processLock.js';

const T1 = '2026-09-29T00:00:01.000Z';
const T2 = '2026-09-29T00:05:00.000Z';

test('the lock file sits next to the database', () => {
  assert.equal(lockFilePath(path.join('C:', 'x', 'db', 'press.sqlite')), path.join('C:', 'x', 'db', 'daily.lock'));
});

test('one daily job at a time: a second one is refused while the first is alive', (t) => {
  const file = path.join(makeTempDir(t), 'db', 'daily.lock');
  assert.deepEqual(takeProcessLock({ file, pid: 111, now: T1, isAlive: () => true }), { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { pid: 111, startedAt: T1 });
  assert.deepEqual(takeProcessLock({ file, pid: 222, now: T2, isAlive: () => true }), { ok: false, holder: { pid: 111, startedAt: T1 } });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { pid: 111, startedAt: T1 }); // not changed
});

test('a leftover lock of a program that is gone (crash, closed window) is taken over', (t) => {
  const file = path.join(makeTempDir(t), 'daily.lock');
  takeProcessLock({ file, pid: 111, now: T1, isAlive: () => true });
  assert.deepEqual(takeProcessLock({ file, pid: 222, now: T2, isAlive: () => false }), { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { pid: 222, startedAt: T2 });
});

test('an unreadable lock file is treated as a leftover', (t) => {
  const file = path.join(makeTempDir(t), 'daily.lock');
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(takeProcessLock({ file, pid: 222, now: T2, isAlive: () => true }), { ok: true });
});

test('release: removes the file only when it is ours, and never throws', (t) => {
  const file = path.join(makeTempDir(t), 'daily.lock');
  takeProcessLock({ file, pid: 111, now: T1, isAlive: () => true });
  assert.equal(releaseProcessLock({ file, pid: 222 }), false);
  assert.ok(fs.existsSync(file));
  assert.equal(releaseProcessLock({ file, pid: 111 }), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(releaseProcessLock({ file, pid: 111 }), false); // already gone: no error
});
