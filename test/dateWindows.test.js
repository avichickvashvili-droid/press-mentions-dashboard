// dateWindows.test.js — tests of the 90-day date arithmetic (src/collector/dateWindows.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWindowQuery, dayNumberOf, formatDay, isInsideRange, runRange, shouldSplit, splitWindow, windowLength,
} from '../src/collector/dateWindows.js';

test('the run range is the 90 UTC days ending on the start day', () => {
  const range = runRange('2026-09-27T23:30:00.000Z');
  assert.equal(formatDay(range.start), '2026-06-30');
  assert.equal(formatDay(range.end), '2026-09-27');
  assert.equal(windowLength(range), 90);
});

test('the range depends only on the start date, not on the time of a resume', () => {
  assert.deepEqual(runRange('2026-09-27T00:00:01.000Z'), runRange('2026-09-27T23:59:59.000Z'));
});

test('the search puts the date part first, with the day before / after the window', () => {
  const window = { start: dayNumberOf('2026-06-30'), end: dayNumberOf('2026-09-27') };
  assert.equal(
    buildWindowQuery(window, '"Harvey AI" (company OR AI)'),
    'after:2026-06-29 before:2026-09-28 "Harvey AI" (company OR AI)',
  );
});

test('a 90-day window splits into two 45-day halves, older first', () => {
  const range = runRange('2026-09-27T10:00:00Z');
  const [older, newer] = splitWindow(range);
  assert.equal(formatDay(older.start), '2026-06-30');
  assert.equal(formatDay(older.end), '2026-08-13');
  assert.equal(formatDay(newer.start), '2026-08-14');
  assert.equal(formatDay(newer.end), '2026-09-27');
  assert.equal(windowLength(older), 45);
  assert.equal(windowLength(newer), 45);
});

test('an odd window gives the extra day to the newer half; halves touch without overlap', () => {
  const [older, newer] = splitWindow({ start: 100, end: 102 });
  assert.deepEqual(older, { start: 100, end: 101 });
  assert.deepEqual(newer, { start: 102, end: 102 });
});

test('split only at 95+ items, and never a 1-day window', () => {
  assert.equal(shouldSplit({ start: 1, end: 90 }, 94), false);
  assert.equal(shouldSplit({ start: 1, end: 90 }, 95), true);
  assert.equal(shouldSplit({ start: 1, end: 90 }, 100), true);
  assert.equal(shouldSplit({ start: 1, end: 2 }, 100), true);
  assert.equal(shouldSplit({ start: 5, end: 5 }, 100), false);
});

test('isInsideRange includes both ends', () => {
  const range = { start: 10, end: 20 };
  assert.equal(isInsideRange(9, range), false);
  assert.equal(isInsideRange(10, range), true);
  assert.equal(isInsideRange(20, range), true);
  assert.equal(isInsideRange(21, range), false);
});
