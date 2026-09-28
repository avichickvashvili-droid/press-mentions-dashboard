// dates.js — how dates are shown on the page.
//
// Where it sits: used by the components (Header, MentionsPanel).
// Reads/writes: nothing.
//
// Dates are shown in the viewer's own time zone, in a fixed English format, e.g. "28 Sep 2026"
// and "28 Sep 2026, 10:01". `timeZone` can be given (the tests use 'UTC').

// "28 Sep 2026" for an ISO date text; "" when there is no date.
export function formatDate(isoText, timeZone) {
  if (!isoText) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(isoText));
}

// "28 Sep 2026, 10:01" for an ISO date text; "" when there is no date.
export function formatDateTime(isoText, timeZone) {
  if (!isoText) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone,
  }).format(new Date(isoText));
}
