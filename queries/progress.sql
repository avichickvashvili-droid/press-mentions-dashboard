-- progress.sql — ready-made queries to follow a run from the database.
--
-- Plain SQLite, read-only (every query is a SELECT). Works in any viewer (DB Browser for SQLite,
-- the sqlite3 command line). Open db/press-mentions.sqlite READ-ONLY, select ONE query and run it.
-- Safe while a run is going (WAL mode: reading never blocks the collector or the classifier).
-- "The latest run" is found by itself with (SELECT MAX(id) FROM JobRun): nothing to fill in.
-- All times are UTC. `npm run progress` shows the same main numbers in the terminal.


-- =============================================================================================
-- TL;DR: the 5 most useful queries (the ones used to follow the real run)
-- =============================================================================================

-- 1. Is the run OK? Status (running → collected → done), last heartbeat and how many minutes ago,
--    last error, and the AI counts (classified / relevant / irrelevant / failed).
--    A 'running' run with no heartbeat for more than 15 minutes has probably crashed.
--    While 'collected' no heartbeat is written: that is normal.
SELECT id AS run_id, status, started_at, last_heartbeat,
  ROUND((julianday('now') - julianday(last_heartbeat)) * 24 * 60, 1) AS minutes_since_heartbeat,
  last_error, classified_count AS classified, relevant_count AS relevant,
  irrelevant_count AS irrelevant, failed_count AS failed
FROM JobRun WHERE id = (SELECT MAX(id) FROM JobRun);

-- 2. How is each group doing? One line per group: status, companies done / failed / left,
--    crashes in a row, when data/ was written after it (exported_at), and its last error.
--    exported_at stays empty until the AI has finished that group's articles.
SELECT g.group_number, g.status,
  SUM(j.status = 'finished') AS done, SUM(j.status = 'failed') AS failed,
  SUM(j.status IN ('not_started','fetching')) AS left, COUNT(j.company_id) AS total,
  g.crashes_in_a_row, g.exported_at, g.last_error
FROM JobRunGroup g
LEFT JOIN JobRunCompany j ON j.run_id = g.run_id AND j.group_number = g.group_number
WHERE g.run_id = (SELECT MAX(id) FROM JobRun)
GROUP BY g.group_number ORDER BY g.group_number;

-- 3. What is in the AI queue? Articles per state: waiting for the AI, being classified now,
--    failed once (will be retried), failed for good (3 tries), relevant (waiting to be moved
--    to Mention, in chunks of 1,000). An empty result means the queue is empty.
SELECT state, COUNT(*) AS articles FROM (
  SELECT CASE WHEN claimed_at IS NOT NULL THEN 'being classified now'
              WHEN status = 'pending' THEN 'waiting for the AI'
              WHEN status = 'failed' AND attempts < 3 THEN 'failed once, will be retried'
              WHEN status = 'failed' THEN 'failed for good'
              WHEN status = 'relevant' THEN 'relevant, waiting to be moved'
              ELSE status END AS state
  FROM BufferQueue) GROUP BY state ORDER BY articles DESC;

-- 4. Which company is being searched right now? Its group and name. No row = no search running
--    (between groups, waiting for queue room, or collection has ended).
SELECT j.group_number, c.name AS company, j.status
FROM JobRunCompany j
JOIN Company c ON c.id = j.company_id
WHERE j.run_id = (SELECT MAX(id) FROM JobRun)
  AND j.status = 'fetching';

-- 5. How many mentions, and what sentiment? Total, positive / negative / neutral, and how many
--    companies have at least one. Grows in steps of about 1,000 (mentions are moved in chunks).
SELECT COUNT(*) AS total,
  SUM(sentiment = 'positive') AS positive,
  SUM(sentiment = 'negative') AS negative,
  SUM(sentiment = 'neutral')  AS neutral,
  COUNT(DISTINCT company_id)  AS companies_with_mentions
FROM Mention;


-- =============================================================================================
-- MORE (when you need detail)
-- =============================================================================================

-- 6. All runs, newest first.
SELECT id AS run_id, status, started_at, finished_at,
  classified_count AS classified, relevant_count AS relevant, failed_count AS failed, last_error
FROM JobRun ORDER BY id DESC;

-- 7. The group running now: its first and last company, done / failed / left. No row = none.
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
  g.crashes_in_a_row, g.started_at, g.last_error
FROM JobRunGroup g
WHERE g.run_id = (SELECT MAX(id) FROM JobRun)
  AND g.status = 'in_progress';

-- 8. Which groups failed, and why? Re-run one later with `npm start -- --groups N`.
SELECT group_number, crashes_in_a_row, failed_rounds, started_at, finished_at, last_error
FROM JobRunGroup
WHERE run_id = (SELECT MAX(id) FROM JobRun) AND status = 'failed'
ORDER BY group_number;

-- 9. How many companies are finished / failed / being searched / not started?
SELECT
  SUM(status = 'finished')    AS finished,
  SUM(status = 'failed')      AS failed,
  SUM(status = 'fetching')    AS fetching,
  SUM(status = 'not_started') AS not_started,
  COUNT(*)                    AS total
FROM JobRunCompany
WHERE run_id = (SELECT MAX(id) FROM JobRun);

-- 10. Every company of the group running now, in list order.
--     For another group, replace the last condition with: AND j.group_number = 4
SELECT j.group_number, c.name AS company, j.status, j.error
FROM JobRunCompany j
JOIN Company c ON c.id = j.company_id
WHERE j.run_id = (SELECT MAX(id) FROM JobRun)
  AND j.group_number = (SELECT group_number FROM JobRunGroup
                        WHERE run_id = (SELECT MAX(id) FROM JobRun) AND status = 'in_progress'
                        ORDER BY group_number LIMIT 1)
ORDER BY j.rowid;

-- 11. Which companies failed, and why? Re-run their group with `npm start -- --groups N`.
SELECT c.name AS company, j.group_number, j.error
FROM JobRunCompany j
JOIN Company c ON c.id = j.company_id
WHERE j.run_id = (SELECT MAX(id) FROM JobRun) AND j.status = 'failed'
ORDER BY j.group_number, c.name;

-- 12. Every company of the latest run: group, status, error, and its mentions (from all runs).
SELECT j.group_number, c.name AS company, j.status, j.error,
  (SELECT COUNT(*) FROM Mention m WHERE m.company_id = j.company_id) AS mentions
FROM JobRunCompany j
JOIN Company c ON c.id = j.company_id
WHERE j.run_id = (SELECT MAX(id) FROM JobRun)
ORDER BY j.group_number, j.rowid;

-- 13. Articles the AI failed on for good (no valid answer after 3 tries).
SELECT c.name AS company, b.title, b.publisher, b.published_at, b.attempts
FROM BufferQueue b
JOIN Company c ON c.id = b.company_id
WHERE b.status = 'failed' AND b.attempts >= 3
ORDER BY c.name, b.published_at;

-- 14. The 20 companies with the most articles waiting for the AI.
SELECT c.name AS company, COUNT(*) AS waiting
FROM BufferQueue b
JOIN Company c ON c.id = b.company_id
WHERE b.status IN ('pending', 'failed') AND b.attempts < 3
GROUP BY b.company_id
ORDER BY waiting DESC, c.name
LIMIT 20;

-- 15. The 20 companies with the most mentions, by sentiment, with their latest article date.
SELECT c.name AS company, COUNT(*) AS mentions,
  SUM(m.sentiment = 'positive') AS positive,
  SUM(m.sentiment = 'negative') AS negative,
  SUM(m.sentiment = 'neutral')  AS neutral,
  MAX(m.published_at)           AS latest_published_at
FROM Mention m
JOIN Company c ON c.id = m.company_id
GROUP BY m.company_id
ORDER BY mentions DESC, c.name
LIMIT 20;

-- 16. Companies with no mentions at all. During a run, a company may not be searched yet, or its
--     articles may still be waiting in the queue (query 14).
SELECT c.name AS company, c.section
FROM Company c
WHERE NOT EXISTS (SELECT 1 FROM Mention m WHERE m.company_id = c.id)
ORDER BY c.section, c.name;
