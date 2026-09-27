// exitCodes.js — what each program's exit code means (D68). The ONE list of exit codes.
//
// Where it sits: shared by every program. The services (collector, classifier, later the api)
// and `npm run seed` end with these codes; the orchestrator (supervisor) reads them when a
// service process ends, to decide whether to restart it, so it can tell "done" from "crashed".
// Nobody else defines exit-code numbers, so they can't drift apart.
// Reads/writes: nothing.
//
// Exit code table (plain language):
//
//   code | meaning                                   | what the orchestrator does
//   -----+-------------------------------------------+---------------------------------------------
//     0  | finished normally (e.g. collection done)  | does not restart it. Exception: a service
//        |                                           | that should always run (classifier, api)
//        |                                           | ending with 0 is unexpected = a crash
//     3  | refused to start, nothing is wrong        | logs it, does not restart it
//        | (e.g. another collection holds the lock)  |
//     1  | crashed                                   | restarts it after a growing wait
//   130  | stopped by Ctrl+C                         | expected while the orchestrator is stopping;
//   143  | stopped by a stop request (SIGTERM)       | otherwise (nobody asked) = a crash, restarted
//   any other code, or killed by the system       | = a crash, restarted

export const EXIT_CODES = Object.freeze({
  FINISHED: 0,
  CRASHED: 1,
  REFUSED: 3,
  STOPPED_BY_CTRL_C: 130,
  STOPPED_BY_REQUEST: 143,
});
