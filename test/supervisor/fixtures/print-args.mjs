// print-args.mjs — fake service for the orchestrator tests: prints the command-line words it was
// started with (after its own file name), then exits 0. Used to check that a service's `args`
// (e.g. the collector's `--groups 2,5`, D87) reach it.
console.log(`args: ${process.argv.slice(2).join(' ')}`);
