-- progress.sql — ready-made queries to follow a collection run from the database.
--
-- What it is: plain SQLite queries you can copy into any database viewer (DB Browser for
-- SQLite, the IntelliJ Database tool, the sqlite3 command line). Each query answers one
-- question, written as its heading. Run one query at a time (select it, then "Execute").
-- Reads: db/press-mentions.sqlite (tables JobRun, JobRunGroup, JobRunCompany, Company,
-- BufferQueue, Mention; see src/db/database.js). Writes: nothing. Every query is a SELECT.
--
-- Safe while a run is going: the database uses WAL mode, so reading never blocks the
-- collector or the classifier. Open the file READ-ONLY in your viewer to be sure nothing is
-- changed by accident.
--
-- "The latest run" = the JobRun row with the highest id. The queries find it by themselves
-- with (SELECT MAX(id) FROM JobRun), so there is nothing to fill in.
--
-- Words used below:
--   group status    pending = not started yet · in_progress = running now (or was, before a
--                   stop) · complete = every company in it is finished or failed ·
--                   failed = given up after 5 crashes in a row (D84)
--   company status  not_started · fetching (being searched now) · finished · failed
--                   (Google answered 400 three times, D85)
--   done / failed / left
--                   done = finished companies · failed = failed companies ·
--                   left = not_started + fetching (still to do)
--   All times are UTC, e.g. 2026-09-27T10:15:00.000Z.
--
-- The same main queries are shown as tables in the terminal by `npm run progress`
-- (src/tools/progress.js).


-- =============================================================================================
-- 1. RUN
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1.1 How is the latest run doing? (run overview)
-- Shows one line, e.g.:
--   run_id | status  | started_at               | last_heartbeat           | minutes_since_heartbeat | owner_pid | last_error | classified | relevant | irrelevant | failed
--   3      | running | 2026-09-27T08:00:00.000Z | 2026-09-27T10:12:00.000Z | 2.4                     | 12345     | NULL       | 1200       | 310      | 870        | 20
-- A 'running' run whose heartbeat is more than 15 minutes old has probably crashed (D39).
-- classified / relevant / irrelevant / failed = the AI step's counters for this run.
-- ---------------------------------------------------------------------------------------------
SELECT
  id                AS run_id,
  status,
  started_at,
  finished_at,
  last_heartbeat,
  ROUND((julianday('now') - julianday(last_heartbeat)) * 24 * 60, 1) AS minutes_since_heartbeat,
  owner_pid,
  last_error,
  classified_count  AS classified,
  relevant_count    AS relevant,
  irrelevant_count  AS irrelevant,
  failed_count      AS failed
FROM JobRun
WHERE id = (SELECT MAX(id) FROM JobRun);

-- ---------------------------------------------------------------------------------------------
-- 1.2 What runs have there been? (all runs, newest first)
-- Shows e.g.:
--   run_id | status | started_at               | finished_at              | classified | relevant
--   3      | done   | 2026-09-27T08:00:00.000Z | 2026-09-27T11:40:00.000Z | 5400       | 1310
-- ---------------------------------------------------------------------------------------------
SELECT
  id               AS run_id,
  status,
  started_at,
  finished_at,
  classified_count AS classified,
  relevant_count   AS relevant,
  failed_count     AS failed,
  last_error
FROM JobRun
ORDER BY id DESC;


-- =============================================================================================
-- 2. GROUPS (of the latest run)
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 2.1 Which group is running now?
-- Shows the in_progress group (no row = no group is running), e.g.:
--   group_number | first_company | last_company | done | failed | left | total | crashes_in_a_row | started_at
--   3            | Acme          | Zeta Labs    | 10   | 0      | 16   | 26    | 0                | 2026-09-27T09:10:00.000Z
-- first_company / last_company = the group's range in the company list.
-- ---------------------------------------------------------------------------------------------
SELECT
  g.group_number,
  (SELECT c.name FROM JobRunCompany j JOIN Company c ON c.id = j.company_id
     WHERE j.run_id = g.run_id AND j.group_number = g.group_number ORDER BY j.rowid ASC  LIMIT 1) AS first_company,
  (SELECT c.name FROM JobRunCompany j JOIN Company c ON c.id = j.company_id
     WHERE j.run_id = g.run_id AND j.group_number = g.group_number ORDER BY j.rowid DESC LIMIT 1) AS last_company,
  (SELECT COUNT(*) FROM JobRunCompany j
     WHERE j.run_id = g.run_id AND j.group_number = g.group_number AND j.status = 'finished') AS done,
  (SELECT COUNT(*) FROM JobRunCompany j
     WHERE j.run_id = g.run_id AND j.group_number = g.group_number AND j.status = 'failed') AS failed,
  (SELECT COUNT(*) FROM JobRunCompany j
     WHERE j.run_id = g.run_id AND j.group_number = g.group_number AND j.status IN ('not_started', 'fetching')) AS left,
  (SELECT COUNT(*) FROM JobRunCompany j
     WHERE j.run_id = g.run_id AND j.group_number = g.group_number) AS total,
  g.crashes_in_a_row,
  g.started_at,
  g.last_error
FROM JobRunGroup g
WHERE g.run_id = (SELECT MAX(id) FROM JobRun)
  AND g.status = 'in_progress';

-- ---------------------------------------------------------------------------------------------
-- 2.2 How are all the groups doing? (every group of the latest run)
-- Shows one line per group, e.g.:
--   group_number | status      | done | failed | left | total | crashes_in_a_row | started_at | finished_at | exported_at | last_error
--   1            | complete    | 26   | 0      | 0    | 26    | 0                | ...        | ...         | ...         | NULL
--   2            | complete    | 25   | 1      | 0    | 26    | 0                | ...        | ...         | NULL        | NULL
--   3            | in_progress | 10   | 0      | 16   | 26    | 1                | ...        | NULL        | NULL        | Error: ...
--   4            | pending     | 0    | 0      | 26   | 26    | 0                | NULL       | NULL        | NULL        | NULL
-- exported_at = when data/ was written after this group (D86).
-- ---------------------------------------------------------------------------------------------
SELECT
  g.group_number,
  g.status,
  SUM(j.status = 'finished')                   AS done,
  SUM(j.status = 'failed')                     AS failed,
  SUM(j.status IN ('not_started', 'fetching')) AS left,
  COUNT(j.company_id)                          AS total,
  g.crashes_in_a_row,
  g.started_at,
  g.finished_at,
  g.exported_at,
  g.last_error
FROM JobRunGroup g
LEFT JOIN JobRunCompany j ON j.run_id = g.run_id AND j.group_number = g.group_number
WHERE g.run_id = (SELECT MAX(id) FROM JobRun)
GROUP BY g.group_number
ORDER BY g.group_number;

-- ---------------------------------------------------------------------------------------------
-- 2.3 How many groups are complete / failed / running / waiting?
-- Shows one line per group status, e.g.:
--   status      | groups
--   complete    | 2
--   in_progress | 1
--   pending     | 7
-- ---------------------------------------------------------------------------------------------
SELECT status, COUNT(*) AS groups
FROM JobRunGroup
WHERE run_id = (SELECT MAX(id) FROM JobRun)
GROUP BY status
ORDER BY CASE status WHEN 'complete' THEN 1 WHEN 'failed' THEN 2 WHEN 'in_progress' THEN 3 ELSE 4 END;

-- ---------------------------------------------------------------------------------------------
-- 2.4 Which groups failed, and why?
-- Shows e.g.:
--   group_number | crashes_in_a_row | started_at               | finished_at              | last_error
--   5            | 5                | 2026-09-27T09:40:00.000Z | 2026-09-27T09:45:00.000Z | Error: out of memory
-- A failed group can be run again later with `npm start -- --groups 5` (D87).
-- ---------------------------------------------------------------------------------------------
SELECT group_number, crashes_in_a_row, started_at, finished_at, last_error
FROM JobRunGroup
WHERE run_id = (SELECT MAX(id) FROM JobRun)
  AND status = 'failed'
ORDER BY group_number;


-- =============================================================================================
-- 3. COMPANIES (of the latest run)
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 3.1 How many companies are finished / failed / being searched / not started?
-- Shows e.g.:
--   finished | failed | fetching | not_started | total
--   60       | 2      | 1        | 195         | 258
-- ---------------------------------------------------------------------------------------------
SELECT
  SUM(status = 'finished')    AS finished,
  SUM(status = 'failed')      AS failed,
  SUM(status = 'fetching')    AS fetching,
  SUM(status = 'not_started') AS not_started,
  COUNT(*)                    AS total
FROM JobRunCompany
WHERE run_id = (SELECT MAX(id) FROM JobRun);

-- ---------------------------------------------------------------------------------------------
-- 3.2 What is the status of each company in the group that is running now?
-- Shows the companies of the in_progress group, in list order, e.g.:
--   group_number | company  | status      | error
--   3            | Acme     | finished    | NULL
--   3            | Beta Bio | fetching    | NULL
--   3            | Cortex   | not_started | NULL
-- To see another group, replace the last condition with: AND j.group_number = 4
-- ---------------------------------------------------------------------------------------------
SELECT j.group_number, c.name AS company, j.status, j.error
FROM JobRunCompany j
JOIN Company c ON c.id = j.company_id
WHERE j.run_id = (SELECT MAX(id) FROM JobRun)
  AND j.group_number = (SELECT group_number FROM JobRunGroup
                        WHERE run_id = (SELECT MAX(id) FROM JobRun) AND status = 'in_progress'
                        ORDER BY group_number LIMIT 1)
ORDER BY j.rowid;

-- ---------------------------------------------------------------------------------------------
-- 3.3 Which companies failed, and why?
-- Shows e.g.:
--   company | group_number | error
--   Harvey  | 2            | Google answered 400 Bad Request 3 times
-- ---------------------------------------------------------------------------------------------
SELECT c.name AS company, j.group_number, j.error
FROM JobRunCompany j
JOIN Company c ON c.id = j.company_id
WHERE j.run_id = (SELECT MAX(id) FROM JobRun)
  AND j.status = 'failed'
ORDER BY j.group_number, c.name;

-- ---------------------------------------------------------------------------------------------
-- 3.4 What is the status of every company? (the whole checklist of the latest run)
-- Shows one line per company, in list order, e.g.:
--   group_number | company | status   | error | mentions
--   1            | Lambda  | finished | NULL  | 42
-- mentions = all mentions of the company in the Mention table (not only from this run).
-- ---------------------------------------------------------------------------------------------
SELECT
  j.group_number,
  c.name AS company,
  j.status,
  j.error,
  (SELECT COUNT(*) FROM Mention m WHERE m.company_id = j.company_id) AS mentions
FROM JobRunCompany j
JOIN Company c ON c.id = j.company_id
WHERE j.run_id = (SELECT MAX(id) FROM JobRun)
ORDER BY j.group_number, j.rowid;


-- =============================================================================================
-- 4. QUEUE (BufferQueue: articles waiting for the AI step)
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 4.1 How many articles are in the queue, and in what state?
-- Shows one line per state, e.g.:
--   state                         | articles
--   waiting for the AI            | 1240
--   being classified now          | 16
--   failed once, will be retried  | 3
--   failed for good               | 2
--   relevant, waiting to be moved | 50
-- "Failed for good" = tried 3 times (MAX_ATTEMPTS in src/config.js) with no valid answer (D59).
-- Relevant rows are moved to the Mention table in chunks (D51); irrelevant rows are deleted.
-- ---------------------------------------------------------------------------------------------
SELECT state, COUNT(*) AS articles
FROM (
  SELECT CASE
           WHEN claimed_at IS NOT NULL                   THEN 'being classified now'
           WHEN status = 'pending'                       THEN 'waiting for the AI'
           WHEN status = 'failed' AND attempts < 3       THEN 'failed once, will be retried'
           WHEN status = 'failed'                        THEN 'failed for good'
           WHEN status = 'relevant'                      THEN 'relevant, waiting to be moved'
           ELSE status
         END AS state
  FROM BufferQueue
)
GROUP BY state
ORDER BY articles DESC;

-- ---------------------------------------------------------------------------------------------
-- 4.2 Which articles failed for good? (the AI never gave a valid answer)
-- Shows e.g.:
--   company | title                              | publisher | published_at             | attempts
--   Lambda  | Lambda raises $300M - Reuters      | Reuters   | 2026-09-20T12:00:00.000Z | 3
-- ---------------------------------------------------------------------------------------------
SELECT c.name AS company, b.title, b.publisher, b.published_at, b.attempts
FROM BufferQueue b
JOIN Company c ON c.id = b.company_id
WHERE b.status = 'failed' AND b.attempts >= 3
ORDER BY c.name, b.published_at;

-- ---------------------------------------------------------------------------------------------
-- 4.3 Which companies have the most articles waiting in the queue?
-- Shows e.g.:
--   company | waiting
--   Lambda  | 310
-- ---------------------------------------------------------------------------------------------
SELECT c.name AS company, COUNT(*) AS waiting
FROM BufferQueue b
JOIN Company c ON c.id = b.company_id
WHERE b.status IN ('pending', 'failed') AND b.attempts < 3
GROUP BY b.company_id
ORDER BY waiting DESC, c.name
LIMIT 20;


-- =============================================================================================
-- 5. MENTIONS (the final, relevant articles)
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 5.1 How many mentions are there, and with what sentiment?
-- Shows one line, e.g.:
--   total | positive | negative | neutral | companies_with_mentions
--   4321  | 1200     | 300      | 2821    | 180
-- ---------------------------------------------------------------------------------------------
SELECT
  COUNT(*)                     AS total,
  SUM(sentiment = 'positive')  AS positive,
  SUM(sentiment = 'negative')  AS negative,
  SUM(sentiment = 'neutral')   AS neutral,
  COUNT(DISTINCT company_id)   AS companies_with_mentions
FROM Mention;

-- ---------------------------------------------------------------------------------------------
-- 5.2 Which companies have the most mentions? (top 20)
-- Shows e.g.:
--   company | mentions | positive | negative | neutral | latest_published_at
--   Lambda  | 312      | 120      | 12       | 180     | 2026-09-26T18:00:00.000Z
-- ---------------------------------------------------------------------------------------------
SELECT
  c.name                        AS company,
  COUNT(*)                      AS mentions,
  SUM(m.sentiment = 'positive') AS positive,
  SUM(m.sentiment = 'negative') AS negative,
  SUM(m.sentiment = 'neutral')  AS neutral,
  MAX(m.published_at)           AS latest_published_at
FROM Mention m
JOIN Company c ON c.id = m.company_id
GROUP BY m.company_id
ORDER BY mentions DESC, c.name
LIMIT 20;

-- ---------------------------------------------------------------------------------------------
-- 5.3 Which companies have no mentions at all?
-- Shows e.g.:
--   company       | section
--   Quiet Robotics | 4
-- Note: during a run, a company may simply not be searched yet, or its articles may still be
-- waiting in the queue (see 4.3).
-- ---------------------------------------------------------------------------------------------
SELECT c.name AS company, c.section
FROM Company c
WHERE NOT EXISTS (SELECT 1 FROM Mention m WHERE m.company_id = c.id)
ORDER BY c.section, c.name;
