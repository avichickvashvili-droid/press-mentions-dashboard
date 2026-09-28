// link-emergency.mjs — fake collector for the orchestrator tests. Like the real collector it
// takes the JobRun lock, installs the emergency handlers (D48a) and connects to the orchestrator
// (serviceLink.js); then it keeps running until asked to stop.
// Reads/writes: the JobRun table of the temporary database named by FAKE_DB_PATH.
import { openDatabase } from '../../../src/db/database.js';
import { acquireRun, installEmergencyHandlers } from '../../../src/collector/jobLock.js';
import { connectToSupervisor } from '../../../src/supervisor/serviceLink.js';

connectToSupervisor();
const db = openDatabase(process.env.FAKE_DB_PATH);
const { runId } = acquireRun(db, []);
installEmergencyHandlers(db, runId, { log: (text) => console.error(text) });
setInterval(() => {}, 1000);
console.log(`READY run ${runId} pid ${process.pid}`);
