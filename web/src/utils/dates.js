// dates.js — how dates are shown on the page.
//
// Where it sits: used by the components (Hero, KPI cards, MentionsPanel) and utils/mentionFilters.js.
// Reads/writes: nothing.
//
// Dates are shown in the viewer's own time zone, in a fixed English format, e.g. "28 Sep 2026"
// and "28 Sep 2026, 10:01". `timeZone` can be given (the tests use 'UTC').

// British English writes September short as "Sept"; the page always says "Sep" (Prompt 328).
const withSep = (text) => text.replace(/\bSept\b/, 'Sep');

// "28 Sep 2026" for an ISO date text; "" when there is no date.
export function formatDate(isoText, timeZone) {
  if (!isoText) return '';
  return withSep(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(isoText)));
}

// "28 Sep 2026, 10:01" for an ISO date text; "" when there is no date.
export function formatDateTime(isoText, timeZone) {
  if (!isoText) return '';
  return withSep(new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone,
  }).format(new Date(isoText)));
}

// The mentions panel shows days and times in Israel time, labelled "IST" (owner, Prompt 320, D111).
export const PANEL_TIME_ZONE = 'Asia/Jerusalem';
export const PANEL_TIME_LABEL = 'IST';

// The day of an ISO date text in `timeZone`, as "2026-09-30" (for grouping by day); '' when
// there is no date.
export function dayKey(isoText, timeZone) {
  if (!isoText) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(new Date(isoText));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// A day heading: "Wed 30 Sep", with the year when it is not the year of `now` ("Tue 30 Dec 2025").
// Built from parts in US English, so it is "Sep" everywhere (British English gives "Sept").
export function formatDayHeading(isoText, timeZone, now = Date.now()) {
  if (!isoText) return '';
  const partsOf = (d) => new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone }).formatToParts(d);
  const pick = (parts, type) => parts.find((p) => p.type === type)?.value;
  const parts = partsOf(new Date(isoText));
  const text = `${pick(parts, 'weekday')} ${pick(parts, 'day')} ${pick(parts, 'month')}`;
  return pick(parts, 'year') === pick(partsOf(new Date(now)), 'year') ? text : `${text} ${pick(parts, 'year')}`;
}

// "10:35" (24-hour) for an ISO date text in `timeZone`; '' when there is no date.
export function formatTime(isoText, timeZone) {
  if (!isoText) return '';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(isoText));
}

// When the daily job last updated the data, for the top of the page (Prompt 333): "Today 03:16",
// "Yesterday 03:16" or "Mon 28 Sep 03:16", in `timeZone` (Israel time); '' when there is no date.
export function formatUpdateTime(isoText, timeZone, now = Date.now()) {
  if (!isoText) return '';
  const day = dayKey(isoText, timeZone);
  const today = dayKey(new Date(now).toISOString(), timeZone);
  const yesterday = dayKey(new Date(now - 24 * 60 * 60 * 1000).toISOString(), timeZone);
  const label = day === today ? 'Today' : day === yesterday ? 'Yesterday' : formatDayHeading(isoText, timeZone, now);
  return `${label} ${formatTime(isoText, timeZone)}`;
}
