// useToday.js — today's date (UTC, "YYYY-MM-DD"), which changes by itself at midnight (D100).
//
// Where it sits: used by useCompanies and useCompanyMentions. The date is part of their query
// keys, so at midnight both load again and the server cuts the new 90-day window. The 90-day
// rule itself stays only on the server (D13).
// Reads: the clock. Writes: nothing.
//
// One timer, set to fire just after the next midnight (UTC). When the date changes, a new timer
// is set for the midnight after that. The timer is removed when the component goes away.

import { useEffect, useState } from 'react';

// A short extra wait after midnight, so the timer never fires a moment too early.
const AFTER_MIDNIGHT_MS = 1000;

// Today's date in UTC as "YYYY-MM-DD".
export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Milliseconds from `now` until the next midnight (UTC).
export function msUntilNextMidnightUtc(now = new Date()) {
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return nextMidnight - now.getTime();
}

// Returns today's date and re-renders the component when it changes.
export function useToday() {
  const [today, setToday] = useState(() => todayUtc());

  useEffect(() => {
    const timer = setTimeout(() => setToday(todayUtc()), msUntilNextMidnightUtc() + AFTER_MIDNIGHT_MS);
    return () => clearTimeout(timer);
  }, [today]);

  return today;
}
