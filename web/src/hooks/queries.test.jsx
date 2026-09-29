// queries.test.jsx — useCompanies and useCompanyMentions (D100): the query keys, that the
// mentions only load once a company is selected, and that ONE invalidate of ['companies']
// reloads both. The fetch is a fake.

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { companiesQueryKey, useCompanies } from './useCompanies.js';
import { companyMentionsQueryKey, useCompanyMentions } from './useCompanyMentions.js';
import { todayUtc } from './useToday.js';
import { COMPANIES_ANSWER, HARVEY_MENTIONS, jsonResponse, makeQueryWrapper, stubFetch } from '../test/testTools.jsx';

// A fake api: the company list, and Harvey's mentions.
function fakeApi() {
  return stubFetch((url) => (url.includes('/mentions') ? jsonResponse(HARVEY_MENTIONS) : jsonResponse(COMPANIES_ANSWER)));
}

describe('query hooks', () => {
  it('both keys start with "companies" and end with today', () => {
    expect(companiesQueryKey('2026-09-27')).toEqual(['companies', '2026-09-27']);
    expect(companyMentionsQueryKey('harvey', '2026-09-27')).toEqual(['companies', 'harvey', 'mentions', '2026-09-27']);
  });

  it('useCompanies loads the list under the key [companies, today]', async () => {
    const fetchMock = fakeApi();
    const { queryClient, wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useCompanies(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data.companies).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/companies', expect.anything());
    expect(queryClient.getQueryData(['companies', todayUtc()])).toEqual(COMPANIES_ANSWER);
  });

  it('useCompanyMentions does nothing until a company is selected', async () => {
    const fetchMock = fakeApi();
    const { wrapper } = makeQueryWrapper();
    const { result, rerender } = renderHook(({ id }) => useCompanyMentions(id), { wrapper, initialProps: { id: null } });
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ id: 'harvey' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/harvey/mentions', expect.anything());
  });

  it('one invalidate of ["companies"] reloads the list and the open mentions', async () => {
    const fetchMock = fakeApi();
    const { queryClient, wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => ({ list: useCompanies(), mentions: useCompanyMentions('harvey') }), { wrapper });
    await waitFor(() => expect(result.current.list.isSuccess && result.current.mentions.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(() => queryClient.invalidateQueries({ queryKey: ['companies'] }));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const urls = fetchMock.mock.calls.slice(2).map(([url]) => url).sort();
    expect(urls).toEqual(['/api/companies', '/api/companies/harvey/mentions']);
  });
});
