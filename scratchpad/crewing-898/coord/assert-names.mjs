// Refactor oracle: the normalised SET and the COUNT of a harness run's assert names.
//
// Why both: the set is blind to multiplicity (two asserts of one name read as one) and the
// count is blind to substitution (one name swapped for another keeps the total). Neither alone
// is an oracle for "the same checks still run".
//
// Normalisation, and exactly what it exists for: four asserts interpolate VOLATILE byte offsets
// into their NAME, so their names change whenever `dist` changes even though the check does not:
//   harness:562  control: both dictionary regions are locatable — SETTINGS_I18N at N, ru at N
//   harness:573  control: both regions are substantial — en N B, ru N B
//   harness:709  control: both containers present and ordered — doors at N, form at N
//   harness:712  No.894: the caption sits INSIDE the doors container … note N between N and N
// Runs of FOUR OR MORE digits collapse to `N`. Four or more, not any run, because real names
// carry short numbers that MUST stay distinguishing: `No.898`, `No.894`, `lib.rs:141`,
// `native_fresh.rs:55,64`, `depth 5`. Collapsing those would merge different checks.
//
// This normalisation is a DEBT, not a design: the four asserts should carry their offsets after
// ` :: ` like the rest of the file, and then this can go. Fixing one of the four and dropping it
// would be worse than keeping it — the other three would read as changed on every dist edit.
//
// Diffing two runs: pass BOTH logs and the oracle reports lost/gained itself. Never diff the
// --list outputs with `comm`: JS `sort()` orders by UTF-16 code unit, `comm` expects the shell's
// LC_COLLATE order, and on a mismatch comm prints a warning and an answer that is not a set
// difference. Measured here: comm said "file 1 is not in sorted order" and still printed rows.
//
// Usage: node coord/assert-names.mjs <log> [--list]
//        node coord/assert-names.mjs <before.log> <after.log> --diff
import fs from "fs";
function readNames(log) {
  const names = [];
  for (const l of fs.readFileSync(log, "utf8").split("\n")) {
    const m = l.match(/^(?:PASS|FAIL) (.*)$/);
    if (m) names.push(m[1].replace(/ :: .*$/, "").replace(/\d{4,}/g, "N"));
  }
  if (names.length === 0) { console.error("REFUSE: no PASS/FAIL lines in " + log); process.exit(3); }
  return names;
}
const args = process.argv.slice(2);
if (args.includes("--diff")) {
  const [a, b] = args.filter((x) => !x.startsWith("--"));
  const A = readNames(a), B = readNames(b);
  const sa = new Set(A), sb = new Set(B);
  const lost = [...sa].filter((n) => !sb.has(n)).sort();
  const gained = [...sb].filter((n) => !sa.has(n)).sort();
  console.log(JSON.stringify({ count_before: A.length, count_after: B.length,
    unique_before: sa.size, unique_after: sb.size,
    lost: lost.length, gained: gained.length }, null, 0));
  for (const n of lost) console.log("LOST   " + n);
  for (const n of gained) console.log("GAINED " + n);
  process.exit(lost.length === 0 ? 0 : 4);
}
const [log, flag] = args;
const names = readNames(log);
const set = [...new Set(names)].sort();
console.log(JSON.stringify({ count: names.length, unique: set.length,
  duplicated: names.length - set.length }, null, 0));
if (flag === "--list") for (const n of set) console.log(n);
