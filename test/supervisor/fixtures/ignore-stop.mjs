// ignore-stop.mjs — fake service for the orchestrator tests: never connects to the orchestrator
// and ignores stop requests (a hung service). Only a force-kill ends it.
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
console.log('READY');
