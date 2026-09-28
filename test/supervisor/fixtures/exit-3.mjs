// exit-3.mjs — fake service for the orchestrator tests: refuses to start, nothing wrong (exit 3).
console.error('another collection holds the lock');
process.exitCode = 3;
