# Project Plan — Press Mentions Monitoring & Dashboard

Status legend: ✅ done · 🔄 in progress · ⏳ not started · ❓ needs decision

## Task Requirements Checklist (from `OC FullStack Dev Task 2026.pdf`)

Re-check every decision against this list.

### Goals (the "three required outputs")
- [ ] **G1 Quarterly dashboard** — every tracked company, its press mentions over the last quarter, each labeled positive / negative / neutral, each linked to the source URL.
- [ ] **G2 Mention status** — per company, based on last-mentioned date ("3 days ago" / "45 days ago" / "no coverage found").
- [ ] **G3 Daily alert** — a daily job checks for new mentions of any tracked company and sends an alert when one is found. The channel is our choice, but it must be visible and documented.

### Constraints
- [ ] The seed list (`ourcrowd_companies.txt`) is the source of truth for which companies we track.
- [ ] News source is our choice (can differ per company). Document the choice and its limitations in the README.
- [ ] Sentiment, and **any** other text-understanding step (e.g. relevance filtering), must use a **local Ollama model**. No cloud LLM.
- [ ] Backend and data collection in **Node.js**.
- [ ] Storage: files or a lightweight DB.
- [ ] Scheduled job: cron, script, or workflow tool.

### Deliverables
- [ ] GitHub repo with the full solution.
- [ ] README covering:
  - [ ] what it does and how it's structured
  - [ ] setup: dependencies, env vars, installing/running Ollama, which model to pull
  - [ ] exact commands to run end-to-end locally
  - [ ] assumptions, trade-offs, known limitations
  - [ ] news-source choice and its limitations
  - [ ] which Ollama model and why
  - [ ] how the model is invoked (prompt structure, output format)
  - [ ] how classification quality was validated
- [ ] `data/` folder with the output of a successful run: mentions, sentiment labels, links, per-company last-mentioned status.
- [ ] **Copy of the full AI assistant prompts** → `prompts/ai-assistant-prompts.md`, **appended after every prompt**.

### Evaluation criteria
Correctness (runs end-to-end, three outputs) · Code quality · Use of local LLM · Documentation (reviewer can run from README alone) · Product thinking (sentiment, alerting, dashboard presentation).

### Notes from the brief
- Make reasonable assumptions and **document them**.
- A partial solution with clear notes beats an undocumented "complete" one. **So get an end-to-end slice running early.**
- We may reach out with questions about the company list or scope.

---

## Steps

| # | Step | Status |
|---|------|--------|
| 1 | System design | 🔄 |
| 2 | Data collection | ⏳ |
| 3 | Classification (Ollama) | ⏳ |
| 4 | Storage layer | ⏳ |
| 5 | Dashboard / UI layer | ⏳ |
| 6 | Daily job + alert | ⏳ |
| 7 | Deliver the task | ⏳ |

### 1. System design 🔄
Follows the agreed design process (see Prompt 1):

| Sub-step | Status |
|---|---|
| 1.1 Functional requirements | ✅ |
| 1.2 Non-functional requirements | ✅ |
| 1.3 Core entities | ✅ |
| 1.4 API design | ✅ |
| 1.5 High-level architecture | ✅ (query_param moved to deep dive DD1) |
| Deep dive DD1: query_param for ambiguous names | 🔄 user presenting |
| 1.6 Data flow | ⏳ |
| 1.7 Database design | ⏳ |
| 1.8 External data / integrations | ⏳ |
| 1.9 Performance & scalability | ⏳ |
| 1.10 Failure scenarios | ✅ (see Engineering Standards, D37) |
| 1.11 Security | ⏳ |
| 1.12 Trade-offs | ⏳ |
| 1.13 MVP vs production | ⏳ |
| 1.14 Implementation plan (details steps 2–7) | ⏳ |

#### 1.1 Functional Requirements ✅

**Explicit requirements**

*Quarterly dashboard (G1)*
- FR1. Users can see every company from the seed list on the dashboard, including companies with no coverage.
- FR2. Users can see, for each company, **all** of its press appearances from the last 90 days (rolling) that our sources return. We never cap the number on purpose (see D11).
- FR3. Users can see each mention's sentiment: positive, negative, or neutral.
- FR4. Users can open each mention's original article through its source URL.

*Mention status (G2)*
- FR5. Users can see, for each company, its current mention status based on the date of its latest mention: "last mentioned N days ago", or "no coverage found" when it has no mention in the last 90 days.

*Daily alert (G3)*
- FR6. The system runs a job once a day that checks all tracked companies for new mentions.
- FR7. The system sends one alert, a daily digest, when the run finds new mentions. The alert channel is visible and documented.
- FR8. The system never alerts about the same mention twice.

*Pipeline*
- FR9. The system reads the tracked companies from the seed list file.
- FR10. The system fetches news for each company from the chosen source(s).
- FR11. The system uses the local Ollama model to drop articles that aren't about the company (relevance) before they count as mentions.
- FR12. The system classifies each relevant mention's sentiment with the local Ollama model, once per mention.
- FR13. The system stores each mention once per (company, normalized URL), so a rerun doesn't create duplicates.
- FR14. The system writes the results of a run to `data/`: mentions, labels, links, and per-company status.
- FR15. A reviewer can run the whole pipeline locally with the documented commands.

**Out of scope**
- Authentication, users, roles
- Adding or editing companies via UI/API (the seed file is the source)
- Summarization (only an example in the brief)
- Real-time or streaming updates
- Cloud deployment
- Trend charts, analytics, search, export (optional extras only)
- Grouping syndicated copies of one story (optional)
- Coverage older than 90 days
- Searching former company names (documented limitation, D10)

#### 1.2 Non-Functional Requirements ✅

These state *what* the system must satisfy. *How* is decided in 1.5+ (high-level design / deep dives).

| # | NFR | Target | Driven by |
|---|---|---|---|
| NFR1 | Scale | 258 companies; one local user (the reviewer); roughly 10k–20k candidate articles per 90 days (estimate, measured in step 2) | Seed list, G1 |
| NFR2 | Processing time: daily run | Finishes in under 1 hour on the dev machine | G3 "daily" |
| NFR3 | Processing time: first 90-day backfill | May take hours, but must be resumable: an interruption doesn't lose finished work | G1 + local-LLM speed |
| NFR4 | Dashboard latency | Loads in about 1–2 s for all 258 companies; loading it doesn't depend on news sources or Ollama being up | G1, G2 |
| NFR5 | Freshness | Mentions at most ~24 h old; "N days ago" is correct on the day the page is viewed | G2, G3 |
| NFR6 | Classification quality | Relevance favors precision; relevance and sentiment accuracy are both measured on a hand-labeled sample and reported in the README | 4.1, evaluation "use of local LLM" |
| NFR7 | Reliability | One failing company, source, or LLM call doesn't abort the run; reruns are safe; no missed or double alerts | Evaluation "error handling", FR8, FR13 |
| NFR8 | Reproducibility | A reviewer can set up and run it end-to-end from the README alone (exact commands, env vars, Ollama model to pull), **and** can review results without running anything via the committed `data/` folder. No hardware target: built and run on the dev machine. | Deliverables: README + data folder |
| NFR9 | Cost | $0 to run: free-tier/no-key sources, local LLM (**assumption confirmed**, D12) | Reviewer can run it without paying |
| NFR10 | Security (baseline) | No secrets in the repo; untrusted article text is rendered safely | Public GitHub repo; scraped content |
| NFR11 | Maintainability | Clear module boundaries (collect / classify / store / serve / alert); a source can be added without touching the rest | Evaluation "code quality" |
| NFR12 | External etiquette | Respect provider rate limits and terms | Sourcing choice (details in 1.8) |

**Not design drivers:** availability/uptime (it's a local tool), multi-user consistency (a single writer), horizontal scaling.

**Back-of-envelope (why NFR2/NFR3 matter):**
- Rough split: ~200 small companies × ~5 articles + ~40 mid × ~50 + ~15 large × 500–2,000 ≈ **10k–20k candidate articles** for the backfill.
- **Dev machine:** i7-13620H, 32 GB RAM, RTX 4070 Laptop (8 GB VRAM), Node v24.15.0, Ollama 0.34.3. A ~7–8B model fits in VRAM, so each short call takes roughly 0.5–1 s (to be measured in step 3).
- Each article needs about 2 calls (relevance + sentiment).
- **Backfill:** 20k × 2 × ~0.5–1 s ≈ **~5–11 h worst case.** That still can't be a naive single pass, so it drives the design.
- **Daily run:** ≈ 1/90 of that ≈ 100–250 articles ≈ **~2–8 min.** That's fine.

#### 1.3 Core Entities ✅ (updated in Prompts 42–43: BufferQueue added)

Logical entities only; the storage technology is chosen in 1.7. Three entities: **Company**, **BufferQueue** (waiting articles), **Mention** (final relevant mentions, the "sentiment table").

**Company** (loaded from `ourcrowd_companies.txt`, the source of truth — FR9)

| Field | Type | Notes |
|---|---|---|
| id | string (slug) | PK, e.g. `lambda` |
| name | string | Display/search name with the annotation removed, e.g. `Lambda`. Unique. |
| hint | string, nullable | Disambiguation taken from the seed line, e.g. `lambda.ai`, `Safe Superintelligence`, `formerly Edge` |
| query_param | string | The search query used for this company, needed because many names are ambiguous. Built from the company's section (DD1: 12 sections, each with its own query/queries). |

Not added: portfolio vs fund type (not in the list), sector/domain (not in the list). A separate former_name field was dropped: "(formerly X)" goes into `hint` (user's design).

**BufferQueue**: fetched articles waiting for the LLM (user's design, Prompt 42; D24). This is the queue between DC and classification (D21).

| Field | Type | Notes |
|---|---|---|
| id | int | PK |
| company_id | FK → Company | |
| guid | string | Google News article ID from the RSS item. **Dedup key** together with company_id (D32) |
| url | string | The Google News link from RSS (opens the article via Google) |
| title | string | |
| publisher | string, nullable | From `<source>` in the RSS item |
| published_at | datetime | |
| first_seen_at | datetime | When we first fetched it |
| status | enum: `pending` / `relevant` / `failed` | `pending` = waiting for the LLM; `relevant` = passed, waiting to be moved; `failed` = LLM error, retried |
| sentiment | enum, nullable | Set by the LLM step when relevant (D26); NULL while pending |
| attempts | int | LLM retries (NFR7) |

Constraint: UNIQUE(company_id, url).

**Mention** (the "sentiment table"): one **relevant, classified** article for one company. This is what the dashboard, status, alert and `data/` export read.

| Field | Type | Notes |
|---|---|---|
| id | int | PK |
| company_id | FK → Company | |
| guid | string | Copied from BufferQueue; dedup key together with company_id (D32) |
| url | string | Link to the article (FR4): the **real publisher URL**, decoded at move time; falls back to the Google link if decoding fails (D31) |
| title | string | |
| publisher | string, nullable | e.g. "Reuters" |
| published_at | datetime | Drives the 90-day window and the status |
| first_seen_at | datetime | Copied from BufferQueue |
| sentiment | enum: `positive` / `negative` / `neutral` | FR12 |
| alerted_at | datetime, nullable | FR8: set once the row is included in a digest |

Removed from Mention compared with the earlier draft:
- `relevance`: every row here is relevant.
- `attempts`: moved to BufferQueue.
- `snippet`: Google News RSS has no real snippet (I13).

Relationships: Company 1 → N BufferQueue, Company 1 → N Mention.

Constraints:
- UNIQUE(company_id, guid) on **each** table (D32; replaces the earlier url-based key).
- Backup duplicate check (D33): same company + publisher + title (" - Publisher" suffix stripped) = duplicate, checked in both tables at insert.
- An article is "already stored" if its (company_id, guid) is in BufferQueue **or** Mention. A UNIQUE constraint can't span two tables, so insert-if-absent checks both (D24).

**Queue lifecycle (D21, D22, D24)**

```
Google News search result (≤ ~100 items = 1 chunk)
        │  wait while  count(BufferQueue) + chunk > CAP
        ▼
BufferQueue  status = pending          ← insert chunk in 1 transaction, skip (company,url) already in either table
        │  LLM, per article: relevant? if yes → sentiment (batch)
        ├── irrelevant → DELETE row     (D25)
        └── relevant   → sentiment → status = relevant   (one end-to-end LLM step, D26)
        │  when relevant rows ≥ MOVE_CHUNK
        ▼
Mention                                ← move in 1 transaction: insert into Mention + delete from BufferQueue
```

- **Queue size** (for the CAP check): the count of BufferQueue rows. It's asked from the DB before each chunk. There's no in-memory counter, because the DB always has the true number (Prompt 40).
- **CAP**: the maximum BufferQueue size, tuned to the dev PC's measured LLM speed (Step 3). It must be ≥ the largest chunk (~100). It limits the queue, not the number of mentions (D11).
- **MOVE_CHUNK**: how many relevant rows to collect before moving them to Mention. Size decided later.
- **End of run:** the leftover relevant rows (< MOVE_CHUNK) are moved too, so nothing is stuck before the alert and the `data/` export.
- **DB writes are always in chunks:** a search result per insert, an LLM batch per update, a MOVE_CHUNK per move (I9).

Access patterns (indexes finalized in 1.7):
- BufferQueue: count rows (CAP check); oldest `pending`/`failed` rows (LLM batch); `relevant` rows (move).
- Mention: by company, newest first (dashboard, status); `alerted_at` NULL (daily digest).

**Crash / rerun walkthrough (D16).** Every stage must be safe to run again.

| Crash point | What's already stored | What the rerun does |
|---|---|---|
| Mid-fetch | Some chunks in BufferQueue as `pending` | Refetches. Articles already in BufferQueue or Mention are **skipped, not overwritten**. Only new ones are inserted. |
| Mid-classification | Some rows `relevant`, the rest `pending` | Picks up only `pending`/`failed` rows. Finished rows aren't re-sent to the LLM. |
| Mid-move | Nothing half-done: the move is one transaction (insert + delete together) | Rows are either still in BufferQueue or already in Mention. The next move continues. |
| Before the alert is sent | Mention rows with `alerted_at` NULL | Next run includes them in the digest, so nothing is missed. |
| After sending, before `alerted_at` is set | Digest sent, rows still NULL | Next run sends them again. `alerted_at` is set right after a successful send; we accept a rare duplicate digest over a missed one (at-least-once). |

Two details make this work:
- Every write (chunk insert, batch update, move) is one transaction, so a crash can't leave half-written data.
- "Skip if exists" is essential. An overwrite would reset finished work or clear `alerted_at`.

**Mention status (derived, not stored):** `max(published_at)` over a company's Mention rows, compared with *today*. It isn't stored because "N days ago" would go stale (NFR5). A snapshot is exported to `data/` at the end of each run (FR14, D20).

**Resolved points (Prompt 45)**
- **Deleting irrelevant rows: accepted (D25).** The daily search covers only the past ~24 h, so the same article rarely comes back. Small leftover risk (accepted): window edges are fuzzy by about a day, date windows overlap slightly, and crash reruns can bring an irrelevant article back for one more LLM check. We still measure the irrelevant rate per section in Step 2 (for the README and precision).
- **Sentiment runs in the same LLM step (D26):** each article is handled end to end. Ask "is it about the company?" If not → delete, and skip the sentiment question. If yes → ask sentiment → it moves to Mention (in chunks). Mention only ever holds finished rows.

**Not entities:**
- Alert: covered by `Mention.alerted_at`.
- Article (shared across companies): not needed. An article about two companies becomes one row per company (D17).
- Run log: optional.

#### 1.4 API Design ✅

Only the dashboard calls the API. Fetching, classifying and alerting run as scripts (the daily job), not as endpoints. All endpoints are read-only.

**GET /api/companies** (FR1, FR5 / G2)
- Purpose: the overview. Every company with its status.
- Request: none.
- Response: `{ asOf, windowStart, companies: [{ id, name, hint, status: "mentioned" | "no_coverage", lastMentionAt | null, daysAgo | null }] }`
- Only `relevant` mentions inside the 90-day window count. `daysAgo` is computed when the request arrives, so it's never stale (NFR5).
- Errors: 500 if storage can't be read.

**GET /api/companies/:id/mentions** (FR2–FR4 / G1)
- Purpose: when a company is clicked, show all its mentions from the last 90 days with their sentiment, sorted by date.
- Response: `{ company: { id, name }, mentions: [{ title, url, publisher, publishedAt, sentiment, snippet }] }`, newest first, relevant only.
- Errors: 404 for an unknown company id; 500 if storage can't be read.

**Not included:** write endpoints (no company CRUD, no auth), a "run the job now" endpoint, an alerts endpoint, filters/search/pagination, per-company sentiment counts on the list (all OPTIONAL / OUT OF SCOPE FOR MVP).

#### 1.5 High-Level Architecture ✅

```
        ourcrowd_companies.txt  (the 258 companies, sorted into 12 sections)
                    │
                    ▼
 ┌──────────────────────────────┐        ┌───────────────────┐
 │ 1. DATA COLLECTION           │ ◄────► │ Google News RSS   │
 │    one company at a time,    │        │ (1 req / 3–5 s)   │
 │    section queries, 90 days  │        └───────────────────┘
 └──────────────┬───────────────┘
                │  each search result = 1 chunk
                │  (waits while queue + chunk > CAP)
                ▼
 ┌──────────────────────────────┐
 │ 2. BUFFER QUEUE  (DB table)  │
 │    articles waiting: pending │
 └──────────────┬───────────────┘
                │  batches
                ▼
 ┌──────────────────────────────┐        ┌───────────────────┐
 │ 3. CLASSIFICATION            │ ◄────► │ Ollama            │
 │    relevant? → no: delete    │        │ (AI on your PC)   │
 │    sentiment                 │        └───────────────────┘
 └──────────────┬───────────────┘
                │  relevant rows, moved in chunks
                ▼
 ┌──────────────────────────────┐        ┌───────────────────┐
 │ 4. MENTION TABLE  (DB)       │ ─────► │ data/ folder      │
 │    final relevant mentions   │        │ (end of run)      │
 └──────────────┬───────────────┘        └───────────────────┘
                │  reads
                ▼
 ┌──────────────────────────────┐
 │ 5. API SERVER                │
 │    our 2 endpoints           │
 └──────────────┬───────────────┘
                │
                ▼
 ┌──────────────────────────────┐
 │ 6. DASHBOARD  (browser)      │
 │    all companies + status    │
 │    click → its mentions      │
 └──────────────────────────────┘

 ⏰ DAILY JOB: node-cron starts it once a day. Our own loop runs
    steps 1 → 4 (DC holds when the queue is full, the LLM drains it),
    then sends ONE alert listing the new mentions, then writes data/.
```

How to read it:
- The diagram shows the whole flow, from collection to the dashboard. Boxes map to project steps: 1 → Step 2, 3 → Step 3, 2 + 4 → Step 4 (storage), 5–6 → Step 5, ⏰ → Step 6.
- The daily job is **not a separate stage**. It re-runs steps 1 → 4 each day, then sends the digest and writes `data/`.
- The **BufferQueue** separates the fast collector from the slow LLM. It lives in the DB, not in RAM, so memory stays low and a crash loses nothing (D21, D24). Queue details are in 1.3, "Queue lifecycle".

| Component | What it does | Requirement |
|---|---|---|
| Seed loader | Reads the seed file and creates or updates Company rows (id, name, hint, query_param) | FR9 |
| Collector | One company at a time: runs its section queries on Google News RSS (paced, adaptive date windows). Inserts each search result into BufferQueue as one chunk, waiting while it doesn't fit under CAP. Skips articles already stored | FR10, FR13, D16, D21–D23 |
| BufferQueue (DB table) | Holds articles waiting for the LLM; its row count is the queue size | D21, D24 |
| Classifier | Takes `pending`/`failed` rows in batches and asks Ollama about relevance (irrelevant → delete) and sentiment. Moves relevant rows to Mention in chunks | FR11, FR12, D9 |
| Orchestrator loop | Our own small loop: runs the collector and the classifier, holds the collector while the queue is full, shows progress (stage, %, current company, companies left, LLM rate) | D22, I10 |
| node-cron | Starts the job once a day | FR6 |
| Alerter | Collects Mention rows with `alerted_at` NULL into one digest, sends it, then sets `alerted_at` | FR7, FR8 |
| Exporter | At the end of the run, writes the mentions and a per-company status snapshot to `data/` | FR14, D20 |
| API server | Serves the two endpoints and the dashboard page; reads Mention and Company only | FR1–FR5, D19 |
| Dashboard page | List of companies with status; click a company to see its mentions, newest first | G1, G2 |

Key properties:
- The job and the API are **separate processes** that share the DB. The dashboard never waits on Google News or Ollama (NFR4).
- The collector and the LLM run at different speeds, and the DB queue with its CAP keeps them balanced without filling memory (I7, I8).
- All DB writes are chunked: one search result, one LLM batch, or one move at a time (I9).
- Each stage only picks up unfinished work, so the same command does the first 90-day backfill and every daily run, and it resumes after a crash (NFR3, D16).

Not added, because no requirement needs them: message queues, caches, a search engine, RAG/embeddings, microservices, containers.

Still open for this step or the deep dives:
- `query_param`: how it's built for ambiguous names → **Deep dive DD1** (user's design)
- ~~News source(s) and the ~100-results limit~~ → decided: Google News RSS + adaptive date windows (D23, I12)
- Alert channel (must be visible and documented, $0) → to decide
- ~~Scheduler~~ → decided: node-cron starts the job; our own loop orchestrates (D22)
- Frontend tech (plain HTML/JS vs a framework) → to decide

#### Deep dive DD1: query_param for ambiguous names 🔄
Process (Prompt 27): the user first shares all their deep-dive ideas as input. They are recorded below as-is, and the review starts only after the user finishes.

**User inputs (recorded as-is, not yet reviewed):**

*Data collection (DC) flow* (Prompt 28)
1. Problem: some company names don't return relevant results.
   - 1.1 Fix: sort the companies into **12 sections**. Each section has its own query or queries.
   - The 12 sections (Prompt 47, D28): High-Tech (Information Technology) · Health (Healthcare & Biotechnology) · Sports, Fitness & Entertainment · Financials (Banking & Insurance) · Consumer Staples (Essential Goods) · Consumer Discretionary (Luxury & Leisure) · Industrials (Manufacturing & Logistics) · Communication Services · Energy · Utilities · Materials · Real Estate.
   - Assigning companies to sections and writing each section's query is **part of the DC job** (Prompt 48). Deferred to Step 2.
2. Source: **Google News**.
3. Loop over the companies and fetch mostly **relevant** data.
4. Note (Prompt 29): we aren't worried about the high news volume from big companies, so **no cap** is needed (matches D11).
5. (Prompt 32 → 33) `data/` is written **at the end of the classification process**, not during collection, so it holds classified results (see D20).

*Classification: model research* (Prompt 30)
1. Look for current models, including any newly released ones.
2. Look for existing benchmarks on similar use cases.
3. Benchmarks must run on **live data, not mock data**.
4. Benchmarks must fit the data source we chose (Google News: titles and short snippets).
- Goal: real research on which model to use, and why.
- Fallback: if there's no similar use case or clear winner, **we test models ourselves on real data**.

*Throughput problem + buffer stream system* (Prompt 34)
- Problem: the stages run at very different speeds.
  - DC: Google News returns results fast (user's figure: ~1,000 results/s), over a long run.
  - Classification: even a well-optimized model, in parallel, handles ~3–4 articles/s, because each article needs (1) a relevance check, then (2) sentiment if relevant.
  - DB: writing too many rows at once, or writing each result the moment the LLM finishes one article, is unacceptable.
  - Result: a **memory issue**. Articles arrive faster than the LLM can process them.
- Proposed solution: a **buffer stream system**.
  1. Tell DC to **stop when the buffer reaches its limit**.
  2. Let the LLM **catch up**.
  3. Write to the DB **in chunks**.
  4. An **orchestrator** manages both processes (DC, classification): **node-cron**.
  5. QOL: a **visible progress bar in %**, as clear as possible since it runs for hours. Shows the current stage (e.g. waiting on the LLM), which company is being fetched, how many companies are left, the LLM ratio, etc.
  6. DC fetches **one company at a time** (no parallel fetching) to avoid running out of memory (OOM).
- Clarified (Prompt 35): the orchestrator (node-cron) manages the process. It tells DC to **hold** when the buffer is full and lets it continue once the LLM has cleared some of it. Writes into the buffer must be managed.
- Research launched (Prompt 35): Google News limits (requests per second, results per search). Findings are below and in the Issues log.
- Decided (Prompt 36): **the DB is the buffer/queue** (option B, D21). Articles are saved as `pending` rows. DC holds while the count of `pending` rows ≥ **CAP**. CAP is tuned to the dev PC's measured speed later (Step 3). This CAP limits the *queue size*, not the number of mentions (D11 still holds).
- Question (Prompt 36): is there an orchestrator library? → Decided (Prompt 37): **our own small loop** + node-cron to start it daily (D22). BullMQ etc. were rejected because they need Redis/Postgres/Mongo servers.
- Chunk rule (Prompt 37): each search result (up to ~100 items) is **one chunk**, inserted in one write. Before inserting, wait until the whole chunk fits: `pending + chunk ≤ CAP`. Example: CAP 10,000, pending 9,999, chunk 100 → wait until pending ≤ 9,900, then insert. Implication: CAP must be ≥ the largest chunk (~100), or the loop waits forever.
- Queue mechanics (Prompt 40): there is **no in-memory queue object**; the DB holds it. **Superseded in part by Prompt 42:** the queue is now its own table, **BufferQueue** (D24), not Mention rows. The size is the count of BufferQueue rows. Full lifecycle in 1.3, "Queue lifecycle".
  - Size: count of BufferQueue rows, checked once before each chunk (every ~3–5 s).
  - Add: insert the chunk in one transaction (insert-if-absent).
  - Take: the classifier reads `pending` rows in batches (oldest first) and writes results back in one transaction per batch.
  - Why not an in-memory counter: it can drift (duplicates skipped by UNIQUE, crashes) and the DB already knows the true number. A counter is an optional optimization only if COUNT proves slow.

*Research findings: Google News limits (agent, 2026-09-25)*

Labels: [OFFICIAL] = documented by Google or the vendor · [COMMUNITY] = third-party or anecdotal reports · [TESTED] = observed by us in 5 well-spaced requests.

- **No official Google News API.** It was deprecated in 2011 and shut down in 2016. [OFFICIAL]
- **Custom Search JSON API** is closed to new customers and ends 2027-01-01. It was never a News-tab API anyway. [OFFICIAL]
- **Paid wrappers** (SerpApi, SearchApi) are free only for about 100–250 searches, far below our ~7.7k queries/month. They break D12 ($0).
- **The only $0 option is the Google News RSS search feed:** `news.google.com/rss/search?q=...&hl=en-US&gl=US&ceid=US:en`. It needs no key. [TESTED]
- **Rate limit:** undocumented.
  - Heavy use leads to HTTP 429, CAPTCHA pages or temporary IP blocks. [COMMUNITY]
  - Safe pacing: 1 request at a time, about 3–5 s apart plus random jitter, with exponential backoff on 429 or a CAPTCHA page.
  - At that pace the daily run takes about 15–20 min; the backfill takes a few hours.
- **Results per search:** about 100 items maximum, with no pagination.
  - "Anthropic" with no date filter returned 97 items, almost all from the last 3 days. [TESTED]
- **Date operators work:** `after:YYYY-MM-DD before:YYYY-MM-DD` and `when:7d`. [TESTED]
  - This gets around the cap: split the 90 days into smaller windows (adaptive: if a window returns ≥95 items, split it in half).
  - Window edges are fuzzy by about a day, so overlap the windows and dedupe.
  - Very big names can hit 100 items per day. That is an accepted ceiling.
- **Full 90 days is reachable.** A window 90 days back, and even one a year back, returned items. [TESTED]
- **Fields per item:**
  - `title`, formatted as "Headline - Publisher"
  - `link`
  - `guid`
  - `pubDate`
  - `<source url>` (the publisher)
  - `description` (**not a real snippet**, only title + publisher HTML)
- **Links are encoded Google redirect URLs** (`news.google.com/rss/articles/CBMi...`), not the publisher URL.
  - Decoding needs undocumented network calls that have broken before and are the most likely to trigger 429s.
  - Suggestion: don't bulk-decode. Use `guid` or the Google link for dedup, and `<source url>` for the publisher.
- **ToS:**
  - The feed says it is "solely for ... personal feed reader for personal, non-commercial use".
  - `robots.txt` disallows `/rss/`.
  - Google's ToS forbids automated access that violates robots.txt.
  - So automated use works technically but is outside the stated terms. It must be a knowing decision and documented in the README.
- **User requirement (Prompt 38):** the data must be Google's **News** results. This is crucial. Note: the RSS feed comes from **Google News (news.google.com)**, which draws on the same news index as the **News tab** in Google Search (`google.com/search?tbm=nws`), but they are separate products, so results and order may differ. The News tab itself has no feed or API: only HTML scraping (CAPTCHA, stricter ToS) or paid wrappers (break D12). **Confirmed (Prompt 39):** Google News RSS is acceptable (D23).
- **Correction to Prompt 34's figure:** it's not "1,000 results per second". It's ~100 items per request at ~1 request every 3–5 s, so roughly 20–30 items/s at most. That's still faster than the LLM (~3–4/s), so the buffer is still needed.

### 2. Data collection ⏳
Fetch recent news per company (Node.js). Details come from 1.8.
- Check the real data for same-article / different-URL duplicates; add the D18 backup rule only if they appear.
- Measure the irrelevant rate per section (I14 / open question on deleting irrelevant rows).

### 3. Classification ⏳
Ollama relevance + sentiment. Includes a validation spot-check set for the README.

### 4. Storage layer ⏳
Files or lightweight DB. Must produce the `data/` folder deliverable.

### 5. Dashboard / UI layer ⏳
Quarterly mentions + current status for every company, including companies with no coverage.

### 6. Daily job ⏳
Scheduled check → daily digest alert.
- High-level flow (Prompt 46, user; details discussed later): daily job → check for duplicates → remove/add in the DB → send the message (mail, webhook, etc.).
- To reconcile later: duplicates are already skipped at insert (D16), and old data is filtered, not deleted (D13). Clarify what "remove" means here.

### 7. Deliver ⏳
README, `data/` output from a real run, prompts file finalized, push to GitHub.
- README started early (Prompt 58): what it does, flow diagram, tech stack, **16 system challenges → solution → trade-off**, and the LLM research section (to fill in Step 3). Keep it in sync with the Issues log and Decisions log as things change.

---

## Engineering Standards (Prompt 57, applies to Steps 2–7)

1. **Test during development.** Each module gets tests as it's built, not at the end. Pure logic (dedup checks, title cleaning, date windows, queue CAP math, LLM JSON validation) gets unit tests. DB steps (chunk insert, move BufferQueue → Mention) get tests on a temporary SQLite file. Google News and Ollama are replaced with fakes in tests, so tests run offline and fast. Runner: `node:test` (built into Node).
2. **Code anyone can pick up, even a non-programmer.** Every file starts with a plain-language header: what it does, where it sits in the flow, what it reads and writes. Every function gets a short comment on *what* and *why*. Names are clear, with no clever tricks. Config values (CAP, MOVE_CHUNK, pacing, retries) live in one config file, with a comment on what each one controls.
3. **Error and crash handling everywhere (D37).** Expect things to fail. Nothing crashes the whole system unhandled.

| Failure | Behaviour |
|---|---|
| **DC: internet down / Google 429 / CAPTCHA page** | The collector retries with exponential backoff (pausing and retrying). **Meanwhile the classifier keeps draining the queue.** The two loops are independent, so one failing doesn't stop the other. After max retries the company is logged as "skipped this run" and the loop moves on; the next run picks it up |
| DC: one company's query fails / bad RSS | Log it, skip that company, continue with the rest |
| Ollama down or slow | The classifier waits and retries with backoff. The collector keeps filling until the CAP, then holds. Nothing is lost: rows stay `pending` |
| LLM returns invalid JSON | Retry up to N, then status `failed` (`attempts` counted), retried on the next run (D27) |
| URL decoding fails | Keep the Google link (D31) |
| DB write fails | Each chunk/batch/move is one transaction, so it rolls back fully. Log it and retry |
| Process killed / PC off | Rerun resumes from the DB (D16): pending rows are still there, duplicates are skipped |
| Alert send fails | `alerted_at` stays NULL, so it is sent on the next run (at-least-once) |
| API: DB unreadable / unknown id | 500 / 404 with a clear message; the dashboard shows an error state instead of a blank page |
| Unexpected error anywhere | A top-level handler logs it clearly and exits with a message, never silently |

- The progress display (I10) shows these states too, e.g. "Google unreachable, retrying in 60 s · LLM still working: 1,240 in queue".
- This section is 1.10 (Failure scenarios) of the design.

## Tech Stack (Prompt 47)

Every choice lists why we use it for THIS task and the alternative we didn't pick. TBD rows are still open.

| Layer | Choice | Why | Alternative not chosen |
|---|---|---|---|
| Runtime | **Node.js 24** (dev machine: v24.15.0) | Required by the brief (backend + data collection in Node) | — |
| Database | **SQLite via `node:sqlite`** (built into Node, SQLite 3.51) | We need **relations between tables**: Company → BufferQueue / Mention (foreign keys). We also need **UNIQUE constraints** to stop duplicates (D18), **transactions** so chunk inserts and BufferQueue→Mention moves are all-or-nothing (crash safety, D16/D24), and **indexes** for the queue count and dashboard queries. It's a single file with no server ("lightweight DB" per the brief), built into Node so there's no install or native build | **JSON files**: no relations, uniqueness or transactions; we'd hand-code all of it. **better-sqlite3**: same SQLite, but a native addon that must compile on install. **Postgres/Mongo**: a server to install; overkill for one local user |
| News source | **Google News RSS search feed** (D23) | The only free, structured access to Google's news results; no key | Paid wrappers (SerpApi etc.) break $0 (D12); scraping the News tab (CAPTCHAs, stricter ToS) |
| RSS/XML parsing | TBD (a small XML parser) | Turns the RSS feed into items (title, link, guid, pubDate, source) | — |
| LLM | **Ollama** (local), model **TBD by research** (Prompt 30) | Required by the brief: local model for relevance + sentiment | Cloud LLMs are not allowed |
| LLM output | **Strict JSON** via Ollama structured output (`format` = JSON schema) (D27) | The model must answer in a fixed shape we can check, e.g. `{"relevant": true, "sentiment": "positive"}`. Anything else is treated as a failure, not guessed at | Free-text answers parsed with regex: fragile |
| Orchestration | **Our own small loop** (D22) | The DB is already the queue (D21/D24); the loop just holds the collector while the queue is full | BullMQ / pg-boss / Agenda: need Redis/Postgres/Mongo servers |
| Scheduler | **node-cron** (D22) | Starts the daily job from Node, and it's documented in the README | OS schedulers (Task Scheduler / cron): outside the codebase and differ per OS |
| Progress display | TBD (e.g. a terminal progress-bar library) | Multi-hour runs must show stage, %, current company, companies left, LLM rate (I10) | — |
| API server | **Express** (D34) | Serves the 2 read-only endpoints (D19) and the built React app (`express.static`). The most familiar option and the fastest to build under the take-home time limit | **Fastify**: built-in validation + logging; the better choice for a production API (noted for README / 1.13). **Plain `node:http`**: hand-written routing, parsing and errors |
| Frontend | **React + Vite** (D29) | A component-based UI for a list → click → detail view; Vite gives a fast dev server and a simple build. Widely known, so easy to review | Plain HTML/JS: no build step, but harder to keep tidy as the UI grows |
| Alert channel | TBD, in Step 6 (mail / webhook / …) | G3: the daily job must send an alert; channel is our choice but must be visible and documented, $0 | — |
| Data for reviewers | `data/*.json` exports + auto-import into SQLite on API start when the DB is empty (D35) | The reviewer can open the dashboard on the committed real-run data without running Google News or Ollama; JSON is readable on GitHub | Committing only the `.sqlite` file: works, but isn't readable on GitHub. Only JSON with no import: the dashboard would need a second code path |
| Packaging | npm scripts on plain Node (required). **Docker image for API + dashboard** that serves the committed `data/`: OPTIONAL / OUT OF SCOPE FOR MVP, a stretch goal (D36). Kubernetes: out of scope | The brief asks for local run commands. A Docker image lets a reviewer see the dashboard with one command. The pipeline (Google News + Ollama on GPU) stays local | Putting Ollama in Docker needs GPU passthrough: too heavy for a reviewer. Kubernetes needs a cluster |
| Testing | `node:test` (built into Node), with fakes for Google News and Ollama | Tests run offline and fast; no extra test framework (Prompt 57) | Jest/Vitest: extra dependency for the backend |
| Secrets | `.env` file (not committed) | Mail password or webhook URL must never be in the public repo (NFR10) | — |

---

## Decisions Log

| # | Decision | Choice | Reason |
|---|---|---|---|
| D1 | "Last quarter" | Rolling 90 days | Matches the "N days ago" status example |
| D2 | "No coverage found" | No relevant mention in the last 90 days | We only search that window |
| D3 | Relevance filtering | Required (Ollama) | Ambiguous names (Harvey, Island, Silo, Bites, Groq/Grok…); a reliable dashboard requires it |
| D4 | Precision vs recall | Favor precision | A wrong article on the dashboard hurts trust more than a missed one |
| D5 | Mention identity | (company, cleaned URL) pair (see D14). **Superseded by D32: (company, guid)** | Dedups reruns and URL variants; one article can mention several companies |
| D6 | Syndicated copies | Counted as separate mentions | Each is a real press appearance; grouping is optional / out of scope |
| D7 | "New" for the alert | Not previously stored + not yet alerted | Idempotent; a crash doesn't cause missed or double alerts |
| D8 | Alert format | One daily digest | No real-time requirement; avoids alert floods |
| D9 | Classify once | Never re-classify a stored mention | Local LLM is slow; makes reruns cheap |
| D10 | Aliases ("formerly X") | Search the current name only | Old names add noise; document as a limitation |
| D12 | Cost | No paid services or keys required | Confirmed by user; the reviewer must be able to run it |
| D13 | Old data (>90 days) | Filter by `published_at` in queries; never delete | No requirement to delete; size is tiny; deleting destroys data and adds a failure point. Keeps the door open for longer ranges (e.g. yearly) later |
| D14 | URL columns | **Superseded by D31/D32** (Google links; guid is the key). Was: one `url` column, stored cleaned (strip `utm_*`/`fbclid`, `#fragment`, lowercase host, trailing `/`) | A second normalized column was redundant. Only known tracking params are stripped, so the link keeps working |
| D15 | Date field | `published_at` = the article's publication date (not the fetch date) | Drives the 90-day window and "last mentioned" |
| D16 | Crash + refetch duplicates | Insert-if-absent across BufferQueue and Mention (never overwrite existing rows); every write is one transaction; each stage picks up only unfinished work; mark `alerted_at` only after a successful send | Any stage can be re-run safely after a crash. Details in 1.3 "Crash / rerun walkthrough" |
| D17 | Article in 2+ companies | One Mention row per company, with the article fields copied (option A) | Relevance and sentiment are per company anyway; one table, no joins, one-step idempotent insert |
| D18 | Dedup key | **Superseded by D32 (guid).** Backup rule still applies if needed. Was: UNIQUE(company_id, cleaned url). A backup rule (company_id, publisher, title, published date) is added **only if** real data in Step 2 shows same-article/different-URL duplicates | The URL is stable across refetches; adding title or date to the same key would let edited headlines through as duplicates |
| D19 | API surface | Two read-only endpoints: `GET /api/companies` (list + status) and `GET /api/companies/:id/mentions` (on click, newest first) | Matches the dashboard: list, then drill down. The first load stays small, and `daysAgo` is computed per request. Alternatives were one big endpoint or a static page over `data/` |
| D21 | Buffer between DC and LLM | The queue lives in the DB (not RAM): articles are saved as `pending` in chunks; DC holds while queue + chunk > CAP; the LLM takes pending rows and writes results back in chunks. The table is BufferQueue (D24). CAP is tuned to the dev PC's measured speed | User decision (Prompt 36). Crash-safe (nothing lost in RAM), low memory, same rows as D16 |
| D22 | Orchestrator | Our own small loop (hold while `count(BufferQueue) + chunk > CAP`, insert each search result as one chunk) + node-cron to start the job daily | User decision (Prompt 37). No extra servers (Redis etc.); the DB is already the queue (D21) |
| D23 | News source | Google News RSS search feed (no key), paced ~1 req / 3–5 s with backoff, adaptive date windows | User confirmed (Prompt 39). Only free, structured access to Google's news results. ToS caveat (personal, non-commercial; robots.txt) accepted and documented in the README (I11) |
| D24 | Queue table | Separate **BufferQueue** table for waiting articles; irrelevant → delete; relevant rows move to Mention in chunks (MOVE_CHUNK, size TBD). Mention holds only relevant, classified mentions | User decision (Prompt 42): the sentiment table must not double as the queue. Cleaner final table. Costs: dedup checks two tables; deleted irrelevant rows may be re-fetched and re-classified (open, verify in Step 2) |
| D25 | Irrelevant articles | Delete from BufferQueue; keep no record | User decision (Prompt 45): the daily search covers only the past ~24 h, so re-fetches are rare; don't keep data we don't need. Accepted cost: an occasional re-check at window edges or after a crash |
| D26 | LLM flow per article | One end-to-end step: relevance → (if relevant) sentiment; irrelevant skips the sentiment question and is deleted; relevant goes to Mention (in chunks) | User decision (Prompt 45). Mention never holds half-classified rows; no separate sentiment pass |
| D27 | LLM answer format | Strict JSON via Ollama structured output (JSON schema), e.g. `{"relevant": true, "sentiment": "positive"}`. Invalid answer → retry (up to N, TBD) → status `failed`, counted in `attempts`, retried on the next run | User accepted (Prompt 47). Checkable output; never guess from garbage |
| D28 | Company sections | 12 sections (list in DD1); each section has its own query/queries | User design (Prompts 28, 47). Assignment + query shape are part of the DC job, deferred to Step 2 (Prompt 48) |
| D29 | Frontend | React + Vite | User decision (Prompt 47) |
| D30 | Storage engine | SQLite via built-in `node:sqlite` | User decision (Prompt 47). Relations (FKs), UNIQUE, transactions, indexes; no server, no install. See Tech Stack |
| D31 | Real article URL | Decode the Google link to the real publisher URL **only for relevant articles**, when they move to Mention; if decoding fails keep the Google link | User agreed (Prompt 50). User verified both the Google link and the decoded URL open the same article (Prompt 51). Far fewer requests than decoding everything; every mention always has a working link (FR4) |
| D32 | Dedup key (replaces D5/D14/D18 url key) | Store the RSS `guid` in both tables; UNIQUE(company_id, guid) | Prompt 50. The Google link is known at fetch time but the real URL is only known after decoding, so the real URL can't be the dedup key without decoding every article. Verify in Step 2 that the same article keeps the same guid across fetches; D18's backup rule (publisher + title + date) applies only if it doesn't |
| D33 | Backup duplicate check (accepted, Prompt 53) | Keep guid as the main key (D32). Add a second check at insert: same company + same publisher + same title (" - Publisher" suffix stripped) = duplicate. **Not** publisher + published date alone | Tested on real feeds (Prompt 52): the same query fetched twice gave 100/100 identical guids; a different query for the same articles gave 16/17 identical, and the 1 mismatch was a same-titled Anthropic page with a different date (likely a second page). **Publisher + pubDate alone is unsafe:** 22 collisions between *different* articles in our sample, because many pubDates are rounded (e.g. `07:00:00 GMT`), so real articles would be dropped |
| D34 | API server library | **Express** (revised in Prompt 55; was Fastify) | Speed isn't a concern for 2 endpoints, and Express is the fastest to build in a time-limited task. **README note:** Fastify would be the better production choice (built-in schema validation + logging) |
| D35 | `data/` format | JSON files (e.g. `companies.json` with status, `mentions.json`) written at the end of the run (D20). On start, the API imports them into SQLite if the DB is empty, so the dashboard works right away from the committed data | User goal (Prompt 54): the reviewer sees results without re-running. Readable on GitHub and loadable by the app. Exact file names/fields decided in Step 4 |
| D36 | Packaging | npm scripts (required). Optional stretch: a Docker image for API + dashboard serving the committed `data/`. Kubernetes out of scope | User meant Docker (Prompt 55). The pipeline stays local because Ollama needs the GPU |
| D37 | Failure handling | Collector and classifier are independent loops; any failure in one (e.g. internet down) is retried with backoff while the other keeps working; every write is a transaction; nothing crashes unhandled. Full table in Engineering Standards | User requirement (Prompt 57) |
| D20 | When `data/` is written | At the end of the classification process: classified mentions (sentiment, links) + per-company status snapshot | User decision (Prompts 32–33). Sentiment labels only exist after classification, and the brief asks for them in `data/` |
| D11 | How many mentions | All relevant mentions in 90 days that our sources return; no intentional cap | G1 says "its press appearances over the last quarter". Completeness is limited only by what the sources return, and that is documented. |

## Issues & Trade-offs Log (feeds the README)

Rule (Prompt 31): whenever an issue or difficulty comes up (throughput, latency, scale, quality, source limits…), record it here right away, even before it's solved. The README's "assumptions, trade-offs, known limitations" section is built from this list.

| # | Issue / difficulty | Where it hurts | Current handling / status | Raised in |
|---|---|---|---|---|
| I1 | Ambiguous company names (Harvey, Island, Silo, Bites, Rewire, Glean, Groq vs Grok) return unrelated articles | Precision (D4), wasted LLM time | Per-group queries (DD1: 12 sections) + Ollama relevance check (D3) | 1.1, Prompt 28 |
| I2 | Volume skew: big companies (SpaceX, Anthropic, Stripe…) get thousands of articles; small ones get ~0 | Backfill time, dashboard list size | Accepted: no cap (D11, Prompt 29). Backfill is resumable (NFR3) | 1.2, Prompt 29 |
| I3 | Local LLM throughput: ~2 calls per article at ~0.5–1 s each means ~5–11 h worst-case backfill | Backfill time (NFR3) | Resumable stages, classify once (D9, D16). Measure the real speed in Step 3 | 1.2 |
| I4 | Free news sources cap results (~100 per query), which can cut off "all mentions" for big companies | Completeness (FR2) | Open: settle in 1.8 (e.g. split 90 days into smaller date windows) | 1.2 |
| I5 | Only current company names are searched ("formerly X" is not) | Recall | Accepted limitation (D10) | 1.1 |
| I6 | Google News gives titles and short snippets, not full text | Classification accuracy | Benchmarks and model choice must fit this input (Prompt 30) | Prompt 30 |
| I7 | Speed mismatch: DC produces articles faster than the LLM classifies them (DC ~20–30 items/s at most with safe pacing vs LLM ~3–4/s, 2 steps each) | Throughput, backfill time | DB queue table BufferQueue: DC holds while queue + chunk > CAP, LLM catches up (D21, D24) | Prompt 34, 36 |
| I8 | Memory: unclassified articles pile up in memory | Stability (OOM) | The queue lives in the DB, not RAM (D21), plus one company at a time | Prompt 34, 36 |
| I9 | DB write pattern: too many rows at once, or one write per LLM result | DB load, run time | Chunked writes: one search result per insert, one LLM batch per update, one MOVE_CHUNK per move (D24) | Prompt 34 |
| I11 | Google News has no official API. The RSS feed has undocumented rate limits (429 / CAPTCHA / IP block) and its ToS/robots.txt disallow automated use | Reliability, legitimacy | Pace 1 request per 3–5 s + jitter, backoff on 429. Document the ToS caveat in the README. Decision needed | Research (Prompt 35) |
| I12 | ~100 results per query, no pagination | Completeness (FR2) | Adaptive date windows (`after:`/`before:`), split when ≥95 items. Very big names can hit 100/day: accepted ceiling | Research (Prompt 35); resolves I4 |
| I13 | RSS links are encoded Google redirects, not publisher URLs; there's no real snippet (title + publisher only) | Dedup key (D14/D18), link quality (FR4), LLM input (I6) | Open: dedup on `guid`/Google link; decode lazily or not at all. The LLM sees the title only | Research (Prompt 35) |
| I15 | Real article URLs need 2 extra undocumented Google requests per article | Link quality (FR4), rate limits | Decode relevant articles only, paced; fall back to the Google link if decoding fails (D31) | Prompt 48 |
| I16 | guid stability isn't documented by Google | Duplicates on the dashboard | Tested: stable for the same query (100/100) and mostly across queries (16/17). Backup check on company + publisher + title (D33) | Prompt 52 |
| I14 | Irrelevant rows are deleted, so the same irrelevant article can be re-fetched and re-classified on later runs | LLM time, D9, precision measurement (NFR6) | Accepted (D25): the daily search covers ~24 h, so re-fetches are rare (window-edge overlap, crash reruns). Measure the irrelevant rate in Step 2 | Prompts 42–45 |
| I10 | Multi-hour runs are opaque | Operability, reviewer experience | Progress bar with %, current company, companies left, LLM rate (user input, to review) | Prompt 34 |

## Remaining to Discuss (gap check, Prompt 46)

Must settle before building:
1. ~~What the 12 sections are~~ (done, D28). Still open: how each company gets assigned (by hand, or by Ollama, since any text-understanding must use the local model), and what the queries look like.
2. ~~Article link + dedup key~~ → decided: decode relevant only (D31), dedup on guid (D32).
3. **Model research + validation (Prompt 30):** run the research. Define how we validate quality for the README (e.g. a hand-labeled sample of real articles, with the accuracy reported).
4. ~~LLM output format~~ → strict JSON, retry → `failed` (D27).
5. ~~Storage choice~~ → `node:sqlite` (D30).
6. **Alert channel:** part of the daily job (mail / webhook / …). Must be visible, documented, and $0.
7. ~~Frontend tech~~ → React + Vite (D29). ~~API server library~~ → Express (D34; Fastify noted as the production choice).

Smaller, can come later:
- ~~The `data/` folder format~~ → JSON + auto-import (D35); exact file names in Step 4.
- Failure handling: Ollama down, Google 429/CAPTCHA, the job running while the PC is off (node-cron only fires if the process is running).
- Security: escape article titles in the UI (XSS); secrets like SMTP credentials or a webhook URL go in `.env`, never in the repo.
- Design-process sections not written up yet: 1.6 data flow, 1.12 trade-offs summary, 1.13 MVP vs production, 1.14 implementation plan. Most of the content already exists in this file.
- Company list mismatch (the brief says "name + domain/sector"; the file has names only): consider asking OurCrowd.

## Open Questions
- ❓ **Daily job details (Prompt 46):** flow is duplicates check → remove/add → send message (mail/webhook/etc.). Channel, what gets removed, and the search window are open; to discuss in Step 6.
- ❓ **Sourcing:** same providers for all companies plus per-company query overrides (recommended), or different sources per company? → to settle in 1.8.
- ❓ **Company list:** the brief promises "name + domain/sector", but the file has names only and doesn't mark portfolio vs fund. Consider asking OurCrowd.
- ❓ **Volume skew:** SpaceX/Anthropic/Stripe get thousands of articles; seed startups get ~0. We aren't capping (D11), so how do we keep the local-LLM processing time reasonable? → 1.2 / 1.9.
- ✅ ~~**Source result limits**~~: confirmed ~100 per query; handled by adaptive date windows (I12).
