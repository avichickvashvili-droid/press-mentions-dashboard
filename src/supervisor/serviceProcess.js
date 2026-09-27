// serviceProcess.js — starts ONE service as its own Node process and reports when it ends.
//
// Where it sits: used by supervisor.js each time it starts (or restarts) a service.
// The service is started as `node --env-file-if-exists=.env <entry>` in the project folder,
// the same command its npm script runs (plus the service's `args`, if any, e.g. the collector's
// `--groups 2,5`, D87), with a private message channel so the orchestrator can
// ask it to stop cleanly (see serviceLink.js).
// Reads: the service's output. Writes: that output to the terminal, each line labelled
// "[collector] ..." (errors stay on the error output).

import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { createLineSplitter } from './logging.js';

// Writes text to a stream, ignoring a failed write (the terminal may be gone).
function safeWrite(stream, text) {
  try {
    stream.write(text);
  } catch {
    // nothing else to do
  }
}

// True for error lines that say nothing on their own in a short summary: stack-trace lines
// ("    at ..."), blank lines and Node's version footer. They are still shown live; they are only
// left out of the "last error lines" kept for the give-up message.
function isNoiseLine(line) {
  return line.trim() === '' || /^\s+at\s/.test(line) || /^Node\.js v\d/.test(line);
}

// Starts the service and returns a handle:
//   pid                   the process id
//   onExit(callback)      callback({ code, signal, error }) runs ONCE when the process has ended
//                         (or could not be started) and all its output has been shown; several
//                         callbacks can be added (the orchestrator's log file also listens)
//   onMessage(callback)   callback(message) for every message the service sends, e.g.
//                         { type: 'run', runId } or { type: 'event', text } (D93)
//   requestStop()         sends { type: 'stop' }; returns false if the message could not be sent
//   forceKill()           hard kill (no emergency heartbeat can be written): the last resort
//   recentErrorLines()    its last few error lines, shown when the orchestrator gives up on it
export function startServiceProcess(service, {
  projectRoot = config.PROJECT_ROOT,
  out = process.stdout,
  err = process.stderr,
  nodePath = process.execPath,
  errorLinesKept = config.ERROR_LINES_KEPT,
} = {}) {
  const entryFile = path.resolve(projectRoot, service.entry);
  const label = `[${service.name}]`;
  const recentErrors = [];
  let exitResult = null;
  const exitCallbacks = [];
  const messageCallbacks = [];

  const outLines = createLineSplitter((line) => safeWrite(out, `${label} ${line}\n`));
  const errLines = createLineSplitter((line) => {
    safeWrite(err, `${label} ${line}\n`);
    if (isNoiseLine(line)) return;
    recentErrors.push(line);
    if (recentErrors.length > errorLinesKept) recentErrors.shift();
  });

  // Hands the end result to the orchestrator exactly once, after the last output is shown.
  function reportExit(result) {
    if (exitResult) return;
    outLines.flush();
    errLines.flush();
    exitResult = result;
    for (const callback of exitCallbacks) callback(result);
  }

  let child;
  try {
    child = spawn(nodePath, ['--env-file-if-exists=.env', entryFile, ...(service.args ?? [])], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
  } catch (error) {
    queueMicrotask(() => reportExit({ code: null, signal: null, error }));
    child = null;
  }

  if (child) {
    child.stdout.on('data', (piece) => outLines.push(piece));
    child.stderr.on('data', (piece) => errLines.push(piece));
    child.stdout.on('error', () => {}); // a broken pipe only loses output; the exit is still reported
    child.stderr.on('error', () => {});
    child.on('message', (message) => {
      for (const callback of messageCallbacks) {
        try {
          callback(message);
        } catch {
          // a message the orchestrator can't handle must not stop it
        }
      }
    });
    child.on('error', (error) => {
      // No pid = the process never started. Otherwise it is a message-channel or kill problem
      // on a running process; the process end is still reported through 'close'.
      if (child.pid === undefined) reportExit({ code: null, signal: null, error });
    });
    // 'close' comes after the process ended AND its output was fully read.
    child.on('close', (code, signal) => reportExit({ code, signal }));
  }

  return {
    pid: child?.pid,
    onExit(callback) {
      if (exitResult) callback(exitResult);
      else exitCallbacks.push(callback);
    },
    onMessage(callback) {
      messageCallbacks.push(callback);
    },
    requestStop() {
      if (!child || !child.connected) return false;
      try {
        child.send({ type: 'stop' }, () => {}); // a send error only means the child is already gone
        return true;
      } catch {
        return false;
      }
    },
    forceKill() {
      try {
        child?.kill('SIGKILL');
      } catch {
        // already gone
      }
    },
    recentErrorLines: () => [...recentErrors],
  };
}
