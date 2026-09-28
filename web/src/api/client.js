// client.js — the page's only connection to the api: the ONLY file that calls fetch (D100).
//
// Where it sits: used by the hooks (src/hooks/useCompanies.js, useCompanyMentions.js), never by
// components directly.
// Reads: GET /api/companies and GET /api/companies/:id/mentions. Writes: nothing.
//
// Every problem becomes an ApiError with a message a person can read:
//   - the server can't be reached (network down, api not running)
//   - the server answers with an error (its JSON { error } message is used)
//   - the server answers with something that is not JSON (e.g. an HTML page)
// `status` is the HTTP status (0 when the server was not reached), so the page can tell
// "not found" (404) from other errors.

// An error from the api, with a readable message and the HTTP status (0 = not reached).
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// GETs one api address and returns its JSON answer, or throws an ApiError.
async function getJson(address, { signal } = {}) {
  let response;
  try {
    response = await fetch(address, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error?.name === 'AbortError') throw error; // the page cancelled it; not a real error
    throw new ApiError('Could not reach the dashboard server. Check that it is running ("npm run api" or "npm run dashboard") and try again.', 0);
  }

  let body = null;
  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    throw new ApiError(body?.error ?? `The server answered with an error (HTTP ${response.status}).`, response.status);
  }
  if (body === null) {
    throw new ApiError('The server sent an answer the page could not read (not JSON). Is the api running on the right port?', response.status);
  }
  return body;
}

// The company list: { asOf, windowStart, companies: [...] }.
export async function fetchCompanies({ signal } = {}) {
  const body = await getJson('/api/companies', { signal });
  if (!Array.isArray(body.companies)) throw new ApiError('The server sent a company list the page could not read.', 200);
  return body;
}

// One company's mentions: { company: { id, name }, mentions: [...] }, newest first.
export async function fetchCompanyMentions(companyId, { signal } = {}) {
  const body = await getJson(`/api/companies/${encodeURIComponent(companyId)}/mentions`, { signal });
  if (!Array.isArray(body.mentions)) throw new ApiError('The server sent a mention list the page could not read.', 200);
  return body;
}
