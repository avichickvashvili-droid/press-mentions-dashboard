// crash.mjs — fake service for the orchestrator tests: crashes at once with an uncaught error (exit 1).
throw new Error('fake service crashed on purpose');
