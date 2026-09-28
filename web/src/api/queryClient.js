// queryClient.js — the TanStack Query settings of the page: when data is loaded again (D100).
//
// Where it sits: created once in src/main.jsx (and in the tests).
// Reads/writes: nothing itself.
//
//   - Reload when the person comes back to the browser tab (refetchOnWindowFocus). No polling.
//   - A failed request is tried again up to 2 more times, but never for a 4xx answer such as
//     404 "not found" (trying again can't help).

// Decides whether a failed request is tried again. `failureCount` = failures so far.
export function shouldRetry(failureCount, error) {
  if (error?.status >= 400 && error?.status < 500) return false;
  return failureCount < 2;
}

// The options every query of the page uses.
export const QUERY_DEFAULTS = {
  queries: {
    refetchOnWindowFocus: true,
    retry: shouldRetry,
  },
};
