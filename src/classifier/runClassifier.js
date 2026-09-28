// runClassifier.js — the `npm run classifier` command: the always-on classifier service.
//
// Where it sits: one of the services started by the orchestrator (`npm start`; today the
// collector and the classifier, later also the api), or alone with `npm run classifier` (D38, D62, D66). It runs until it is
// stopped. It meets the other services only through the SQLite database.
// Reads/writes: the database (BufferQueue, Mention, JobRun), Ollama, and data/ at the end of a run.
//
// Start-up: connect to the orchestrator (if any) → open the database → read the section names →
// install the stop/crash handlers → run the loop (classifierLoop.js), which first checks Ollama.
//
// Exit codes (D68, see src/shared/exitCodes.js):
//   1   crashed (including a database error that is not "busy", D76), or could not start
//       (database or section names unreadable)
//   130 stopped by Ctrl+C          143 stopped on request (SIGTERM / orchestrator stop message)
// It never ends with 0 on its own: it is an always-on service.
//
// When it stops or crashes it makes one last clean-up (D48a):
//   - articles it was working on are given back to the queue: on a stop request their attempt is
//     undone (they did nothing wrong); on a crash the attempt still counts (poison-article rule,
//     D59) and they are asked one at a time next time (D78);
//   - if it was holding a run (while finishing it), the emergency heartbeat is written
//     (crashed_at, last_error, owner_pid = NULL) so the next start takes the run over at once.
//
// Log file (D92, D93): classifier.log in the folder of the LATEST run (logs/run-<id>/), checked
// before every line, because the classifier is always on and outlives a run: after run 4 is done
// its lines stay in run-4 until run 5 exists. With no run at all: logs/no-run/. Lines written
// before the database is open are held until the folder is known. It also sends the system-log
// lines (orchestrator.log) through the orchestrator's channel (does nothing when run alone).

import { config } from '../config.js';
import { connectToSupervisor, sendEvent } from '../supervisor/serviceLink.js';
import { createLogFile } from '../shared/logFile.js';
import { latestRunFolder, settleLogFolder } from '../shared/runLogs.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { openDatabase } from '../db/database.js';
import { createOllamaClient } from './ollamaClient.js';
import { loadSectionNames } from './prompt.js';
import { installStopHandlers } from './stopHandlers.js';
import { createClassifier } from './classifierLoop.js';

// The classifier's log file, and the open database once there is one (to find the latest run).
const logFile = createLogFile('classifier.log');
let openDb = null;

// Points the log file at the latest run's folder (see the top). Needs the open database.
function followLatestRun() {
  if (!openDb) return;
  const folder = latestRunFolder({ db: openDb }); // null = can't read now: keep the current folder
  if (folder !== null && folder !== logFile.folder()) logFile.setFolder(folder);
}

// Writes one line to classifier.log, in the latest run's folder. Never throws.
const fileLog = {
  write(text) {
    try {
      followLatestRun();
      logFile.write(text);
    } catch {
      // logging must never stop the classifier
    }
  },
};

// An error line: on the terminal (as before) and in the log file.
function printError(text) {
  fileLog.write(`ERROR: ${text}`);
  console.error(text);
}

// A normal line: on the terminal and in the log file.
function printLine(text) {
  fileLog.write(text);
  console.log(text);
}

// The whole service. Only returns (with an exit code) when it can't start.
async function main() {
  connectToSupervisor();

  let db;
  try {
    db = openDatabase();
  } catch (error) {
    printError(`Cannot open the database: ${error.message}`);
    return EXIT_CODES.CRASHED;
  }
  openDb = db;

  let sectionNames;
  try {
    sectionNames = loadSectionNames();
  } catch (error) {
    printError(error.message);
    return EXIT_CODES.CRASHED;
  }

  const client = createOllamaClient();
  const classifier = createClassifier({ db, client, sectionNames, logFile: fileLog, event: sendEvent });
  // The stop handlers' lines go to the error output (as before) and to the log file.
  const handlers = installStopHandlers({ db, classifier, log: (text) => { fileLog.write(text); console.error(text); } });

  printLine(`Classifier started (process ${process.pid}): model ${client.model} at ${client.baseUrl}, ` +
    `${config.LLM_CONCURRENCY} request(s) at a time, batches of ${config.CLAIM_BATCH}.`);
  try {
    await classifier.runForever();
  } catch (error) {
    handlers.handleFatal(error); // runForever only throws on a database error that is not "busy" (D76)
  }
  return EXIT_CODES.CRASHED; // reached only if the loop ended without a stop request
}

// Gives held lines a folder before the process ends (e.g. the database could not be opened).
function settleBeforeExit() {
  try {
    followLatestRun();
    settleLogFolder(logFile, openDb ? { db: openDb } : {});
  } catch {
    // logging must never stop the classifier
  }
}

main().then(
  (exitCode) => {
    settleBeforeExit();
    process.exit(exitCode);
  },
  (error) => {
    fileLog.write(`ERROR: ${error?.stack ?? error}`);
    settleBeforeExit();
    console.error(`ERROR: ${error?.stack ?? error}`);
    process.exit(EXIT_CODES.CRASHED);
  },
);
