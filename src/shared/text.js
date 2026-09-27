// text.js — small text helpers shared by the collector, the classifier and the seed.
//
// Where it sits: used wherever a headline is compared or put in a prompt (stripPublisherSuffix),
// a number is shown to a person (formatCount), an error is written to a log or to
// JobRun.last_error (describeError), or text from the internet is printed in a log (cleanForLog), or a length of time is written
// in a log line (describeDuration).
// Reads/writes: nothing (pure functions).

import { config } from '../config.js';

// Removes the trailing " - Publisher" from a headline. Google gives headlines as
// "Headline - Publisher". Used when comparing titles for the D33 duplicate check, and for the
// prompt (the model test passed the headline without it). The stored title is never changed (D55).
// "Harvey raises $300M - Reuters" with publisher "Reuters" -> "Harvey raises $300M".
export function stripPublisherSuffix(title, publisher) {
  if (!publisher) return title;
  const suffix = ` - ${publisher}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

// Formats a number with thousands separators, e.g. 10000 -> "10,000".
export function formatCount(count) {
  return Number(count).toLocaleString('en-US');
}

// Turns any thrown value into readable text, e.g. "Error: boom".
export function describeError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

// Control characters (C0: 0x00-0x1F and DEL 0x7F; C1: 0x80-0x9F). In a terminal some of them
// start escape codes that can move the cursor or rewrite the progress line.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

// Makes text that came from the internet (a headline, a publisher name, a guid) safe to print in
// a log line: control characters are removed and the text is cut to LOG_TEXT_MAX_CHARS
// characters, with "…" at the end when it was cut. Only for logs: the stored text and the text
// sent to the AI model are not changed.
export function cleanForLog(text, maxChars = config.LOG_TEXT_MAX_CHARS) {
  const clean = String(text ?? '').replace(CONTROL_CHARACTERS, '');
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}…` : clean;
}

// A length of time for a log line: 12 s, 1 min 12 s, 2 h 5 min (rounded to whole seconds).
export function describeDuration(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}
