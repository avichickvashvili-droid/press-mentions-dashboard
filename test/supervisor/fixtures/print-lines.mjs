// print-lines.mjs — fake service for the orchestrator tests: writes lines to both outputs,
// including a Windows line end and a last line without a line end, then exits 0.
process.stdout.write('first line\nsecond ');
process.stdout.write('line\r\n');
process.stderr.write('an error line\n');
process.stdout.write('last line without end');
