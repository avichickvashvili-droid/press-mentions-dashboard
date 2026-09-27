// link-no-handler.mjs — fake service for the orchestrator tests: connected to the orchestrator
// but with no stop handler of its own (like a service before it took its lock). A stop request
// must still end it, with the stop code 143.
import { connectToSupervisor } from '../../../src/supervisor/serviceLink.js';

connectToSupervisor();
setInterval(() => {}, 1000);
console.log('READY');
