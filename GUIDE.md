# Owner's guide (TL;DR)

The quick version. Everything else (setup, all commands, logs, how failures are handled) is in [README.md](README.md). Type every command in the project folder.

## Run

1. First time only: [install](README.md#1-what-you-need) Node 24, Ollama and `qwen3:4b`, then `npm install`.
2. With Ollama running: `npm start`. It takes about an hour (the real run: 58 min).
3. When it prints `Run N is done`, press **Ctrl+C**. Results are in `data/`.

Stop: Ctrl+C. Resume: `npm start` again. It continues where it stopped.

## Open the dashboard

`npm run dashboard`, then open **http://localhost:3000**. The table: search, and two icons on the right: Sort (Most mentions / Last mentioned / Company A–Z) and Filter (All / Mentioned this week / Mentioned / No coverage); a blue dot and a small "×" pill show a choice that is not the default. Last mentioned says "< 24h", "3d ago", "2w ago" or "1mo ago" (hover for the exact time). Recent activity = mentions in the last 7 days and the change vs the 7 days before. Click a company to see its mentions (filter them with the clock icon by 24h / 7d / 30d / 90d, with the lines icon by sentiment, or by a word in the headline; × closes the panel); the address becomes e.g. `http://localhost:3000/?company=spacex`, a link that opens that company. It shows the database; if the database is empty (a fresh clone), it first loads the committed `data/`. Stop: Ctrl+C.
Port 3000 taken? Set `API_PORT=3001` in `.env`. More in [README](README.md#5-the-dashboard).

## Daily job

**TL;DR:** `npm run daily` in its own terminal, leave it open. It runs every day at 03:00 Israel time and posts to Discord. Watch it in its window, in `db\logs\daily\daily.log`, or with the queries below.

### Run it
1. Ollama running, and `DISCORD_WEBHOOK_URL` set in `.env` (never commit it).
2. Optional, to watch the page update by itself: `npm run dashboard` in another terminal (restart it after an update).
3. `npm run daily`. It prints `Daily job started ... It runs every day at 03:00 (Asia/Jerusalem)`.
   - The first time (or if the last run is more than a day old) it runs **right away**.
   - The very first run marks all the mentions already in the database as alerted, so they are never sent.
4. Leave the window open. Stop: **Ctrl+C**. After a crash, a closed window or a PC restart, just run `npm run daily` again: it catches up the missed days by itself.

Only one can be open: a second `npm run daily` says `Another daily job is already open` and exits. While a daily run is going on, `npm start` refuses to start: try again when it ends.

### Is it working? (the window)
A run takes about 25–40 minutes (one Google search every 5 s: 1 s got us blocked by Google for 2 hours, see [README](README.md#6-the-daily-job)). The lines you see, in order (the numbers are only an example):
```
Daily run starting (a missed run).
First daily run: the 11,600 mentions already in the database are marked as alerted (they are not sent to Discord).   ← first run only
Daily run 1: searching 258 companies for 2026-09-28 to 2026-09-29 (UTC) ...
Searched 50 of 258 companies (12 new articles so far).       ← every 50 companies
Search done: 40 new articles, 310 already known. Classifying done.
New mentions: 25 (14 companies).
Dashboard told about the new data (1 open page).              ← or "not told": fine, the page shows it when reloaded (F5)
Discord message sent.
data/ updated with the new mentions.
Daily run 1 done: 25 new mentions, Discord sent.
```
`WARNING` lines about Google or Ollama mean it is waiting and retrying by itself. It gives up only after 3 failed tries (every 30 min), then waits for the next 03:00.

**Log file** (the same lines, with date and time), live in PowerShell:
```
Get-Content db\logs\daily\daily.log -Tail 20 -Wait
```

### Check it in the database
Open it read-only with the queries (PowerShell), as in [Follow a run](#follow-a-run):
```
& "C:\Program Files\DB Browser for SQLite\DB Browser for SQLite.exe" -R db\press-mentions.sqlite
```
Paste a query in **Execute SQL** and press **Ctrl+Enter**.

**1. The daily runs** (newest first): `running` → `done` or `failed`. `alert_sent_at` empty = Discord not sent (the mentions go out next time); `last_error` says why.
```sql
SELECT id, status, started_at, finished_at,
  ROUND((julianday(COALESCE(finished_at, 'now')) - julianday(started_at)) * 24 * 60, 1) AS minutes,
  new_mentions, alert_sent_at, last_error
FROM DailyRun ORDER BY id DESC;
```

**2. What is waiting to go to Discord** (mentions not alerted yet, per company). Empty after a run = everything was sent.
```sql
SELECT c.name AS company, COUNT(*) AS new_mentions,
  SUM(m.sentiment = 'positive') AS positive, SUM(m.sentiment = 'neutral') AS neutral, SUM(m.sentiment = 'negative') AS negative
FROM Mention m JOIN Company c ON c.id = m.company_id
WHERE m.alerted_at IS NULL
GROUP BY c.name ORDER BY new_mentions DESC, c.name;
```

**3. What the last daily run added** (every new mention, newest first):
```sql
SELECT c.name AS company, m.sentiment, m.published_at, m.publisher, m.title
FROM Mention m JOIN Company c ON c.id = m.company_id
WHERE m.first_seen_at >= (SELECT started_at FROM DailyRun ORDER BY id DESC LIMIT 1)
ORDER BY m.published_at DESC;
```

**4. The AI queue during a run**: the same as query 3 in [Follow a run](#follow-a-run) ("waiting for the AI" goes down to 0).

**5. Old data is filtered, not deleted:** all mentions in the database vs. the ones the dashboard shows (the last 90 days).
```sql
SELECT COUNT(*) AS in_database,
  SUM(published_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')) AS shown_last_90_days,
  SUM(published_at <  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')) AS older_kept_not_shown
FROM Mention;
```

### Discord
- `📰 New press mentions · Tue 29 Sep`: every company with new mentions (count, then 🟢 / ⚪ / 🔴 counts, all three always shown, zeros too), then the total and a dashboard link. A long list goes on in a second message.
- `☕ All quiet on the press front`: nothing new today; the job ran fine.
- `⚠️ Daily job problem` (red): something has been stuck for 3 hours, or a run gave up. The message says what; check the window or `daily.log`.
- No message at all by the morning: `npm run daily` was not open (run it: it catches up), or Discord refused the webhook (see `last_error` in query 1).

More in [README](README.md#6-the-daily-job).

## Follow a run

**Terminal** (a second one): `npm run progress`

**Database**, read-only, with the queries loaded (PowerShell):
```
& "C:\Program Files\DB Browser for SQLite\DB Browser for SQLite.exe" -R -s queries\progress.sql db\press-mentions.sqlite
```
Select one query and press **Ctrl+Enter** (again to refresh). The 5 most useful ones, also at the top of [`queries/progress.sql`](queries/progress.sql):

**1. Is the run OK?** Status (`running` → `collected` → `done`), minutes since the last heartbeat, last error, AI counts. Over 15 min with no heartbeat while `running` = probably crashed. While `collected`, no heartbeat is normal.
```sql
SELECT id AS run_id, status, started_at, last_heartbeat,
  ROUND((julianday('now') - julianday(last_heartbeat)) * 24 * 60, 1) AS minutes_since_heartbeat,
  last_error, classified_count AS classified, relevant_count AS relevant,
  irrelevant_count AS irrelevant, failed_count AS failed
FROM JobRun WHERE id = (SELECT MAX(id) FROM JobRun);
```

**2. How is each group doing?** Status, companies done / failed / left, crashes, when `data/` was written after it (`exported_at`, empty until the AI finishes that group's articles), last error.
```sql
SELECT g.group_number, g.status,
  SUM(j.status = 'finished') AS done, SUM(j.status = 'failed') AS failed,
  SUM(j.status IN ('not_started','fetching')) AS left, COUNT(j.company_id) AS total,
  g.crashes_in_a_row, g.exported_at, g.last_error
FROM JobRunGroup g
LEFT JOIN JobRunCompany j ON j.run_id = g.run_id AND j.group_number = g.group_number
WHERE g.run_id = (SELECT MAX(id) FROM JobRun)
GROUP BY g.group_number ORDER BY g.group_number;
```

**3. What's in the AI queue?** Articles per state. Empty = the queue is empty. At 10,000 waiting, the collector pauses until there is room.
```sql
SELECT state, COUNT(*) AS articles FROM (
  SELECT CASE WHEN claimed_at IS NOT NULL THEN 'being classified now'
              WHEN status = 'pending' THEN 'waiting for the AI'
              WHEN status = 'failed' AND attempts < 3 THEN 'failed once, will be retried'
              WHEN status = 'failed' THEN 'failed for good'
              WHEN status = 'relevant' THEN 'relevant, waiting to be moved'
              ELSE status END AS state
  FROM BufferQueue) GROUP BY state ORDER BY articles DESC;
```

**4. Which company is being searched right now?** No row = nothing is being searched (between groups, queue full, or collection ended).
```sql
SELECT j.group_number, c.name AS company, j.status
FROM JobRunCompany j
JOIN Company c ON c.id = j.company_id
WHERE j.run_id = (SELECT MAX(id) FROM JobRun)
  AND j.status = 'fetching';
```

**5. How many mentions, and what sentiment?** It grows in steps of about 1,000 (mentions are moved in chunks).
```sql
SELECT COUNT(*) AS total,
  SUM(sentiment = 'positive') AS positive,
  SUM(sentiment = 'negative') AS negative,
  SUM(sentiment = 'neutral')  AS neutral,
  COUNT(DISTINCT company_id)  AS companies_with_mentions
FROM Mention;
```

**Logs:** `db\logs\run-N\orchestrator.log` tells the whole run. [More on logs](README.md#tracking-progress).

## If something fails

Most problems fix themselves (retries and restarts). You act only when:
- **A company or group ended `failed`:** when the run is `done`, run `npm start -- --groups N` (N from `npm run progress`).
- **`Ollama unavailable` / `is the model pulled?`:** start Ollama / run `ollama pull qwen3:4b`. Nothing is lost.
- **No heartbeat, or `… It is NOT restarted any more`:** read the error lines, then Ctrl+C and `npm start` again. It resumes.

Details: README → [Crashes and failures](README.md#12-crashes-and-failures), [Other commands](README.md#4-other-commands).
