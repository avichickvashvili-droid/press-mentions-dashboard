# Owner's guide

**TL;DR:** `docker compose up -d`, then open **http://localhost:3000**. That starts the dashboard, the daily job (03:00 Israel time) and the AI.
This page is the short "how do I…". The full story is in [README.md](README.md). Type every command in the project folder.

## Contents

1. [Common commands](#common-commands)
2. [Start everything with Docker](#start-everything-with-docker)
3. [Run without Docker](#run-without-docker)
4. [Open the dashboard](#open-the-dashboard)
5. [The daily job](#the-daily-job)
6. [Follow a run](#follow-a-run)
7. [Check things in the database](#check-things-in-the-database)
8. [If something fails](#if-something-fails)
9. [Before a delivery](#before-a-delivery)

## Common commands

**TL;DR:** the commands you use most, in one table.

| I want to… | Command |
|---|---|
| Start everything (Docker) | `docker compose up -d` |
| See what is running | `docker compose ps` |
| Watch the app live | `docker compose logs -f app` (Ctrl+C stops watching only) |
| Stop everything (data kept) | `docker compose down` |
| Rebuild after a code change | `docker compose up -d --build` |
| Run the backfill in Docker | `docker compose exec app npm start` |
| Dashboard without Docker | `npm run dashboard` |
| Daily job without Docker | `npm run daily` |
| 90-day collection without Docker | `npm start` |
| Progress summary | `npm run progress` |
| Run the tests | `npm test` and `npm run test:web` |
| Refresh the database shipped with Docker | `npm run docker:snapshot` |

## Start everything with Docker

**TL;DR:** open Docker Desktop, run `docker compose up -d`, open http://localhost:3000.

1. Open **Docker Desktop**. Wait for **Engine running** (bottom left).
2. Make sure port 3000 is free: stop `npm run api` / `npm run dashboard` if they run.
3. Open a terminal in the project folder (VS Code: **Terminal → New Terminal**).
4. Run:
   ```
   docker compose up -d
   ```
   The first time takes 5–10 minutes (it downloads the model). You should see `Container press-mentions-app-1 Started`.
5. Open **http://localhost:3000**.

"docker is not recognized"? Open a new terminal (or restart VS Code).

**Quick self-test:**

| Do this | You should see |
|---|---|
| Open the page, click a company | 258 companies, logos, the company's mentions |
| `docker compose ps` | `ollama` and `app` both **(healthy)** (the app needs ~20 s) |
| `docker compose logs app` | `Dashboard: http://localhost:3000` and `Daily job started … 03:00` |
| `docker compose restart app`, wait 20 s, refresh | Same page, same data |
| `docker compose down`, then `docker compose up -d` | Starts in seconds, same data |

- `docker compose down -v` stops **and deletes the data**. The next start begins again from the shipped database.
- With an NVIDIA GPU: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d`.

## Run without Docker

**TL;DR:** Node 24 + Ollama with `qwen3:4b`, then `npm install` and `npm start`.

1. First time only: install Node 24 and Ollama, then:
   ```
   ollama pull qwen3:4b
   npm install
   ```
2. With Ollama running: `npm start`. The full 90-day collection takes about an hour.
3. When you see `Run N is done`, press **Ctrl+C**. The results are in `data/`.

Stopped halfway? Run `npm start` again: it continues where it stopped.

## Open the dashboard

**TL;DR:** `npm run dashboard` (or Docker), then http://localhost:3000.

- **Overview** opens first: the top band with this week's briefing, status pills and a ticker of the newest headlines; then number cards, charts, **Top companies**, **Needs attention** and **Recent mentions**.
- Click a company anywhere on the Overview: it jumps to that company's row on the **Companies** page and opens its mentions.
- **Companies** (side menu): the table with search, Sort and Filter icons. Click a row to open its mentions on the right (filter by time, sentiment or a word; × closes).
- The page is dark. The **Light mode** button (bottom left) switches.
- Port 3000 taken? Put `API_PORT=3001` in `.env`.

## The daily job

**TL;DR:** in Docker it already runs. Without Docker: `npm run daily`, leave the window open. It runs every day at 03:00 (Israel time) and posts to Discord.

**Run it (without Docker):**
1. Start Ollama. Put `DISCORD_WEBHOOK_URL=...` in `.env` (never commit `.env`).
2. Run `npm run daily`. You should see `Daily job started … It runs every day at 03:00 (Asia/Jerusalem)`.
3. Leave it open. If the last run is over 24 hours old, it runs right away.
4. After a crash or a restart, run `npm run daily` again: it catches up by itself.

Do **not** run `npm run daily` while Docker runs: you get two Discord messages.

**Is it working?** A run takes about 25–40 minutes (one Google search every 5 s). The end of a good run looks like:
```
New mentions: 25 (14 companies).
Discord message sent.
Daily run 1 done: 25 new mentions, Discord sent.
```
`WARNING` lines mean it waits and retries by itself. After 3 failed tries (30 min apart) it waits for the next 03:00.

**Log file:** `db\logs\daily\daily.log`. Watch it live (PowerShell):
```
Get-Content db\logs\daily\daily.log -Tail 20 -Wait
```
In Docker: `docker compose logs -f app`.

**Discord messages:**

| Message | Meaning |
|---|---|
| `📰 New press mentions · <date>` | Companies with new mentions, with 🟢 / ⚪ / 🔴 counts |
| `☕ All quiet on the press front` | Nothing new; the job ran fine |
| `⚠️ Daily job problem` (red) | Stuck for 3 hours, or a run gave up. Check the log |
| No message by morning | The job was not running (start it), or Discord refused (see `last_error` below) |

[↑ Back to contents](#contents)

## Follow a run

**TL;DR:** `npm run progress` in a second terminal.

1. Run `npm run progress` (Docker: `docker compose exec app npm run progress`).
2. For more detail, open the database with the ready-made queries (next chapter) from [`queries/progress.sql`](queries/progress.sql).
3. The full story of a run is in `db\logs\run-N\orchestrator.log` (N = the run number).

## Check things in the database

**TL;DR:** open it **read-only** in DB Browser for SQLite and paste a query.

1. Open it (PowerShell):
   ```
   & "C:\Program Files\DB Browser for SQLite\DB Browser for SQLite.exe" -R -s queries\progress.sql db\press-mentions.sqlite
   ```
   `-R` = read-only. `-s` loads the ready-made queries (the 5 most useful are at the top).
2. In **Execute SQL**, select one query and press **Ctrl+Enter**.

**The daily runs** (newest first). `alert_sent_at` empty = Discord not sent yet; `last_error` says why.
```sql
SELECT id, status, started_at, finished_at, new_mentions, alert_sent_at, last_error
FROM DailyRun ORDER BY id DESC;
```

**Waiting to go to Discord** (empty after a run = all sent):
```sql
SELECT c.name AS company, COUNT(*) AS new_mentions
FROM Mention m JOIN Company c ON c.id = m.company_id
WHERE m.alerted_at IS NULL
GROUP BY c.name ORDER BY new_mentions DESC;
```

[↑ Back to contents](#contents)

## If something fails

**TL;DR:** most problems fix themselves. Act only in these cases.

| You see | Do this |
|---|---|
| A company or group ended `failed` | When the run is `done`: `npm start -- --groups N` (N from `npm run progress`) |
| `Ollama unavailable` / `is the model pulled?` | Start Ollama, or `ollama pull qwen3:4b`. Nothing is lost |
| No heartbeat for 15 min, or `It is NOT restarted any more` | Read the error lines, Ctrl+C, then `npm start` again. It resumes |
| `Another daily job is already open` | One is already running. Use that one |
| `npm start` refuses to start | A daily run is going on. Try again when it ends |
| Docker page does not open | `docker compose ps` and `docker compose logs app` |

## Before a delivery

**TL;DR:** snapshot, tests, Docker check, commit, push.

1. Refresh the database shipped with Docker:
   ```
   npm run docker:snapshot
   ```
2. Run the tests. You should see no failures:
   ```
   npm test
   npm run test:web
   ```
3. Rebuild and check Docker:
   ```
   docker compose up -d --build
   ```
   Then do the [quick self-test](#start-everything-with-docker).
4. Commit (check that `.env` is **not** in the list):
   ```
   git status
   git add -A
   git commit -m "Describe the change"
   ```
5. Push: `git push`.

[↑ Back to contents](#contents)
