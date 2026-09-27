// runClassifier.js — the `npm run classifier` command: the always-on classifier service.
//
// Where it sits: one of the three services (api, collector, classifier) started by the
// orchestrator (`npm start`), or alone with `npm run classifier` (D38, D62). It runs until it is
// stopped. It meets the other services only through the SQLite database.
// Reads/writes: the database (BufferQueue, Mention, JobRun), Ollama, and data/ at the end of a run.
//
// Start-up: connect to the orchestrator (if any) → open the database → read the section names →
// install the stop/crash handlers → run the loop (classifierLoop.js), which first checks Ollama.
//
// Exit codes (D68, see src/supervisor/exitCodes.js):
//   1   crashed, or could not start (database or section names unreadable)
//   130 stopped by Ctrl+C          143 stopped on request (SIGTERM / orchestrator stop message)
// It never ends with 0 on its own: it is an always-on service.
//
// When it stops or crashes it makes one last clean-up (D48a):
//   - articles it was working on are given back to the queue: on a stop request their attempt is
//     undone (they did nothing wrong); on a crash the attempt still counts (poison-article rule);
//   - if it was holding a run (while finishing it), the emergency heartbeat is written
//     (crashed_at, last_error, owner_pid = NULL) so the next start takes the run over at once.

import { connectToSupervisor } from '../supervisor/serviceLink.js';
import { EXIT_CODES } from '../supervisor/exitCodes.js';
import { openDatabase } from '../db/database.js';
import { classifierConfig } from './classifierConfig.js';
import { createOllamaClient } from './ollamaClient.js';
import { loadSectionNames } from './prompt.js';
import { installStopHandlers } from './stopHandlers.js';
import { createClassifier } from './classifierLoop.js';

// The whole service. Only returns (with an exit code) when it can't start.
async function main() {
  connectToSupervisor();

  let db;
  try {
    db = openDatabase();
  } catch (error) {
    console.error(`Cannot open the database: ${error.message}`);
    return EXIT_CODES.CRASHED;
  }

  let sectionNames;
  try {
    sectionNames = loadSectionNames();
  } catch (error) {
    console.error(error.message);
    return EXIT_CODES.CRASHED;
  }

  const client = createOllamaClient();
  const classifier = createClassifier({ db, client, sectionNames });
  const handlers = installStopHandlers({ db, classifier });

  console.log(`Classifier started (process ${process.pid}): model ${client.model} at ${client.baseUrl}, ` +
    `${classifierConfig.LLM_CONCURRENCY} request(s) at a time, batches of ${classifierConfig.CLAIM_BATCH}.`);
  try {
    await classifier.runForever();
  } catch (error) {
    handlers.handleFatal(error); // runForever never throws; this is a last safety net
  }
  return EXIT_CODES.CRASHED; // reached only if the loop ended without a stop request
}

main().then(
  (exitCode) => { process.exit(exitCode); },
  (error) => {
    console.error(`ERROR: ${error?.stack ?? error}`);
    process.exit(EXIT_CODES.CRASHED);
  },
);
