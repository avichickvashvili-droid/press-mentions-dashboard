// services.test.js — checks that the orchestrator starts each service with the SAME command as
// its npm script (Q8a): `node --env-file-if-exists=.env <entry>`, and that `npm start` runs the
// orchestrator. A script that is not in package.json yet is reported as skipped, not failed.
// Reads: package.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../src/config.js';
import { SERVICES } from '../../src/supervisor/services.js';

const scripts = JSON.parse(fs.readFileSync(path.join(config.PROJECT_ROOT, 'package.json'), 'utf8')).scripts ?? {};

// Checks one npm script against the expected start file.
function checkScript(t, scriptName, entry) {
  const script = scripts[scriptName];
  if (script === undefined) {
    t.skip(`npm script "${scriptName}" is not in package.json yet`);
    return;
  }
  assert.equal(script, `node --env-file-if-exists=.env ${entry}`);
}

for (const service of SERVICES) {
  test(`${service.name}: npm run ${service.npmScript} starts the same file the orchestrator starts`, (t) => {
    checkScript(t, service.npmScript, service.entry);
  });
}

test('npm start runs the orchestrator', (t) => {
  checkScript(t, 'start', 'src/supervisor/runSupervisor.js');
});

test('every service has a name, a start file and a restart policy', () => {
  const names = new Set();
  for (const service of SERVICES) {
    assert.match(service.name, /^[a-z]+$/);
    assert.ok(!names.has(service.name), 'names are unique');
    names.add(service.name);
    assert.ok(['once', 'always'].includes(service.policy));
    assert.ok(service.entry.endsWith('.js'));
  }
});
