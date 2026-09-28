// send-messages.mjs — fake service for the orchestrator tests: connects like a real service,
// tells the orchestrator which run it works on and sends one system-log line (D93), then ends.
import { connectToSupervisor, sendEvent, sendToSupervisor } from '../../../src/supervisor/serviceLink.js';

connectToSupervisor();
sendToSupervisor({ type: 'run', runId: 7 });
sendEvent('Run 7 started: 6 companies in 3 groups');
console.log('sent');
