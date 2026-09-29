// client.test.js — every api problem becomes a readable ApiError (src/api/client.js), and the
// retry rule never retries a 4xx (src/api/queryClient.js). The fetch is a fake.

import { describe, expect, it } from 'vitest';
import { ApiError, fetchCompanies, fetchCompanyMentions } from './client.js';
import { shouldRetry } from './queryClient.js';
import { jsonResponse, stubFetch } from '../test/testTools.jsx';

describe('api client', () => {
  it('server not reachable: a readable message, status 0', async () => {
    stubFetch(() => { throw new TypeError('Failed to fetch'); });
    await expect(fetchCompanies()).rejects.toMatchObject({ name: 'ApiError', status: 0, message: expect.stringMatching(/Could not reach/) });
  });

  it('an HTML page instead of JSON: a readable message', async () => {
    stubFetch(() => new Response('<html>hi</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(fetchCompanies()).rejects.toThrow(/not JSON/);
  });

  it('an api error: its JSON message and status are kept', async () => {
    stubFetch(() => jsonResponse({ error: 'No company with the id "x".' }, 404));
    const error = await fetchCompanyMentions('x').catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.message).toBe('No company with the id "x".');
  });

  it('a 500 without JSON: a message with the status', async () => {
    stubFetch(() => new Response('oops', { status: 500 }));
    await expect(fetchCompanies()).rejects.toThrow(/HTTP 500/);
  });

  it('the company id is put in the address safely', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ company: {}, mentions: [] }));
    await fetchCompanyMentions('a/b c');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/companies/a%2Fb%20c/mentions');
  });

  it('retry: up to 2 more times, never for a 4xx', () => {
    expect(shouldRetry(0, new ApiError('x', 500))).toBe(true);
    expect(shouldRetry(1, new ApiError('x', 0))).toBe(true);
    expect(shouldRetry(2, new ApiError('x', 500))).toBe(false);
    expect(shouldRetry(0, new ApiError('x', 404))).toBe(false);
  });
});
