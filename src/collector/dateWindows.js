// dateWindows.js — the date arithmetic of the 90-day collection.
//
// Where it sits: used by the company loop to build each search and to decide when a
// window must be split; used by the item rules to drop articles outside the 90 days.
// Reads/writes: nothing (pure calculations, easy to test).
//
// Days are whole UTC days, stored as "day numbers" (days since 1970-01-01) so adding and
// subtracting is plain arithmetic. A window is { start, end }, both days included.
//
// The run's range is [D-89, D], where D is the UTC date of JobRun.started_at: it stays the
// same when a crashed run is resumed the next day (D55).
// A window [s, e] is searched as:  after:<s-1> before:<e+1> <query_param>  (date part first, I28).
// A window that returns 95 or more items is split in two halves, oldest half first (D57, I12).

import { config } from '../config.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The UTC day number of a date (a Date, an ISO text or milliseconds).
export function dayNumberOf(dateValue) {
  const ms = new Date(dateValue).getTime();
  return Math.floor(ms / MS_PER_DAY);
}

// A day number as "YYYY-MM-DD", the format Google's after:/before: understands.
export function formatDay(dayNumber) {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

// The run's 90 days: { start: D-89, end: D } where D is the UTC day the run started.
export function runRange(runStartedAt) {
  const lastDay = dayNumberOf(runStartedAt);
  return { start: lastDay - (config.COLLECTION_DAYS - 1), end: lastDay };
}

// How many days a window covers (both ends included).
export function windowLength(window) {
  return window.end - window.start + 1;
}

// The full search for one window: the date part first, then the company's query_param.
// after:/before: exclude the given day, so we use the day before the start and after the end.
export function buildWindowQuery(window, queryParam) {
  return `after:${formatDay(window.start - 1)} before:${formatDay(window.end + 1)} ${queryParam}`;
}

// True when a window's result was probably cut off by Google's ~100 limit (95 or more items)
// and the window can still be halved without going below the smallest window (1 day).
export function shouldSplit(window, itemCount) {
  return itemCount >= config.SPLIT_THRESHOLD && Math.floor(windowLength(window) / 2) >= config.MIN_WINDOW_DAYS;
}

// Splits a window into two halves: [s, m] (older) and [m+1, e] (newer).
export function splitWindow(window) {
  const middle = window.start + Math.floor((window.end - window.start) / 2);
  return [
    { start: window.start, end: middle },
    { start: middle + 1, end: window.end },
  ];
}

// True when a date (day number) is inside the run's 90 days.
export function isInsideRange(dayNumber, range) {
  return dayNumber >= range.start && dayNumber <= range.end;
}
