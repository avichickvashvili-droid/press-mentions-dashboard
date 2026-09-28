// offline-collect.mjs — makes the REAL collector run offline and fast, for test/commands.test.js,
// test/runCollect.test.js and test/runGroup.test.js. It is loaded with
// `node --import <this file> src/collector/runCollect.js` (or runGroup.js), so it runs first, in
// the same process. The group runner passes its Node options on to its group processes, so every
// group process loads this file too. It changes these things before the collector starts:
//   - the company list, hints and section-words files come from the test (TEST_COMPANY_LIST,
//     TEST_HINTS, TEST_KEYWORDS), so only a few companies are collected;
//   - the 1-second pace between Google requests is set to 0;
//   - `fetch` is replaced by a fake that answers every search with a tiny feed of 2 articles
//     dated 2 days ago. Nothing is sent to Google.
// Optional settings (environment variables):
//   TEST_TAKE_OVER_PID      the first search also simulates another collector taking the run
//                           over: JobRun.owner_pid becomes this process id (D71)
//   TEST_GROUP_SIZE         the target group size (GROUP_TARGET_SIZE), so a small list has several groups
//   TEST_FAST=1             no waits: group restarts, the 1-minute wait after a Google 400, the
//                           short "was it a Ctrl+C?" wait
//   TEST_FETCH_LOG          a file; every search appends "<process id> <company name>" to it
//   TEST_FETCH_MODE         'hang'  = every search waits a very long time (the program is stopped
//                                     while it waits);
//                           'crash' = the first search throws an error nobody catches
//   TEST_CRASH_COMPANY      a company name: searching it crashes the process (an uncaught error),
//   TEST_CRASH_TIMES        at most this many times in total (default 1), counted in the file
//   TEST_CRASH_COUNTER      TEST_CRASH_COUNTER (shared by all processes of the test)
//   TEST_BAD_REQUEST_COMPANY  a company name: Google answers HTTP 400 for it, every time
// Reads: the environment variables above and DB_PATH. Writes: JobRun (only for the take-over),
// and the TEST_FETCH_LOG / TEST_CRASH_COUNTER files.

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../../src/config.js';

config.COMPANY_LIST_FILE = process.env.TEST_COMPANY_LIST;
config.COMPANY_HINTS_FILE = process.env.TEST_HINTS;
config.SECTION_KEYWORDS_FILE = process.env.TEST_KEYWORDS;
config.REQUEST_INTERVAL_MS = 0;
config.REQUEST_JITTER_MS = 0;
if (process.env.TEST_GROUP_SIZE) config.GROUP_TARGET_SIZE = Number(process.env.TEST_GROUP_SIZE);
if (process.env.TEST_FAST === '1') {
  config.GROUP_RESTART_WAITS_MS = [0];
  config.BAD_REQUEST_WAIT_MS = 0;
  config.STOP_SIGNAL_GRACE_MS = 50;
}

const takeOverPid = process.env.TEST_TAKE_OVER_PID ? Number(process.env.TEST_TAKE_OVER_PID) : null;
let tookOver = false;
const fetchMode = process.env.TEST_FETCH_MODE ?? '';

// A tiny RSS feed with 2 articles for one company, dated 2 days ago (inside the 90 days).
function feedFor(name) {
  const pubDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toUTCString();
  const items = [1, 2].map((number) => `
    <item>
      <title>${name} news ${number} - Example News</title>
      <link>https://news.google.com/rss/articles/${name}-${number}?oc=5</link>
      <guid isPermaLink="false">${name}-${number}</guid>
      <pubDate>${pubDate}</pubDate>
      <source url="https://example.com">Example News</source>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>test</title>${items}</channel></rss>`;
}

// Another collector takes the run over: owner_pid becomes takeOverPid (one short write).
function simulateTakeOver() {
  const db = new DatabaseSync(config.DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    db.prepare("UPDATE JobRun SET owner_pid = ? WHERE status = 'running'").run(takeOverPid);
  } finally {
    db.close();
  }
}

// True (and counted) when this search of `name` must crash the process: TEST_CRASH_COMPANY
// matches and the shared counter file is still below TEST_CRASH_TIMES.
function shouldCrash(name) {
  if (process.env.TEST_CRASH_COMPANY !== name) return false;
  const counterFile = process.env.TEST_CRASH_COUNTER;
  const limit = Number(process.env.TEST_CRASH_TIMES ?? 1);
  const count = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) : 0;
  if (count >= limit) return false;
  fs.writeFileSync(counterFile, String(count + 1));
  return true;
}

// Crashes the process with an uncaught error, and never answers the search.
async function crashNow(text) {
  setTimeout(() => { throw new Error(text); }, 0);
  await new Promise((resolve) => setTimeout(resolve, 10 * 60 * 1000));
}

// The fake fetch: reads the company name from the search text and answers with its feed.
globalThis.fetch = async (url) => {
  const query = new URL(url).searchParams.get('q');
  const name = query.match(/"([^"]+)"/)[1];
  if (process.env.TEST_FETCH_LOG) fs.appendFileSync(process.env.TEST_FETCH_LOG, `${process.pid} ${name}\n`);
  if (takeOverPid !== null && !tookOver) {
    tookOver = true;
    simulateTakeOver();
  }
  if (fetchMode === 'hang') await new Promise((resolve) => setTimeout(resolve, 10 * 60 * 1000));
  if (fetchMode === 'crash') await crashNow('group process crashed on purpose');
  if (shouldCrash(name)) await crashNow(`group process crashed on purpose while searching ${name}`);
  if (process.env.TEST_BAD_REQUEST_COMPANY === name) return new Response('', { status: 400, statusText: 'Bad Request' });
  return new Response(feedFor(name), { status: 200 });
};
