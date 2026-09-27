# Owner's guide: run it, follow it, fix it

A short, practical guide for running the system yourself. For how it works inside, see [README.md](README.md). For the reasons behind each rule, see [PLAN.md](PLAN.md).

All commands are typed in a terminal **in the project folder**.

---

## 1. Before the first run (one time only)

1. **Install Node.js 24** or newer ([nodejs.org](https://nodejs.org)). Check it:
   ```
   node --version
   ```
2. **Install the project's packages:**
   ```
   npm install
   ```
3. **Install Ollama** (the local AI, [ollama.com](https://ollama.com)) and download the model:
   ```
   ollama pull qwen3:4b
   ```
4. **Tell Ollama to answer 4 requests at once** (Windows PowerShell):
   ```
   [Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL','4','User')
   ```
   Then quit Ollama from the tray icon and start it again. Keep Ollama running whenever you run the system.
5. **Optional: `.env`.** You don't need it. Only if you want to change a setting, copy `.env.example` to `.env` and edit it.
   Without it, you'll see `.env not found. Continuing without it.`. That's normal.

(macOS/Linux and the GPU-memory option: see README → [What you need](README.md#1-what-you-need).)

---

## 2. Run it

1. Make sure Ollama is running.
2. Start:
   ```
   npm start
   ```
3. **What you'll see.** Every line starts with who wrote it: `[orchestrator]`, `[collector]` or `[classifier]`.
   - The collector goes through 10 groups of about 25 companies, one group after another:
     ```
     Group 2 of 10 (companies 27–52): 12/26 done
     ```
   - When all groups have ended, the collector prints the **end log**:
     ```
     Run 1 collected.
     Companies: 256 finished, 2 failed (of 258).
     Groups: complete 1–10 · failed none
     Companies failed: [Acme Bio, Foo Labs]
       Acme Bio — Google rejected the search (HTTP 400 Bad Request), 3 tries 1 min apart
       Foo Labs — Google rejected the search (HTTP 404 Not Found), 3 tries 1 min apart
     ```
     `failed none` and `Companies failed: none` mean everything was collected. If not, see section 4.
   - The AI (classifier) keeps working after that. When everything is done it prints:
     ```
     Run 1 is done: … data/ written (companies.json, mentions.json, run.json).
     ```
4. **How long:** searching Google takes about 10–30 minutes; the AI needs about 1–2 hours more. Plan for a few hours.
5. **When it says `Run N is done`:** press **Ctrl+C** to close it (the classifier stays on and waits otherwise).

**Results** land in the **`data/`** folder, updated after each group and once more at the end:
- `data/companies.json`: every company, "mentioned N days ago" or "no coverage".
- `data/mentions.json`: every relevant article, with its sentiment.
- `data/run.json`: a summary of the run.

**Stop and resume**
- Stop: press **Ctrl+C** once and wait a few seconds (it saves its place). A second Ctrl+C kills it at once.
- Resume: run `npm start` again. It continues where it stopped, with no duplicates. Same after a crash or a power cut.

**Running it again later:** the 90-day collection runs **once**. After it's done, `npm start` doesn't search Google again. See the commands table in section 5 to force a new one.

---

## 3. Track progress

Both ways below only **read**. They never change anything, and they are safe while a run is going.

### A. In the terminal

Open a **second** terminal in the project folder:
```
npm run progress
```
Add every company to the list:
```
npm run progress -- --all
```

What each part tells you (times are UTC):

| Part | Tells you |
|---|---|
| `RUN` | Run number, status (`running` → `collected` → `done`), last heartbeat, AI counts |
| `COMPANIES` | How many finished / failed / being searched / not started |
| `GROUPS` | Every group: status, done, failed, left, crashes |
| `RUNNING NOW` | The group being searched right now, company by company |
| `FAILED COMPANIES` | Which companies failed, their group, and why |
| `FAILED GROUPS` | Which groups were given up, and why |
| `QUEUE` | Articles waiting for the AI |
| `MENTIONS` | The final results: total and by sentiment |

**The heartbeat warning.** The collector writes "I'm alive" every 5 minutes. If it has been silent for more than 15 minutes, you'll see:
```
WARNING: No heartbeat for 22 min: the collector may have crashed or be stuck.
```
What to do: see section 4.

### B. In DB Browser for SQLite (free viewer)

1. Install it from [sqlitebrowser.org](https://sqlitebrowser.org/dl/).
2. **File → Open Database Read Only…** → choose `db\press-mentions.sqlite` in the project folder.
   Always **read-only**, so nothing can be changed by accident.
3. Open the **Execute SQL** tab.
4. Click **Open SQL file** and load `queries\progress.sql`.
5. **Select one query** with the mouse (from its `SELECT` to its `;`) and press **Ctrl+Enter**.
6. To refresh, press Ctrl+Enter again.

**Which query to run** (numbers as in `queries/progress.sql`):

| I want to know… | Query |
|---|---|
| Is the run OK? (status, heartbeat, AI counts) | **1.1** How is the latest run doing? |
| What runs have there been? | **1.2** |
| Which group is running now? | **2.1** |
| How are all the groups doing? | **2.2** |
| How many groups are complete / failed / running / waiting? | **2.3** |
| Which groups failed, and why? | **2.4** |
| How many companies are finished / failed / left? | **3.1** |
| The companies of the group running now | **3.2** |
| Which companies failed, and why? | **3.3** |
| The status of every company | **3.4** |
| How many articles are waiting for the AI? | **4.1** |
| Which articles did the AI fail on for good? | **4.2** |
| Which companies have the most articles waiting? | **4.3** |
| How many mentions, and what sentiment? | **5.1** |
| Which companies have the most mentions? | **5.2** |
| Which companies have no mentions at all? | **5.3** |

### C. Where are the logs

Everything that shows in the `npm start` window is also saved in files, so nothing is lost when the window closes. They are **next to the database**, in the `db` folder of the project:
```
db\logs\run-1\       ← one folder per run (run-1, run-2, …)
  orchestrator.log   ← the story of the whole run: START HERE
  collector.log      ← the collector: groups started / complete / crashed / failed, the end log
  group-1.log        ← group 1: one line per finished company, every Google error and retry
  group-2.log        ← … one file per group
  classifier.log     ← the AI step: Ollama, invalid answers, data/ written, speed every 10 min
```
- Every line starts with the date and time, e.g. `2026-09-27 14:03:11.482 Group 2 done (26/26 finished) → starting group 3 of 10 (companies 53–78)`.
- The files are short on purpose: what happened, not the moving progress line.
- `orchestrator.log` tells the run in a few lines: services started or restarted, each group done or failed, `Queue full …` / `Queue has room again …`, one line when Google problems start and one when Google answers again, failed companies, Ollama not ready / back, `data/` written, `Run 1 done`.
- **Google errors to analyze after a run:** `group-N.log` (search for `Google error`), and the start / end lines in `orchestrator.log`.
- Lines from before any run existed are in `db\logs\no-run\`. A `--groups` re-run adds to the same run's folder. The logs are never committed to git.
- A test database (set with `DB_PATH` in `.env`) gets its own `logs` folder next to it, so it never touches the real run's logs. `LOGS_DIR` in `.env` can put the logs somewhere else.
- **A new run deletes the old logs**: every older `run-N` folder (and `no-run`) in `db\logs\`, plus the older runs' records in the database. Nothing else in that folder is ever deleted. Articles and mentions are kept. Resuming or `--groups` deletes nothing. **To keep an old run's logs, copy its folder somewhere else before starting a new run.**

**Open a file:** double-click it (Notepad), or in PowerShell:
```
Get-Content db\logs\run-1\orchestrator.log
```
**Follow it live** while the run is going (a second PowerShell window; stop with Ctrl+C, this does not stop the run):
```
Get-Content db\logs\run-1\orchestrator.log -Wait -Tail 20
Get-Content db\logs\run-1\group-3.log -Wait -Tail 20
```

---

## 4. If something fails: what to do

Most problems fix themselves: the system retries and restarts on its own. You only act where the table says so.

**Re-running groups** (used in several rows below):
```
npm start -- --groups 2,5
```
- Searches only those groups again, same 90 days. Articles already stored are skipped.
- Use it when the run is **`done`** (check with `npm run progress`).
- On a run whose collector has died (the run still says `running`, but no collector is working on it), `--groups` does **not** start groups over: the run simply continues where it stopped, with all its unfinished groups, like a plain `npm start`. The start line says so.
- Find the group number in `FAILED COMPANIES` / `FAILED GROUPS` of `npm run progress`, or queries 2.4 and 3.3.

| What you see | What it means | What to do |
|---|---|---|
| A group ended **`failed`** (end log, `FAILED GROUPS`, query 2.4) | Its process crashed 5 times in a row without finishing a company. The other groups went on | Read its last error. When the run is `done`: `npm start -- --groups N` |
| A company ended **`failed`**, e.g. `Google rejected the search (HTTP 400 Bad Request), 3 tries 1 min apart` | Google refused that search 3 times. The rest of its group went on | When the run is `done`, re-run its group: `npm start -- --groups N` (N = the company's group). If it fails again the same way, tell the developer |
| `A run is still in progress (collector or classifier). Try again when it's done.` | You asked for `--groups` while the run is still working. Nothing was started (exit 3) | Wait until `npm run progress` shows `done`, then run the command again |
| `Another collection is running (run 1, process 4242, …)` | `npm start` is already running in another window. Nothing was started (exit 3) | Use the window that's already running, or stop it with Ctrl+C first |
| `--groups: run 1 has groups 1 to 10; there is no group 12.` (or another `--groups` message) | A wrong group number. Nothing was started | Fix the numbers and run again |
| `[orchestrator] collector crashed (exit 1), restart #2 in 5 s` | A crash; it is restarted by itself | Nothing. It continues where it stopped |
| `… crashed 6 times within 10 minutes … It is NOT restarted any more` followed by `Its last error lines:` | The orchestrator **gave up** on that service. The other service keeps running | Read the error lines under it (e.g. disk full, database problem) and fix that. Then Ctrl+C and `npm start` again: it resumes. If the error isn't clear, send it to the developer |
| `WARNING: No heartbeat for … min` in `npm run progress` | The collector stopped writing "I'm alive": it crashed or froze | Look at the `npm start` window. If it has ended or is frozen: Ctrl+C (if needed) and `npm start` again. It resumes |
| `Google error for …: Google blocked the request (HTTP 403 …)` or `… busy or limiting us (HTTP 429 …); retrying the same search in 2 min` | Google is slowing us down. It retries the same company by itself, waiting longer each time (up to 10 min). The AI keeps working meanwhile | Nothing; let it retry. If it lasts for hours, you can Ctrl+C and `npm start` later: it continues from the same company |
| `Ollama unavailable, retry in 30 s` or `Ollama is not reachable …` | Ollama isn't running. Nothing is lost: articles wait in the queue | Start the Ollama app. The classifier picks up by itself |
| `… is the model pulled? Run: ollama pull qwen3:4b` | The model isn't downloaded | Run `ollama pull qwen3:4b`. The classifier picks up by itself |
| AI `failed` count in `RUN`, or articles in query 4.2 | The AI couldn't give a valid answer for those articles after 3 tries. They are set aside and don't block the run | Nothing to do for a few. If there are many, check Ollama is running and the model is `qwen3:4b` |
| The collector crashed during a `--groups` re-run | It is restarted by itself and continues where it stopped (companies already finished are not searched again) | Nothing. Only if the orchestrator **gave up** on the collector: Ctrl+C, then run the **same** command again, e.g. `npm start -- --groups 2,5`. It continues where it stopped |

---

## 5. All commands

| Command | What it does |
|---|---|
| `npm start` | Runs everything: collects (first time, or resumes an unfinished run) and classifies. Stop with Ctrl+C |
| `npm start -- --groups 2,5` | Searches groups 2 and 5 of the last run again. When the run is `done`, or to force-restart them after the collector died |
| `npm run progress` | Shows the latest run's progress. Add `-- --all` to list every company |
| `npm run seed` | Only loads or updates the company list in the database |
| `npm run collect` | Only the collector. Also forces a **new** 90-day collection after a finished one (this deletes the previous run's logs and records; articles and mentions stay) |
| `npm run classifier` | Only the AI step (stays on; stop with Ctrl+C) |
| `npm test` | Runs all the tests, offline (no Google, no Ollama needed) |

More detail: README → [How to run](README.md#how-to-run), [Tracking progress](README.md#tracking-progress), [Crashes and failures](README.md#12-crashes-and-failures).
