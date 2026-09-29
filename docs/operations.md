# Operations reference

The detailed "how it behaves" for running the project: Docker extras, the 90-day collection, the daily job, progress and logs, and the API. Start with the [README](../README.md); the owner's day-to-day steps are in [GUIDE.md](../GUIDE.md).

## Contents
- [Docker: extras](#docker-extras)
- [The 90-day collection (`npm start`)](#the-90-day-collection-npm-start)
- [The daily job in detail](#the-daily-job-in-detail)
- [Tracking progress and logs](#tracking-progress-and-logs)
- [The API](#the-api)

## Docker: extras

**Everyday commands:**

| Command | What it does |
|---|---|
| `docker compose up -d` | Build (first time only) and start everything in the background |
| `docker compose ps` | What's running (both should say `healthy`) |
| `docker compose logs -f app` | Watch the dashboard and daily job live (Ctrl+C stops watching, not the app) |
| `docker compose exec app npm start` | **The backfill:** the 90-day collection + classifier, in the running app container. On the shipped database it says the collection is already done and only the classifier runs. It fetches again only on an empty database (see below) |
| `docker compose exec app npm run progress` | The progress summary (same as [Tracking progress](#tracking-progress-and-logs)) |
| `docker compose down` | Stop everything. The data is kept |
| `docker compose down -v` | Stop and **delete the data volumes**: the next `up` starts again from the shipped database |
| `docker compose up -d --build` | Rebuild after a code change |

**A full new backfill:** with the app running, remove the database and restart:
```
docker compose exec app sh -c "rm -f db/press-mentions.sqlite*"
docker compose restart app
docker compose exec app npm start
```
After the restart the dashboard loads `data/` into the new database (like a fresh clone), then the daily job starts. `npm start` then runs the full 90-day collection, because this database has no collection yet. On the CPU this takes many hours: about 6.5 s per article, while the real run classified ~20k articles on the GPU in under an hour.

**With an NVIDIA GPU (optional, much faster):** Docker Desktop with the WSL2 engine and a current NVIDIA driver, then start with both files:
```
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

**Why one container for the dashboard and the daily job:** the daily job tells the dashboard "new data" over 127.0.0.1, which only works on the same computer (D106), and the "is that process still alive?" lock checks only see processes in the same container. The daily job starts once the dashboard answers, so on an empty database the dashboard has loaded `data/` first. If either program stops, the container restarts both (tested: killed the daily job, both were back within about 20 s). The backfill runs in the same container with `exec` for the same reason.

**For the owner:** before a delivery, refresh the shipped database with `npm run docker:snapshot`. It reads the live database read-only and writes `docker/seed/press-mentions.sqlite`.

**Files:** [Dockerfile](../Dockerfile) (the app image), [docker/ollama.Dockerfile](../docker/ollama.Dockerfile) (Ollama + the model), [docker-compose.yml](../docker-compose.yml), [docker-compose.gpu.yml](../docker-compose.gpu.yml), [.dockerignore](../.dockerignore) (keeps `.env` and the live database out of the image), [src/docker/runApp.js](../src/docker/runApp.js) (starts the two programs).

## The 90-day collection (`npm start`)

`npm start` starts the **orchestrator**, which runs two services side by side and restarts them if they crash:

| Service | What it does | How long (on the dev PC) |
|---|---|---|
| `[collector]` | Searches Google News for all 258 companies over the last 90 days (1 request per second) and puts each article in the queue. The companies are split into **10 groups** of about 25 (in list order); the groups run one after another, **each in its own process**, which exits when its group is done | About 10–30 minutes of searching. It pauses whenever the queue is full (10,000), so on a big backfill it finishes close to the classifier |
| `[classifier]` | Asks the local AI about each article: relevant? sentiment? Deletes the irrelevant ones, saves the rest as mentions | Keeps pace with the collector, then finishes the queue (real run: about 30 min after collection ended) |

The progress lines say which group is running, e.g. `Group 2 of 10 (companies 27–52): 12/26 done`. When the last group has ended, the collector prints the **end log**:
```
Run 1 collected.
Companies: 230 finished, 2 failed (of 258).
Groups: complete 1, 3–10 · failed 2
  group 2: 26 of 26 companies not collected; last error: exit 1: ERROR: Group process crashed: …
Companies failed: [Acme Bio, Foo Labs]
  Acme Bio — Google rejected the search (HTTP 400 Bad Request), 3 tries 1 min apart
  Foo Labs — Google rejected the search (HTTP 404 Not Found), 3 tries 1 min apart
```
A **failed company** is one Google rejected 3 times (HTTP 400 or another 4xx); a **failed group** is one whose process crashed 5 times in a row without finishing a single company. Both can be collected again later with `--groups` (below).

The classifier writes the results to **`data/`** after each group, once that group's articles are all classified (a full snapshot so far), and once more when the queue is empty at the end; then the run is marked `done`:
- `data/companies.json`: every company with its status ("mentioned N days ago" or "no coverage").
- `data/mentions.json`: every relevant mention: title, link, publisher, date, sentiment.
- `data/run.json`: run summary (articles checked, relevant, deleted; the groups: total, complete, failed, how many exported; the failed companies).

The database itself is `db/press-mentions.sqlite` (never committed to git).

**Log files.** Everything important is also written to **`db/logs/run-<id>/`** (next to the database; one folder per run, never committed to git), so nothing is lost when the window closes: `orchestrator.log` (the story of the whole run), `collector.log`, one `group-N.log` per group, and `classifier.log`. The terminal output is the same as without them. See [Tracking progress](#tracking-progress-and-logs).

**Stopping and resuming.** Press **Ctrl+C** to stop. Each service saves where it was first. Run `npm start` again and it continues with the same group, from its first unfinished company, with no duplicates. The same happens after a crash or a power cut.

**Running again.** The 90-day collection runs **once**. After it has finished, `npm start` doesn't collect again (new articles come from the daily job). To force a new 90-day collection, run `npm run collect` (it removes the previous run's rows and log folder; articles and mentions are kept).

**Re-running chosen groups.** To collect some groups of the last run again (e.g. a failed group, or groups with a failed company):
```
npm start -- --groups 2,5
```
- Allowed when the last run is **`done`** (collected and classified). While a collector is really working on it, or while it is being classified, it is refused: `A run is still in progress (collector or classifier). Try again when it's done.`
- If the collector of a re-run dies, the orchestrator restarts it with the same `--groups`. The run is still `running` but no live collector holds it any more (the same lock rules as any resume: the owner process is gone, or no heartbeat for 15 minutes), so the run is taken over and **simply resumed**: nothing is reset, and companies already finished are not searched again (D95). The chosen groups were reset only once, when the `done` run was reopened.
- On any `running` run whose collector has died (not only a re-run), `--groups` does the same: the run resumes like a plain `npm start`, and **all** its unfinished groups continue, chosen or not. The start line says so, e.g. `--groups 1 given: nothing is reset; unfinished group(s) 1–3 continue (also the ones not chosen)`.
- Only the chosen groups are searched again, with the **same 90 days** as the original run. Articles already stored are skipped; new ones go through the classifier as usual, and `data/` is written again. The other groups are not touched.
- A wrong value (`--groups abc`, `--groups 0`, a group the run doesn't have) is refused with a clear message, and nothing is started.
- Also works with the collector alone: `npm run collect -- --groups 2,5`.

Each service ends with an exit code that says why it stopped (0 finished, 3 refused because another run is active or `--groups` can't be used now, 1 crashed); see [challenge 12](design-challenges.md#12-crashes-and-failures).

## The daily job in detail

**One daily run, step by step:**
1. **Waits** if the 90-day collection (`npm start`) is still collecting or classifying, and tries again every 15 min. If that collection was stopped halfway and nothing is working on it, the log says so: run `npm start` to finish it.
2. **First run ever only:** marks every mention already in the database as alerted, so the ~11,600 mentions of the real run never go to Discord.
3. **Searches** every company for yesterday + today (Google takes dates only), **one search every 5 seconds** (about 22 minutes for all companies; see below). A company that is in the list but not in the database yet is named in one warning (run `npm run seed` to add it). Articles already stored are skipped by the same duplicate checks as the 90-day run. The AI classifies at the same time: not about the company → deleted, about it → a mention with its sentiment.
4. **New mentions** = mentions not alerted yet (`Mention.alerted_at` empty), counted per company.
5. **Updates the dashboard** (only when something is new): it calls the API, and every open page reloads its data: the new mentions appear, and anything older than 90 days drops out.
6. **Discord:** one message listing **every** company with new mentions (count, then 🟢 / ⚪ / 🔴 counts, all three always shown, zeros too), most first, with the total and a dashboard link; a long list goes on in a second message. A quiet day gets a short "☕ All quiet on the press front" message, so you know it ran. Only after Discord accepts a message are its mentions marked as alerted; if Discord fails, they go out with the next run.
7. **Merges into `data/`** (only when something is new): `mentions.json` and `companies.json` are written again from the database (old + new mentions, new totals), and `run.json` gets a `lastDailyRun` part (when, which days, how many new, when the alert went out, companies that could not be searched). The 90-day collection's own times in `run.json` (`collectedAt`, `finishedAt`) stay as they were.
8. **Records the run** in the `DailyRun` table (status, new mentions, when the alert went out, last error).

**When something goes wrong:**
- **The computer was off at 03:00:** when `npm run daily` starts and the last successful run is more than a day old, it runs right away, and it searches from the day of the last run, so no day is skipped.
- **The computer was asleep at 03:00** (with `npm run daily` open): the same check runs every hour, so the missed run starts within an hour after the computer wakes up.
- **A database filled from `data/`** (a fresh clone, no run yet): the first daily run searches from the day that data was collected (the newest mention), at most 90 days back.
- **Google or Ollama is down:** it waits and tries again until they are back ("run when possible").
- **Discord is down, or the webhook was deleted:** the run still finishes; the mentions stay "new" and go out with the next message. The terminal and the log say why.
- **A run fails** (an unexpected error): tried again after 30 min, at most 3 times, then at the next 03:00.
- **Something stays wrong for hours:** Discord gets one "⚠️ Daily job problem" message (red) when a run has waited 3 hours (the 90-day collection is still open), has been going on for 3 hours (e.g. Ollama or Google is down; the message says the last problem), or gave up after its 3 retries. So a silent Discord never hides a problem.
- **Stopped in the middle** (Ctrl+C, a crash, a closed window): the articles being classified go back to the queue, the run is marked failed, and the next start runs it again. An article left "being classified" by a program that is gone is given back, so it can never make a run wait forever.
- **The database is busy** for a moment (another program is writing): the run's own writes wait and try again, so a message Discord already accepted is never sent twice.

**Why 5 seconds per search:** the first two real daily runs (29 Sep 2026) searched at the collector's pace, 1 per second. Both times Google answered "503 busy / limiting us" after about 197 fast searches and blocked us for about 2 hours, so each run took 2 h 16 min instead of about 4 minutes. The job waited and finished by itself, but the owner decided on a slower pace for the daily job only (5 s, `DAILY_REQUEST_INTERVAL_MS` in `src/config.js`). It runs at 03:00, so the extra minutes cost nothing. The 90-day collection keeps 1 s.

**Restarting it:** nothing restarts `npm run daily` by itself. After a crash, a closed window or a PC restart, just run `npm run daily` again: it runs the missed day right away (and searches every day since the last run).

**With the 90-day collection:** `npm start` and `npm run collect` refuse to start (exit 3, with a clear message) while a daily run is going on; try again when it ends. The other way round, a daily run waits while a 90-day collection is open. Mentions found by a 90-day collection are marked as already alerted, so they never go to Discord (only what the daily job finds does).

**Log:** the terminal (with the time of each line) and `db/logs/daily/daily.log`. The history of the runs:
```sql
SELECT id, started_at, finished_at, status, new_mentions, alert_sent_at, last_error FROM DailyRun ORDER BY id DESC;
```

## Tracking progress and logs

You can follow a run from the database at any time, also while it is going. Both ways below only **read**; they never change anything.

**In the terminal:** open a second terminal in the project folder and run
```
npm run progress
```
It prints a short dashboard of the latest run (times in UTC). Add `-- --all` (`npm run progress -- --all`) to also list every company. Example:
```
RUN
  Run 1 · running · started 2026-09-27 08:00 · last heartbeat 2026-09-27 09:57 (3.0 min ago) · process 4242
  AI step: 1,200 classified · 310 relevant · 870 irrelevant · 20 failed
  Last error: none

COMPANIES
  75 finished · 1 failed · 1 fetching · 181 not started · 258 total

GROUPS
  2 complete · 0 failed · 1 in progress · 7 pending · 10 total
  Group  Status       Done  Failed  Left  Total  Crashes  Started           Finished          Exported          Last error
  -----  -----------  ----  ------  ----  -----  -------  ----------------  ----------------  ----------------  ----------
      1  complete       26       0     0     26        0  2026-09-27 08:00  2026-09-27 08:40  2026-09-27 09:05  -
      2  complete       25       1     0     26        0  2026-09-27 08:40  2026-09-27 09:20  -                 -
      3  in_progress    24       0     2     26        0  2026-09-27 09:20  -                 -                 -
      4  pending         0       0    26     26        0  -                 -                 -                 -
  ...

RUNNING NOW
  Group 3 (Acme … Zeta Labs): 24 done · 0 failed · 2 left of 26 · crashes in a row: 0
  (one line per company of the group, with its status)

FAILED COMPANIES
  Company  Group  Error
  -------  -----  ------------------------------------------------------------------------
  Harvey       2  Google rejected the search (HTTP 400 Bad Request), 3 tries 1 min apart

FAILED GROUPS
  None.

QUEUE (articles waiting for the AI step)
  1,240 waiting · 16 being classified · 3 to retry · 2 failed for good · 50 relevant, waiting to be moved · 1,311 total

MENTIONS
  4,321 total · 1,200 positive · 300 negative · 2,821 neutral
  180 companies with mentions · 78 with none
```
If no run has started yet, it prints `No database yet — start a run with npm start`.

**Ready-made SQL queries:** [`queries/progress.sql`](../queries/progress.sql) starts with a **TL;DR of the 5 most useful queries** (is the run OK, each group, the AI queue, the company being searched now, mentions by sentiment), then 11 more for detail. Each has a one-line comment on what it shows. They are plain SQLite and work in any database viewer. The 5 are also in [GUIDE.md](../GUIDE.md#follow-a-run).

**In DB Browser for SQLite** (a free viewer):
1. Download it from [sqlitebrowser.org](https://sqlitebrowser.org/dl/) and install it.
2. **File → Open Database Read Only…** and choose `db/press-mentions.sqlite` in the project folder.
3. Open the **Execute SQL** tab, paste one query from `queries/progress.sql`, and press the ▶ (Execute) button. Run it again to refresh.

The database uses WAL mode, so reading it while a run is going is safe: a reader never blocks the collector or the classifier. Always open it **read-only** while a run is going, so nothing can be changed by accident.

**Log files:** each run has its own folder, **`db/logs/run-<id>/`** (e.g. `db/logs/run-1/`): the logs folder sits **next to the database** (`<folder of DB_PATH>/logs`), so a test database set with `DB_PATH` gets its own logs and never touches the real run's logs. It is never committed to git. Every line starts with the date and time (`2026-09-27 14:03:11.482 …`). The files are short on purpose: no progress-line repeats, only what happened.

| File | Written by | What is in it |
|---|---|---|
| `orchestrator.log` | the orchestrator (`npm start`) | **The story of the run**, a few lines per hour: services started / stopped / restarted / given up, run started or resumed, `Group 2 done (26/26 finished) → starting group 3 of 10 (companies 53–78)`, a group that crashed or failed, `Queue full (10,000): collector waiting for the LLM` / `Queue has room again …`, one line when Google problems start and one when Google answers again, a company that failed, Ollama not ready / back, a group's `data/` written, `Collection done: …`, `Run 1 done, data/ written: 1,234 mentions`. Start here |
| `collector.log` | the collector's main process (the group runner) | Seed, run started / resumed, each group started / complete / crashed / failed, the end log |
| `group-1.log`, `group-2.log`, … | each group's process | **One line per finished company** (`Company 5/26 Harvey: finished · 3 windows · 42 new, 7 duplicates · 1 min 12 s`), **every Google error and retry** with its HTTP code and company, failed companies, the group summary |
| `classifier.log` | the classifier | Start, Ollama ready or not, AI answers that were invalid, each group's `data/` export, the end of the run, and the speed line once every 10 minutes |

The classifier is always on, so its lines go to the latest run's folder (after run 1 is done they stay in `run-1` until run 2 starts). Lines written before any run exists go to `db/logs/no-run/`. A `--groups` re-run adds to the same run's folder. The files also exist when a service runs alone (`npm run collect`, `npm run classifier`), except `orchestrator.log`, which only `npm start` writes. The folder can be changed with `LOGS_DIR` in `.env` (relative to the project folder).

**Old logs are removed when a new run starts.** Creating a new run deletes the older runs' rows in the database (`JobRun`, `JobRunCompany`, `JobRunGroup`) and every older `run-<id>` folder in the logs folder (and `no-run/`). **Nothing else** in the logs folder is ever deleted: any other folder is left alone, with one warning. The articles, the mentions and the company list are kept. The new run's line `New run 2: removed 1 old run and its logs` appears in `collector.log` and `orchestrator.log`. Resuming a run or a `--groups` re-run removes nothing: its lines are added to the same folder. A folder that can't be removed (e.g. a file open in another program) gives one warning and is removed at the next new run. A folder that holds a file written **after the new run started** (e.g. the classifier already writing its first lines of the new run) is kept, so no line of the current run is lost; it is removed at the next new run. **Copy a run's folder elsewhere first if you want to keep it.**

To follow a file live, open a second PowerShell window in the project folder:
```
Get-Content db\logs\run-1\orchestrator.log -Wait -Tail 20
```
If a log file can't be written (e.g. the disk is full), the program shows one warning and keeps working.

## The API

The API never writes to the database. It listens on 127.0.0.1 only and answers only requests addressed to `localhost` / `127.0.0.1` (else 403), which blocks "DNS rebinding".

| Endpoint | Answer |
|---|---|
| `GET /api/companies` | `{ asOf, windowStart, windowDays, companies: [{ id, name, section, sectionName, hint, status, lastMentionAt, daysAgo, mentionCount, sentimentCounts: { positive, neutral, negative }, weekCount, prevWeekCount, logoUrl }] }` (`weekCount` = the last 7 days, `prevWeekCount` = the 7 days before; `logoUrl` = `/logos/<file>` or null), and `dailyRun: { latest: { id, status, startedAt, finishedAt }, lastDone: { id, finishedAt, newMentions, companiesWithUpdates, discordSent } }` (null before the first daily run) |
| `GET /api/overview` | The numbers behind the Overview page, counted from the mentions when asked (nothing stored): `{ asOf, windowStart, windowDays, timeZone, totals: { mentions, positive, neutral, negative, companies, companiesMentioned }, trend, daily, monthly, attention, recent }` |
| `GET /api/companies/:id/mentions` | `{ company: { id, name }, asOf, mentions: [{ title, url, publisher, publishedAt, sentiment }] }`, newest first, last 90 days (`asOf` = when they were read: the panel counts 24h / 7d / 30d from it) |
| `GET /logos/<file>` | A company logo (the browser keeps it for 30 days) |
| `GET /api/events` | Live updates for an open page (Server-Sent Events): the event `data-updated` when the daily job has added new data |
| `POST /api/internal/data-updated` | The daily job's "new data" signal. Accepted only from this computer with the header `X-Press-Mentions: daily-job` (else 403). Sends `data-updated` to every open page; answers `{ pages }` |

Errors are JSON `{ "error": "…" }`: 404 for an unknown company or API address, 500 if the database can't be read (details only in the API's terminal).

### Dashboard troubleshooting
- `port 3000 is busy`: another program uses the port. Stop it, or set `API_PORT=3001` in `.env` (copy `.env.example`).
- `The dashboard page has not been built yet`: run `npm run dashboard` (or `npm run build`) instead of `npm run api`.
- `data/ could not be imported`: the database was empty and `data/` is missing or broken. Restore it (`git checkout data`) and start again. The page then shows "No companies to show yet".
