/**
 * Regression check for lib/perf/deviceTier.ts — the layered suggestTier heuristic
 * picks the expected quality tier across renderer strings + form factors
 * (Apple/Retina → med, discrete → high, integrated → med, mobile/coarse → low,
 * masked renderer → platform tie-breakers). (#53)
 *   bun run scripts/verifyDeviceTier.ts
 */
import { suggestTier, type DeviceCaps } from "@/lib/perf/deviceTier";

// A capable desktop platform baseline; override per case.
const desktop = (over: Partial<DeviceCaps>): DeviceCaps => ({
  renderer: null,
  webgl2: true,
  maxTextureSize: 16384,
  cores: 8,
  deviceMemory: 16,
  coarsePointer: false,
  mobileUA: false,
  ...over,
});

const cases: Array<{ label: string; caps: DeviceCaps; dpr: number; want: string }> = [
  {
    label: "Apple M1 (iMac, Retina)",
    caps: desktop({ renderer: "Apple M1" }),
    dpr: 2,
    want: "med",
  },
  {
    label: "Apple M2 Pro (Retina)",
    caps: desktop({ renderer: "Apple M2 Pro", cores: 12 }),
    dpr: 2,
    want: "med",
  },
  {
    label: "Apple M1 (1080p external)",
    caps: desktop({ renderer: "Apple M1" }),
    dpr: 1,
    want: "high",
  },
  {
    label: "RTX 4070",
    caps: desktop({ renderer: "ANGLE (NVIDIA GeForce RTX 4070 Direct3D11)", cores: 16 }),
    dpr: 1,
    want: "high",
  },
  {
    label: "Iris Xe",
    caps: desktop({ renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)" }),
    dpr: 1.5,
    want: "med",
  },
  {
    label: "Radeon RX 6800 XT",
    caps: desktop({ renderer: "ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11)", cores: 24 }),
    dpr: 1,
    want: "high",
  },
  // Mobile GPUs — renderer class catches them even without the form-factor flags.
  { label: "Mali-G78", caps: desktop({ renderer: "Mali-G78" }), dpr: 3, want: "low" },
  { label: "Adreno 730", caps: desktop({ renderer: "Adreno (TM) 730" }), dpr: 2.75, want: "low" },
  // Form factor wins even when the renderer is masked (privacy build / Safari).
  {
    label: "Pixel-class, masked renderer, coarse pointer",
    caps: desktop({
      renderer: null,
      coarsePointer: true,
      mobileUA: true,
      maxTextureSize: 4096,
      cores: 8,
      deviceMemory: 4,
      webgl2: true,
    }),
    dpr: 3,
    want: "low",
  },
  // Masked renderer, desktop form factor — platform tie-breakers.
  {
    label: "masked + strong platform, standard-DPI",
    caps: desktop({ renderer: null }),
    dpr: 1,
    want: "high",
  },
  {
    label: "masked + strong platform, hi-DPI",
    caps: desktop({ renderer: null }),
    dpr: 2,
    want: "med",
  },
  {
    label: "masked + weak platform (no webgl2)",
    caps: desktop({ renderer: null, webgl2: false }),
    dpr: 1,
    want: "low",
  },
  {
    label: "masked + tiny texture cap",
    caps: desktop({ renderer: null, maxTextureSize: 2048 }),
    dpr: 1,
    want: "low",
  },
  {
    label: "masked + 2 cores",
    caps: desktop({ renderer: null, cores: 2, deviceMemory: 4 }),
    dpr: 1,
    want: "low",
  },
  // Unknown class, mid platform (not strong, not weak) — conservative med.
  {
    label: "masked + mid platform, standard-DPI",
    caps: desktop({ renderer: null, cores: 4, deviceMemory: 4 }),
    dpr: 1,
    want: "med",
  },
];

let fail = 0;
for (const c of cases) {
  const { tier, cls, reason } = suggestTier(c.caps, c.dpr);
  const ok = tier === c.want;
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${c.label.slice(0, 44).padEnd(44)} dpr${c.dpr} -> ${cls}/${tier} (want ${c.want})  | ${reason}`,
  );
}
console.log(`\n${fail === 0 ? "DEVICE-TIER: PASS" : `DEVICE-TIER: FAIL (${fail})`}`);
process.exit(fail === 0 ? 0 : 1);
