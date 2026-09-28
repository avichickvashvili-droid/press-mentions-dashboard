// useCompanyMentions.js — loads one company's mentions (GET /api/companies/:id/mentions).
//
// Where it sits: used by the MentionsPanel component, for the company selected in the table.
// Reads: the api through src/api/client.js. Writes: the TanStack Query cache.
//
// Query key: ['companies', id, 'mentions', today]. It starts with 'companies' (see
// useCompanies.js), so the same invalidate reloads it too. It only runs when a company is
// selected (enabled: Boolean(id)).

import { useQuery } from '@tanstack/react-query';
import { fetchCompanyMentions } from '../api/client.js';
import { COMPANIES_KEY } from './useCompanies.js';
import { useToday } from './useToday.js';

// The query key of one company's mentions for one day.
export function companyMentionsQueryKey(companyId, today) {
  return [COMPANIES_KEY, companyId, 'mentions', today];
}

// Returns the TanStack Query result for the company's mentions (idle while `companyId` is empty).
export function useCompanyMentions(companyId) {
  const today = useToday();
  return useQuery({
    queryKey: companyMentionsQueryKey(companyId, today),
    queryFn: ({ signal }) => fetchCompanyMentions(companyId, { signal }),
    enabled: Boolean(companyId),
  });
}
