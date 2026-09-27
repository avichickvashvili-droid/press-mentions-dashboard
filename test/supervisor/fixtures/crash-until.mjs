// crash-until.mjs — fake service for the orchestrator tests: crashes (exit 1) the first N times
// it is started, then finishes normally (exit 0). It counts its starts in a small text file.
// Reads/writes: the file named by FAKE_COUNTER_FILE; N comes from FAKE_CRASHES.
import fs from 'node:fs';

const counterFile = process.env.FAKE_COUNTER_FILE;
const crashes = Number(process.env.FAKE_CRASHES ?? 2);
const starts = (fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) : 0) + 1;
fs.writeFileSync(counterFile, String(starts));
if (starts <= crashes) {
  console.error(`start ${starts}: crashing on purpose`);
  process.exit(1);
}
console.log(`start ${starts}: finished`);
