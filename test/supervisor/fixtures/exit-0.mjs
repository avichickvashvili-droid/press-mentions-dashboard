// exit-0.mjs — fake service for the orchestrator tests: prints one line and finishes normally (exit 0).
console.log('working');
process.exitCode = 0;
