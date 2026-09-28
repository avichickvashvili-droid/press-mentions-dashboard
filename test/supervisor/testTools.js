// testTools.js — shared fakes for the orchestrator tests (no real waiting, no Google, no Ollama).
//
// Where it sits: imported by test/supervisor/*.test.js only.
// Reads/writes: nothing outside memory.

import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

// The folder with the tiny fake services (they exit, crash or hang on purpose).
export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

// A clock the test moves forward by hand: timers run only when advance() passes their time.
export function createFakeClock(start = 1_000_000) {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    // Moves time forward, running every timer that falls due, in time order.
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = end;
    },
    pendingTimers: () => timers.size,
  };
}

// A logger that keeps every line, so tests can check what the orchestrator said.
export function createFakeLog() {
  const lines = [];
  return {
    lines,
    info: (text) => lines.push(`INFO ${text}`),
    error: (text) => lines.push(`ERROR ${text}`),
    text: () => lines.join('\n'),
  };
}

// A fake process launcher: each start creates a fake process the test ends by hand with
// end(code). Records stop requests and force-kills.
export function createFakeLauncher() {
  const started = [];
  function startProcess(service) {
    let exitCallback = null;
    const fake = {
      service: service.name,
      stopRequests: 0,
      killed: false,
      ended: false,
      end(code, signal = null) {
        fake.ended = true;
        exitCallback?.({ code, signal });
      },
      handle: {
        pid: 1000 + started.length,
        onExit: (callback) => { exitCallback = callback; },
        requestStop: () => { fake.stopRequests += 1; return true; },
        forceKill: () => { fake.killed = true; },
        recentErrorLines: () => ['Error: boom'],
      },
    };
    started.push(fake);
    return fake.handle;
  }
  // The most recent fake process of a service.
  const latest = (name) => started.filter((s) => s.service === name).at(-1);
  return { startProcess, started, latest };
}

// A stand-in for the terminal: keeps every written line and lets a test wait for one.
export function createCaptureStream() {
  const events = new EventEmitter();
  let text = '';
  return {
    write(piece) {
      text += piece;
      events.emit('write');
      return true;
    },
    text: () => text,
    lines: () => text.split('\n').filter((line) => line !== ''),
    // Resolves when the written text matches the pattern (fails the test after timeoutMs).
    waitFor(pattern, timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const match = text.match(pattern);
          if (match) {
            events.off('write', check);
            clearTimeout(timer);
            resolve(match);
          }
        };
        const timer = setTimeout(() => {
          events.off('write', check);
          reject(new Error(`timed out waiting for ${pattern}; output so far:\n${text}`));
        }, timeoutMs);
        events.on('write', check);
        check();
      });
    },
  };
}

// Waits for a real process handle to end and returns { code, signal, error }.
export function waitForExit(handle) {
  return new Promise((resolve) => handle.onExit(resolve));
}
