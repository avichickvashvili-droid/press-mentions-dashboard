// systemLog.js — decides where the orchestrator's system log (orchestrator.log) goes, and
// handles the messages the services send for it (D92, D93).
//
// Where it sits: used by runSupervisor.js (`npm start`). orchestrator.log is the story of the
// whole run in a few lines: the orchestrator's own lines (service start / stop / restart /
// give-up) plus the event lines the services send, e.g.
//   Run 1 started: 258 companies in 10 groups, 2026-06-30 to 2026-09-27
//   Group 2 done (26/26 finished) → starting group 3 of 10 (companies 53–78)
//   Queue full (10,000): collector waiting for the LLM
//   Run 1 done, data/ written: 1,234 mentions
// Reads: the services' messages, and (read-only) the latest JobRun when the folder must be
// guessed. Writes: nothing itself (the log file does).
//
// Which folder: the orchestrator starts before the run is known, so its lines are held until:
//   - the collector says which run it works on ({ type: 'run', runId }) -> logs/run-<id>/, or
//   - settle() is called (the collector is not started, or ended without saying, or the
//     orchestrator ends) -> the latest run's folder, or logs/no-run/ when there is no run.
// A later { type: 'run' } message moves the next lines to that run's folder.

import { config } from '../config.js';
import { runFolderName } from '../shared/logFile.js';
import { latestRunFolder } from '../shared/runLogs.js';

// Creates the folder keeper for orchestrator.log. `logFile` = createLogFile('orchestrator.log'),
// `log` = the orchestrator's logger (its event() writes to the file only).
// Returns { onServiceMessage(message), settle() }.
export function createSystemLog({ logFile, log, findLatestFolder = () => latestRunFolder() }) {
  return {
    // Handles one message from a service. Unknown or broken messages are ignored.
    onServiceMessage(message) {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'run' && Number.isSafeInteger(message.runId) && message.runId >= 1) {
        logFile.setFolder(runFolderName(message.runId));
      } else if (message.type === 'event' && typeof message.text === 'string') {
        log.event(message.text);
      }
    },
    // Gives the held lines a folder if none is known yet (never throws).
    settle() {
      try {
        if (logFile.folder() !== null) return;
        let folder = null;
        try {
          folder = findLatestFolder();
        } catch {
          folder = null;
        }
        logFile.setFolder(folder ?? config.LOG_NO_RUN_FOLDER);
      } catch {
        // logging must never stop the orchestrator
      }
    },
  };
}
