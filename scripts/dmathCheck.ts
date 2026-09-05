/**
 * Accuracy + cross-engine parity check for lib/seed/dmath.ts.
 *
 *   bun run scripts/dmathCheck.ts
 *   bunx tsx scripts/dmathCheck.ts
 *
 * (a) Compares each dmath function against its native Math.* counterpart over
 *     1e6 seeded random inputs and reports max abs/rel error.
 * (b) Prints a hash of every dmath output's bit pattern (via toString(), which
 *     round-trips a double's exact value). Diff that hash between a `bun` run
 *     and a `bunx tsx` run of this same script: it should be IDENTICAL, which
 *     is the whole point of dmath — proving the approximation itself doesn't
 *     inherit the V8-vs-JSC drift it exists to route around. The max abs/rel
 *     error numbers are expected to be identical too (both engines run the
 *     same +,-,*,/,sqrt,floor,abs — all exact/correctly-rounded per spec) but
 *     are reported against the input's native Math.* value, which is exactly
 *     the value that IS allowed to differ between engines.
 */
import seedrandom from "seedrandom";
import { dsin, dcos, datan2, dexp, dhypot } from "@/lib/seed/dmath";

const N = 1_000_000;
const rng = seedrandom("dmath-check");

// FNV-1a 32-bit, same algorithm as scripts/cityGolden.ts's hash().
function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function check(name: string, sample: () => { approx: number; exact: number }) {
  let maxAbs = 0;
  let maxRel = 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < N; i++) {
    const { approx, exact } = sample();
    const abs = Math.abs(approx - exact);
    if (abs > maxAbs) maxAbs = abs;
    // Skip the relative-error check near zero (dexp's -37 clamp included) —
    // a tiny absolute difference near 0 is a huge, meaningless relative one.
    if (Math.abs(exact) > 1e-6) {
      const rel = abs / Math.abs(exact);
      if (rel > maxRel) maxRel = rel;
    }
    hash = fnv(hash, approx.toString());
  }
  console.log(
    `${name.padEnd(8)} maxAbs=${maxAbs.toExponential(3)}  maxRel=${maxRel.toExponential(3)}  hash=${hash.toString(16).padStart(8, "0")}`,
  );
}

console.log(`dmath accuracy + parity check — ${N.toLocaleString()} samples\n`);

check("dsin", () => {
  const x = (rng() - 0.5) * 200; // [-100, 100], well past real call-site ranges (|x| < ~15)
  return { approx: dsin(x), exact: Math.sin(x) };
});
check("dcos", () => {
  const x = (rng() - 0.5) * 200;
  return { approx: dcos(x), exact: Math.cos(x) };
});
check("datan2", () => {
  const z = (rng() - 0.5) * 2000;
  const x = (rng() - 0.5) * 2000;
  return { approx: datan2(z, x), exact: Math.atan2(z, x) };
});
check("dexp", () => {
  // Real call sites only ever pass <= 0 (Gaussian falloff); sample that range.
  const x = -rng() * 40;
  return { approx: dexp(x), exact: Math.exp(x) };
});
check("dhypot", () => {
  const a = (rng() - 0.5) * 10000;
  const b = (rng() - 0.5) * 10000;
  return { approx: dhypot(a, b), exact: Math.hypot(a, b) };
});
