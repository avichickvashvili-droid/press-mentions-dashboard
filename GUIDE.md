# Owner's guide (TL;DR)

The quick version. Everything else (setup, all commands, logs, how failures are handled) is in [README.md](README.md). Type every command in the project folder.

## Run

1. First time only: [install](README.md#1-what-you-need) Node 24, Ollama and `qwen3:4b`, then `npm install`.
2. With Ollama running: `npm start`. It takes about an hour (the real run: 58 min).
3. When it prints `Run N is done`, press **Ctrl+C**. Results are in `data/`.

Stop: Ctrl+C. Resume: `npm start` again. It continues where it stopped.

## Open the dashboard

`npm run dashboard`, then open **http://localhost:3000**. It shows the database; if the database is empty (a fresh clone), it first loads the committed `data/`. Stop: Ctrl+C.
Port 3000 taken? Set `API_PORT=3001` in `.env`. More in [README](README.md#5-the-dashboard).

## Daily job

`npm run daily` in its own terminal, with Ollama running and `DISCORD_WEBHOOK_URL` in `.env`. It stays up and runs every day at 03:00 Israel time (right away if a day was missed), then posts to Discord, also on a quiet day; a "⚠️ Daily job problem" message means something is stuck for hours. Stop: Ctrl+C. After a crash or a PC restart, just run `npm run daily` again (it catches up by itself). While a daily run is going on, `npm start` refuses to start: try again when it ends. More in [README](README.md#6-the-daily-job).

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
