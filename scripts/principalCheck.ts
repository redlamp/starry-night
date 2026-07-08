// One-off: assert no school has more than one School Principal.
// Run: bun scripts/principalCheck.ts [seed]
import { buildPersonaDirectory } from "../lib/seed/personas";

const seed = process.argv[2] ?? "starry-night";
const dir = buildPersonaDirectory(seed, "auto", 1);
let schools = 0;
let principals = 0;
let worst = 0;
for (const biz of dir.businesses.values()) {
  if (biz.kind !== "school") continue;
  schools++;
  const n = biz.employeeIds.filter(
    (pid) => dir.personas.get(pid)?.profession?.title === "School Principal",
  ).length;
  principals += n;
  worst = Math.max(worst, n);
  if (n > 1) console.log(`  VIOLATION: ${biz.name} has ${n} principals`);
}
console.log(`schools: ${schools}, principals: ${principals}, max per school: ${worst}`);
if (worst > 1) {
  console.log("FAIL");
  process.exit(1);
}
console.log("PASS — at most one principal per school");
