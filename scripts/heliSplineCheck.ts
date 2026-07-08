// #89 v3 sanity: legs chain continuously (aB === next aA), windows tile 0..1,
// stops are hit exactly, and the tour is deterministic per seed.
import { buildHelicopters } from "../lib/seed/helicopters";

const seed = process.argv[2] ?? "starry-night";
const data1 = buildHelicopters(seed);
const data2 = buildHelicopters(seed);
let fail = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (!ok) { fail++; console.error(`FAIL ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`ok   ${name}`);
};

check("deterministic", JSON.stringify(data1) === JSON.stringify(data2));
check("pool size 10", data1.helicopters.length === 10, String(data1.helicopters.length));

let chainOk = true;
let windowsOk = true;
let hoverDirOk = true;
for (const h of data1.helicopters) {
  for (let i = 0; i < h.legs.length; i++) {
    const cur = h.legs[i];
    const next = h.legs[(i + 1) % h.legs.length];
    const dx = next.aA[0] - cur.aB[0];
    const dy = next.aA[1] - cur.aB[1];
    const dz = next.aA[2] - cur.aB[2];
    if (Math.hypot(dx, dy, dz) > 1e-6) chainOk = false;
    if (i < h.legs.length - 1 && Math.abs(next.winStart - cur.winEnd) > 1e-9) windowsOk = false;
    if (cur.kind === "hover") {
      const len = Math.hypot(cur.dir[0], cur.dir[2]);
      if (Math.abs(len - 1) > 1e-6) hoverDirOk = false;
    }
  }
  if (Math.abs(h.legs[h.legs.length - 1].winEnd - 1) > 1e-12) windowsOk = false;
}
check("legs chain continuously (closed loop)", chainOk);
check("windows tile 0..1 with no gaps", windowsOk);
check("hover dirs unit-length (carried forward)", hoverDirOk);

const legCounts = data1.helicopters.map((h) => h.legs.length);
console.log("legs per helicopter:", legCounts.join(", "));
const transit = data1.helicopters[0].legs.filter((l) => l.kind === "transit").length;
console.log(`heli[0]: ${transit} transit legs, ${data1.helicopters[0].legs.length - transit} hover, cycle ${Math.round(data1.helicopters[0].cycleSec)}s`);

console.log(fail === 0 ? "PASS" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
