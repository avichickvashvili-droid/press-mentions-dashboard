// runSupervisor.js — the `npm start` command: the orchestrator (supervisor) of the services.
//
// Where it sits: the one command a person runs to start the system (D38, D66). It starts each
// service in services.js (today: collector + classifier; the api later) as its own Node
// process and keeps them alive. The services share only the SQLite file; each can also run
// alone with its own npm script (`npm run collect`, `npm run classifier`).
// Reads: nothing itself (the collector's start check reads JobRun, read-only).
// Writes: the terminal. Each line is labelled: [orchestrator], [collector], [classifier].
// And its own log file, orchestrator.log (D92, D93): the system log of the run, i.e. its own
// lines plus the event lines the services send (see systemLog.js), in logs/run-<id>/. Each
// service writes its own log file itself (collector.log, group-N.log, classifier.log).
//
// What it does:
//   - the collector is launched only if the 90-day collection never completed (D67);
//   - `npm start -- --groups 2,5` (D87): re-runs those groups of the latest run. The option is
//     checked first (whole numbers from 1, and groups that exist in the latest run); if it is
//     wrong, a clear message is shown, nothing is started, and the orchestrator ends with 3.
//     Otherwise the collector is started with `--groups 2,5` even though the collection is
//     complete (it refuses by itself, exit 3, if the latest run is not 'done');
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
//   itself failed · 3 `--groups` was wrong, nothing was started · 130 stopped by Ctrl+C ·
//   143 stopped by SIGTERM

import { servicesFor } from './services.js';
import { checkGroupsRequest } from './collectionCheck.js';
import { readGroupsOption } from '../shared/groupsOption.js';
import { createSupervisor } from './supervisor.js';
import { startServiceProcess } from './serviceProcess.js';
import { createOrchestratorLog } from './logging.js';
import { createSystemLog } from './systemLog.js';
import { createLogFile } from '../shared/logFile.js';
import { EXIT_CODES } from '../shared/exitCodes.js';

const logFile = createLogFile('orchestrator.log');
const log = createOrchestratorLog({ file: logFile });
const systemLog = createSystemLog({ logFile, log });

// Reads and checks `--groups` before anything starts. Returns the chosen groups (or null for a
// normal start), or undefined when the option is wrong (the message is already logged).
function readCheckedGroups() {
  const option = readGroupsOption(process.argv.slice(2));
  if (option.error) {
    log.error(option.error);
    return undefined;
  }
  if (!option.groups) return null;
  let check;
  try {
    check = checkGroupsRequest(option.groups);
  } catch (error) {
    log.error(`--groups could not be checked: the database cannot be read (${error.message}).`);
    return undefined;
  }
  if (!check.ok) {
    log.error(check.reason);
    return undefined;
  }
  return option.groups;
}

const groups = readCheckedGroups();
if (groups === undefined) {
  log.error('Nothing was started.');
  systemLog.settle();
  process.exit(EXIT_CODES.REFUSED);
}

const supervisor = createSupervisor({
  services: servicesFor({ groups }),
  startProcess: (service) => {
    const handle = startServiceProcess(service);
    handle.onMessage((message) => systemLog.onServiceMessage(message));
    // A collector that ended without saying which run it had: the held lines still get a folder.
    if (service.name === 'collector') handle.onExit(() => systemLog.settle());
    return handle;
  },
  log,
  onFinished: (exitCode) => {
    systemLog.settle();
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

supervisor.start().then(
  () => {
    // The collector was not started (collection complete, missing file, failed check): nobody
    // will name the run, so the orchestrator's lines go to the latest run's folder now.
    if (supervisor.statuses().collector !== 'running') systemLog.settle();
  },
  onOwnError,
);
