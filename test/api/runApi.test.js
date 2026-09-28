// runApi.test.js — the real `npm run api` program (src/api/runApi.js) started as its own process
// on a temporary database: it answers on its port, and a port that is already taken gives a clear
// message and exit code 1. The temporary database gets a JobRun row first, so it is not empty
// and the real data/ folder is never imported in these tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeApiDb, addCompanies } from './apiHelpers.js';
import { config } from '../../src/config.js';

const RUN_API = path.join(config.PROJECT_ROOT, 'src', 'api', 'runApi.js');

// Opens a server on a free port, on every address like the api does (to keep the port busy,
// or to learn a free one), and returns it.
function occupyFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => resolve(server));
  });
}

// Starts runApi.js with the given database and port. Collects its output.
function startRunApi(dbPath, port) {
  const child = spawn(process.execPath, [RUN_API], {
    cwd: config.PROJECT_ROOT,
    env: { ...process.env, DB_PATH: dbPath, API_PORT: String(port) },
  });
  child.output = '';
  child.stdout.on('data', (chunk) => { child.output += chunk; });
  child.stderr.on('data', (chunk) => { child.output += chunk; });
  child.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return child;
}

// A temporary database that is not empty (a JobRun row), with one company.
function prepareDb(t) {
  const context = makeApiDb(t);
  addCompanies(context.db, [{ id: 'harvey', name: 'Harvey' }]);
  context.db.prepare("INSERT INTO JobRun (started_at, status, last_heartbeat) VALUES ('x', 'done', 'x')").run();
  return context;
}

test('a port that is already taken: a clear message and exit code 1', { timeout: 20000 }, async (t) => {
  const { dbPath } = prepareDb(t);
  const busy = await occupyFreePort();
  t.after(() => busy.close());
  const port = busy.address().port;
  const child = startRunApi(dbPath, port);
  t.after(() => child.kill());
  const code = await child.exited;
  assert.equal(code, 1);
  assert.match(child.output, new RegExp(`port ${port} is busy`));
  assert.match(child.output, /API_PORT/);
});

test('the program starts, answers /api/companies from the database, and prints its address', { timeout: 20000 }, async (t) => {
  const { dbPath, onCleanup } = prepareDb(t);
  const probe = await occupyFreePort();
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = startRunApi(dbPath, port);
  onCleanup(async () => { child.kill(); await child.exited; });

  const deadline = Date.now() + 15000;
  while (!child.output.includes('Dashboard: http://localhost') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(child.output, new RegExp(`Dashboard: http://localhost:${port}`));
  const response = await fetch(`http://127.0.0.1:${port}/api/companies`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.companies));
  assert.ok(body.asOf);
});
