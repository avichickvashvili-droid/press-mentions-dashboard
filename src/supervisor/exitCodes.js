// exitCodes.js — what each service's exit code means to the orchestrator (D68).
//
// Where it sits: read by the orchestrator (supervisor) when a service process ends, to decide
// whether to restart it. The services (collector, classifier, later the api) end with these
// codes so the orchestrator can tell "done" from "crashed".
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
