// groupsOption.test.js — `npm start -- --groups 2,5` on the orchestrator's side (D87): reading
// the option (src/shared/groupsOption.js), checking it against the latest run
// (checkGroupsRequest in collectionCheck.js), the collector started with the option even when the
// collection is complete (servicesFor in services.js, serviceProcess.js), and the real
// orchestrator refusing bad input with exit 3 before anything starts. Offline, temporary files;
// no service is really started (no Google, no Ollama).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readGroupsOption } from '../../src/shared/groupsOption.js';
import { checkGroupsRequest } from '../../src/supervisor/collectionCheck.js';
import { SERVICES, servicesFor } from '../../src/supervisor/services.js';
import { startServiceProcess } from '../../src/supervisor/serviceProcess.js';
import { acquireRun } from '../../src/collector/jobLock.js';
import { config } from '../../src/config.js';
import { makeTempDb, makeTempDir, testLogsDir } from '../helpers.js';
import { FIXTURES_DIR, createCaptureStream, waitForExit } from './testTools.js';

const RUN_SUPERVISOR = path.join(config.PROJECT_ROOT, 'src', 'supervisor', 'runSupervisor.js');

// A database with one run of 6 companies in 3 groups (groups of 2).
function dbWithThreeGroups(t) {
  const { db, dbPath } = makeTempDb(t);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (const id of ids) db.prepare("INSERT INTO Company (id, name, section, query_param) VALUES (?, ?, 1, 'q')").run(id, id.toUpperCase());
  acquireRun(db, ids, { pid: 1, groupSize: 2 });
  return { db, dbPath };
}

test('readGroupsOption: absent, good values, and bad values with a clear message', () => {
  assert.deepEqual(readGroupsOption([]), { groups: null });
  assert.deepEqual(readGroupsOption(['--groups', '2,5']), { groups: [2, 5] });
  assert.deepEqual(readGroupsOption(['--groups=5, 2,2']), { groups: [2, 5] });
  for (const args of [['--groups'], ['--groups', ''], ['--groups', '--other'], ['--groups', 'abc'], ['--groups', '0'], ['--groups', '2,,5'], ['--groups', '1.5'], ['--groups', '-1']]) {
    const result = readGroupsOption(args);
    assert.ok(result.error, `${JSON.stringify(args)} should be refused`);
    assert.match(result.error, /--groups/);
    assert.match(result.error, /Example: npm start -- --groups 2,5/);
  }
});

test('checkGroupsRequest: no database / no run -> refused; a group bigger than the last one -> refused; existing groups -> ok', (t) => {
  const dir = makeTempDir(t);
  assert.match(checkGroupsRequest([1], { dbPath: path.join(dir, 'none.sqlite') }).reason, /There is no run yet/);
  const { dbPath } = dbWithThreeGroups(t);
  assert.deepEqual(checkGroupsRequest([1, 3], { dbPath }), { ok: true });
  const tooBig = checkGroupsRequest([2, 4, 9], { dbPath });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.reason, /run 1 has groups 1 to 3; there is no group 4, 9/);
});

test('servicesFor: a normal start is unchanged; with --groups the collector gets the option and is started even when the collection is complete', async () => {
  assert.equal(servicesFor(), SERVICES);
  const services = servicesFor({ groups: [2, 5] });
  const collector = services.find((service) => service.name === 'collector');
  assert.deepEqual(collector.args, ['--groups', '2,5']);
  assert.deepEqual(await collector.checkBeforeStart(), { start: true, reason: 'Re-running group(s) 2,5 of the last run (--groups).' });
  const classifier = services.find((service) => service.name === 'classifier');
  assert.equal(classifier, SERVICES.find((service) => service.name === 'classifier'), 'the classifier is not changed');
});

test('a service\'s args reach its process', async () => {
  const out = createCaptureStream();
  const handle = startServiceProcess({ name: 'fake', entry: 'print-args.mjs', args: ['--groups', '2,5'] }, { projectRoot: FIXTURES_DIR, out, err: out });
  const result = await waitForExit(handle);
  assert.equal(result.code, 0);
  assert.match(out.text(), /\[fake\] args: --groups 2,5/);
});

test('the real orchestrator refuses bad --groups with exit 3 and starts nothing', (t) => {
  const { dbPath } = dbWithThreeGroups(t);
  for (const [args, message] of [
    [['--groups', 'abc'], /"abc" is not a group number/],
    [['--groups', '0'], /"0" is not a group number/],
    [['--groups', '4'], /there is no group 4/],
  ]) {
    const result = spawnSync(process.execPath, [RUN_SUPERVISOR, ...args], { encoding: 'utf8', timeout: 30000, env: { ...process.env, DB_PATH: dbPath, LOGS_DIR: testLogsDir(dbPath) } });
    assert.equal(result.status, 3, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, message);
    assert.match(result.stderr, /Nothing was started\./);
    assert.doesNotMatch(result.stdout, /Starting/);
  }
  // D92: the orchestrator's lines also went to its log file, in the latest run's folder (run 1).
  const file = fs.readFileSync(path.join(testLogsDir(dbPath), 'run-1', 'orchestrator.log'), 'utf8');
  assert.equal(file.match(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} ERROR: Nothing was started\.$/gm).length, 3);
  assert.doesNotMatch(file, /\[orchestrator\]/, 'no terminal label in the file');
});
