// runCollect.test.js — runs the REAL collector (src/collector/runCollect.js, the group runner)
// with its REAL group processes, offline: test/fixtures/offline-collect.mjs gives a fake Google
// News, a tiny company list and small groups, and can make a group process crash or hang.
// Checks (D83-D90): groups run one after another in separate processes; a crashed group is
// restarted and resumes; 5 crashes with no progress -> the group is failed and the next one runs;
// the end log; a stop reaches the group process and the emergency heartbeat is written;
// `--groups` (D87): refused while a run is running or collected, bad input refused, and on a
// done run only the chosen groups are fetched again, with the same 90 days; the log files (D92,
// D93): collector.log and group-N.log in the run folder, lines held until the run is known; the
// clean-up when a new run starts (D94): old rows and log folders removed, --groups removes nothing.
// Temporary SQLite files and folders only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isProcessAlive } from '../src/shared/runLock.js';
import { TEST_KEYWORDS, makeTempDb, testLogsDir, writeDataFiles } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_COLLECT = path.join(ROOT, 'src', 'collector', 'runCollect.js');
const OFFLINE_COLLECT = pathToFileURL(path.join(ROOT, 'test', 'fixtures', 'offline-collect.mjs')).href;

// 6 companies in one section; with TEST_GROUP_SIZE=2: group 1 = Alpha, Beta; group 2 = Gamma,
// Delta; group 3 = Epsilon, Zeta.
const LIST = '## 1. Tech\nAlpha\nBeta\nGamma\nDelta\nEpsilon\nZeta\n';

// Sets up a temp database and data files. Returns { db, dbPath, dir, env } where env is the
// environment for the collector (fast, groups of 2, a fetch log file).
function setUp(t) {
  const { db, dbPath, dir } = makeTempDb(t);
  const files = writeDataFiles(dir, { list: LIST, keywords: TEST_KEYWORDS });
  const fetchLog = path.join(dir, 'fetch.log');
  const env = {
    ...process.env,
    DB_PATH: dbPath,
    LOGS_DIR: testLogsDir(dbPath),
    TEST_COMPANY_LIST: files.listFile,
    TEST_HINTS: files.hintsFile,
    TEST_KEYWORDS: files.keywordsFile,
    TEST_GROUP_SIZE: '2',
    TEST_FAST: '1',
    TEST_FETCH_LOG: fetchLog,
    TEST_CRASH_COUNTER: path.join(dir, 'crash-count.txt'),
  };
  // Reads the fetch log as [[processId, companyName], ...].
  const fetches = () => (fs.existsSync(fetchLog) ? fs.readFileSync(fetchLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split(' ')) : []);
  return { db, dbPath, dir, env, fetches };
}

// Runs the collector to its end. `args` = extra command-line words (e.g. ['--groups', '2']).
function runCollector(env, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, ['--import', OFFLINE_COLLECT, RUN_COLLECT, ...args], {
    encoding: 'utf8', timeout: 60000, env: { ...env, ...extraEnv },
  });
}

// The JobRunGroup rows of run 1 as [number, status, crashes_in_a_row].
function groups(db) {
  return db.prepare('SELECT group_number, status, crashes_in_a_row FROM JobRunGroup WHERE run_id = 1 ORDER BY group_number').all()
    .map((row) => [row.group_number, row.status, row.crashes_in_a_row]);
}

test('a full run: 3 groups, each in its own process, one after another; end log; the run is collected', (t) => {
  const { db, env, fetches } = setUp(t);
  const result = runCollector(env);
  assert.equal(result.status, 0, result.stderr);

  const log = fetches();
  assert.deepEqual(log.map(([, name]) => name), ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']);
  const pids = log.map(([pid]) => pid);
  assert.equal(new Set(pids).size, 3, 'one process per group');
  assert.deepEqual([pids[0] === pids[1], pids[2] === pids[3], pids[4] === pids[5]], [true, true, true]);
  assert.ok(!pids.includes(String(result.pid)), 'the runner itself fetched nothing');

  assert.deepEqual(groups(db), [[1, 'complete', 0], [2, 'complete', 0], [3, 'complete', 0]]);
  assert.match(result.stdout, /Group 1 of 3 \(companies 1–2\): 0\/2 done · starting its process/);
  assert.match(result.stdout, /Group 3 of 3 \(companies 5–6\): 2\/2 done · group complete/);
  assert.match(result.stdout, /Groups: complete 1–3 · failed none/);
  assert.match(result.stdout, /Companies failed: none/);
  const run = db.prepare('SELECT status, owner_pid FROM JobRun').get();
  assert.deepEqual([run.status, run.owner_pid], ['collected', null]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n, 12);
});

test('a group process that crashes is started again and continues from its unfinished companies', (t) => {
  const { db, env, fetches } = setUp(t);
  const result = runCollector(env, [], { TEST_CRASH_COMPANY: 'Beta', TEST_CRASH_TIMES: '1' });
  assert.equal(result.status, 0, result.stderr);
  const names = fetches().map(([, name]) => name);
  assert.deepEqual(names.slice(0, 3), ['Alpha', 'Beta', 'Beta'], 'Alpha is not searched again after the crash');
  assert.deepEqual(groups(db)[0], [1, 'complete', 0]);
  const group1 = db.prepare('SELECT last_error FROM JobRunGroup WHERE group_number = 1').get();
  assert.match(group1.last_error, /^exit 1: .*crashed on purpose while searching Beta/);
  assert.match(result.stderr, /Group 1's process crashed .*1 crash\(es\) in a row \(it made progress first\)/);
});

test('5 crashes in a row with no progress: the group is failed, the next groups run; a company rejected by Google (400 x3) fails alone', (t) => {
  const { db, env, fetches } = setUp(t);
  const result = runCollector(env, [], { TEST_CRASH_COMPANY: 'Alpha', TEST_CRASH_TIMES: '99', TEST_BAD_REQUEST_COMPANY: 'Gamma' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(groups(db), [[1, 'failed', 5], [2, 'complete', 0], [3, 'complete', 0]]);
  const names = fetches().map(([, name]) => name);
  assert.equal(names.filter((name) => name === 'Alpha').length, 5);
  assert.equal(names.filter((name) => name === 'Gamma').length, 3, 'Gamma: 3 tries (D85)');
  assert.ok(!names.includes('Beta'), 'Beta was never reached');
  assert.match(result.stdout, /Groups: complete 2–3 · failed 1/);
  assert.match(result.stdout, /group 1: 2 of 2 companies not collected; last error: exit 1/);
  assert.match(result.stdout, /Companies failed: \[Gamma\]/);
  assert.match(result.stderr, /Google error for Gamma: Google rejected the search \(HTTP 400 Bad Request\) \(try 1 of 3\)/);
  assert.equal(db.prepare('SELECT status FROM JobRun').get().status, 'collected');
});

test('stop (the orchestrator\'s stop message): the group process is stopped, then the emergency heartbeat is written (D70)', async (t) => {
  const { db, env } = setUp(t);
  const child = spawn(process.execPath, ['--import', OFFLINE_COLLECT, RUN_COLLECT], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...env, TEST_FETCH_MODE: 'hang' },
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  child.stdout.on('data', (piece) => { output += piece; });
  child.stderr.on('data', (piece) => { output += piece; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));

  const deadline = Date.now() + 20000;
  const fetching = () => {
    try { return db.prepare("SELECT 1 FROM JobRunCompany WHERE status = 'fetching'").get(); } catch { return false; }
  };
  while (!fetching()) {
    if (Date.now() > deadline) assert.fail(`the group never started fetching:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const groupPid = Number(output.match(/Group 1: process (\d+) started/)[1]);
  assert.equal(isProcessAlive(groupPid), true);

  child.send({ type: 'stop' });
  assert.equal(await exited, 143, output);
  assert.equal(isProcessAlive(groupPid), false, 'the group process was stopped too');
  const run = db.prepare('SELECT status, owner_pid, last_error FROM JobRun').get();
  assert.deepEqual([run.status, run.owner_pid], ['running', null]);
  assert.match(run.last_error, /stopped by SIGTERM/);
  const group = db.prepare('SELECT status, crashes_in_a_row, last_error FROM JobRunGroup WHERE group_number = 1').get();
  assert.deepEqual([group.status, group.crashes_in_a_row, group.last_error], ['in_progress', 0, null], 'a stop is not a crash');
});

test('--groups: bad input is refused with exit 3 and nothing is started', (t) => {
  const { db, env } = setUp(t);
  for (const args of [['--groups'], ['--groups', 'abc'], ['--groups', '0'], ['--groups', '1,,2']]) {
    const result = runCollector(env, args);
    assert.equal(result.status, 3, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, /--groups/);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM JobRun').get().n, 0);
});

test('--groups: refused (exit 3) with no run, while the latest run is collected, and while a LIVE collector holds it (D91)', (t) => {
  const { db, env } = setUp(t);
  const none = runCollector(env, ['--groups', '1']);
  assert.equal(none.status, 3, none.stderr);
  assert.match(none.stderr, /There is no run yet/);

  assert.equal(runCollector(env).status, 0); // run 1 collected
  const collected = runCollector(env, ['--groups', '1']);
  assert.equal(collected.status, 3, collected.stderr);
  assert.match(collected.stderr, /A run is still in progress \(collector or classifier\)\. Try again when it's done\./);

  // A live collector: this test process is alive and the heartbeat is fresh.
  db.prepare("UPDATE JobRun SET status = 'running', owner_pid = ?, last_heartbeat = ?").run(process.pid, new Date().toISOString());
  const running = runCollector(env, ['--groups', '1']);
  assert.equal(running.status, 3, running.stderr);
  assert.match(running.stderr, /A run is still in progress/);
  const run = db.prepare('SELECT status, owner_pid FROM JobRun').get();
  assert.deepEqual([run.status, run.owner_pid], ['running', process.pid], 'nothing changed');
});

test('D91: the collector dies during --groups 2; the restarted collector with --groups 2 resets group 2 again and finishes the run', async (t) => {
  const { db, env, fetches, dir } = setUp(t);
  assert.equal(runCollector(env).status, 0);
  db.prepare("UPDATE JobRun SET status = 'done'").run();
  const group1Before = { ...db.prepare('SELECT * FROM JobRunGroup WHERE group_number = 1').get() };
  const queueBefore = db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n;
  fs.rmSync(path.join(dir, 'fetch.log'));

  // First try: the collector hangs on Gamma (group 2) and is killed hard (no emergency heartbeat).
  const first = spawn(process.execPath, ['--import', OFFLINE_COLLECT, RUN_COLLECT, '--groups', '2'], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...env, TEST_FETCH_MODE: 'hang' },
  });
  t.after(() => { if (first.exitCode === null) first.kill('SIGKILL'); });
  let output = '';
  first.stdout.on('data', (piece) => { output += piece; });
  first.stderr.on('data', (piece) => { output += piece; });
  const exited = new Promise((resolve) => first.on('exit', resolve));
  const deadline = Date.now() + 20000;
  const fetching = () => {
    try { return db.prepare("SELECT 1 FROM JobRunCompany WHERE status = 'fetching'").get(); } catch { return false; }
  };
  while (!fetching()) {
    if (Date.now() > deadline) assert.fail(`group 2 never started fetching:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const groupPid = Number(output.match(/Group 2: process (\d+) started/)[1]);
  first.kill('SIGKILL');
  await exited;
  for (let waited = 0; isProcessAlive(groupPid) && waited < 5000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(isProcessAlive(groupPid), false, 'the group process stopped when its runner died');
  const crashed = db.prepare('SELECT status, owner_pid FROM JobRun').get();
  assert.equal(crashed.status, 'running');
  db.prepare("UPDATE JobRunGroup SET crashes_in_a_row = 2, last_error = 'exit 1: boom' WHERE group_number = 2").run();

  // The restart (as the orchestrator does it: the same command line, --groups 2).
  const result = runCollector(env, ['--groups', '2']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /its collector had stopped, so those groups start again from the beginning/);
  const run = db.prepare('SELECT status, owner_pid FROM JobRun').get();
  assert.deepEqual([run.status, run.owner_pid], ['collected', null]);
  const group2 = db.prepare('SELECT status, crashes_in_a_row, last_error FROM JobRunGroup WHERE group_number = 2').get();
  assert.deepEqual([group2.status, group2.crashes_in_a_row, group2.last_error], ['complete', 0, null], 'reset, then finished');
  const statuses = db.prepare("SELECT status FROM JobRunCompany WHERE group_number = 2").all().map((row) => row.status);
  assert.deepEqual(statuses, ['finished', 'finished']);
  assert.deepEqual(fetches().map(([, name]) => name), ['Gamma', 'Gamma', 'Delta'], 'group 2 again from its start; no other group');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n, queueBefore, 'articles collected before stay; duplicates skipped');
  assert.deepEqual({ ...db.prepare('SELECT * FROM JobRunGroup WHERE group_number = 1').get() }, group1Before, 'group 1 untouched');
});

test('--groups 2 on a done run: only group 2 is fetched again, same 90 days, duplicates dropped, other groups untouched', (t) => {
  const { db, env, fetches, dir } = setUp(t);
  assert.equal(runCollector(env).status, 0);
  db.prepare("UPDATE JobRun SET status = 'done', relevant_count = 7").run(); // as the classifier leaves it
  db.prepare("UPDATE JobRunGroup SET exported_at = '2026-01-01T00:00:00.000Z'").run();
  const before = { ...db.prepare('SELECT started_at FROM JobRun').get() };
  const group1Before = { ...db.prepare('SELECT * FROM JobRunGroup WHERE group_number = 1').get() };
  const queueBefore = db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n;
  fs.rmSync(path.join(dir, 'fetch.log'));

  const beyond = runCollector(env, ['--groups', '2,4']);
  assert.equal(beyond.status, 3, beyond.stderr);
  assert.match(beyond.stderr, /there is no group 4/);
  assert.equal(db.prepare('SELECT status FROM JobRun').get().status, 'done', 'a refused re-run changes nothing');

  const result = runCollector(env, ['--groups', '2']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Re-running group\(s\) 2 of run 1 \(same 90 days/);
  assert.deepEqual(fetches().map(([, name]) => name), ['Gamma', 'Delta']);
  const run = db.prepare('SELECT started_at, status, relevant_count FROM JobRun').get();
  assert.deepEqual([run.started_at, run.status, run.relevant_count], [before.started_at, 'collected', 7], 'same window; counters keep adding up');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n, queueBefore, 'the same articles again: all dropped as duplicates');
  assert.match(result.stdout, /Group 2 done: 2 finished, 0 failed \(of 2\)/);
  assert.match(result.stdout, /skipped \(already stored\): +4/);
  assert.deepEqual({ ...db.prepare('SELECT * FROM JobRunGroup WHERE group_number = 1').get() }, group1Before, 'group 1 untouched');
  const group2 = db.prepare('SELECT status, exported_at FROM JobRunGroup WHERE group_number = 2').get();
  assert.deepEqual([group2.status, group2.exported_at], ['complete', null], 'group 2 will be exported again');
});

// ---------- Log files (D92, D93) ----------

// The lines of one log file of the test's logs folder, without their date and time.
function logLines(dbPath, folder, file) {
  const text = fs.readFileSync(path.join(testLogsDir(dbPath), folder, file), 'utf8');
  const lines = text.trimEnd().split('\n');
  for (const line of lines) assert.match(line, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} /, 'every line has the date and time');
  return lines.map((line) => line.slice(24));
}

test('log files: collector.log (runner) and one group-N.log per group in logs/run-1/, lean, with the seed lines held until the run was known', (t) => {
  const { dbPath, env } = setUp(t);
  const result = runCollector(env, [], { TEST_BAD_REQUEST_COMPANY: 'Gamma' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(testLogsDir(dbPath)), ['run-1']);
  assert.deepEqual(fs.readdirSync(path.join(testLogsDir(dbPath), 'run-1')).sort(),
    ['collector.log', 'group-1.log', 'group-2.log', 'group-3.log']);

  const collector = logLines(dbPath, 'run-1', 'collector.log');
  assert.match(collector[0], /^Seed done: 6 companies/, 'the line from before the run is first');
  assert.ok(collector.includes('Started run 1 (3 groups).'));
  assert.ok(collector.some((line) => /Group 2 of 3 \(companies 3–4\): 2\/2 done · group complete\./.test(line)));
  assert.ok(collector.includes('Companies failed: [Gamma]'), 'the end log');
  assert.ok(!collector.some((line) => /Company \d\/\d|Google error for/.test(line)), 'group lines are not in collector.log');

  const group2 = logLines(dbPath, 'run-1', 'group-2.log');
  assert.equal(group2.filter((line) => /^WARNING: Google error for Gamma: .*HTTP 400/.test(line)).length, 2, 'every Google retry');
  assert.ok(group2.some((line) => /^ERROR: Gamma: Google rejected the search/.test(line)));
  assert.ok(group2.some((line) => /^Company 2\/2 Delta: finished · 1 window · 2 new, 0 duplicates · \d+ s$/.test(line)));
  assert.ok(!group2.some((line) => /· fetching ·|· waiting ·|queue \d/.test(line)), 'no progress lines');
  assert.doesNotMatch(result.stdout + result.stderr, /Company 2\/2 Delta: finished/, 'the terminal output is unchanged');
});

test('log files: a collector that refuses before having a run writes its lines to logs/no-run/ (no run exists)', (t) => {
  const { dbPath, env } = setUp(t);
  const result = runCollector(env, ['--groups', '1']);
  assert.equal(result.status, 3, result.stderr);
  const lines = logLines(dbPath, 'no-run', 'collector.log');
  assert.ok(lines.some((line) => /^ERROR: There is no run yet/.test(line)));
});

// ---------- Clean-up when a new run starts (D94) ----------

test('D94: a new run removes the old run (rows and log folders, also no-run/), keeps the articles, and says so', (t) => {
  const { db, dbPath, env } = setUp(t);
  assert.equal(runCollector(env).status, 0);
  db.prepare("UPDATE JobRun SET status = 'done'").run();
  fs.mkdirSync(path.join(testLogsDir(dbPath), 'no-run'), { recursive: true });
  fs.writeFileSync(path.join(testLogsDir(dbPath), 'no-run', 'classifier.log'), 'old\n');
  const articles = db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n;

  const result = runCollector(env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(db.prepare('SELECT id FROM JobRun').all().map((row) => row.id), [2]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM JobRunCompany WHERE run_id <> 2').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM BufferQueue').get().n, articles, 'articles are kept (repeats skipped)');
  assert.deepEqual(fs.readdirSync(testLogsDir(dbPath)), ['run-2']);
  assert.ok(logLines(dbPath, 'run-2', 'collector.log').includes('New run 2: removed 1 old run and its logs.'));
  assert.match(result.stdout, /New run 2: removed 1 old run and its logs\./);
});

test('D94: a stale folder with the new run\'s number (from an earlier database) is emptied first', (t) => {
  const { dbPath, env } = setUp(t);
  fs.mkdirSync(path.join(testLogsDir(dbPath), 'run-1'), { recursive: true });
  fs.writeFileSync(path.join(testLogsDir(dbPath), 'run-1', 'collector.log'), '2026-01-01 00:00:00.000 a stale line\n');
  fs.writeFileSync(path.join(testLogsDir(dbPath), 'run-1', 'group-9.log'), 'stale\n');
  assert.equal(runCollector(env).status, 0);
  const collector = logLines(dbPath, 'run-1', 'collector.log');
  assert.ok(!collector.some((line) => /stale/.test(line)));
  assert.match(collector[0], /^Seed done/);
  assert.ok(!fs.existsSync(path.join(testLogsDir(dbPath), 'run-1', 'group-9.log')));
});

test('D94: a --groups re-run removes nothing: same run, same folder, lines added', (t) => {
  const { db, dbPath, env } = setUp(t);
  assert.equal(runCollector(env).status, 0);
  db.prepare("UPDATE JobRun SET status = 'done'").run();
  const result = runCollector(env, ['--groups', '2']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM JobRun').get().n, 1);
  const collector = logLines(dbPath, 'run-1', 'collector.log');
  assert.equal(collector.filter((line) => /^Seed done/.test(line)).length, 2, 'both collections in one file');
  assert.deepEqual(collector.filter((line) => /^New run/.test(line)), ['New run 1: no old runs to remove.'], 'only from the first, new run');
});
