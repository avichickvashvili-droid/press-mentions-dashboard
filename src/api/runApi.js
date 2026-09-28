// runApi.js — the `npm run api` command: starts the api server, which also serves the dashboard
// page (D19, D34, D98). `npm run dashboard` builds the page first and then runs this.
//
// Where it sits: its own process, separate from the pipeline (`npm start` does not start it).
// It shares only the SQLite file with the collector and the classifier, and only reads it.
// Reads: the database (config.DB_PATH), data/*.json (only when the database is empty), the
// company list files, and web/dist (the built page).
// Writes: the database ONLY for the one-time data/ import into an empty database (D35,
// src/api/importData.js); the data of an existing database is never changed (opening it may
// only switch it to WAL mode and add missing tables or columns); the terminal.
//
// Start-up:
//   1. Open the database (creating the tables if the file is new).
//   2. If it is empty, import data/ (one transaction). If data/ is missing or broken, a clear
//      error is printed and the server still starts, on the database as it is (the page then
//      shows "no companies"). It does not exit, so it can't end up in a crash loop.
//   3. Close that connection and open a READ-ONLY one for serving: the api can never write.
//   4. Listen on API_PORT (default 3000). A port that is already taken gives a clear message.
//
// Exit codes (src/shared/exitCodes.js): 1 = crashed (the database can't be opened, the port is
// taken, an unexpected error), 130 = Ctrl+C, 143 = stop request (SIGTERM).

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { openDatabase, openDatabaseReadOnly } from '../db/database.js';
import { EXIT_CODES } from '../shared/exitCodes.js';
import { describeError } from '../shared/text.js';
import { createApp } from './app.js';
import { importDataIfEmpty } from './importData.js';

let server = null;
let db = null;
let stopping = false;

// Closes the server and the database (each step on its own, so one failure doesn't block the
// other), then exits with the given code. Runs only once.
function stopWith(reason, exitCode) {
  if (stopping) return;
  stopping = true;
  if (exitCode === EXIT_CODES.CRASHED) console.error(`ERROR: Api stopped: ${reason}.`);
  else console.log(`Api stopped: ${reason}.`);
  try {
    server?.close();
    server?.closeAllConnections();
  } catch { /* the server was not running */ }
  try { db?.close(); } catch { /* already closed */ }
  process.exit(exitCode);
}

// Ctrl+C / stop request: a clean stop. An unexpected error: logged with its details, exit 1
// (so a supervisor could restart it).
process.on('SIGINT', () => stopWith('stopped by Ctrl+C', EXIT_CODES.STOPPED_BY_CTRL_C));
process.on('SIGTERM', () => stopWith('stopped by SIGTERM', EXIT_CODES.STOPPED_BY_REQUEST));
process.on('uncaughtException', (error) => {
  console.error(error?.stack ?? error);
  stopWith(`crashed: ${describeError(error)}`, EXIT_CODES.CRASHED);
});
process.on('unhandledRejection', (error) => {
  console.error(error?.stack ?? error);
  stopWith(`crashed (unhandled promise): ${describeError(error)}`, EXIT_CODES.CRASHED);
});

// Step 1 + 2: opens the database (creating the tables if needed) and imports data/ if it is empty.
// Returns false if the database can't be opened at all.
function prepareDatabase() {
  let writeDb;
  try {
    writeDb = openDatabase(config.DB_PATH);
  } catch (error) {
    console.error(`ERROR: Cannot open the database ${config.DB_PATH}: ${describeError(error)}`);
    return false;
  }
  try {
    const result = importDataIfEmpty(writeDb);
    if (result.imported) {
      for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
      console.log(`The database was empty: imported data/ (${result.companies} companies, ${result.mentions} mentions).`);
    }
  } catch (error) {
    console.error(`ERROR: The database is empty and data/ could not be imported: ${describeError(error)}`);
    console.error('The dashboard starts anyway, with no data. Restore the data/ folder (e.g. "git checkout data") and start the api again.');
  } finally {
    try { writeDb.close(); } catch { /* already closed */ }
  }
  return true;
}

// Step 3 + 4: opens the read-only connection and starts listening.
function startServer() {
  db = openDatabaseReadOnly(config.DB_PATH);
  const app = createApp({ db });
  server = app.listen(config.API_PORT);
  server.on('listening', () => {
    console.log(`Dashboard: http://localhost:${config.API_PORT}  (api: /api/companies). Stop with Ctrl+C.`);
    if (!fs.existsSync(path.join(config.WEB_DIST_DIR, 'index.html'))) {
      console.warn('WARNING: The dashboard page is not built yet (web/dist is missing): only the api works. Run "npm run dashboard" to build it and start.');
    }
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      stopWith(`port ${config.API_PORT} is busy (another program uses it). Stop that program, or set API_PORT to another port in .env`, EXIT_CODES.CRASHED);
      return;
    }
    stopWith(`the server could not start: ${describeError(error)}`, EXIT_CODES.CRASHED);
  });
}

console.log(`Api starting on the database ${config.DB_PATH} ...`);
if (!prepareDatabase()) {
  stopWith('the database could not be opened', EXIT_CODES.CRASHED);
} else {
  startServer();
}
