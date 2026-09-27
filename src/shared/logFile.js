// logFile.js — writes one process's log file: logs/run-<id>/<name>.log (D92).
//
// Where it sits: each process (orchestrator, collector runner, group process, classifier) creates
// one log file with createLogFile() and writes its lines to it, next to what it already prints on
// the terminal. The terminal output is not changed by this file.
// Reads: nothing. Writes: the log file (created with its folders when needed).
//
// How it works:
//   - every line gets the local date and time in front: "2026-09-27 14:03:11.482 text";
//   - a process may not know its run yet (e.g. the collector before it has taken the run). Until
//     setFolder() is called, lines are held in memory (at most LOG_HELD_LINES_MAX), with the time
//     they were written, and written to the file as soon as the folder is known;
//   - each line is appended with open-write-close, so the file is never kept open (another
//     program can read it live, and the folder can be removed on Windows);
//   - writing a log file must never crash or stop the program: if a write fails, ONE warning is
//     shown on the terminal and the program carries on (later lines are still tried quietly).

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Terminal escape codes (e.g. the progress line's "\r\x1b[K") and other control characters
// except the tab. They mean nothing in a file.
const ESCAPE_CODES = /\x1b\[[0-9;?]*[A-Za-z]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;

// The folder name of a run inside the logs folder: 5 -> "run-5".
export function runFolderName(runId) {
  return `run-${runId}`;
}

// The local date and time as "2026-09-27 14:03:11.482".
export function formatLogTime(date) {
  const two = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

// Cleans one line for the file: removes terminal escape codes and control characters, and the
// end-of-line spaces.
function cleanLine(line) {
  return line.replace(ESCAPE_CODES, '').replace(CONTROL_CHARACTERS, '').trimEnd();
}

// Creates the log file writer of one process. `fileName` is e.g. 'collector.log'.
// Returns:
//   write(text)          adds the text (one or more lines) with the date and time in front;
//                        empty lines are skipped
//   setFolder(folder)    the folder inside the logs folder, e.g. runFolderName(5) or
//                        config.LOG_NO_RUN_FOLDER; writes the held lines there. Can be called
//                        again later (e.g. the classifier moves to a new run's folder)
//   folder()             the current folder, or null while lines are held
//   filePath()           the full path of the file, or null while lines are held
export function createLogFile(fileName, {
  logsDir = config.LOGS_DIR,
  heldLinesMax = config.LOG_HELD_LINES_MAX,
  now = () => new Date(),
  warnOut = process.stderr,
  fileSystem = fs,
} = {}) {
  let currentFolder = null;
  let held = [];       // lines waiting for the folder, already with their time
  let droppedHeld = 0; // held lines dropped because too many were held
  let warned = false;

  // Shows the one warning about this log file on the terminal (never throws).
  function warnOnce(error) {
    if (warned) return;
    warned = true;
    try {
      warnOut.write(`WARNING: the log file ${fileName} could not be written (${error?.message ?? error}). ` +
        'The program carries on; this is not shown again.\n');
    } catch {
      // the terminal is gone too; nothing else to do
    }
  }

  // Appends ready lines to the file (creating its folder if needed). A failure only warns.
  function append(lines) {
    if (lines.length === 0) return;
    try {
      const dir = path.join(logsDir, currentFolder);
      fileSystem.mkdirSync(dir, { recursive: true });
      fileSystem.appendFileSync(path.join(dir, fileName), `${lines.join('\n')}\n`, 'utf8');
    } catch (error) {
      warnOnce(error);
    }
  }

  // The date and time for a line now (a broken clock gives question marks, never an error).
  function stampNow() {
    try {
      return formatLogTime(now());
    } catch {
      return '????-??-?? ??:??:??.???';
    }
  }

  function write(text) {
    const stamp = stampNow();
    const lines = String(text ?? '').split(/\r?\n|\r/).map(cleanLine).filter((line) => line !== '')
      .map((line) => `${stamp} ${line}`);
    if (lines.length === 0) return;
    if (currentFolder !== null) {
      append(lines);
      return;
    }
    held.push(...lines);
    if (held.length > heldLinesMax) {
      droppedHeld += held.length - heldLinesMax;
      held = held.slice(held.length - heldLinesMax);
    }
  }

  function setFolder(folder) {
    currentFolder = String(folder);
    if (held.length === 0 && droppedHeld === 0) return;
    const lines = droppedHeld > 0
      ? [`${stampNow()} (${droppedHeld} earlier line(s) were dropped: too many lines before the run was known)`, ...held]
      : held;
    held = [];
    droppedHeld = 0;
    append(lines);
  }

  return {
    write,
    setFolder,
    folder: () => currentFolder,
    filePath: () => (currentFolder === null ? null : path.join(logsDir, currentFolder, fileName)),
  };
}
