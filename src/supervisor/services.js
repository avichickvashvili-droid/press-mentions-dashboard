// services.js — the list of services the orchestrator (`npm start`) runs (D66).
//
// Where it sits: read by runSupervisor.js at start-up. Each entry is one separate Node process.
// To add a service (e.g. the api later), add one entry here.
// Reads/writes: nothing (the collector's start check reads the database, see collectionCheck.js).
//
// Fields of each service:
//   name       the label shown in front of its output, e.g. [collector]
//   entry      its start file, relative to the project folder. It is started as
//              `node --env-file-if-exists=.env <entry>`, the same line as its npm script
//   npmScript  the npm script that runs the same service alone (checked by a test)
//   policy     'once'   = a one-shot job: exit 0 means "done", do not restart
//              'always' = always on: any exit the orchestrator did not ask for is a crash
//   checkBeforeStart (optional) decides at start-up whether to launch it at all
//   args       (optional) extra command-line words for the service, e.g. ['--groups', '2,5']
//
// `npm start -- --groups 2,5` (D87): servicesFor({ groups: [2, 5] }) gives the same list, but the
// collector gets `--groups 2,5` and is started even though the collection is complete (the only
// change to D67). Every restart of the collector gets the same words.

import { checkCollectionNeeded } from './collectionCheck.js';

export const SERVICES = [
  {
    name: 'collector',
    entry: 'src/collector/runCollect.js',
    npmScript: 'collect',
    policy: 'once',
    // The 90-day collection runs once (D67): launch only if no collection has completed yet.
    checkBeforeStart: () => checkCollectionNeeded(),
  },
  {
    name: 'classifier',
    // Always on (D62): the classifier polls the queue and never ends by itself.
    entry: 'src/classifier/runClassifier.js',
    npmScript: 'classifier',
    policy: 'always',
  },
  // Later: { name: 'api', entry: 'src/api/runApi.js', npmScript: 'api', policy: 'always' },
];

// The services to run for this start. `groups` = the chosen groups of `--groups` (already
// checked), or null for a normal start (then it is exactly SERVICES).
export function servicesFor({ groups = null } = {}) {
  if (!groups) return SERVICES;
  const list = groups.join(',');
  return SERVICES.map((service) => (service.name !== 'collector' ? service : {
    ...service,
    args: ['--groups', list],
    checkBeforeStart: () => ({ start: true, reason: `Re-running group(s) ${list} of the last run (--groups).` }),
  }));
}
