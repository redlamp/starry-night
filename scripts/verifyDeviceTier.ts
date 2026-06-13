/**
 * Regression check for lib/perf/deviceTier.ts — the suggestTier heuristic picks
 * the expected quality tier for known GPU renderer strings (Apple/Retina → med,
 * discrete → high, integrated → med, mobile → low).
 *   bun run scripts/verifyDeviceTier.ts
 */
import { suggestTier } from "@/lib/perf/deviceTier";

const cases: Array<{ r: string | null; dpr: number; cores: number; want: string }> = [
  { r: "Apple M1", dpr: 2, cores: 8, want: "med" }, // the iMac
  { r: "Apple M2 Pro", dpr: 2, cores: 12, want: "med" },
  { r: "Apple M1", dpr: 1, cores: 8, want: "high" }, // external 1080p display
  { r: "ANGLE (NVIDIA GeForce RTX 4070 Direct3D11)", dpr: 1, cores: 16, want: "high" },
  { r: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)", dpr: 1.5, cores: 8, want: "med" },
  { r: "ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11)", dpr: 1, cores: 24, want: "high" },
  { r: "Mali-G78", dpr: 3, cores: 8, want: "low" },
  { r: "Adreno (TM) 730", dpr: 2.75, cores: 8, want: "low" },
  { r: null, dpr: 2, cores: 4, want: "med" }, // unknown + hi-dpi -> conservative
  { r: null, dpr: 1, cores: 8, want: "high" },
];

let fail = 0;
for (const c of cases) {
  const { tier, cls, reason } = suggestTier({ renderer: c.r, dpr: c.dpr, cores: c.cores });
  const ok = tier === c.want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${(c.r ?? "(null)").slice(0, 44).padEnd(44)} dpr${c.dpr} -> ${cls}/${tier} (want ${c.want})  | ${reason}`);
}
console.log(`\n${fail === 0 ? "DEVICE-TIER: PASS" : `DEVICE-TIER: FAIL (${fail})`}`);
process.exit(fail === 0 ? 0 : 1);
