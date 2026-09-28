// logging.js — how the orchestrator shows output: every line gets a label in front (D66, D69).
//
// Where it sits: used by serviceProcess.js (a service's output, e.g. "[collector] ...") and by
// runSupervisor.js (the orchestrator's own lines, "[orchestrator] 10:15:03 ...").
// Reads: the output of the service processes. Writes: the terminal; the orchestrator's own lines
// also go to its log file, orchestrator.log (D92, D93), when one is given. The services write
// their own log files themselves (src/shared/logFile.js).

import { StringDecoder } from 'node:string_decoder';

// Cuts a stream of text pieces into whole lines. `onLine` gets each line without its line end.
// Returns { push(piece), flush() }: flush() hands over a last line that had no line end.
export function createLineSplitter(onLine) {
  const decoder = new StringDecoder('utf8');
  let pending = '';

  // Adds a piece of output and hands over every line that is now complete.
  function push(piece) {
    pending += typeof piece === 'string' ? piece : decoder.write(piece);
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) onLine(line.replace(/\r$/, ''));
  }

  // Hands over what is left (called when the process has ended).
  function flush() {
    pending += decoder.end();
    if (pending !== '') onLine(pending.replace(/\r$/, ''));
    pending = '';
  }

  return { push, flush };
}

// The time as HH:MM:SS (local), put on the orchestrator's own lines.
function clockTime(date) {
  return date.toTimeString().slice(0, 8);
}

// Creates the orchestrator's own logger: info() goes to standard output, error() to the error
// output, both as "[orchestrator] HH:MM:SS text". A failed write is ignored: logging must never
// crash the orchestrator.
// `file` (optional) = orchestrator.log (src/shared/logFile.js), the system log of the run (D93):
// info() and error() lines also go there ("ERROR: " in front of errors, no label: the file date
// and time replace the clock), and event() writes a line to the file ONLY, e.g. the services'
// "Group 2 done (26/26 finished) → starting group 3". The terminal is not changed.
export function createOrchestratorLog({ out = process.stdout, err = process.stderr, now = () => new Date(), file = null } = {}) {
  // Writes one line to the log file, if there is one (never throws).
  function toFile(text) {
    if (!file) return;
    try {
      file.write(text);
    } catch {
      // logging must never crash the orchestrator
    }
  }

  // Writes one labelled line to the given stream.
  function write(stream, text) {
    try {
      stream.write(`[orchestrator] ${clockTime(now())} ${text}\n`);
    } catch {
      // the terminal is gone; nothing else to do
    }
  }
  return {
    info: (text) => { toFile(text); write(out, text); },
    error: (text) => { toFile(`ERROR: ${text}`); write(err, `ERROR: ${text}`); },
    event: (text) => toFile(text),
  };
}
