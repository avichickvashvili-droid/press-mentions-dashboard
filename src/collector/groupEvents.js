// groupEvents.js — the lines a group process sends for the orchestrator's system log
// (orchestrator.log, D92/D93), built so that a long problem gives ONE line when it starts and
// ONE when it ends, never a line per retry or per check.
//
// Where it sits: used by runGroup.js (a group process). The lines are sent with `event(text)`
// (in real use: sendEvent from serviceLink.js, to the runner, which passes them on to the
// orchestrator). Every single Google retry is still written to the group's own file (group-N.log).
// Reads/writes: nothing (the clock only).
//
// Examples:
//   Google problems started: Google is busy or limiting us (HTTP 429) at Harvey; retrying
//   Google OK again after 7 min (5 retries)
//   Queue full (10,000): collector waiting for the LLM
//   Queue has room again (8,000): collector resumed after 12 min
//   Company Acme Bio failed: Google rejected the search (HTTP 400), 3 tries 1 min apart

import { config } from '../config.js';
import { cleanForLog, describeDuration, formatCount } from '../shared/text.js';

// Follows a streak of Google problems. retry(info) is called before every retry wait (the Google
// client's onRetry info: reason, companyName); ok() after every search that worked. The first
// retry of a streak sends "started", the first ok() after it sends "OK again".
export function createGoogleStreak({ event, now = Date.now }) {
  let startedAt = null;
  let retries = 0;
  return {
    retry(info) {
      retries += 1;
      if (startedAt !== null) return;
      startedAt = now();
      const who = info?.companyName ? ` at ${cleanForLog(info.companyName)}` : '';
      event(`Google problems started: ${info?.reason ?? 'unknown problem'}${who}; retrying`);
    },
    ok() {
      if (startedAt === null) return;
      event(`Google OK again after ${describeDuration(now() - startedAt)} (${retries} ${retries === 1 ? 'retry' : 'retries'})`);
      startedAt = null;
      retries = 0;
    },
  };
}

// Follows the waits for room in the queue: waiting(count) is called on every check while the
// queue is full, resumed(count) once the wait is over. One line when the wait starts, one when it
// ends.
export function createQueueWaitEvents({ event, now = Date.now }) {
  let waitingSince = null;
  return {
    waiting() {
      if (waitingSince !== null) return;
      waitingSince = now();
      event(`Queue full (${formatCount(config.CAP)}): collector waiting for the LLM`);
    },
    resumed(queueCount) {
      if (waitingSince === null) return;
      const count = queueCount === null || queueCount === undefined ? '' : ` (${formatCount(queueCount)})`;
      event(`Queue has room again${count}: collector resumed after ${describeDuration(now() - waitingSince)}`);
      waitingSince = null;
    },
  };
}

// The line for a company that failed (D85), e.g.
// "Company Acme Bio failed: Google rejected the search (HTTP 400), 3 tries 1 min apart".
export function companyFailedEvent(companyName, reason) {
  return `Company ${cleanForLog(companyName)} failed: ${reason}`;
}
