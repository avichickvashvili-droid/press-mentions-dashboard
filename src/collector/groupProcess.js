// groupProcess.js — starts ONE group process (runGroup.js) as a child of the group runner (D83).
//
// Where it sits: used by groupRunner.js each time it starts (or restarts) a group. The child is
// `node <the runner's own Node options> src/collector/runGroup.js <runId> <groupNumber> <runnerPid>`,
// with a private message channel (IPC) so the runner can ask it to stop and hear its "still
// alive" messages (D90). The runner's own Node options are passed on (e.g. --env-file-if-exists,
// or a test's --import), so the child runs with the same settings as the runner.
// Reads: the child's messages and its error output. Writes: the child's normal output goes
// straight to the runner's output (so the progress line keeps working in a terminal); its error
// output is passed on line by line to the runner's error output, and the last line is kept, so
// the runner can say why a group process crashed (JobRunGroup.last_error).

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLineSplitter } from '../supervisor/logging.js';

// The group process's start file (next to this file).
export const GROUP_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runGroup.js');

// Writes text to a stream, ignoring a failed write (the terminal may be gone).
function safeWrite(stream, text) {
  try {
    stream.write(text);
  } catch {
    // nothing else to do
  }
}

// Starts the group process and returns a handle:
//   pid                   the process id (undefined if it could not start)
//   onMessage(callback)   callback(message) for every message it sends (e.g. { type: 'alive' })
//   onExit(callback)      callback({ code, signal, error }) runs ONCE when it has ended (or
//                         could not start) and its error output has been passed on
//   requestStop()         sends { type: 'stop' }; returns false if it could not be sent
//   forceKill()           hard kill: the last resort
//   lastErrorLine()       its last non-empty error line, or null
export function startGroupProcess({ runId, groupNumber, runnerPid }, {
  entry = GROUP_ENTRY,
  nodePath = process.execPath,
  nodeOptions = process.execArgv,
  env = process.env,
  err = process.stderr,
} = {}) {
  let lastErrorLine = null;
  let exitResult = null;
  let exitCallback = null;
  const messageCallbacks = [];

  const errLines = createLineSplitter((line) => {
    safeWrite(err, `${line}\n`);
    if (line.trim() !== '' && !/^\s+at\s/.test(line) && !/^Node\.js v\d/.test(line)) lastErrorLine = line.trim();
  });

  // Hands the end result over exactly once, after the last error output was passed on.
  function reportExit(result) {
    if (exitResult) return;
    errLines.flush();
    exitResult = result;
    if (exitCallback) exitCallback(result);
  }

  let child = null;
  try {
    child = spawn(nodePath, [...nodeOptions, entry, String(runId), String(groupNumber), String(runnerPid)], {
      env,
      stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
      windowsHide: true,
    });
  } catch (error) {
    queueMicrotask(() => reportExit({ code: null, signal: null, error }));
  }

  if (child) {
    child.stderr.on('data', (piece) => errLines.push(piece));
    child.stderr.on('error', () => {}); // a broken pipe only loses output; the exit is still reported
    child.on('message', (message) => {
      for (const callback of messageCallbacks) callback(message);
    });
    child.on('error', (error) => {
      // No pid = it never started. Otherwise a channel or kill problem; the end still comes via 'close'.
      if (child.pid === undefined) reportExit({ code: null, signal: null, error });
    });
    child.on('close', (code, signal) => reportExit({ code, signal }));
  }

  return {
    pid: child?.pid,
    onMessage(callback) {
      messageCallbacks.push(callback);
    },
    onExit(callback) {
      exitCallback = callback;
      if (exitResult) callback(exitResult);
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
    lastErrorLine: () => lastErrorLine,
  };
}
