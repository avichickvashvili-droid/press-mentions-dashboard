// crash-child.mjs — a tiny program used by jobLock.test.js to check the emergency heartbeat
// in a real separate process. It takes the lock on the given database, installs the emergency
// handlers, and then crashes in the way asked for.
// Usage: node crash-child.mjs <dbPath> <throw|reject>
// Writes: the JobRun table of the given (temporary) database.

import { openDatabase } from '../../src/db/database.js';
import { acquireRun, installEmergencyHandlers } from '../../src/collector/jobLock.js';

const [dbPath, mode] = process.argv.slice(2);
const db = openDatabase(dbPath);
const { runId } = acquireRun(db, []);
installEmergencyHandlers(db, runId, { log: () => {} });
console.log(`RUN ${runId} PID ${process.pid}`);

if (mode === 'reject') {
  Promise.reject(new Error('child rejected a promise'));
} else {
  setTimeout(() => { throw new Error('child crashed on purpose'); }, 0);
}
