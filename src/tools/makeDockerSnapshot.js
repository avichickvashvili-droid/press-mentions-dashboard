// makeDockerSnapshot.js — `npm run docker:snapshot`: copies the database into the file that ships
// with the Docker setup (owner, Prompt 345: "ship with the data and DB").
//
// Where it sits: a helper command for the owner, run by hand before a delivery. The Docker image
// takes docker/seed/press-mentions.sqlite as its starting database; the first
// `docker compose up -d` copies it into the database volume (D116).
// Reads: the SQLite file at config.DB_PATH, opened READ-ONLY (the live database is never
// changed, not even merged). Writes: docker/seed/press-mentions.sqlite (replaced).
//
// How: SQLite's `VACUUM INTO` writes one clean, compact file that already includes the changes
// still waiting in the -wal file. It is safe while the daily job runs: a reader never blocks a
// writer (WAL mode), and the copy is one consistent moment.
//
// Failures: no database → a plain message and exit 1; a copy that fails → the half-written file
// is removed, the old snapshot stays as it was, and the exit code is 1.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { describeError, formatCount } from '../shared/text.js';

// Where the snapshot goes (the Dockerfile copies it from here).
export const SNAPSHOT_PATH = path.join(config.PROJECT_ROOT, 'docker', 'seed', 'press-mentions.sqlite');

// Copies `source` (read-only) into `target` as one clean file. Written to target + '.tmp' first
// and renamed at the end, so a failed copy never leaves a broken snapshot behind.
// Returns { mentions, companies, bytes } of the new snapshot.
export function makeSnapshot({ source = config.DB_PATH, target = SNAPSHOT_PATH } = {}) {
  if (!fs.existsSync(source)) throw new Error(`no database at ${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  fs.rmSync(temp, { force: true }); // VACUUM INTO refuses to write over a file
  try {
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    const copy = new DatabaseSync(temp, { readOnly: true });
    let counts;
    try {
      counts = copy.prepare('SELECT (SELECT COUNT(*) FROM Mention) AS mentions, (SELECT COUNT(*) FROM Company) AS companies').get();
    } finally {
      copy.close();
    }
    fs.renameSync(temp, target);
    return { mentions: counts.mentions, companies: counts.companies, bytes: fs.statSync(target).size };
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// The command: makes the snapshot and prints one line about it.
function main() {
  try {
    const { mentions, companies, bytes } = makeSnapshot();
    console.log(`Docker snapshot written: ${path.relative(config.PROJECT_ROOT, SNAPSHOT_PATH)} · ${formatCount(companies)} companies · ${formatCount(mentions)} mentions · ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  } catch (error) {
    console.error(`Docker snapshot failed: ${describeError(error)}. The old snapshot was not changed.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
