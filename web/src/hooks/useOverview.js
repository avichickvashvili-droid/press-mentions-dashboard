// useOverview.js — loads the Overview page's numbers (GET /api/overview, D117).
//
// Where it sits: used by the Overview page. Components get data only through hooks (D100).
// Reads: the api through src/api/client.js. Writes: the TanStack Query cache.
//
// Query key: ['companies', 'overview', today]. It starts with 'companies' (see useCompanies.js),
// so the daily job's "new data" signal (useDataUpdates) reloads it with everything else, and a
// new day (midnight) loads it again.

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchOverview } from '../api/client.js';
import { COMPANIES_KEY } from './useCompanies.js';
import { useToday } from './useToday.js';

// The query key of the overview for one day.
export function overviewQueryKey(today) {
  return [COMPANIES_KEY, 'overview', today];
}

// Returns the TanStack Query result: { data, isPending, isError, error, refetch }.
export function useOverview() {
  const today = useToday();
  return useQuery({
    queryKey: overviewQueryKey(today),
    queryFn: ({ signal }) => fetchOverview({ signal }),
    placeholderData: keepPreviousData,
  });
}
