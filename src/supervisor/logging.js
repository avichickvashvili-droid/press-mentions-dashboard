// logging.js — how the orchestrator shows output: every line gets a label in front (D66, D69).
//
// Where it sits: used by serviceProcess.js (a service's output, e.g. "[collector] ...") and by
// runSupervisor.js (the orchestrator's own lines, "[orchestrator] 10:15:03 ...").
// Reads: the output of the service processes. Writes: the terminal only (no log files).

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
export function createOrchestratorLog({ out = process.stdout, err = process.stderr, now = () => new Date() } = {}) {
  // Writes one labelled line to the given stream.
  function write(stream, text) {
    try {
      stream.write(`[orchestrator] ${clockTime(now())} ${text}\n`);
    } catch {
      // the terminal is gone; nothing else to do
    }
  }
  return {
    info: (text) => write(out, text),
    error: (text) => write(err, `ERROR: ${text}`),
  };
}
