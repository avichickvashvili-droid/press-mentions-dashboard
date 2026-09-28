// testTools.jsx — shared tools for the page tests: a fresh TanStack Query cache per test, and a
// fake fetch that answers like the api.
//
// Where it sits: imported by the *.test.jsx files only.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

// A fresh cache without retries (so an error shows at once) and a wrapper component for it.
export function makeQueryWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  companies: [
    {
      id: 'ukko', name: 'Ukko', section: 2, sectionName: 'Health', hint: null, status: 'no_coverage',
      lastMentionAt: null, daysAgo: null, mentionCount: 0, sentimentCounts: { positive: 0, neutral: 0, negative: 0 },
    },
    {
      id: 'harvey', name: 'Harvey', section: 1, sectionName: 'High-Tech', hint: null, status: 'mentioned',
      lastMentionAt: '2026-09-25T09:00:00.000Z', daysAgo: 2, mentionCount: 3, sentimentCounts: { positive: 1, neutral: 1, negative: 1 },
    },
  ],
};

// A mentions answer for Harvey.
export const HARVEY_MENTIONS = {
  company: { id: 'harvey', name: 'Harvey' },
  mentions: [
    { title: 'Harvey raises money - Example News', url: 'https://news.google.com/a', publisher: 'Example News', publishedAt: '2026-09-25T09:00:00.000Z', sentiment: 'positive' },
    { title: 'Harvey sued - Other News', url: 'https://news.google.com/b', publisher: 'Other News', publishedAt: '2026-09-20T09:00:00.000Z', sentiment: 'negative' },
  ],
};
