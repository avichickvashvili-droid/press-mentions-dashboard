# Press Mentions Monitoring & Dashboard

> **Status: work in progress.** The system design is done; implementation hasn't started.
> Setup and run commands, results and the LLM evaluation will be added as each part is built.
> Full design notes and the decision log (D1–D37) are in [PLAN.md](PLAN.md).

## What it does

For every company in `ourcrowd_companies.txt` (258 companies), the system:

1. **Collects** its news from the last 90 days from Google News.
2. **Classifies** each article with a **local Ollama model**: is it really about this company, and if so, is it positive, negative or neutral?
3. **Stores** the relevant mentions in SQLite.
4. **Shows** a dashboard: every company with its status ("last mentioned 3 days ago" / "no coverage found"). Click a company to see its mentions, newest first, each with its sentiment and a link to the article.
5. **Runs daily**, adds new mentions, and sends one alert listing them.

## How it works

```
ourcrowd_companies.txt (258 companies, sorted into 12 sections)
        │
        ▼
1. DATA COLLECTION ◄──► Google News RSS  (one company at a time, paced)
        │  each search result = one chunk; waits while the queue is full
        ▼
2. BUFFER QUEUE (SQLite table)   articles waiting for the LLM
        │  batches
        ▼
3. CLASSIFICATION ◄──► Ollama (local)
        │  not about the company → deleted
        │  about the company     → sentiment → moved in chunks
        ▼
4. MENTION TABLE (SQLite) ──► data/ (JSON export of the run)
        │
        ▼
5. API (Express) ──► 6. DASHBOARD (React + Vite)

Daily job (node-cron): re-runs steps 1–4, then sends one alert with the new mentions.
```

## Tech stack

| Part | Choice | Why |
|---|---|---|
| Runtime | Node.js 24 | Required by the brief |
| Database | SQLite via built-in `node:sqlite` | We need relations between tables, unique rules to block duplicates, and transactions so chunk writes are all-or-nothing. It's a single file with no server and no install |
| News source | Google News RSS search feed | The only free, structured access to Google's news results |
| LLM | Ollama (local), model chosen by research ([see below](#llm-research-model-choice-and-validation)) | Required by the brief: a local model for all text understanding |
| Orchestration | Our own small loop + node-cron to start it daily | The database already is the queue, so a queue library would add a server (Redis) for nothing |
| API | Express | Fastest to build in a time-limited task. *For a production API, Fastify would be the better choice* (built-in validation and logging) |
| Frontend | React + Vite | List → click → detail view; fast dev server |
| Tests | `node:test` (built in) with fakes for Google News and Ollama | Tests run offline and fast |

---

## System challenges, solutions and trade-offs

Each design choice solves a specific problem. For each one: the problem, what we do about it, and what it costs.

### 1. There is no official Google News API
- **Problem:** Google shut down its News API in 2016. The Custom Search API is closed to new customers. Paid wrappers (SerpApi etc.) cost money after 100–250 searches, far below our ~7,700 searches/month.
- **Solution:** use the **Google News RSS search feed** (`news.google.com/rss/search?q=...`). It's free, needs no key, and returns Google's news results.
- **Trade-offs:**
  - The feed is undocumented and could change or break at any time.
  - Its terms say it's for personal, non-commercial feed readers, and Google's `robots.txt` disallows it. We accept this knowingly for a non-commercial take-home and document it here.
  - Results come from Google News (news.google.com). They may differ slightly from the "News" tab of Google Search.

### 2. Each search returns only ~100 results
- **Problem:** one RSS search returns about 100 articles at most, with no next page. For a big company like Anthropic, that covers only the last ~3 days, not 90.
- **Solution:** **split the time range.** The feed supports date filters (`after:` / `before:`, tested). We start with one 90-day window per company, and any window that comes back full (≥95 results) is split in half, down to single days. Windows overlap slightly because Google's date edges are fuzzy by about a day.
- **Trade-offs:**
  - More requests for big companies.
  - A very big company can still hit 100 articles in a *single day*. That is an accepted ceiling.
  - Completeness is limited to what Google returns (known limitation).

### 3. Google blocks aggressive scraping
- **Problem:** Google publishes no rate limit. Going too fast leads to HTTP 429 errors, CAPTCHA pages or temporary IP blocks.
- **Solution:**
  - One request at a time, about **3–5 seconds apart with random jitter**.
  - On 429 or CAPTCHA, **back off exponentially** (wait longer each time), then resume.
  - Companies are fetched **one at a time**.
- **Trade-off:** the first 90-day backfill takes a few hours. The daily run takes about 15–20 minutes.

### 4. Ambiguous company names bring junk results
- **Problem:** names like *Harvey*, *Island*, *Silo*, *Bites*, *Rewire*, *Glean* are everyday words, and *Groq* collides with xAI's *Grok*. Searching the bare name returns mostly unrelated articles.
- **Solution, in two layers:**
  1. **12 industry sections.** Each company is placed in one section, and each section has its own search query or queries that add context:
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
  2. **LLM relevance check.** The local model confirms that each article is really about *this* company before it counts.
- **Trade-offs:**
  - We favor **precision over recall**: a wrong article on the dashboard hurts trust more than a missed one, so some real mentions may be filtered out.
  - Every company has to be assigned a section.

### 5. Throughput: collection is much faster than the LLM
- **Problem:** the stages run at very different speeds:
  - The collector brings in up to ~20–30 articles/second, even with pacing.
  - The local LLM handles about 3–4 articles/second.
  - Left alone, unclassified articles would pile up.
- **Solution: a buffer queue with a cap.**
  - Fetched articles go into a **BufferQueue table** in SQLite.
  - Each search result is inserted as **one chunk**, and only if the whole chunk fits under the **CAP**. Example: with CAP 10,000 and 9,999 waiting, a chunk of 100 waits until the queue drops to 9,900.
  - The collector **holds** while the queue is full and the LLM catches up.
  - Our own small loop does this orchestration. No queue library is needed.
- **Trade-offs:**
  - The collector sometimes sits idle.
  - The CAP must be tuned to the machine's LLM speed, and it must be at least the largest chunk (~100), or the loop would wait forever.
  - The CAP limits the *queue*, **not** the number of mentions: every relevant mention is kept.

### 6. Memory: articles piling up in RAM
- **Problem:** holding thousands of waiting articles in memory risks running out of memory, and a crash would lose them.
- **Solution:**
  - The queue lives **in the database, not in RAM**. The queue size is simply the number of rows in BufferQueue.
  - Collection runs **one company at a time** (no parallel fetches).
- **Trade-off:** a DB count before each chunk, which is cheap with an index and happens once every few seconds.

### 7. Database write load
- **Problem:** writing each article or LLM result individually means thousands of tiny writes, and writing everything at once is a risk.
- **Solution:** **all writes are chunked, and each chunk is one transaction:**
  - one search result per insert
  - one LLM batch per update
  - one group of relevant articles per move from BufferQueue to Mention
- **Trade-off:** results show up in batches rather than instantly. Fine for a daily job.

### 8. The local LLM is slow for a 90-day backfill
- **Problem:** roughly 10k–20k candidate articles × up to 2 questions each could take hours on a local GPU.
- **Solution:**
  - **One end-to-end step per article:** first "is it about the company?"; if not, the sentiment question is skipped and the article is deleted.
  - **Classify once:** a stored article is never sent to the LLM again.
  - The run is **resumable**, so an interruption loses no finished work.
- **Trade-off:** the first backfill is still long (hours). Later daily runs only handle ~1/90 of that.

### 9. Irrelevant articles
- **Problem:** keeping every rejected article grows the database with data we never show.
- **Solution:** irrelevant articles are **deleted**. The daily search covers only the last ~24 hours, so the same article rarely comes back.
- **Trade-offs:**
  - Google's fuzzy date edges and reruns after a crash can occasionally bring a rejected article back for one more LLM check.
  - We don't keep rejected samples in the database. For validation, the samples are collected separately.

### 10. Duplicates
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

### 11. Google links are not the real article URL, and there's no snippet
- **Problem:**
  - RSS links are Google redirect pages (`news.google.com/rss/articles/...`), not the publisher's URL.
  - The "description" field is not a real snippet, just the title and publisher again.
- **Solution:**
  - For **relevant articles only** (when they move to the Mention table), decode the Google link into the **real publisher URL**. Tested: two requests to Google return e.g. `politico.com/news/2026/09/24/...`.
  - If decoding fails, we keep the Google link, which still opens the article in a browser.
  - The LLM classifies from the **title** (and publisher).
- **Trade-offs:**
  - Decoding uses an undocumented Google endpoint that could break. The fallback keeps every mention linkable.
  - Classifying from titles only is less accurate than full text. The model choice and validation take this into account.

### 12. Crashes and failures
- **Problem:** long runs meet real failures: the internet drops, Google blocks, Ollama stops, the PC restarts, the model returns garbage.
- **Solution:**
  - The **collector and classifier are independent loops.** If the internet drops, the collector retries with backoff **while the LLM keeps working through the queue**.
  - Every write is a transaction, and inserts skip existing rows (never overwrite), so a rerun resumes exactly where it stopped.
  - The LLM must answer in **strict JSON**. Invalid answers are retried, then marked `failed` and retried on the next run.
  - A company that keeps failing is skipped for this run and picked up next time.
  - The alert is marked "sent" only after it actually sends.
- **Trade-off:** alerts are *at-least-once*. In the rare case of a crash between sending and marking, the next digest may repeat a mention. We prefer that over missing one.

### 13. Multi-hour runs are hard to follow
- **Problem:** a backfill runs for hours. Without feedback, it's unclear whether it's working, waiting or stuck.
- **Solution:** a live progress display:
  - the stage and a % bar
  - the current company and how many are left
  - queue size and LLM rate
  - any retry state (e.g. "Google unreachable, retrying in 60 s · LLM still working: 1,240 in queue")

### 14. Keeping "N days ago" correct
- **Problem:** a stored "3 days ago" is wrong tomorrow.
- **Solution:** the status is **computed when the dashboard asks** (latest mention date vs today), never stored. A snapshot is exported to `data/` at the end of each run.

### 15. Reviewing results without re-running everything
- **Problem:** the full pipeline needs Ollama, a GPU and hours of runtime.
- **Solution:**
  - At the end of each run, the results are exported to **`data/` as JSON** (companies with status, mentions with sentiment and links). They're readable directly on GitHub.
  - When the API starts on an empty database, it **imports `data/` automatically**, so the dashboard works right away from the committed results.
- **Optional:** a Docker image for the API + dashboard only. The pipeline stays local, because Ollama needs the GPU.

### 16. Other deliberate limits
- **Old data is filtered, not deleted.** Queries use the last 90 days, which keeps the door open for longer ranges later.
- **Former names aren't searched** ("formerly Plantish", etc.): only current names, to avoid noise. Known limitation.
- **No authentication, company editing, or real-time updates.** Not required; the seed file is the source of truth.

---

## LLM research: model choice and validation

> **To be completed in Step 3 (Classification).**

**Research plan:**
1. Survey current models that run on Ollama, including recent releases.
2. Look for existing benchmarks on similar tasks: news sentiment, and whether an article is about a given company (entity relevance).
3. Only trust benchmarks run on **real data**, not synthetic examples.
4. Check that the benchmarks match **our input**: Google News titles + publisher, with no article body.
5. If no benchmark fits, **test candidate models ourselves on real Google News data** from this project.

**Will be documented here:**
- The chosen model, and why.
- How it's invoked: prompt structure, strict JSON output, retries.
- How quality was validated: a hand-labeled sample of real articles, with relevance and sentiment accuracy reported.
- Measured speed on the dev machine (articles/second), which sets the queue CAP.

## Setup and running

> To be added as the system is built: dependencies, environment variables, installing Ollama and pulling the model, and the exact commands to run end to end.

## Known limitations

See challenges 1, 2, 4, 9, 10, 11 and 16 above. This section will be finalized after the real run.
