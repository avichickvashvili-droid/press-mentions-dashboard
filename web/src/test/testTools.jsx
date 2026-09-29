// testTools.jsx — shared tools for the page tests: a fresh TanStack Query cache per test, and a
// fake fetch that answers like the api.
//
// Where it sits: imported by the *.test.jsx files only.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { QUERY_DEFAULTS } from '../api/queryClient.js';

// A fresh cache and a wrapper component for it. By default without retries (so an error shows
// at once). With `realDefaults: true` it uses the page's real settings (QUERY_DEFAULTS: the
// retry rule and reload on tab focus), only without the wait between tries, so a test that is
// about retrying checks the real rule and stays fast.
export function makeQueryWrapper({ realDefaults = false } = {}) {
  const queries = realDefaults ? { ...QUERY_DEFAULTS.queries, retryDelay: 0 } : { retry: false };
  const queryClient = new QueryClient({ defaultOptions: { queries } });
  const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}

// A JSON answer like the api's.
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Replaces the global fetch. `answer(url)` returns a Response (or throws). Returns the mock.
export function stubFetch(answer) {
  const fake = vi.fn(async (url) => answer(String(url)));
  vi.stubGlobal('fetch', fake);
  return fake;
}

// A small company list answer.
export const COMPANIES_ANSWER = {
  asOf: '2026-09-27T10:00:00.000Z',
  windowStart: '2026-06-29T10:00:00.000Z',
  windowDays: 90,
  companies: [
    {
      id: 'ukko', name: 'Ukko', section: 2, sectionName: 'Health', hint: null, status: 'no_coverage',
      lastMentionAt: null, daysAgo: null, mentionCount: 0, sentimentCounts: { positive: 0, neutral: 0, negative: 0 },
      weekCount: 0, prevWeekCount: 0, logoUrl: null,
    },
    {
      id: 'harvey', name: 'Harvey', section: 1, sectionName: 'High-Tech', hint: null, status: 'mentioned',
      lastMentionAt: '2026-09-25T09:00:00.000Z', daysAgo: 2, mentionCount: 3, sentimentCounts: { positive: 1, neutral: 1, negative: 1 },
      weekCount: 1, prevWeekCount: 2, logoUrl: '/logos/harvey.png',
    },
  ],
};

// A mentions answer for Harvey.
export const HARVEY_MENTIONS = {
  company: { id: 'harvey', name: 'Harvey' },
  asOf: '2026-09-27T10:00:00.000Z',
  mentions: [
    { title: 'Harvey raises money - Example News', url: 'https://news.google.com/a', publisher: 'Example News', publishedAt: '2026-09-25T09:00:00.000Z', sentiment: 'positive' },
    { title: 'Harvey sued - Other News', url: 'https://news.google.com/b', publisher: 'Other News', publishedAt: '2026-09-20T09:00:00.000Z', sentiment: 'negative' },
  ],
};
