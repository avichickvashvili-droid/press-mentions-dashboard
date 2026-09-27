// runSupervisor.js — the `npm start` command: the orchestrator (supervisor) of the services.
//
// Where it sits: the one command a person runs to start the system (D38, D66). It starts each
// service in services.js (today: collector + classifier; the api later) as its own Node
// process and keeps them alive. The services share only the SQLite file; each can also run
// alone with its own npm script (`npm run collect`, `npm run classifier`).
// Reads: nothing itself (the collector's start check reads JobRun, read-only).
// Writes: the terminal only. Each line is labelled: [orchestrator], [collector], [classifier].
//
// What it does:
//   - the collector is launched only if the 90-day collection never completed (D67);
//   - a service that crashes is restarted after 1 s, 2 s, 5 s, 10 s, 30 s, 60 s ... and each
//     restart is logged; more than 5 crashes in 10 minutes -> that service is given up (D69);
//   - Ctrl+C: every service is asked to stop cleanly and writes its emergency heartbeat first
//     (D48a, D70); after 10 s anything still running is force-killed. A second Ctrl+C
//     force-kills at once;
//   - it ends by itself when nothing is left to supervise.
//
// Exit codes of the services (full table in src/shared/exitCodes.js):
//   0 finished · 3 refused, nothing wrong · 1 crash · 130 Ctrl+C · 143 stop request
// Exit code of the orchestrator itself:
//   0 everything finished normally · 1 a service was given up / missing, or the orchestrator
//   itself failed · 130 stopped by Ctrl+C · 143 stopped by SIGTERM

import { SERVICES } from './services.js';
import { createSupervisor } from './supervisor.js';
import { startServiceProcess } from './serviceProcess.js';
import { createOrchestratorLog } from './logging.js';
import { EXIT_CODES } from '../shared/exitCodes.js';

const log = createOrchestratorLog();

const supervisor = createSupervisor({
  services: SERVICES,
  startProcess: (service) => startServiceProcess(service),
  log,
  onFinished: (exitCode) => {
    process.exitCode = exitCode;
  },
});

// First Ctrl+C = clean stop; a second one = force-kill now.
let ctrlCCount = 0;
process.on('SIGINT', () => {
  ctrlCCount += 1;
  if (ctrlCCount === 1) {
    log.info('Ctrl+C received. Press Ctrl+C again to force-kill everything now.');
    supervisor.stop(EXIT_CODES.STOPPED_BY_CTRL_C);
  } else {
    supervisor.forceStop();
  }
});
process.on('SIGTERM', () => supervisor.stop(EXIT_CODES.STOPPED_BY_REQUEST));

// An error inside the orchestrator itself must not leave the services running unsupervised:
// stop them cleanly (a second error force-kills them).
let ownErrors = 0;
function onOwnError(error) {
  ownErrors += 1;
  log.error(`The orchestrator itself failed: ${error?.stack ?? error}`);
  if (ownErrors === 1) supervisor.stop(EXIT_CODES.CRASHED);
  else supervisor.forceStop();
}
process.on('uncaughtException', onOwnError);
process.on('unhandledRejection', onOwnError);

supervisor.start().catch(onOwnError);
