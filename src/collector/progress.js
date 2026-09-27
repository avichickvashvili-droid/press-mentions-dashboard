// progress.js — the one-line progress display of the collector (I10).
//
// Where it sits: the company loop and the Google News client tell it what is happening;
// it prints it. Each group process has its own display. Example line:
//   group 3/10 · company 5/26 · Harvey · fetching · window 3 · queue 3,400/10,000 · Google unreachable, retry in 1 min
// Reads: nothing. Writes: the terminal, and the process's log file if one is given (D92).
//
// In a real terminal the line is redrawn in place. When the output goes to a file or another
// program, a new line is printed each time the line changes. Warnings and errors always get
// their own line, so they stay visible.
//
// The log file (optional `logFile`, see src/shared/logFile.js) is kept lean (D93): it gets the
// messages, warnings and errors, but never the progress line itself. record(text) writes a line
// to the log file only (e.g. the "company finished" line); the terminal does not show it.

import { config } from '../config.js';
import { formatCount } from '../shared/text.js';

// Creates the progress display. `out` receives the progress line and info messages, `err`
// receives warnings and errors. `interactive` = redraw in place (default: when `out` is a terminal).
// `logFile` (optional) = the process's log file.
export function createProgress({ out = process.stdout, err = process.stderr, interactive = Boolean(out.isTTY), logFile = null } = {}) {
  const state = {
    groupNumber: null,
    groupTotal: null,
    companyNumber: null,
    companyTotal: null,
    companyName: null,
    phase: null,
    window: null,
    queueCount: null,
    note: null,
  };
  let lastLine = '';
  let lineIsOnScreen = false;

  // Builds the progress line from the current state (parts that are unknown are left out).
  function buildLine() {
    const parts = [];
    if (state.groupNumber !== null) parts.push(`group ${state.groupNumber}/${state.groupTotal}`);
    if (state.companyNumber !== null) parts.push(`company ${state.companyNumber}/${state.companyTotal}`);
    if (state.companyName) parts.push(state.companyName);
    if (state.phase) parts.push(state.phase);
    if (state.window !== null) parts.push(`window ${state.window}`);
    if (state.queueCount !== null) parts.push(`queue ${formatCount(state.queueCount)}/${formatCount(config.CAP)}`);
    if (state.note) parts.push(state.note);
    return parts.join(' · ');
  }

  // Removes the in-place line from the screen, so a message can be printed cleanly.
  function clearLine() {
    if (interactive && lineIsOnScreen) {
      out.write('\r\x1b[K');
      lineIsOnScreen = false;
    }
  }

  // Prints the line: redrawn in place, or as a new line when it changed (non-interactive).
  function render() {
    const line = buildLine();
    if (interactive) {
      out.write(`\r\x1b[K${line}`);
      lineIsOnScreen = true;
    } else if (line !== lastLine) {
      out.write(`${line}\n`);
    }
    lastLine = line;
  }

  // Writes a line to the log file, if there is one. Never throws.
  function toFile(text) {
    if (!logFile) return;
    try {
      logFile.write(text);
    } catch {
      // logging must never stop the program
    }
  }

  // Prints a message on its own line, then puts the progress line back; also to the log file.
  function printMessage(stream, text) {
    toFile(text);
    clearLine();
    stream.write(`${text}\n`);
    if (interactive && lastLine) render();
  }

  return {
    // Changes some fields of the line (e.g. { phase: 'fetching', window: 3 }) and redraws it.
    update(fields) {
      Object.assign(state, fields);
      render();
    },
    // A normal message on its own line.
    info(text) {
      printMessage(out, text);
    },
    // A warning on its own line.
    warn(text) {
      printMessage(err, `WARNING: ${text}`);
    },
    // An error on its own line.
    error(text) {
      printMessage(err, `ERROR: ${text}`);
    },
    // A line for the log file only (not shown on the terminal).
    record(text) {
      toFile(text);
    },
    // Ends the progress line (moves to a fresh line) before the final summary.
    finish() {
      if (interactive && lineIsOnScreen) out.write('\n');
      lineIsOnScreen = false;
      lastLine = '';
    },
  };
}
