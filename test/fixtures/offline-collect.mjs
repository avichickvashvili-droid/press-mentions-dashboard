// offline-collect.mjs — makes the REAL `collect` program run offline and fast, for
// test/commands.test.js. It is loaded with `node --import <this file> src/collector/runCollect.js`,
// so it runs first, in the same process, and changes three things before the collector starts:
//   - the company list, hints and section-words files come from the test (TEST_COMPANY_LIST,
//     TEST_HINTS, TEST_KEYWORDS), so only a few companies are collected;
//   - the 1-second pace between Google requests is set to 0;
//   - `fetch` is replaced by a fake that answers every search with a tiny feed of 2 articles
//     dated 2 days ago. Nothing is sent to Google.
// With TEST_TAKE_OVER_PID set, the first search also simulates another collector taking the run
// over: it sets JobRun.owner_pid to that process id (D71).
// Reads: the environment variables above and DB_PATH. Writes: JobRun (only for the take-over).

import { DatabaseSync } from 'node:sqlite';
import { config } from '../../src/config.js';

config.COMPANY_LIST_FILE = process.env.TEST_COMPANY_LIST;
config.COMPANY_HINTS_FILE = process.env.TEST_HINTS;
config.SECTION_KEYWORDS_FILE = process.env.TEST_KEYWORDS;
config.REQUEST_INTERVAL_MS = 0;
config.REQUEST_JITTER_MS = 0;

const takeOverPid = process.env.TEST_TAKE_OVER_PID ? Number(process.env.TEST_TAKE_OVER_PID) : null;
let tookOver = false;

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

// The fake fetch: reads the company name from the search text and answers with its feed.
globalThis.fetch = async (url) => {
  const query = new URL(url).searchParams.get('q');
  const name = query.match(/"([^"]+)"/)[1];
  if (takeOverPid !== null && !tookOver) {
    tookOver = true;
    simulateTakeOver();
  }
  return new Response(feedFor(name), { status: 200 });
};
