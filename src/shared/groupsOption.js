// groupsOption.js — reads the `--groups 2,5` option (D87): which groups of the latest run to
// collect again.
//
// Where it sits: shared by the orchestrator (`npm start -- --groups 2,5`, runSupervisor.js), which
// checks the option before starting anything and passes it on, and by the collector
// (runCollect.js), which also accepts it when run alone (`npm run collect -- --groups 2,5`).
// Reads/writes: nothing (a pure function over the command-line words).
//
// Accepted: `--groups 2,5` or `--groups=2,5`; whole numbers of at least 1, separated by commas
// (spaces around them are fine). A number given twice counts once; the list is sorted.
// Whether each group really exists is checked against the database by the caller.

// Looks for --groups in the command-line words (e.g. process.argv.slice(2)). Returns:
//   { groups: null }            the option is not there (a normal start)
//   { groups: [2, 5] }          the chosen groups, sorted, each once
//   { error: 'text' }           the option is there but its value is not usable (for a person)
export function readGroupsOption(args) {
  const index = args.findIndex((word) => word === '--groups' || word.startsWith('--groups='));
  if (index === -1) return { groups: null };

  const word = args[index];
  const value = word === '--groups' ? args[index + 1] : word.slice('--groups='.length);
  const example = 'Example: npm start -- --groups 2,5';
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    return { error: `--groups needs a list of group numbers. ${example}` };
  }
  const parts = value.split(',').map((part) => part.trim());
  const bad = parts.filter((part) => !/^\d+$/.test(part) || Number(part) < 1 || !Number.isSafeInteger(Number(part)));
  if (bad.length > 0) {
    return { error: `--groups: "${bad.join('", "')}" is not a group number (group numbers start at 1). ${example}` };
  }
  return { groups: [...new Set(parts.map(Number))].sort((a, b) => a - b) };
}
