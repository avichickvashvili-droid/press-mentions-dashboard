// useCompanies.js — loads the company list with its status and totals (GET /api/companies).
//
// Where it sits: used by App.jsx. Components get the data only through hooks like this one;
// they never call fetch (D100).
// Reads: the api through src/api/client.js. Writes: the TanStack Query cache.
//
// Query key: ['companies', today]. It starts with 'companies', like the mentions key, so one
// queryClient.invalidateQueries({ queryKey: ['companies'] }) reloads everything on the page
// (the Refresh button, and the daily job's signal through useDataUpdates). `today` changes at
// midnight, which loads the list again (new 90-day window, new "days ago").

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchCompanies } from '../api/client.js';
import { useToday } from './useToday.js';

// The first part of every query key of the page: invalidating it reloads everything.
export const COMPANIES_KEY = 'companies';

// The query key of the company list for one day.
export function companiesQueryKey(today) {
  return [COMPANIES_KEY, today];
}

// Returns the TanStack Query result: { data, isPending, isError, error, refetch, isFetching }.
export function useCompanies() {
  const today = useToday();
  return useQuery({
    queryKey: companiesQueryKey(today),
    queryFn: ({ signal }) => fetchCompanies({ signal }),
    // At midnight the key changes: keep showing the old list until the new one has arrived.
    placeholderData: keepPreviousData,
  });
}
