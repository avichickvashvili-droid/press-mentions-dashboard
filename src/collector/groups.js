// groups.js — splits the companies of a run into groups (D83).
//
// Where it sits: used by jobLock.js when a NEW run starts: the run's companies are split into
// groups of about config.GROUP_TARGET_SIZE (25), each company's group number is stored in
// JobRunCompany, and one JobRunGroup row is made per group. The groups are then collected one
// after another, each in its own process (runGroup.js).
// Reads/writes: nothing (pure functions, easy to test).
//
// The rule (D83, owner answer in Prompt 186):
//   - number of groups = companies / 25, rounded to the nearest whole number, at least 1;
//   - the groups are as equal as possible and keep the list order; when the companies don't
//     divide evenly, the FIRST groups get one extra company each.
// Examples: 258 companies -> 10 groups: groups 1-8 have 26, groups 9-10 have 25
//   (group 1 = companies 1-26, group 2 = 27-52, ..., group 9 = 209-233, group 10 = 234-258);
//   100 -> 4 groups of 25; 40 -> 2 groups of 20; 24 or 7 -> 1 group.

// How many groups `companyCount` companies are split into, for groups of about `targetSize`.
// Returns 0 only when there are no companies at all.
// Throws if targetSize is not a whole number of at least 1 (a wrong setting in config.js).
export function groupCountFor(companyCount, targetSize) {
  if (!Number.isInteger(targetSize) || targetSize < 1) {
    throw new Error(`The group size must be a whole number of at least 1 (got ${targetSize}). Check GROUP_TARGET_SIZE in src/config.js.`);
  }
  if (companyCount === 0) return 0;
  return Math.max(1, Math.round(companyCount / targetSize));
}

// Splits `items` (in list order) into groups of about `targetSize`, as described above.
// Returns a list of groups; each group is a non-empty list of items, in the original order.
export function splitIntoGroups(items, targetSize) {
  const count = groupCountFor(items.length, targetSize);
  const groups = [];
  if (count === 0) return groups;
  const baseSize = Math.floor(items.length / count);
  const groupsWithExtra = items.length % count; // the first groups get one extra company
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const size = baseSize + (index < groupsWithExtra ? 1 : 0);
    groups.push(items.slice(start, start + size));
    start += size;
  }
  return groups;
}
