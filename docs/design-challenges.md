# Design challenges, solutions and trade-offs

Each design choice solves a specific problem. For each one: the problem, what we do about it, and what it costs. The short version is in the [README](../README.md#assumptions-trade-offs-and-limitations); the decision log (D-numbers) is in [PLAN.md](../PLAN.md).

## 1. There is no official Google News API
- **Problem:** Google shut down its News API in 2016. The Custom Search API is closed to new customers. Paid wrappers (SerpApi etc.) cost money after 100–250 searches, far below our ~7,700 searches/month.
- **Solution:** use the **Google News RSS search feed** (`news.google.com/rss/search?q=...`). It's free, needs no key, and returns Google's news results.
- **Trade-offs:**
  - The feed is undocumented and could change or break at any time.
  - Its terms say it's for personal, non-commercial feed readers, and Google's `robots.txt` disallows it. We accept this knowingly for a non-commercial take-home and document it here.
  - Results come from Google News (news.google.com). They may differ slightly from the "News" tab of Google Search.

## 2. Each search returns only ~100 results
- **Problem:** one RSS search returns about 100 articles at most, with no next page. For a big company like Anthropic, that covers only the last ~3 days, not 90.
- **Solution:** **split the time range.** The feed supports date filters (`after:` / `before:`, tested). We start with one 90-day window per company, and any window that comes back full (≥95 results) is split in half, down to single days. Windows overlap slightly because Google's date edges are fuzzy by about a day.
- **Trade-offs:**
  - More requests for big companies.
  - A very big company can still hit 100 articles in a *single day*. That is an accepted ceiling.
  - Completeness is limited to what Google returns (known limitation).

## 3. Google blocks aggressive scraping
- **Problem:** Google publishes no rate limit. Going too fast leads to HTTP 429 errors, CAPTCHA pages or temporary IP blocks.
- **Solution:**
  - One request at a time, **1 second apart** with a little random jitter. The daily job uses **5 seconds** (see below).
  - On 429 or CAPTCHA, **back off exponentially** (wait longer each time), then retry the same company until it's done.
  - On 403 (blocked), wait 5 s for the first 3 tries, then use the same growing waits (up to 10 min), so a real block isn't hammered.
  - A broken or cut-off XML answer is treated like a 429: growing waits, then the same search again.
  - On **400** (or another 4xx such as 404 or 410, but not 403, 408 or 429): wait 1 minute and try again, **3 tries in total**. After the 3rd, that company is marked `failed` with the reason and its group goes on with the next company. Nothing else fails a company.
  - **Every** Google error is logged with its HTTP code and the company name, e.g. `Google error for Acme Bio: Google rejected the search (HTTP 400 Bad Request) (try 1 of 3); retrying the same search in 1 min.`, so the real run's logs show exactly what Google answered.
  - Companies are fetched **one at a time**.
- **What happened in real runs:** the 90-day collection (745 searches, spread out because it kept pausing for the AI) was never blocked. The first two daily runs searched ~200 companies in a row at 1 per second and were blocked (HTTP 503) for about 2 hours each. So the daily job now waits **5 seconds** between searches (~22 minutes per run, owner decision, D108).
- **Trade-offs:**
  - 1 second is faster than the 3–5 seconds commonly reported as safe, so a block is more likely. We accept that risk for the 90-day collection, which was never blocked. The daily job was blocked at 1 s (twice, for about 2 hours), so it uses 5 s (D108).
  - During the 90-day backfill the local LLM is the slow part, so the faster pace barely changes the total time (a few hours).

## 4. Ambiguous company names bring junk results
- **Problem:** names like *Harvey*, *Island*, *Silo*, *Bites*, *Rewire*, *Glean* are everyday words, and *Groq* collides with xAI's *Grok*. Searching the bare name returns mostly unrelated articles.
- **Solution, in three layers:**
  1. **12 industry sections.** Each company is placed in one section (`filtered_ourcrowd_companies.txt`), and each section adds a few context words to the search:
     - High-Tech (Information Technology)
     - Health (Healthcare & Biotechnology)
     - Sports, Fitness & Entertainment
     - Financials (Banking & Insurance)
     - Consumer Staples (Essential Goods)
     - Consumer Discretionary (Luxury & Leisure)
     - Industrials (Manufacturing & Logistics)
     - Communication Services
     - Energy
     - Utilities
     - Materials
     - Real Estate
  2. **Search hints for the hard names.** Some companies need more than section words, so they get a hint used in the search: the name the press actually writes ("Harvey AI", "Wave Financial", "Launchpad Build AI"), a product, a founder, or a very specific word. Unique names like *Cerebras* need no hint. The hints live in `company_hints.json`: 108 of the 258 names needed one.
     - Example: `after:2026-06-29 before:2026-09-28 "Flash Forest" (section words)`, or, with a hint, `after:… before:… "Peak AI" (section words)`. The date part always goes first.
     - **How the three files come together:**
       ```
       filtered_ourcrowd_companies.txt   company_hints.json    section_keywords.json
         Harvey → section 1                Harvey → "Harvey AI"  1 → (company OR AI OR …)
                  └──────────────────────────┬─────────────────────────┘
                                             ▼
                        SEED LOADER (collector's first step at start-up)
                                             ▼
                  Company table: query_param = "Harvey AI" (company OR AI OR …)
                                             ▼
                  COLLECTOR: date window + query_param → Google News
       ```
     - **How it's wired:** at start-up a small seed loader reads the three files (`filtered_ourcrowd_companies.txt`, `company_hints.json`, `section_keywords.json`), builds each company's search once, and saves it in the database. The collector reads that search and puts the date window at the front, e.g. `after:2026-07-01 before:2026-07-15 "Harvey AI" (company OR AI OR …)`. Edit a file and the searches are rebuilt on the next start.
     - **Why:** fewer junk articles enter the queue, so the LLM checks fewer articles (less load on the slowest stage) and more of the 100 results per search are real. In our test, the plain search "Harvey" gave 25 real articles out of 100, and the search with context gave 86.
  3. **LLM relevance check.** The local model confirms that each article is really about *this* company before it counts.
- **Trade-offs:**
  - We favor **precision over recall**: a wrong article on the dashboard hurts trust more than a missed one, so some real mentions may be filtered out.
  - Every company has to be assigned a section, and hard names need a hint that was researched by hand. A new company with a confusing name needs a hint added.
  - A hint that is too narrow can drop real articles that don't use it.

## 5. Throughput: collection is much faster than the LLM
- **Problem:** the stages run at very different speeds:
  - The collector brings in up to ~20–30 articles/second, even with pacing.
  - The local LLM handles about 3–4 articles/second.
  - Left alone, unclassified articles would pile up.
- **Solution: a buffer queue with a cap.**
  - Fetched articles go into a **BufferQueue table** in SQLite.
  - Each search result is inserted as **one chunk**, and only if the whole chunk fits under the **CAP**. Example: with CAP 10,000 and 9,999 waiting, a chunk of 100 waits until the queue drops to 9,900.
  - The collector **holds** while the queue is full and the LLM catches up.
  - The collector and classifier are separate services that meet only in this table. No queue library is needed.
  - **Speeding up the LLM: parallel requests (measured on REAL DATA).** The classifier sends **4 articles to Ollama at the same time** (Ollama's `OLLAMA_NUM_PARALLEL` = 4, plus 4 workers in the classifier, `LLM_CONCURRENCY`). We measured 1 to 8 at once on the 598 real headlines: 4 at once is **1.66× faster** (2.45 → 4.08 articles/s) with the same accuracy, taking the ~20k-article backfill from about 2.3 h to 1.4 h. Details: [LLM research, section 7](llm-research.md#7-speeding-up-the-llm-parallel-requests).
- **Trade-offs:**
  - The collector sometimes sits idle.
  - Parallel requests don't scale for free: each one uses extra GPU memory, and on one GPU the gain is usually well below 2× per doubling. Too many can push the model partly onto the CPU and make it slower. Workers must never pick the same article, so each worker claims its rows in the queue first.
  - The CAP is **10,000** rows, and relevant rows move to the Mention table **1,000 at a time**. The CAP must be at least the largest chunk (~100), or the loop would wait forever.
  - The CAP limits the *queue*, **not** the number of mentions: every relevant mention is kept.

## 6. Memory: articles piling up in RAM
- **Problem:** holding thousands of waiting articles in memory risks running out of memory, and a crash would lose them.
- **Solution:**
  - The queue lives **in the database, not in RAM**. The queue size is simply the number of rows in BufferQueue.
  - Collection runs **one company at a time** (no parallel fetches).
  - The companies are split into **10 groups of ~25**, and each group is collected by **its own process**, which exits when its group is done, so whatever memory it used is freed before the next group starts.
- **Trade-off:** a DB count before each chunk, which is cheap with an index and happens once every few seconds.

## 7. Database write load
- **Problem:** writing each article or LLM result individually means thousands of tiny writes, and writing everything at once is a risk.
- **Solution:** **all writes are chunked, and each chunk is one transaction:**
  - one search result per insert
  - one LLM batch per update
  - one group of relevant articles per move from BufferQueue to Mention
- **Trade-off:** results show up in batches rather than instantly. Fine for a daily job.

## 8. The local LLM is slow for a 90-day backfill
- **Problem:** roughly 10k–20k candidate articles × up to 2 questions each could take hours on a local GPU.
- **Solution:**
  - **One end-to-end step per article:** first "is it about the company?"; if not, the sentiment question is skipped and the article is deleted.
  - **Classify once:** a stored article is never sent to the LLM again.
  - The run is **resumable**, so an interruption loses no finished work.
- **Trade-off:** the first backfill is still long (hours). Later daily runs only handle ~1/90 of that.

## 9. Irrelevant articles
- **Problem:** keeping every rejected article grows the database with data we never show.
- **Solution:** irrelevant articles are **deleted**. The daily search covers only the last ~24 hours, so the same article rarely comes back.
- **Trade-offs:**
  - Google's fuzzy date edges and reruns after a crash can occasionally bring a rejected article back for one more LLM check.
  - We don't keep rejected samples in the database. For validation, the samples are collected separately.

## 10. Duplicates
- **Problem:** the same article can arrive again: tomorrow's search, overlapping date windows, a rerun after a crash, or a different search query.
- **Solution: two checks at insert time, across both tables:**
  1. **Same company + same Google article ID (`guid`)** = duplicate.
     - Tested: the same search run twice gave 100/100 identical guids.
     - Different searches gave 16/17 identical.
  2. **Backup: same company + same publisher + same title** = duplicate.
- **Why not publisher + date?** We tested it: Google often rounds publication times (e.g. `07:00:00 GMT`), and 22 *different* articles in our sample shared publisher + date. Title is what tells same-day articles apart.
- **Trade-offs:**
  - Google doesn't document that guids are stable (we measured instead).
  - Two genuinely different articles with an identical title from the same publisher would be merged. That's rare.
- **Not duplicates:** an article about two companies is one mention *per company*. The same story syndicated on different sites counts separately, since each is a real press appearance.

## 11. Google links are not the real article URL, and there's no snippet
- **Problem:**
  - RSS links are Google redirect pages (`news.google.com/rss/articles/...`), not the publisher's URL.
  - The "description" field is not a real snippet, just the title and publisher again.
- **Solution:**
  - We **keep the Google link**. It opens the real article in a browser (checked by hand).
  - Decoding it into the publisher URL (e.g. `politico.com/...`) was tested and works, but it costs 2 extra Google requests per article: about 20,000 requests and 5.5 hours for the backfill, plus a higher risk of being blocked. Not worth it (D60).
  - The LLM classifies from the **title** (and publisher).
- **Trade-offs:**
  - Links show `news.google.com` instead of the publisher's site; the publisher name is shown next to each mention.
  - Classifying from titles only is less accurate than full text. The model choice and validation take this into account.

## 12. Crashes and failures
- **Problem:** long runs meet real failures: the internet drops, Google blocks, Ollama stops, the PC restarts, the model returns garbage.
- **Why it matters:** the collector, classifier and database writes together carry the whole throughput. If one process ran everything, one crash would stop it all.
- **Solution: independent services + a supervisor, with 4 layers of protection.** `npm start` supervises the collector and the classifier; the dashboard (`npm run dashboard`) and the daily job (`npm run daily`) are separate commands.
  ```
  npm start
    └─ orchestrator  (restarts any service that dies)
         ├─ collector    → group runner: group 1 process → group 2 process → … (one at a time)
         │                   each group: ~25 companies → Google News → BufferQueue
         └─ classifier   → BufferQueue → Ollama → Mention → data/
  ```
  1. **One item fails → retry it.** A temporary Google error (no internet, 429, 5xx, timeout, broken XML) is retried on the **same company until it's done**, with growing waits capped at ~10 minutes. Google 400 (or another 4xx except 403/408/429) is tried 3 times, 1 minute apart; then that company is marked `failed`, reported, and its group goes on. Invalid LLM JSON is retried, then marked `failed`.
  2. **A loop fails → only that loop restarts.**
  3. **A process dies → the supervisor restarts only that service.** The others keep running: if the internet drops, the collector waits **while the classifier keeps working through the queue**. A service that keeps crashing is stopped with a clear error instead of looping forever. An article that crashes the classifier is counted *before* processing; after a crash the articles are retried one at a time, so only the one that really causes it reaches 3 tries and is set aside as `failed`.
  4. **After a restart → resume, don't start over.** A `JobRun` table (a lock + a heartbeat written every 5 minutes. On a crash or stop, the service writes one last **emergency heartbeat** with the error, which releases the lock so the restart resumes at once. If even that can't be written, e.g. on power loss, a dead owner process is detected at once and a frozen one after 15 minutes without a beat), a per-run company checklist (`JobRunCompany`, each company `not_started` → `fetching` → `finished`, or `failed`) and a per-run group list (`JobRunGroup`, each group `pending` → `in_progress` → `complete`, or `failed`) record where we stopped. The companies and groups of a run are fixed when it starts; a company added to the list later waits for the next run. The collection ends when every group is `complete` or `failed`. Every write is a transaction and inserts skip existing rows, so redoing the interrupted company is safe.
  - **Groups: a crash stays inside its group.** The collector's main process (the *group runner*) holds the lock and fetches nothing itself; it starts one **group process** at a time. Example: group 2 has finished 12 of its 26 companies and its process dies. The runner starts group 2 again (after 1 s, 2 s, 5 s, 10 s, 30 s …); it skips the 12 finished companies and goes on from company 13. Groups 1 and 3–10 are not touched.
    - **5 crashes in a row with no progress** (no company finished or failed in between) → the group has failed a round and is **tried again, 3 more times** (`GROUP_FAILED_RETRIES`), each time with a fresh count. After that it is `failed`, skipped, and the next group starts; it is listed in the end log and `run.json`. The runner never stops because groups fail. Progress resets the count. A crash of the runner itself doesn't count against the group.
    - **A company that crashes its group process 3 times** (`COMPANY_MAX_GROUP_CRASHES`; the company being fetched when the process died, or was killed as stuck) is marked `failed` ("crashed the group process 3 times (last: …)") and the group goes on with its next company, so one bad feed can't fail the rest of its group. That `failed` doesn't count as progress for the group's crash count.
    - **Stuck, not just slow:** a group process tells the runner "still alive" before each Google request, every 30 s while it waits to retry Google, and every 5 s while the queue is full. **No signal for 5 minutes** = stuck: the runner kills it and counts a crash. Waiting for Google or for the queue is never "stuck".
    - Stopping (Ctrl+C) first stops the group process (6 s, then a forced kill), then writes the runner's emergency heartbeat.
  - The services share only the SQLite file. There's **no database service**: SQLite is a file, not a server, so there's nothing to crash.
  - **Exit codes** tell the orchestrator why a service stopped, so it only restarts real crashes:

    | Code | Meaning | What the orchestrator does |
    |---|---|---|
    | `0` | Finished normally (e.g. the collection is done) | Doesn't restart it |
    | `3` | Refused, nothing wrong (another live process holds the run, the previous run is still being classified, another process took the run over, or `--groups` can't be used now: a bad value, no such group, or the last run is being classified or a live collector is working on it) | Logs the reason, doesn't restart it |
    | `1` | Crashed | Restarts it: 1 s → 2 s → 5 s → 10 s → 30 s → 60 s; more than 5 crashes in 10 minutes → gives up on that service with a clear error |
    | `130` | Stopped with Ctrl+C | Expected during shutdown |
    | `143` | Stopped by a stop request | Expected during shutdown |
  - **Every stop or restart writes the emergency heartbeat first.** The orchestrator sends the service a "stop" message (Windows has no soft stop signal between programs), the service writes its last heartbeat to the database and exits, and only if it hasn't exited after 10 s is it force-killed. Every restart is logged, e.g. `[orchestrator] classifier crashed (exit 1), restart #2 in 5 s`.
  - Articles that failed for good (3 failed rounds) don't count toward the queue limit, so they can't block collection. How many were skipped is logged.
  - When there is no `.env` file, Node prints `.env not found. Continuing without it.` That's expected: `.env` is optional.
  - If the PC was turned off mid-run, the next `npm start` resumes the unfinished collection.
  - Daily job: a mention is marked "alerted" only after Discord accepts the message.
- **Trade-offs:**
  - Alerts are *at-least-once*. In the rare case of a crash between sending and marking, the next digest may repeat a mention. We prefer that over missing one.
  - Our own small supervisor instead of **PM2** (the standard Node process manager): no extra tool for the reviewer to install, but PM2 would be the choice in production.
  - Several processes (collector, classifier, daily job) write to one SQLite file. WAL mode and short transactions make them take turns, which is fine at our write rate but wouldn't scale to many writers.
  - "Retry until done" can hold one company for a long time if Google blocks us for hours. The classifier keeps working meanwhile.

## 13. Multi-hour runs are hard to follow
- **Problem:** a backfill runs for hours. Without feedback, it's unclear whether it's working, waiting or stuck.
- **Solution:** a live progress line per service, e.g. `group 3/10 · company 5/26 · Harvey · fetching · window 3 · queue 3,400/10,000 · Google unreachable, retry in 1 min`, plus `npm run progress` (a read-only summary from the database).
- **Log files** (`db/logs/run-<id>/`): the same events are kept after the window is closed, one file per process and per group, each line with the date and time, and `orchestrator.log` tells the whole run in a few lines. This is where Google's errors are studied after a real run.

## 14. Keeping "N days ago" correct
- **Problem:** a stored "3 days ago" is wrong tomorrow.
- **Solution:** the status is **computed when the dashboard asks** (latest mention date vs today), never stored. A snapshot is exported to `data/` at the end of each run.

## 15. Reviewing results without re-running everything
- **Problem:** the full pipeline needs Ollama, a GPU and hours of runtime.
- **Solution:**
  - After each group of the collection (once its articles are classified) and at the end of each run, the classifier exports the results to **`data/` as JSON**, readable directly on GitHub:
    - `companies.json`: every company with its status (days since last mention, or "no coverage found")
    - `mentions.json`: every relevant mention from the last 90 days, with sentiment, publisher, date and link
    - `run.json`: a run summary (counts fetched / relevant / deleted / failed; groups complete / failed / exported; failed companies)
  - Only relevant, classified mentions are exported. Each run rewrites a full snapshot, so `data/` always matches the database.
  - Each file is written to a temp file and then renamed, so a crash can never leave a half-written file.
  - The daily job writes `data/` again after each run with new mentions (old + new mentions, new totals, and a `lastDailyRun` part in `run.json`), after the Discord message, so `run.json` can say whether the alert went out.
  - When the API starts on an empty database, it **imports `data/` automatically**, so the dashboard works right away from the committed results.
- **Docker (D116):** `docker compose up -d` runs everything (dashboard, daily job, the AI with the model inside, and the backfill on demand) on the CPU, with the database shipped in the image. See [Quick start with Docker](../README.md#quick-start-with-docker).

## 16. Other deliberate limits
- **Old data is filtered, not deleted.** Queries use the last 90 days, which keeps the door open for longer ranges later.
- **Former names aren't searched** ("formerly Plantish", etc.): only current names, to avoid noise. Known limitation.
- **No authentication or company editing.** Not required; the seed file is the source of truth. The API only listens on this computer (127.0.0.1).
