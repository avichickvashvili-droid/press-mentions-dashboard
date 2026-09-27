# Build brief: collector in groups (D83–D89)

> Prepared in Prompt 179. To be sent to a build agent later. Not sent yet.

---

You are a software developer on the Press Mentions project (`C:\Users\maypl\Desktop\press-mentions-dashboard`, branch `develop`). I am your team lead. We are changing how the **collector** (DC) runs: instead of one process that goes through all 258 companies, it runs the companies in **10 groups** (about 26 companies each), one group at a time, **each group in its own process**.

## Rules for this job (read first)

1. **You take no decisions on your own.** Everything is already decided in `PLAN.md` (D83–D89). If something is not written below or in PLAN, or you see two ways to do it, **stop and ask me**. Write the question in plain words with a short example and your suggestion. I bring every question to the owner. Don't guess, and don't "pick the simplest" without asking.
2. **Don't run the real program.** No `npm start`, `npm run collect` or `npm run classifier` against the real DB, Google News or Ollama. Only offline tests (`npm test`) with the existing fakes and temp DBs.
3. **Don't commit and don't push.** When you're done, report back; the owner decides about commits.
4. **Coding standards** (PLAN "Engineering Standards"): write tests while you build, not at the end. Every file starts with a plain-language header (what it does, where it sits in the flow, what it reads and writes). Every function gets a short comment on what and why. Handle every error. All settings go in `src/config.js` with a comment.
5. Match the existing code style. Reuse what's in `src/shared/` (exit codes, retry, run lock, text helpers). Don't copy helpers.
6. `.env` is never committed. No secrets in code.
7. All 185 existing tests must still pass at the end, plus your new ones.

## Read before you start

- `PLAN.md`: section 1.3 (entities: **JobRun**, **JobRunCompany**, the new **JobRunGroup**), 1.5 (services diagram, the `data/` folder), Step 2 (the "Design change: collector in groups" bullet), the failure table in Engineering Standards, and decisions **D39, D48, D48a, D52, D55, D63, D67–D71, D79, D83–D89**.
- The code: `src/collector/` (runCollect.js, companyLoop.js, jobLock.js, googleNews.js), `src/classifier/` (classifierLoop.js, runFinisher.js, exporter.js), `src/supervisor/` (runSupervisor.js, collectionCheck.js, services.js, serviceProcess.js, serviceLink.js, restartRules.js), `src/db/database.js`, `src/shared/`, `src/config.js`.

## What the finished behaviour looks like (the target)

```
npm start
  └─ orchestrator
       ├─ collector = GROUP RUNNER (holds the run lock + heartbeat; fetches nothing itself)
       │     group 1 process  (companies 1–26)   → exits
       │     group 2 process  (companies 27–52)  → exits
       │     ...
       │     group 10 process (companies 234–258) → exits
       │     end log: "Groups: complete 1, 3–10 · failed 2 | Companies failed: [Acme Bio]"
       │     run → collected
       └─ classifier (as today) + writes data/ after each group + at the end → done
```

Example of a crash: group 2 has finished 12 of its 26 companies and its process dies. The runner restarts group 2; it skips the 12 finished companies and goes on from company 13 of the group. Groups 1 and 3–10 are not touched.

## Steps

### Step 1: Settings
In `src/config.js` add, each with a comment:
- `GROUP_COUNT = 10` (D83): the number of groups, not the size
- `GROUP_MAX_CRASHES_IN_A_ROW = 5` (D84)
- `GROUP_RESTART_WAITS_MS = [1000, 2000, 5000, 10000, 30000]` (D84; after the last one keep using 30 s)
- `BAD_REQUEST_RETRIES = 3` and `BAD_REQUEST_WAIT_MS = 60000` (D85: Google 400 → 3 tries, 1 minute apart)

### Step 2: Database (D89)
In `src/db/database.js`:
1. New table **JobRunGroup**: `run_id` (FK → JobRun), `group_number` (int), `status` (`pending` / `in_progress` / `complete` / `failed`, CHECK constraint), `crashes_in_a_row` (int, default 0), `started_at`, `finished_at`, `last_error`, `exported_at` (all nullable). Primary key (run_id, group_number).
2. New column **JobRunCompany.group_number** (int). Add it through the existing `addMissingColumns` so an existing test DB still opens.
3. Tests: the table and the column exist on a new DB and on an old DB opened again.

### Step 3: Creating the groups when a run starts (D83, D88)
In `acquireRun` (`src/collector/jobLock.js`), in the **same transaction** that creates the run and its JobRunCompany rows:
1. Split the companies into `GROUP_COUNT` (10) groups **as equal as possible**, in list order. The first groups get one extra company when it doesn’t divide evenly. 258 companies → groups 1–8 have 26, groups 9–10 have 25: group 1 = companies 1–26, group 2 = 27–52, …, group 8 = 183–208, group 9 = 209–233, group 10 = 234–258. Put this in one small pure function with its own tests.
2. Insert one JobRunGroup row per group, status `pending`.
3. **Remove** the D79 behaviour "a company added to the list while a run is unfinished is added to that run on resume". The checklist is fixed at run start (D88). A new company waits for the next run.
4. Tests: 258 companies → 10 groups (26 ×8, 25 ×2, first and last company as above); 100 → 10 groups of 10; 101 → group 1 has 11, the rest 10; fewer than 10 companies (e.g. 7) → ask me what should happen (question 6). Resuming a run doesn't create groups again and doesn't add new companies.

### Step 4: The group process (new entry file, e.g. `src/collector/runGroup.js`)
This process collects **one group** and exits.
1. It gets from the runner: the run id, the group number and the **runner's pid**. The runner holds the lock; the group process doesn't take its own. All ownership checks (the R4 checks: status writes, the `fetching` claim) use the **runner's pid**, not its own.
2. It works like today's company loop, but only on the companies of its group: take the next `not_started` company **of this group**, `fetching` → `finished` / `failed`. On start, put any `fetching` company of this group back to `not_started` (as today after a crash).
3. When no `not_started` company is left in the group, it exits with code **0**.
4. If the runner is gone (the IPC channel disconnects), it stops cleanly, the same way the services do today (`serviceLink.js`).
5. Exit codes: 0 = group done; 1 = crash; 3 = lost ownership of the run (D71). Use `src/shared/exitCodes.js`.
6. Tests with the fake Google News (`test/fixtures/offline-collect.mjs` and the existing fakes): it collects only its group's companies; it resumes inside the group; it exits 0 at the end.

### Step 5: The group runner (`src/collector/runCollect.js` becomes the runner)
1. Takes or resumes the run and its lock exactly as today: heartbeat every 5 min, emergency heartbeat, refusals with exit 3.
2. Picks groups in order: first an `in_progress` group (a resume), then `pending` ones by number. Sets the group `in_progress` + `started_at`, then starts the group process (Step 4) as a child process with an IPC channel.
3. **Only one group process at a time.** Never start the next group before the current one has exited.
4. When the child exits:
   - **0** → group `complete`, `finished_at`, `crashes_in_a_row = 0`. Next group.
   - **3** → the run belongs to someone else: the runner stops too, with exit 3 (D71).
   - **anything else** = a crash. Save `last_error` (the exit code or signal, plus the child's last error line if you have it). **Progress rule (D84):** if at least 1 company of this group became `finished` or `failed` since the last start, set `crashes_in_a_row` to 1 (this crash is the first one "in a row" after progress); otherwise add 1. At **5** → group `failed`, `finished_at`, log it, go to the next group. Below 5 → wait (`GROUP_RESTART_WAITS_MS`) and start the same group again.
   - Check the exact counting with me before you code it (see question 3 below).
5. **Stopping:** when the orchestrator asks the runner to stop (IPC stop, Ctrl+C, SIGTERM), first ask the group process to stop, wait up to 10 s, force-kill it only if needed, then write the runner's emergency heartbeat (D70) and exit with the usual code.
6. When no `pending` or `in_progress` group is left: print the **end log** (D86), then set the run `collected` exactly as today (hand-over D63).
   ```
   Groups: complete 1, 3–10 · failed 2
   Companies failed: [Acme Bio, Foo Labs]
   ```
7. Progress lines should say which group is running, e.g. `Group 2 of 10 (companies 27–52): 12/26 done`.
8. Tests (offline, real child processes like the existing supervisor tests): groups run one after another and never overlap; a crashing group is restarted and resumes; 5 crashes with no progress → `failed` and the next group runs; progress resets the count; the end log lists failed groups and companies; stop reaches the child and the emergency heartbeat is written.

### Step 6: Google errors (D85), in `src/collector/googleNews.js`
1. **Broken XML** (can't be read, or has no `<channel>`): no longer permanent. Treat it as **temporary**: the same growing waits as 429 / 5xx (5 s → 10 s → … → 10 min).
2. **HTTP 400**: wait `BAD_REQUEST_WAIT_MS` (1 minute) and retry, **3 tries in total**. After the 3rd 400, throw the permanent error; the company becomes `failed` with the reason, and the group **continues** with its next company.
3. Every retry is logged.
4. Tests: broken XML then a good answer → the company finishes; three 400s → the company is `failed` and the next company runs; 400, 400, then success → finished.
5. Other 4xx codes (404, 410, …) are **not** decided yet → ask me (question 1).

### Step 7: `data/` after each group (D86), in the classifier
Today the classifier only exports when the run is `collected` and the queue is empty. Add:
1. While the run is `running`, look for a group that has ended (`complete` or `failed`), has `exported_at` NULL, and has **no articles left to classify** in BufferQueue for the companies of that group (not counting rows that failed for good, D72).
2. For that group: move its leftover relevant rows to Mention, write `data/` (the full snapshot so far, the same three files and the same safe write as today), then set that group's `exported_at`.
3. `run.json` gets: `groups: { total, complete: [numbers], failed: [numbers], exported: n }` and `failedCompanies: [names]`.
4. The end-of-run export and `done` stay as they are.
5. Tests: after group 1 ends and its rows are classified, `data/` exists and group 1 has `exported_at`; group 2 isn't exported before its rows are done; `run.json` shows the group numbers and the failed companies.

### Step 8: Run chosen groups: `npm start -- --groups 2,5` (D87)
1. `src/supervisor/runSupervisor.js` reads `--groups` (a list of numbers) and passes it to the collector. Bad input (`--groups abc`, `--groups 0`, a number bigger than the last group) → clear message, exit 3, nothing is started.
2. With `--groups`, the orchestrator starts the collector even though the collection is complete (this is the only change to D67).
3. The collector, when given groups:
   - The latest run must be **`done`**. If it's `running` or `collected` → refuse (exit 3): "A run is still in progress (collector or classifier). Try again when it's done."
   - Reopen the run: status `running`, the lock taken by this runner. **`started_at` is not changed**, so the 90-day window stays the same (D55).
   - For each chosen group: status `pending`, `crashes_in_a_row = 0`, `exported_at` NULL, its companies back to `not_started` with the error cleared. Groups not chosen are not touched.
   - Then the runner runs only those groups (Step 5), then `collected` → the classifier → `done`.
4. Tests: refused while `running`; refused while `collected`; bad input; on a `done` run only groups 2 and 5 are fetched again, the window is unchanged, and duplicates are dropped.

### Step 9: Documents
1. `PLAN.md`: mark the Step 2 bullet "Design change: collector in groups" as built and add the test results. If anything differs from D83–D89, it must be because the owner decided it; write the new decision number.
2. `README.md`: update "How to run" (the `--groups` command with an example, the end log), the challenges section that describes crashes and resume, and the exit-code table if something changes.

### Step 10: Report back to me
- What you changed, file by file, in plain words.
- The test result (`npm test`: total, pass, fail).
- Every question you asked and the answer you used.
- Anything you noticed but did not change.

## Questions to ask me BEFORE coding (the owner hasn't decided these)

1. **Other 4xx from Google** (404, 410, …): treat them like 400 (3 tries, 1 minute apart, then the company fails), or like temporary errors (growing waits, never fail)?
2. **Run counters on a group re-run** (`--groups`): JobRun has classified / relevant / irrelevant / failed counters for `run.json`. When groups are re-run on a `done` run, should the counters keep adding up (a run total), or should `run.json` show the numbers of the last re-run only?
3. **The exact crash counting** (D84, "5 in a row with no progress"): my reading is: a crash after progress sets the count to 1; a crash with no progress adds 1; at 5 the group is `failed`. Confirm or correct.
4. **The runner's own restarts:** if the runner process itself dies (not a group process), the orchestrator restarts it (D69) and it resumes the `in_progress` group. Should that also count as a crash of the group?
5. **The group process's own heartbeat:** the runner writes the run heartbeat. If a group process hangs (alive but stuck, no progress), should the runner detect that with a time limit, e.g. no company finished in X minutes → kill and count a crash? If yes, what X?
6. **Fewer companies than groups** (e.g. a test list of 7): make 7 groups of 1, or fewer groups? (Only matters for small test lists; the real list has 258.)

Don't start Steps 5–8 until these have answers.

## Owner answers (Prompts 185–186) — these replace the open questions above

1. **Other 4xx (404, 410, …):** same as 400 — 3 tries, 1 minute apart, then that company is `failed` and the group continues.
2. **Run counters on a `--groups` re-run:** keep adding up (a run total).
3. **Crash counting:** confirmed. Progress (a company finished) resets the count to 0; each crash with no progress adds 1; at 5 → group `failed`.
4. **Runner crashes** do **not** count as a crash of the group.
5. **Stuck vs waiting:** the group process sends the runner a "still alive" IPC message whenever it works: before each Google request (`fetching`), on every queue check while the queue is full (`waiting for queue`, every 5 s), and every 30 s during a Google retry wait (`waiting for Google`). If the runner gets **no message for 5 minutes**, the group is stuck: kill it and count a crash. Waiting for the queue or for Google is never "stuck". Setting: `GROUP_STUCK_AFTER_MS = 300000`.
6. **Group size (replaces `GROUP_COUNT = 10`):** `GROUP_TARGET_SIZE = 25`. Number of groups = companies ÷ 25 rounded to the nearest whole number, at least 1; sizes as equal as possible, first groups get the extra company. Examples: 258 → 10 groups (26 ×8, 25 ×2); 7 → 1 group; 24 → 1 group; 40 → 2 groups of 20; 100 → 4 groups of 25. PLAN D83 and D90 are updated.

## Owner answers to your Step 1–4 questions (Prompt 187)

- **Q1a:** 1 (reset to 0, then this crash adds 1). Already answered — don't ask again.
- **Q1b:** yes, a company that ends `failed` counts as progress, same as `finished`.
- **Q2:** keep 403, 408 and 429 exactly as they are today; other 4xx (404, 410, …) like 400. Make sure **every** Google error is logged with its HTTP code and the company name, so the owner can analyze the real run's logs and decide later.
- **Q3:** a `complete` group must never run again. The runner skips it, **and** the group process itself checks the DB and refuses (exit 3, clear message) if its group is not `in_progress`. The only way to re-run a complete group is `--groups`, which first sets it back to `pending`. Test both.
- **Q4:** no support for old databases. The owner starts from a fresh DB (no DB file exists in the project now). Don't add code for runs without groups.
- **Q5:** yes, 130/143 from a group while the runner itself is stopping = a stop, not a crash.
- **Q6:** only **2 working states**, so the message is `{ type: 'alive', state: 'waiting' | 'fetching' }`:
  - `waiting` = the queue is full; send it on every 5 s queue check.
  - `fetching` = getting data from Google, **including** Google's retry waits (send it every 30 s while waiting).
  - Anything else = stuck: no message for 5 minutes (`GROUP_STUCK_AFTER_MS`) → kill it and count a crash.
