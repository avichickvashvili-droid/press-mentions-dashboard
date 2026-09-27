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
    // Assumed path; the classifier's entry file is not final yet (to be confirmed).
    entry: 'src/classifier/runClassifier.js',
    npmScript: 'classifier',
    policy: 'always',
  },
  // Later: { name: 'api', entry: 'src/api/runApi.js', npmScript: 'api', policy: 'always' },
];
