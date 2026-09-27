// link-one-shot.mjs — fake one-shot job for the orchestrator tests: connected to the orchestrator,
// does a little work and must then exit BY ITSELF (the message channel must not keep it alive).
import { connectToSupervisor } from '../../../src/supervisor/serviceLink.js';

const connected = connectToSupervisor();
setTimeout(() => console.log(`done (connected: ${connected})`), 50);
