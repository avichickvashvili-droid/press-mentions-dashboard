// processLock.js — only ONE `npm run daily` may be open at a time (Step 6 review #3, Prompt 296).
//
// Where it sits: runDaily.js takes the lock at start-up and gives it back when it stops.
// Reads/writes: one small file next to the database, daily.lock (e.g. db/daily.lock), holding
// the process number of the open daily job and when it started. No database table (owner, Prompt 296).
// The file is not committed (.gitignore).
//
// Why: two open daily jobs would both run every day and Discord would get two messages.
// How: the file is created only if it does not exist yet (the operating system guarantees only
// one program can create it). If it exists:
//   - its process is still alive → another daily job is open: refuse (the caller exits with 3);
//   - its process is gone (a crash, a closed window) or the file can't be read → it is a leftover:
//     it is removed and the lock is taken.
// Giving it back removes the file, only if it is still ours.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { isProcessAlive } from '../shared/runLock.js';

// The lock file for a database: daily.lock in the database's folder.
export function lockFilePath(dbPath = config.DB_PATH) {
  return path.join(path.dirname(dbPath), 'daily.lock');
}

// Reads the lock file: { pid, startedAt }, or null when it is missing or can't be read.
function readHolder(file) {
  try {
    const holder = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Number.isInteger(holder?.pid) ? holder : null;
  } catch {
    return null;
  }
}

// Takes the lock for this process. Returns { ok: true } or { ok: false, holder: { pid, startedAt } }
// when another live daily job holds it (the file is not changed then).
// Throws only when the file can't be written at all (e.g. no permission).
export function takeProcessLock({
  file = lockFilePath(), pid = process.pid, now = new Date().toISOString(), isAlive = isProcessAlive,
} = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      fs.writeFileSync(file, `${JSON.stringify({ pid, startedAt: now })}\n`, { flag: 'wx' }); // only if it does not exist
      return { ok: true };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const holder = readHolder(file);
    if (holder && holder.pid === pid) return { ok: true };
    if (holder && isAlive(holder.pid)) return { ok: false, holder };
    try { fs.rmSync(file, { force: true }); } catch { /* tried again below */ } // a leftover
  }
  const holder = readHolder(file);
  return holder ? { ok: false, holder } : { ok: false, holder: { pid: null, startedAt: null } };
}

// Gives the lock back: removes the file, only if it belongs to this process.
// Returns true if it was removed. Never throws.
export function releaseProcessLock({ file = lockFilePath(), pid = process.pid } = {}) {
  try {
    if (readHolder(file)?.pid !== pid) return false;
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}
