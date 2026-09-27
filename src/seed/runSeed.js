// runSeed.js — the `npm run seed` command: fills/updates the Company table from the data files.
//
// Where it sits: can be run alone at any time; `npm run collect` runs the same seed step
// itself at start-up, so running this first is optional.
// Reads:  the three data files (through seedLoader.js) and JobRun (the lock check).
// Writes: the Company table (one transaction).
//
// It refuses to run while a live collection holds the lock, so a running collection is
// never disturbed. On any problem it prints a clear message, leaving the Company table unchanged.
//
// Exit codes (D68):
//   0  seed done
//   3  refused, nothing is wrong: a live collection holds the lock
//   1  real failure: bad or missing data file, database problem

import { config } from '../config.js';
import { openDatabase } from '../db/database.js';
import { findLiveRun } from '../collector/jobLock.js';
import { seedCompanies } from './seedLoader.js';

// The exit codes of this command (see the table above).
const EXIT_DONE = 0;
const EXIT_FAILED = 1;
const EXIT_REFUSED = 3;

// Runs the seed command and returns the exit code.
function main() {
  let db;
  try {
    db = openDatabase();
    const liveRun = findLiveRun(db);
    if (liveRun) {
      console.error(`ERROR: A collection is running (run ${liveRun.id}, process ${liveRun.owner_pid}). ` +
        'Seeding is not allowed while it runs; "npm run collect" seeds by itself on its next start.');
      return EXIT_REFUSED;
    }
    const result = seedCompanies(db);
    for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
    console.log(`Seed done: ${result.companies.length} companies in the list ` +
      `(${result.inserted} added, ${result.updated} updated) in ${config.DB_PATH}.`);
    return EXIT_DONE;
  } catch (error) {
    console.error(`ERROR: Seed failed, nothing was changed. ${error.message}`);
    return EXIT_FAILED;
  } finally {
    try { db?.close(); } catch { /* closing can only fail if already closed */ }
  }
}

process.exitCode = main();
