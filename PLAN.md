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

**Company**: one row per portfolio company, **written by the seed loader at start-up (D46)**. Built from `filtered_ourcrowd_companies.txt` (the 258 companies, same as `ourcrowd_companies.txt`, sorted into sections: FR9), `company_hints.json` and `section_keywords.json`. Updated on every start-up, never wiped.

| Field | Type | Notes |
|---|---|---|
| id | string (slug) | PK, e.g. `lambda` |
| name | string | Display/search name with the annotation removed, e.g. `Lambda`. Unique. |
| section | int (1–13) | From `filtered_ourcrowd_companies.txt` (D43), e.g. `1` = High-Tech. Picks the section words |
| hint | string, nullable | The search hint from `company_hints.json`, e.g. `"Harvey AI"`, `Lambda "GPU"`. Null for the ~150 unique names, which are searched by plain name (D44) |
| query_param | string | The search query used for this company, needed because many names are ambiguous. Built once by the seed loader (D46): **the company's hint** from `company_hints.json` (or its plain name in quotes) + **its section's words** from `section_keywords.json`. It holds **no date part**: the collector puts the date window at the front of each search. |

Not added: portfolio vs fund type (not in the list). A separate former_name field was dropped: "(formerly X)" names are handled inside the hint, e.g. `(Lifeward OR ReWalk)`. Status notes such as acquired or renamed stay in `company_hints.json` and aren't stored (not needed by the MVP). Updated in Prompt 114: `section` added and `hint` re-sourced, after D43, D44 and D46.

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
| claimed_at | datetime, nullable | Set when a classifier worker takes the row (D45, parallel LLM), so two workers never process the same article. A claim older than a timeout is released (the worker probably died) |

Constraint: UNIQUE(company_id, guid) (D32).

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
BufferQueue  status = pending          ← insert chunk in 1 transaction, skip (company, guid) already in either table
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

**JobRun** (added in Prompts 64–67, D39): one row per run of the job. It's the lock and the "where did we stop" record.

| Field | Type | Notes |
|---|---|---|
| id | int | PK |
| started_at | datetime | |
| finished_at | datetime, nullable | |
| status | enum: `running` / `collected` / `done` / `failed` | `collected` = the collector finished every company; `done` = the queue is drained, `data/` is written and the alert is sent |
| last_heartbeat | datetime | Updated **every 5 minutes** while running (D48). If it's older than **15 minutes** (3 missed beats), the run is treated as crashed and taken over (stale lock) |
| owner_pid | int, nullable | Process ID of the service holding the run. On restart, if that process is no longer alive, the run is taken over at once without waiting 15 minutes (D48). Set to NULL by the emergency heartbeat |
| last_error | string, nullable | Written by the **emergency heartbeat** when the service crashes or is stopped: what went wrong, plus `crashed_at` time. Shown in the run summary and logs (D48) |
| crashed_at | datetime, nullable | When the emergency heartbeat fired |

**JobRunCompany** (D39): the checklist of companies for one run. At the start of a run, one row per company is inserted as `pending`. The collector always takes the next `pending` one.

| Field | Type | Notes |
|---|---|---|
| run_id | FK → JobRun | PK together with company_id |
| company_id | FK → Company | |
| status | enum: `pending` / `in_progress` / `done` / `failed` | `failed` only for permanent errors (D40). After a crash, `in_progress` goes back to `pending` and the company is searched again (duplicates are skipped by guid) |
| error | string, nullable | Why it failed, shown in the run summary |

It's not a temp table: it stays as a history of each run (which companies were done, which failed). The Company table itself never changes during a run.

**Not entities:**
- Alert: covered by `Mention.alerted_at`.
- Article (shared across companies): not needed. An article about two companies becomes one row per company (D17).

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
        ourcrowd_companies.txt  (the 258 companies) → filtered_ourcrowd_companies.txt (12 sections + 13 Unsorted)
                    │
                    ▼
 ┌──────────────────────────────┐        ┌───────────────────┐
 │ 1. DATA COLLECTION           │ ◄────► │ Google News RSS   │
 │    one company at a time,    │        │ (1 req / second)  │
 │    hint + section, 90 days   │        └───────────────────┘
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

 ⏰ DAILY JOB: node-cron (in the collector service) starts a run once a day.
    Collector (1) and classifier (3) are separate services that meet only
    in the DB. When collection is done and the queue is empty, the classifier
    writes data/ and sends ONE alert listing the new mentions (D38).
```

How to read it:
- The diagram shows the whole flow, from collection to the dashboard. Boxes map to project steps: 1 → Step 2, 3 → Step 3, 2 + 4 → Step 4 (storage), 5–6 → Step 5, ⏰ → Step 6.
- The daily job is **not a separate stage**. It re-runs steps 1 → 4 each day, then sends the digest and writes `data/`.
- The **BufferQueue** separates the fast collector from the slow LLM. It lives in the DB, not in RAM, so memory stays low and a crash loses nothing (D21, D24). Queue details are in 1.3, "Queue lifecycle".

| Component | What it does | Requirement |
|---|---|---|
| Seed loader | Runs at every start-up. Reads `filtered_ourcrowd_companies.txt` (name + section), `company_hints.json` (hint) and `section_keywords.json` (words per section); builds each company's `query_param` (D46) and creates or updates the Company rows. It runs again after any file edit, so changes apply on the next start | FR9 |
| Collector | One company at a time: reads the company's ready-made `query_param` from the DB, puts the date window at the front (`after:… before:…` for the 90-day backfill windows, or the last day for the daily run), and searches Google News RSS (paced, adaptive date windows). Inserts each search result into BufferQueue as one chunk, waiting while it doesn't fit under CAP. Skips articles already stored | FR10, FR13, D16, D21–D23 |
| BufferQueue (DB table) | Holds articles waiting for the LLM; its row count is the queue size | D21, D24 |
| Classifier | Takes `pending`/`failed` rows in batches and asks Ollama about relevance (irrelevant → delete) and sentiment. Moves relevant rows to Mention in chunks | FR11, FR12, D9 |
| Supervisor | `npm start`. Starts the 3 services as separate processes and restarts any that dies, with growing waits; stops and logs a clear error if one keeps crashing | D38 |
| node-cron | Lives in the collector service; starts a run once a day. On start, if the last run is older than 24 h, it starts one right away (missed-run catch-up) | FR6, D38 |
| Alerter | Collects Mention rows with `alerted_at` NULL into one digest, sends it, then sets `alerted_at` | FR7, FR8 |
| Exporter | At the end of the run, writes the mentions and a per-company status snapshot to `data/` | FR14, D20 |
| API server | Serves the two endpoints and the dashboard page; reads Mention and Company only | FR1–FR5, D19 |
| Dashboard page | List of companies with status; click a company to see its mentions, newest first | G1, G2 |

**Services and the supervisor (D38, Prompts 63–66).** The "orchestrator" is not one loop in one process. It's 3 independent services, like microservices on one machine, plus a tiny supervisor that keeps them alive:

```
npm start
  └─ supervisor  (restarts any child that dies, with backoff)
       ├─ api          → API + dashboard
       ├─ collector    → node-cron fires daily → JobRunCompany checklist → Google News → BufferQueue
       └─ classifier   → always on: BufferQueue → Ollama → delete, or move to Mention
                          → when the run is `collected` and the queue is empty: data/ + alert → `done`
```

- Each service is its own Node process with its own memory. If one crashes, the other two don't notice.
- They talk **only through the DB**. There's no DB service: SQLite is a file that each service opens directly, so there's nothing to crash. WAL mode + a busy timeout let the 3 processes take turns writing.
- Each service can also run alone: `npm run api`, `npm run collector`, `npm run classifier`. For testing or a one-off run: `npm run collect` (one run now) and `npm run classify` (drain the queue once).
- Write ownership: the **collector** runs the seed loader at its start and so owns the **Company** rows (D46). It also adds BufferQueue rows and writes JobRun/JobRunCompany progress. The **classifier** updates/deletes BufferQueue rows, adds Mention rows, writes `data/`, sends the alert and marks the run `done`. The **api** only reads.
- Crash handling in 4 layers: (1) one item or company fails → retry; (2) a loop throws → only that loop restarts; (3) a process dies → the supervisor restarts it; (4) after a restart → resume from the DB (JobRun, JobRunCompany, BufferQueue statuses). Details in Engineering Standards.

**The `data/` folder (D20, D35, D41, Prompt 68)**: the deliverable output of a real run, committed to git.

```
classifier: run is `collected` + queue empty
   → move leftovers to Mention
   → export  ──►  data/companies.json   every company + status (mentioned / no coverage, last mention, days ago)
                  data/mentions.json    every relevant mention in the 90-day window (company, title, url, publisher, date, sentiment)
                  data/run.json         run summary (when, how many fetched / relevant / deleted / failed, failed companies)
   → send the alert → JobRun = done

api on start: DB empty? → import data/*.json into SQLite → dashboard works right away
```

- **Who writes it:** only the classifier, at the end of a run (D20). It creates the folder if it's missing.
- **What's in it:** relevant, classified mentions only. BufferQueue rows (pending or irrelevant) are never exported (Prompt 32).
- **A full snapshot each run, not an append:** each file is rewritten with the current 90-day picture, so `data/` always matches the DB.
- **Crash-safe write (D41):** each file is written to a temp file (`mentions.json.tmp`) and then renamed over the old one. A rename is all-or-nothing, so a crash mid-export leaves the previous complete file, never a half-written one. If the export fails, the run isn't marked `done`, so it's retried.
- **Order: export before the alert,** so the alert never mentions something missing from `data/`.
- **Who reads it:** the api service imports it only when the DB is empty (D35), for example on a reviewer's fresh clone. A reviewer can also just open the JSON on GitHub.
- The `days ago` value in `companies.json` is a snapshot "as of" the export time (it includes `asOf`). The live dashboard always recomputes it (NFR5).
- File names and fields are a **proposal**; they're finalized in Step 4.

Key properties:
- The job and the API are **separate processes** that share the DB. The dashboard never waits on Google News or Ollama (NFR4).
- The collector and the LLM run at different speeds, and the DB queue with its CAP keeps them balanced without filling memory (I7, I8).
- All DB writes are chunked: one search result, one LLM batch, or one move at a time (I9).
- Each stage only picks up unfinished work, so the same command does the first 90-day backfill and every daily run, and it resumes after a crash (NFR3, D16).

Not added, because no requirement needs them: message brokers (the DB is the queue), caches, a search engine, RAG/embeddings, a DB server, containers for the pipeline. The 3 services are plain Node processes on one machine, not a distributed system.

Still open for this step or the deep dives:
- `query_param`: how it's built for ambiguous names → **Deep dive DD1** (user's design)
- ~~News source(s) and the ~100-results limit~~ → decided: Google News RSS + adaptive date windows (D23, I12)
- Alert channel (must be visible and documented, $0) → to decide
- ~~Scheduler~~ → decided: node-cron starts the job (D22); 3 services + supervisor (D38)
- Frontend tech (plain HTML/JS vs a framework) → to decide

#### Deep dive DD1: query_param for ambiguous names 🔄
Process (Prompt 27): the user first shares all their deep-dive ideas as input. They are recorded below as-is, and the review starts only after the user finishes.

**Summary: how the list, hints and section words come together (D44, D46, Prompt 111)**

```
 filtered_ourcrowd_companies.txt   company_hints.json     section_keywords.json
   "Harvey" → section 1              Harvey → "Harvey AI"   1 → (company OR AI OR startup …)
            └───────────────────────────┬──────────────────────────┘
                                        ▼
                         SEED LOADER (runs at every start-up)
                         builds 1 search per company
                                        ▼
                  Company.query_param in SQLite (no date part)
                  Harvey   → "Harvey AI" (company OR AI …)
                  Cerebras → "Cerebras" (company OR AI …)
                                        ▼
                  COLLECTOR: date window + query_param → Google News
```

1. **Read the list:** each company's name and section.
2. **Look up a hint** in `company_hints.json`. If there is one, use it (`"Harvey AI"`). If not, use the plain name in quotes (`"Cerebras"`).
3. **Add the section's words** from `section_keywords.json`. They go to **all** companies (decided, Prompt 120).
4. **Save the result** as `Company.query_param`.
5. **The collector** reads `query_param` and puts the date part at the **front**: `after:… before:…` windows for the backfill, or the last day for daily runs. Then it searches.

- **When it's saved:** right away, at start-up, **before the first search**. The seed loader runs inside the collector as its first step (the collector owns the Company rows) and also runs alone with `npm run seed`. All 258 rows are written in **one transaction**, so either all are saved or none.
- **Upsert, not wipe:** a company that already exists keeps its `id`, and only its section, hint and `query_param` are updated. Its mentions stay linked to it. New companies are added.
- **Not rebuilt mid-run:** a run in progress keeps the searches it started with. File edits apply at the next start.
- If a file is missing or broken (bad JSON, unknown section number), the seed loader stops with a clear error and the collector doesn't start. The old Company rows stay untouched.
- The collector never reads the three files.


**User inputs (recorded as-is, not yet reviewed):**

*Data collection (DC) flow* (Prompt 28)
1. Problem: some company names don't return relevant results.
   - 1.1 Fix: sort the companies into **12 sections**. Each section has its own query or queries.
   - The 12 sections (Prompt 47, D28): High-Tech (Information Technology) · Health (Healthcare & Biotechnology) · Sports, Fitness & Entertainment · Financials (Banking & Insurance) · Consumer Staples (Essential Goods) · Consumer Discretionary (Luxury & Leisure) · Industrials (Manufacturing & Logistics) · Communication Services · Energy · Utilities · Materials · Real Estate.
   - Assigning companies to sections and writing each section's query is **part of the DC job** (Prompt 48). Deferred to Step 2.
   - **Assignment done (Prompt 72, D43):** `filtered_ourcrowd_companies.txt`. Companies whose business couldn't be confirmed go to a 13th section, *Unsorted*. Counts after the unsorted companies were identified (Prompt 74): High-Tech 104 · Health 49 · Sports/Fitness/Entertainment 8 · Financials 15 · Consumer Staples 22 · Consumer Discretionary 15 · Industrials 19 · Communication Services 12 · Energy 6 · Utilities 3 · Materials 2 · Real Estate 3 · **Unsorted 0** (the section is kept for future companies). Queries per section are still to do.
   - *The 15 formerly unsorted companies (agent, Prompt 74):* each was linked to its OurCrowd page, and the hints below are for the Step 2 queries.
     - **Hints to tell them apart in search:**
       - Arrow Global → "Arrow Global Group", private credit (4)
       - Kini → kini.id, on-demand pay (4)
       - Genopore → protein sequencing, imec (2)
       - Peak → "Peak AI", decision intelligence (1)
       - Launchpad → "Launchpad Build AI" (7)
       - Tamar Robotics → brain-surgery robot (2)
       - Shield → shieldfc, communications compliance (1)
       - BlueCircle → also search "Trellis" / trellis.ai (5)
       - Near → "Near Intelligence" (8)
       - Wave → "Wave Financial" / waveapps (1)
       - Appforma → "Maverick" (8)
       - Mentad → "MentAd" (8)
       - Powwow → "PowWow Mobile" (1)
       - Barcode Nanotech → lipid nanoparticles (2)
       - ItsMine → "ITsMine", DLP (1)
     - **Acquired, renamed or closed:**
       - Peak: acquired by UiPath in 2025.
       - Wave: acquired by H&R Block in 2019; the brand lives on.
       - Near: went bankrupt in 2023, and its executives face a fraud case.
       - Mentad: acquired by SocialCode in 2017.
       - Appforma: acquired by GIX, around 2016.
       - Powwow: acquired; the buyer is unverified.
     - **Borderline:** BlueCircle, Near, Appforma and Kini could also be High-Tech.
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
- Research agent launched (Prompt 71). Hardware is **not** a constraint on the choice (user, Prompt 71); each candidate's size and speed are reported only to show the trade-off. **Revised in Prompt 104:** models must fit in GPU memory (8 GB on the dev machine), after measuring how slowly the big models run partly on the CPU.

*Research findings: model choice (agent, 2026-09-27)*
- **Result: no public benchmark matches our task** (headline only, "is this about company X?", then sentiment toward X). The newest Ollama models (Qwen3.5/3.6/3.8, Gemma 4) have no published scores on real headline sentiment or entity relevance. **So the fallback applies: we test the shortlist ourselves on real data.**
- Closest real-data benchmarks:
  - **SEntFiN 1.0**: 10,753 real financial headlines with sentiment per entity. This is the best match for the sentiment step, but it has no recent zero-shot scores for open models.
  - **RepLab 2013 filtering**: real tweets about entities with ambiguous names. This is the best match for the relevance step, but it has no LLM results.
  - Financial PhraseBank, FiQA-SA, Twitter Financial News: real data, but they rate the whole sentence or tweet, not a target company. The only evidence found was Qwen3 8B zero-shot on Twitter Fin News, at 0.79 accuracy.
  - Two papers (arXiv 2506.04574, 2603.19558) found that reasoning ("thinking") doesn't help simple classification, or hurts it, at 10–100× the tokens. **This supports running with thinking off.**
- Shortlist (all Apache 2.0):

  | Model | Size (q4) | Role |
  |---|---|---|
  | `qwen3.5:35b-a3b` | 24 GB, MoE (~3B active) | **Top pick.** Large total size means more world knowledge for ambiguous names (Harvey, Island, Silo, Lambda). With MoE, only ~3B parameters run per token, so it is fast for its size |
  | `gemma4:26b` | 18 GB, MoE (~3.8B active) | Alternative from another model family |
  | `qwen3.5:9b` | 6.6 GB | Fast baseline. If it scores close to the others, use it |
  | `gemma4:31b` | 20 GB, dense | Quality ceiling, slower |

- Speed (the agent's estimate, **not measured**): at ~200 input and ~15 output tokens per call with thinking off, the MoE models should reach ~5–10 items/s. That puts a 20k-headline backfill at about 0.5–1 h. The dense models should be 2–4× slower.
- Prompt and schema tips:
  - Temperature 0. Put the schema in the prompt as well as in `format`.
  - Put `relevant` before `sentiment`; `sentiment` is null when not relevant.
  - Strip the " - Publisher" suffix from the title and pass the publisher separately.
  - Tell the model to answer `false` when the name could mean another person, product or common word.
  - Use a few balanced hard-negative examples. Small models are sensitive to examples: one study measured a drop from 0.63 to 0.44 macro-F1.
- Confidence: **low to medium**. The families are sensible choices, but nothing ranks them on our task.
- **Next (our own test, Step 3):**
  - **Data:** hand-label ~400–600 real Google News headlines from our feed. Oversample ambiguous names and include routine big-company news.
  - **Measure for each model:**
    - Relevance precision, the main metric: target ≥ 95%.
    - Relevance recall.
    - Sentiment macro-F1 on the relevant items.
    - JSON and schema validity.
    - Items/s on our hardware.
    - Whether answers are the same across two runs.
  - **Rule:** pick the **fastest model that meets the precision target**. The model is not decided until this test runs.

*Model test: launched (agent, Prompt 86, 2026-09-27)*
- **Data:** 1 company from each of the 6 largest sections (High-Tech, Health, Consumer Staples, Industrials, Financials, Consumer Discretionary), about 100 real Google News articles each, so **about 600 articles**. The final size goes in the README.
- **Models:** all of them, none skipped (user). qwen3.5:35b-a3b, gemma4:26b, qwen3.5:9b, gemma4:31b, qwen3.6:27b, qwen3.8:27b, gpt-oss:20b, gemma3:4b, qwen3:4b, llama3.2:3b.
- **Revised (Prompt 104): models that don't fit the system are excluded.** Only models that fit in the dev machine's **8 GB GPU memory** are scored: llama3.2:3b, qwen3:4b, gemma3:4b, qwen3.5:9b. Excluded as "does not fit the system": gpt-oss:20b (13 GB; measured 56% CPU, 0.37–0.42 articles/s), qwen3.5:35b-a3b (24 GB), gemma4:26b (18 GB), gemma4:31b (20 GB), qwen3.6:27b and qwen3.8:27b (about 18 GB). Running partly on the CPU, they would need days for the 20,000-article backfill.
- **Method:**
  - One fixed prompt for every model. Strict JSON, temperature 0, thinking off.
  - Reference labels are made by the agent before any model runs. These are AI labels, not human ones, and the README must say so.
- **Measured per model:**
  - relevance precision, recall and F1
  - sentiment accuracy and macro-F1
  - JSON valid rate
  - **total runtime**, articles per second, and the estimated 90-day backfill time
- **Output:** `research/model-test/`, containing the dataset, labeling rules, prompt, runner, results for each model, and a summary.

*Model test: results (Prompt 107, 2026-09-27)*
- Scored on 598 articles; details in `research/model-test/summary.md`.

  | Model | Precision | Recall | Sentiment | Runtime (598 articles) | Speed |
  |---|---|---|---|---|---|
  | llama3.2:3b | 96.2% | 87.9% | 62.3% | 1.8 min | 5.5/s |
  | **qwen3:4b** | 97.7% | 97.7% | 82.2% | 3.3 min | 3.1/s |
  | gemma3:4b | 80.4% | 99.8% | 84.4% | 2.7 min | 3.7/s |
  | qwen3.5:9b | 86.2% | 100% | 83.8% | 6.3 min | 1.6/s |

  JSON was 100% valid for every model.
- **The rule's pick vs. the recommendation:**
  - The written rule ("fastest with ≥ 95% precision") picks **llama3.2:3b**.
  - It ignores recall and sentiment, and llama3.2:3b is weak on both.
  - **Chosen: qwen3:4b** (user confirmed, Prompt 120; D49).
- The test agent was stopped after the change to D47. The scoring was finished by the main session, and the excluded section was added to `summary.md`. Partial gpt-oss results are in `results/excluded/`.

*Query test: 3 sections (agent, Prompt 73, 2026-09-27)*

Setup: 49 Google News RSS searches over `when:90d`, one search (up to 100 results) per test, 2 ambiguous-name companies per section. The agent judged each headline by hand. Raw data is in the session scratchpad (`query-tests/`).

**Winning template per section:**
- **High-Tech (T8):**
  - `when:90d "{name}" (startup OR valuation OR "funding round" OR unicorn OR "venture capital" OR cybersecurity OR SaaS OR "tech company" OR "AI company" OR "AI startup" OR "AI platform" OR raised)`
  - Harvey: 25 → 86 relevant (95% precision). Island: 4 → 34 relevant (46%).
- **Health (H3), a weak win:**
  - `when:90d "{name}" (health OR healthcare OR medical OR patients OR clinical OR FDA OR telehealth OR startup OR funding) -congressman -congresswoman -Rep -senator -Democrat -Democrats -Republican -obituary`
  - Ro: 6 → 14 relevant (31% precision). Eko Health: about 1 either way, because it has almost no coverage.
- **Consumer Staples (C4):**
  - `when:90d ("{name}" OR "{alias}") (startup OR foodtech OR "plant-based" OR "alternative protein" OR "animal-free" OR vegan OR dairy OR funding)`
  - Oshi: 4/57 → 3/13 +5 likely. Remilk has almost no coverage in the window.

**Findings:**
- **Query length:**
  - Long queries silently lose their last words, including `when:90d`; results then went back to 1993.
  - Put `when:90d` **first** and keep queries to about 30 words or fewer.
- **How the operators behave:**
  - Quotes ignore case and punctuation (`"Ro"` matches "RO water").
  - OR with parentheses works.
  - A `-word` exclusion matches the whole article, so it can drop real coverage.
  - `intitle:` gives the best precision but cuts coverage by more than half.
  - Context words match the article body, not only the title.
- **The baseline hides real coverage:** noise fills the 100 slots. With the baseline, Harvey showed only 25 real articles; the template found 86.
- **No blocking seen:** no 429s or CAPTCHAs in 49 requests at about 1.5 s apart.
- **Company-specific problems need company-specific fixes:**
  - Some companies are known by a different name in the press ("Eko", not "Eko Health").
  - Aliases are needed for "formerly" names.
  - Some exclusions only apply to one company (`-Khanna` for Ro, `-Lagos` for Eko).
- **Avoid `Israel` / `Tel Aviv` as context words:** war news swamps them.
- **Open questions:**
  - Does a company's own blog (publisher = the company) count as press?
  - Should Company get `search_name` / `alias` / `extra_exclusions` fields? That would feed `query_param`.

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
| **DC: temporary error** (internet down, Google 429 / 5xx, timeout, CAPTCHA page) | **Keep retrying the same company until it's done** (D40). The wait grows (5 s → 10 s → 30 s …) up to a cap of ~10 min, so we don't hammer Google. **Meanwhile the classifier keeps draining the queue**: it's a separate service (D38). Progress shows "Google unreachable, retry in 2 m" |
| DC: permanent error (e.g. 400 for a malformed query, a response we can't parse) | Retrying can't fix it: mark the company `failed` in JobRunCompany with the reason, move on, and list it in the run summary (D40) |
| Ollama down or slow | The classifier waits and retries with backoff. The collector keeps filling until the CAP, then holds. Nothing is lost: rows stay `pending` |
| LLM returns invalid JSON | Retry up to N, then status `failed` (`attempts` counted), retried on the next run (D27) |
| URL decoding fails | Keep the Google link (D31) |
| DB write fails | Each chunk/batch/move is one transaction, so it rolls back fully. Log it and retry |
| A service process dies (out of memory, bug) | The supervisor restarts only that service, with growing waits; the others keep running. More than N crashes in a few minutes → stop restarting it and log a clear error (no endless crash loop) (D38) |
| One article crashes the classifier every time ("poison" article) | `attempts` is increased **before** the article is processed, so after 3 crashes it's marked `failed` and skipped |
| Two runs at once (cron + manual `npm run collect`) | JobRun is a lock: only one `running` run. A run whose heartbeat is older than 15 minutes (beat every 5 min), or whose owner process is dead, counts as crashed and is taken over (D39, D48) |
| Process killed / PC off | On restart, resume from the DB (D16, D39): the collector continues from the next `pending` company in JobRunCompany (the `in_progress` one is redone; duplicates are skipped by guid), and the classifier continues with the `pending` rows. If a daily run was missed, it starts right away |
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
| LLM | **Ollama** (local), model **`qwen3:4b`** (D49, chosen by research: Prompts 30, 86, 120) | Required by the brief: local model for relevance + sentiment | Cloud LLMs are not allowed |
| LLM output | **Strict JSON** via Ollama structured output (`format` = JSON schema) (D27) | The model must answer in a fixed shape we can check, e.g. `{"relevant": true, "sentiment": "positive"}`. Anything else is treated as a failure, not guessed at | Free-text answers parsed with regex: fragile |
| Orchestration | **3 independent services** (api, collector, classifier) + **our own tiny supervisor** (D22, D38) | The DB is already the queue (D21/D24), so the services only need to share the SQLite file. The supervisor restarts any service that dies. No dependency, and the reviewer runs one command | BullMQ / pg-boss / Agenda: need Redis/Postgres/Mongo servers. **PM2**: the standard process manager, would work, but it's one more tool to install (noted in the README) |
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
| D23 | News source | Google News RSS search feed (no key), paced ~1 req / 3–5 s with backoff (pace revised to 1 s by D42), adaptive date windows | User confirmed (Prompt 39). Only free, structured access to Google's news results. ToS caveat (personal, non-commercial; robots.txt) accepted and documented in the README (I11) |
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
| D38 | Services + supervisor | `npm start` runs a tiny supervisor that starts **api**, **collector** (with node-cron) and **classifier** as separate processes and restarts any that dies (growing waits, stops after repeated crashes). They share only the SQLite file; no DB service. Each can also run alone (`npm run api` / `collector` / `classifier`); `npm run collect` / `classify` run once. Missed daily run → start on launch | User (Prompts 64–66): the orchestrator carries the whole throughput, so one part crashing must not affect the others, and it must relaunch. SQLite is a file, so a DB service would only add a single point of failure. PM2 noted as the alternative |
| D39 | Resume + lock | **JobRun** (status, heartbeat) is the lock and the run record. **JobRunCompany** is the per-run checklist of companies (`pending` / `in_progress` / `done` / `failed`). After a crash, the `in_progress` company is redone and the rest continue. Stale heartbeat → take over | User agreed (Prompt 67). Restarting must continue, not start over. A checklist row per company is simpler than tracking positions, and redoing one company is safe because duplicates are skipped by guid |
| D40 | Collector retries | Temporary errors (network, 429, 5xx, timeout): retry the same company **until it's done**, backoff capped at ~10 min. Permanent errors (400, unparseable response): mark the company `failed`, move on, report it | User (Prompt 65): keep going until the company is done. Permanent errors are the exception, because retrying them forever would stall the whole run |
| D41 | `data/` export safety | Written by the classifier at the end of the run as a full snapshot (not an append); each file goes to a `.tmp` file first, then is renamed over the old one; export happens **before** the alert; a failed export keeps the run from being `done` | Prompt 68. A crash mid-export must never leave a half-written JSON in the deliverable. Exporting before alerting keeps the alert and `data/` consistent |
| D42 | Collector pace (revises D23's 3–5 s) | **Fixed 1 request/second** (+ small jitter), always. A 429 / CAPTCHA still triggers backoff and retry (D40); once a request succeeds, the pace returns to 1 s. Configurable (`REQUEST_INTERVAL_MS`) | User decision (Prompt 71): always 1 second; the adaptive slowdown was rejected. Risk accepted and documented (I23) |
| D43 | Company → section assignment | A static file, `filtered_ourcrowd_companies.txt`: 12 sections plus **13. Unsorted** for companies whose business couldn't be confirmed. Sorted by the AI assistant from its general knowledge at design time and open to review by the user. Automotive goes to Consumer Discretionary, commercial vehicles, aerospace and defense to Industrials, and agtech to Consumer Staples | Prompt 72. This is one-time setup data, like the seed list, not text understanding done by the running system, so the "Ollama for all text understanding" rule doesn't apply. Ambiguous names keep their section; the query and the LLM relevance check handle the ambiguity |
| D44 | Search query shape | One simple query per company: `when:90d` + **the name, or the company's hint if it has one** + **its section's context words**. Hints exist only for hard names (common words, people's names, places, other companies, a different press name, "formerly" names), stored in **`company_hints.json`**: 108 hard names, found by an agent (Prompt 84) and spot-tested on Google News (40 searches). The other 150 names use the plain name. Section words are in **`section_keywords.json`** (agent, Prompt 94, 67 searches). Every list starts with `company`, which recovers real articles that the other words dropped | User (Prompts 82, 85): keep it simple. Sections plus hints **cut the junk articles that reach the LLM** (less load on the slowest stage) and leave more of the 100 results for real coverage. Replaces the longer per-section templates from the query test |
| D45 | LLM speed-up: parallel classification (planned) | After the model is chosen, run **2 or more classification requests at once**: Ollama `OLLAMA_NUM_PARALLEL` = N and N classifier workers. Measure N = 1, 2, 4… on the chosen model (articles/s, errors, GPU memory) and pick the best stable N. Configurable (`LLM_CONCURRENCY`). Each worker **claims** its BufferQueue rows (e.g. a `claimed_at` / `worker` mark in one transaction) so two workers never process the same article. MOVE_CHUNK and the crash rules (D38–D40) stay the same | User (Prompt 97). The LLM is the slowest stage (1.5–5.5 articles/s one at a time in the model test), so this is where speed-ups pay off |
| D46 | Where the query is built | The **seed loader** builds each company's search **once at start-up** and saves it in `Company.query_param`:<br>1. Section from `filtered_ourcrowd_companies.txt`.<br>2. Hint from `company_hints.json` if there is one, otherwise the name in quotes.<br>3. Section words from `section_keywords.json`, for **all** companies (I34, decided in Prompt 120).<br>The **collector** never reads the files. It takes `query_param` and puts the date part at the front: `after:/before:` windows for the backfill (D23), or the last day for daily runs. The date is always first (I28) | Prompt 100–101. The collector stays simple, every company's exact search is visible in the DB for checking, and editing a file takes effect on the next start. The date isn't stored because adaptive windows change it per search |
| D47 | Model must fit the machine | Only models that fit fully in GPU memory (8 GB on the dev machine) are candidates. Larger models are excluded and marked "does not fit the system" in the research | User (Prompt 104), after measuring gpt-oss:20b at 56% CPU and 0.37–0.42 articles/s, versus 1.6–5.5 articles/s for the models that fit. A 20,000-article backfill would take days. Revises the "hardware not a constraint" note from Prompt 71 |
| D48 | Heartbeat interval | `JobRun.last_heartbeat` is written **every 5 minutes** (configurable, `HEARTBEAT_MS`). Stale after **15 minutes** (3 missed beats), so a slow moment isn't mistaken for a crash. `JobRun.owner_pid` allows an **immediate** takeover when the process that held the run is gone. That's the usual case, since the supervisor restarts a crashed service within seconds | User (Prompt 116): fewer DB writes. Trade-off: a truly hung process, still alive but stuck, is detected only after up to 15 minutes |
| D48a | Emergency heartbeat | When a service crashes (uncaught error, unhandled promise rejection) or is stopped (Ctrl+C, SIGTERM from the supervisor), it makes **one last write before exiting**: `crashed_at`, `last_error`, and `owner_pid = NULL`, which releases the lock. The run stays `running` so it resumes. The next start sees a released lock and **resumes at once**. Best effort only: a hard kill, power loss or `kill -9` can't write anything, and then the `owner_pid` check or the 15-minute timeout (D48) takes over | User (Prompt 117). Instant, explained recovery for the common crash, with the heartbeat as a safety net |
| D49 | LLM model | **qwen3:4b** on Ollama, thinking off, temperature 0, strict JSON. Our own test on 598 real headlines: 97.7% relevance precision, 97.7% recall, 82.2% sentiment accuracy, 3.06 articles/s (about 1.8 h for the 20k backfill). Fits in 8 GB of VRAM | User confirmed (Prompt 120). The best balance of the models that fit (D47). llama3.2:3b is faster but misses 12% of real articles and gets 62% of sentiment right (I35) |
| D50 | Section words scope | Section words are added for **all** companies, not only the hinted ones | User (Prompt 120). One simple rule. The recall loss for well-known unique names (I34) is accepted |
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
| I11 | Google News has no official API. The RSS feed has undocumented rate limits (429 / CAPTCHA / IP block) and its ToS/robots.txt disallow automated use | Reliability, legitimacy | Pace: fixed 1 request/second + jitter (D42, revised from 3–5 s), backoff on 429. ToS caveat documented in the README | Research (Prompt 35) |
| I12 | ~100 results per query, no pagination | Completeness (FR2) | Adaptive date windows (`after:`/`before:`), split when ≥95 items. Very big names can hit 100/day: accepted ceiling | Research (Prompt 35); resolves I4 |
| I13 | RSS links are encoded Google redirects, not publisher URLs; there's no real snippet (title + publisher only) | Dedup key (D14/D18), link quality (FR4), LLM input (I6) | Open: dedup on `guid`/Google link; decode lazily or not at all. The LLM sees the title only | Research (Prompt 35) |
| I15 | Real article URLs need 2 extra undocumented Google requests per article | Link quality (FR4), rate limits | Decode relevant articles only, paced; fall back to the Google link if decoding fails (D31) | Prompt 48 |
| I16 | guid stability isn't documented by Google | Duplicates on the dashboard | Tested: stable for the same query (100/100) and mostly across queries (16/17). Backup check on company + publisher + title (D33) | Prompt 52 |
| I14 | Irrelevant rows are deleted, so the same irrelevant article can be re-fetched and re-classified on later runs | LLM time, D9, precision measurement (NFR6) | Accepted (D25): the daily search covers ~24 h, so re-fetches are rare (window-edge overlap, crash reruns). Measure the irrelevant rate in Step 2 | Prompts 42–45 |
| I17 | The orchestrator carries the whole throughput (DC, classification, DB), so a crash stops everything | Reliability | 3 independent services + a supervisor that restarts them; resume from the DB (D38, D39) | Prompt 64 |
| I18 | A service that crashes on start, or a "poison" article, could cause an endless crash loop | Reliability, log noise | Supervisor stops after N crashes in a few minutes; `attempts` counted before processing, so a poison article ends up `failed` | Prompt 64 |
| I19 | node-cron only fires while `npm start` is running; a PC that's off at the scheduled time misses the run | Freshness (G3) | On launch, if the last run is older than 24 h, start one right away. The search window overlaps, so nothing is lost | Prompt 63 |
| I20 | 3 processes write to the same SQLite file | DB locking errors | WAL mode + busy timeout; writes are short transactions; clear write ownership per service (D38) | Prompt 66 |
| I21 | Retrying a company "until done" can stall the run if Google blocks us for hours | Run time | Accepted (D40): the classifier keeps working meanwhile, and progress shows the wait. Backoff capped at ~10 min | Prompt 65 |
| I22 | A crash while writing `data/` could leave a broken JSON file in the deliverable (and break the reviewer's auto-import) | Deliverable quality | Write to `.tmp`, then rename (all-or-nothing); the run isn't `done` until the export succeeds (D41) | Prompt 68 |
| I23 | 1 request/second is faster than the pace reported as safe (3–5 s); a block can be IP-wide and last hours, stalling the collector (D40) and URL decoding | Reliability, run time | Accepted (D42, user decision): fixed 1 s. Backoff on 429/CAPTCHA still applies. In backfill the LLM is the bottleneck, so the gain is mainly in daily runs | Prompt 69, 71 |
| I24 | On thinking models, `think:false` together with `format` made Ollama drop the JSON constraint and return plain text. This was fixed for qwen3.5 (PR #15901, v0.32.7); the Gemma 4 report (#15260) still shows as open | Classification reliability | Check this on our Ollama version during the model test. Validate every response against the schema anyway, and treat bad output as a failure (D27) | Model research (2026-09-27) |
| I25 | No public benchmark matches our task, so the model can't be chosen from the literature | Model choice confidence | Own test on ~400–600 hand-labeled real headlines. Pick the fastest model with ≥ 95% relevance precision | Model research (2026-09-27) |
| I26 | The section assignment is a best guess: some companies have little public information, generic names (Peak, Wave, Near, Shield, Launchpad) or two plausible sectors (e.g. SpaceX: aerospace or telecom). 15 went to section 13; all were later identified by an agent (Prompt 74), so section 13 is empty. Some sections are tiny (Materials 2, Utilities 3) | Query quality for those companies | Section 13 gets a generic query shape (to design in Step 2). Measure the irrelevant rate per section in the test run and move companies if needed | Prompt 72 |
| I27 | Some generic names (Launchpad, Shield, Wave, Near, Peak) need a distinguishing hint to be searchable. Some companies were acquired or shut down (Peak, Wave, Near, Mentad, Appforma, Powwow), so their news may appear under the new owner's name or not at all | Relevance and recall for those companies | Use the agent's hints in the queries (Step 2). "No coverage found" is the correct result for companies that no longer operate. Document this under the README's known limitations | Prompt 74 |
| I28 | Long Google News queries silently drop their last words, including `when:90d`, so results escape the date window | Wrong data (old articles) | Put `when:90d` first. Keep queries to about 30 words or fewer and warn when a built query is longer | Query test (Prompt 73) |
| I29 | Generic section templates can't fix every ambiguous name: Island is still about 54% noise and Ro about 69%. Health barely beats the baseline | Precision, LLM load | The LLM relevance check stays the real filter; the query only has to get more real articles into the 100 results. Hints for hard names (D44), researched by an agent (Prompt 84) | Query test (Prompt 73) |
| I30 | The query test covered only 6 companies, all hand-picked hard cases, so it doesn't show that the section queries work across all 258. Most of the portfolio is AI companies or startups, so the shared words (startup, funding, AI, raised) do most of the filtering, and the section split may add little | Confidence in the query design | Don't claim coverage beyond what was tested. Next test: the same queries on randomly picked, ordinary companies from each section, compared with a single "startup words" query for everyone | User challenge (Prompt 80) |
| I31 | Many portfolio companies were acquired, renamed or closed: about 50 are marked in `company_hints.json`, e.g. CyberX → Microsoft, Zebra Medical → Nanox, Virgin Hyperloop One shut down. Their news may be under the new name or not exist. Some hints are low-confidence (Spot AI, Bites, Neura, Silo, Parko, Orchard, Guild) and a few identities are unsure (NetOp, Neura, Air EV) | Recall; "no coverage found" for many companies | Hints use the new name where one exists. "No coverage" is a correct result for closed companies. List the affected companies under the README's known limitations. Status notes for easy names are from the agent's memory and not verified | Hint agent (Prompt 84) |
| I32 | Small companies may have **no news at all** in the window. Spot check of ItsMine (Prompt 88): 0 results in 90 days and 0 in a year; 6 results all-time, of which only 1–2 are real (2023 CrowdStrike partnership, 2018 list). Without quotes, `ITsMine` matches "its mine" (mining news). Google's regular search (News tab) does the same without quotes: "ItsMine high tech company" returned mining articles (BHP, rare earths, a uranium town), none of them about the company | Expectations: many "no coverage found" rows | That's a correct result, not a bug. Always quote the name or hint. Don't widen the window to find something, because the dashboard is per quarter | Prompt 88 |
| I33 | Parallel LLM requests (D45) share one GPU (8 GB on the dev machine). Each extra request needs more memory, the speed-up is usually well below linear, and too many can push the model partly onto the CPU and make it slower. Several workers could also pick the same article | Throughput, correctness | Measure N = 1, 2, 4 and keep the best stable value. Rows are claimed in a transaction before processing; a claimed row whose worker died is released after a timeout | Prompt 97 |
| I34 | Section words cost real articles for **well-known, unique names**: Freightos lost 19 of 66, Klook about 22, with no junk to remove. They clearly help **confusing names**: Clinch lost 15 sports headlines, Skillz golf gear, H2Pro mop reviews. Real Estate, Materials and Utilities have almost no news, so their words are barely tested | Recall for unique names | **Decided (Prompt 120): section words for all companies** (D44 as written). The loss for unique names is accepted; each list starts with `company` to limit it. Google's results also shift a little between runs | Section-words agent (Prompt 94) |
| I35 | The model-choice rule (fastest with ≥ 95% relevance precision) ignores recall and sentiment. It would pick llama3.2:3b, which misses 12% of real mentions and has 62% sentiment accuracy | Model choice | Choose by precision, recall and sentiment together. Recommended: qwen3:4b (97.7 / 97.7 / 82.2) | Model test (Prompt 107) |
| I36 | The reference labels in the model test are AI-made (Claude), not human | Trust in the scores | Stated in the README and `summary.md`. A human spot-check of some labels is advised | Model test |
| I37 | `score.mjs` rewrites `summary.md` completely, so re-running it drops the hand-added "Excluded" section. Astra's junk was first wrongly described as "mostly AstraZeneca"; the README agent checked and found 79 of 93 were about OpenAI's GPT-6 "Astra" (corrected in the page and README) | Accuracy of the research docs | The README says to back up `summary.md` before re-scoring. The Astra wording is fixed. Lesson: check claims about the data against the data | README agent (Prompt 110) |
| I38 | With a 5-minute heartbeat, a hung process (alive but stuck) blocks a new run for up to 15 minutes | Recovery time | Accepted (D48). Crashes release the lock at once through the emergency heartbeat (D48a). Dead processes are detected at once through `owner_pid`. Only a stuck-but-alive process waits for the timeout | Prompt 116–117 |
| I10 | Multi-hour runs are opaque | Operability, reviewer experience | Progress bar with %, current company, companies left, LLM rate (user input, to review) | Prompt 34 |

## Remaining to Discuss (gap check, Prompt 46)

Must settle before building:
1. ~~What the 12 sections are~~ (done, D28). ~~How each company gets assigned~~ (done, D43). ~~How the query is built~~ (D44: hint + section). Still open: the exact context words per section (the words journalists write, not the section label). Section 13 is empty now.
2. ~~Article link + dedup key~~ → decided: decode relevant only (D31), dedup on guid (D32).
3. **Model research + validation (Prompt 30):** run the research. Define how we validate quality for the README (e.g. a hand-labeled sample of real articles, with the accuracy reported).
4. ~~LLM output format~~ → strict JSON, retry → `failed` (D27).
5. ~~Storage choice~~ → `node:sqlite` (D30).
6. **Alert channel:** part of the daily job (mail / webhook / …). Must be visible, documented, and $0.
7. ~~Frontend tech~~ → React + Vite (D29). ~~API server library~~ → Express (D34; Fastify noted as the production choice).

Smaller, can come later:
- ~~The `data/` folder format~~ → JSON + auto-import (D35); exact file names in Step 4.
- ~~Failure handling: Ollama down, Google 429/CAPTCHA, the job running while the PC is off~~ → decided: D37–D40, I17–I21.
- Security: escape article titles in the UI (XSS); secrets like SMTP credentials or a webhook URL go in `.env`, never in the repo.
- Design-process sections not written up yet: 1.6 data flow, 1.12 trade-offs summary, 1.13 MVP vs production, 1.14 implementation plan. Most of the content already exists in this file.
- Company list mismatch (the brief says "name + domain/sector"; the file has names only): consider asking OurCrowd.

## Open Questions
- ❓ **Daily job details (Prompt 46):** flow is duplicates check → remove/add → send message (mail/webhook/etc.). Channel, what gets removed, and the search window are open; to discuss in Step 6.
- ❓ **Sourcing:** same providers for all companies plus per-company query overrides (recommended), or different sources per company? → to settle in 1.8.
- ❓ **Company list:** the brief promises "name + domain/sector", but the file has names only and doesn't mark portfolio vs fund. Consider asking OurCrowd.
- ❓ **Volume skew:** SpaceX/Anthropic/Stripe get thousands of articles; seed startups get ~0. We aren't capping (D11), so how do we keep the local-LLM processing time reasonable? → 1.2 / 1.9.
- ✅ ~~**Source result limits**~~: confirmed ~100 per query; handled by adaptive date windows (I12).
