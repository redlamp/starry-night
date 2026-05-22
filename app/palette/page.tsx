"use client";

import { useMemo, useState } from "react";
import seedrandom from "seedrandom";
import * as THREE from "three";
import { kelvinToColor, lerpKelvin } from "@/lib/color/kelvin";

type Bucket = {
  key: string;
  label: string;
  kMin: number;
  kMax: number;
  intensity: number;
};

type Profile = {
  litRatio: number;
  tvFlickerRatio: number;
  officeRatio: number;
  neutralRatio: number;
  brightRatio: number;
};

const BUCKETS_CURRENT: Bucket[] = [
  { key: "dim", label: "Dim warm", kMin: 1800, kMax: 2200, intensity: 0.3 },
  { key: "std", label: "Standard warm", kMin: 2300, kMax: 2700, intensity: 0.55 },
  { key: "bright", label: "Bright warm", kMin: 2800, kMax: 3200, intensity: 0.9 },
  { key: "office", label: "Office cool", kMin: 5000, kMax: 5800, intensity: 0.7 },
  { key: "neon", label: "Neon highlight", kMin: 6500, kMax: 7200, intensity: 0.95 },
  { key: "tv", label: "TV flicker", kMin: 6500, kMax: 6500, intensity: 0.55 },
];

const BUCKETS_PROPOSED: Bucket[] = [
  { key: "dim", label: "Dim warm", kMin: 2200, kMax: 2600, intensity: 0.4 },
  { key: "std", label: "Standard warm", kMin: 2700, kMax: 3100, intensity: 0.55 },
  { key: "bright", label: "Bright warm", kMin: 2800, kMax: 3200, intensity: 0.75 },
  { key: "neutral", label: "Neutral white (NEW)", kMin: 3300, kMax: 3800, intensity: 0.55 },
  { key: "office", label: "Office cool", kMin: 5000, kMax: 5800, intensity: 0.7 },
  { key: "neon", label: "Neon highlight", kMin: 6500, kMax: 7200, intensity: 0.95 },
  { key: "tv", label: "TV flicker", kMin: 6500, kMax: 6500, intensity: 0.55 },
];

const PROFILES_CURRENT: Record<string, Profile> = {
  warm: { litRatio: 0.55, tvFlickerRatio: 0.14, officeRatio: 0, neutralRatio: 0, brightRatio: 0.18 },
  cool: { litRatio: 0.55, tvFlickerRatio: 0, officeRatio: 0.55, neutralRatio: 0, brightRatio: 0.09 },
  sparse: { litRatio: 0.15, tvFlickerRatio: 0.05, officeRatio: 0.04, neutralRatio: 0, brightRatio: 0.06 },
  blazing: { litRatio: 0.75, tvFlickerRatio: 0.1, officeRatio: 0.04, neutralRatio: 0, brightRatio: 0.33 },
  neutral: { litRatio: 0.5, tvFlickerRatio: 0.1, officeRatio: 0.04, neutralRatio: 0, brightRatio: 0.15 },
};

const PROFILES_PROPOSED: Record<string, Profile> = {
  warm: { litRatio: 0.55, tvFlickerRatio: 0.14, officeRatio: 0.07, neutralRatio: 0.05, brightRatio: 0.18 },
  cool: { litRatio: 0.55, tvFlickerRatio: 0, officeRatio: 0.55, neutralRatio: 0.1, brightRatio: 0.09 },
  "neutral-white": {
    litRatio: 0.55,
    tvFlickerRatio: 0.1,
    officeRatio: 0.02,
    neutralRatio: 0.7,
    brightRatio: 0.1,
  },
  sparse: { litRatio: 0.15, tvFlickerRatio: 0.05, officeRatio: 0.04, neutralRatio: 0, brightRatio: 0.06 },
  blazing: { litRatio: 0.75, tvFlickerRatio: 0.1, officeRatio: 0.04, neutralRatio: 0, brightRatio: 0.33 },
  neutral: { litRatio: 0.5, tvFlickerRatio: 0.1, officeRatio: 0.04, neutralRatio: 0, brightRatio: 0.15 },
};

const MOODS_CURRENT = ["warm", "cool", "neutral", "sparse", "blazing"];
const MOODS_PROPOSED = ["warm", "cool", "neutral-white", "neutral", "sparse", "blazing"];

const RESIDENTIAL_MOODS = new Set(["warm", "neutral", "neutral-white"]);

function shiftBuckets(buckets: Bucket[], warmShift: number): Bucket[] {
  const WARM_KEYS = new Set(["dim", "std", "bright"]);
  return buckets.map((b) =>
    WARM_KEYS.has(b.key)
      ? { ...b, kMin: b.kMin + warmShift, kMax: b.kMax + warmShift }
      : b,
  );
}

function tuneProfileForCoolPop(p: Profile, coolPop: number, isResidential: boolean): Profile {
  if (!isResidential || coolPop === 0) return p;
  const extraCool = coolPop * 0.2;
  const extraNeutral = coolPop * 0.15;
  return {
    ...p,
    officeRatio: Math.min(0.95, p.officeRatio + extraCool),
    neutralRatio: Math.min(0.95, p.neutralRatio + extraNeutral),
  };
}

function pickKelvinFromBuckets(
  rng: () => number,
  profile: Profile,
  buckets: Bucket[],
): { color: THREE.Color; intensity: number } {
  const find = (k: string) => buckets.find((b) => b.key === k);
  const tv = find("tv")!;
  const office = find("office")!;
  const neon = find("neon")!;
  const neutral = find("neutral");
  const bright = find("bright")!;
  const dim = find("dim")!;
  const std = find("std")!;

  const roll = rng();
  let cum = profile.tvFlickerRatio;
  if (roll < cum) return { color: kelvinToColor(tv.kMin), intensity: tv.intensity };
  cum += profile.officeRatio;
  if (roll < cum) {
    if (rng() < 0.12) {
      return { color: lerpKelvin(rng, neon.kMin, neon.kMax), intensity: neon.intensity };
    }
    return { color: lerpKelvin(rng, office.kMin, office.kMax), intensity: office.intensity };
  }
  if (neutral) {
    cum += profile.neutralRatio;
    if (roll < cum) {
      return { color: lerpKelvin(rng, neutral.kMin, neutral.kMax), intensity: neutral.intensity };
    }
  }
  cum += profile.brightRatio;
  if (roll < cum) {
    return { color: lerpKelvin(rng, bright.kMin, bright.kMax), intensity: bright.intensity };
  }
  if (rng() < 0.28) {
    return { color: lerpKelvin(rng, dim.kMin, dim.kMax), intensity: dim.intensity };
  }
  return { color: lerpKelvin(rng, std.kMin, std.kMax), intensity: std.intensity };
}

function whiteBalanceGain(whitePoint: number): { r: number; g: number; b: number } {
  if (whitePoint === 6500) return { r: 1, g: 1, b: 1 };
  const wp = kelvinToColor(whitePoint);
  const maxWp = Math.max(wp.r, wp.g, wp.b, 0.001);
  const wpN = { r: wp.r / maxWp, g: wp.g / maxWp, b: wp.b / maxWp };
  return {
    r: 1 / Math.max(0.08, wpN.r),
    g: 1 / Math.max(0.08, wpN.g),
    b: 1 / Math.max(0.08, wpN.b),
  };
}

function applyBrightness(
  color: THREE.Color,
  intensity: number,
  brightness: number,
  wbGain: { r: number; g: number; b: number },
): string {
  const r = Math.min(255, color.r * intensity * brightness * wbGain.r * 255);
  const g = Math.min(255, color.g * intensity * brightness * wbGain.g * 255);
  const b = Math.min(255, color.b * intensity * brightness * wbGain.b * 255);
  return `rgb(${r.toFixed(0)}, ${g.toFixed(0)}, ${b.toFixed(0)})`;
}

function colorToHex(color: THREE.Color, intensity: number): string {
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * intensity * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function BucketSwatchRow({
  bucket,
  brightness,
  wbGain,
  seed,
}: {
  bucket: Bucket;
  brightness: number;
  wbGain: { r: number; g: number; b: number };
  seed: string;
}) {
  const samples = useMemo(() => {
    const rng = seedrandom(`${seed}:${bucket.key}`);
    return Array.from({ length: 6 }, () => lerpKelvin(rng, bucket.kMin, bucket.kMax));
  }, [seed, bucket.key, bucket.kMin, bucket.kMax]);
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-44 shrink-0">
        <div className="font-mono text-sm">{bucket.label}</div>
        <div className="text-xs text-zinc-500">
          {bucket.kMin === bucket.kMax ? `${bucket.kMin}K` : `${bucket.kMin}-${bucket.kMax}K`} ·
          intensity {bucket.intensity}
        </div>
      </div>
      <div className="flex gap-1">
        {samples.map((c, i) => (
          <div
            key={i}
            className="h-10 w-10 rounded border border-zinc-800"
            style={{ background: applyBrightness(c, bucket.intensity, brightness, wbGain) }}
            title={colorToHex(c, bucket.intensity)}
          />
        ))}
      </div>
    </div>
  );
}

function BucketComparison({
  proposedBuckets,
  brightness,
  wbGain,
  seed,
}: {
  proposedBuckets: Bucket[];
  brightness: number;
  wbGain: { r: number; g: number; b: number };
  seed: string;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">1 · Buckets — Current vs Proposed</h2>
      <div className="grid grid-cols-2 gap-8">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">Current</h3>
          {BUCKETS_CURRENT.map((b) => (
            <BucketSwatchRow
              key={b.key}
              bucket={b}
              brightness={brightness}
              wbGain={wbGain}
              seed={`${seed}:cur`}
            />
          ))}
        </div>
        <div>
          <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">Proposed (live)</h3>
          {proposedBuckets.map((b) => (
            <BucketSwatchRow
              key={b.key}
              bucket={b}
              brightness={brightness}
              wbGain={wbGain}
              seed={`${seed}:pro`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function MoodFace({
  label,
  profile,
  buckets,
  seed,
  brightness,
  wbGain,
  cols = 8,
  rows = 14,
}: {
  label: string;
  profile: Profile;
  buckets: Bucket[];
  seed: string;
  brightness: number;
  wbGain: { r: number; g: number; b: number };
  cols?: number;
  rows?: number;
}) {
  const cells = useMemo(() => {
    const rng = seedrandom(seed);
    const out: string[] = [];
    for (let i = 0; i < cols * rows; i++) {
      if (rng() < profile.litRatio) {
        const pick = pickKelvinFromBuckets(rng, profile, buckets);
        out.push(applyBrightness(pick.color, pick.intensity, brightness, wbGain));
      } else {
        out.push("transparent");
      }
    }
    return out;
  }, [seed, profile, buckets, brightness, wbGain, cols, rows]);

  return (
    <div>
      <div className="text-xs font-mono mb-1 text-zinc-300">{label}</div>
      <div
        className="grid bg-[#08080f] p-1 rounded border border-zinc-800"
        style={{
          gridTemplateColumns: `repeat(${cols}, 12px)`,
          gridAutoRows: "16px",
          gap: "2px",
        }}
      >
        {cells.map((c, i) => (
          <div key={i} style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

function MoodGrid({
  proposedBuckets,
  coolPop,
  brightness,
  wbGain,
  seed,
}: {
  proposedBuckets: Bucket[];
  coolPop: number;
  brightness: number;
  wbGain: { r: number; g: number; b: number };
  seed: string;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold mb-3">
        2 · Mood faces — residential-tower base profile (same seed both sides)
      </h2>
      <div className="grid grid-cols-2 gap-8">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">Current</h3>
          <div className="flex flex-wrap gap-5">
            {MOODS_CURRENT.map((m) => (
              <MoodFace
                key={m}
                label={m}
                profile={PROFILES_CURRENT[m]}
                buckets={BUCKETS_CURRENT}
                seed={`${seed}:${m}`}
                brightness={brightness}
                wbGain={wbGain}
              />
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-xs uppercase tracking-wide text-zinc-400 mb-2">Proposed (live)</h3>
          <div className="flex flex-wrap gap-5">
            {MOODS_PROPOSED.map((m) => (
              <MoodFace
                key={m}
                label={m}
                profile={tuneProfileForCoolPop(
                  PROFILES_PROPOSED[m],
                  coolPop,
                  RESIDENTIAL_MOODS.has(m) || m === "neutral-white",
                )}
                buckets={proposedBuckets}
                seed={`${seed}:${m === "neutral-white" ? "neutral" : m}`}
                brightness={brightness}
                wbGain={wbGain}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs text-zinc-500 mt-3 max-w-2xl">
        Proposed warm allows 7% office + 5% neutral interleaving (real residential has cool
        stairwells / TV rooms). neutral-white is new: ~20% of residential moods in proposed
        distribution, dominated by 3300-3800K modern LED.
      </p>
    </section>
  );
}

function Streetlights({
  brightness,
  wbGain,
  warmShift,
}: {
  brightness: number;
  wbGain: { r: number; g: number; b: number };
  warmShift: number;
}) {
  const SODIUM_K = 2000;
  const CURRENT_K = 2300;
  const LED_K = 4000;
  const applyK = (kelvin: number) => {
    const c = kelvinToColor(kelvin + warmShift);
    return applyBrightness(c, 1, brightness, wbGain);
  };
  const mix = Array.from({ length: 32 }, (_, i) => ((i * 9973) % 10 < 8 ? SODIUM_K : LED_K));
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold mb-3">3 · Streetlights</h2>
      <p className="text-xs text-zinc-500 mb-3 max-w-2xl">
        Driven by kelvinToColor() and warm-K shift &mdash; same math as window buckets so a shift
        moves everything together.
      </p>
      <div className="flex gap-10 items-end flex-wrap">
        {[
          { label: "Current", kelvin: CURRENT_K, note: "~2300K (was #ffc060)" },
          { label: "Sodium HPS", kelvin: SODIUM_K, note: "~2000K" },
          { label: "LED 4000K", kelvin: LED_K, note: "~4000K" },
        ].map((s) => (
          <div key={s.label}>
            <div
              className="h-14 w-14 rounded-full"
              style={{
                background: applyK(s.kelvin),
                boxShadow: `0 0 22px ${applyK(s.kelvin)}`,
              }}
            />
            <div className="text-xs font-mono mt-2">{s.label}</div>
            <div className="text-xs text-zinc-500">
              {s.note}
              {warmShift !== 0 && (
                <>
                  {" "}
                  &rarr; {s.kelvin + warmShift}K
                </>
              )}
            </div>
          </div>
        ))}
        <div>
          <div className="flex gap-1 flex-wrap max-w-[420px]">
            {mix.map((kelvin, i) => (
              <div
                key={i}
                className="h-6 w-6 rounded-full"
                style={{ background: applyK(kelvin), boxShadow: `0 0 8px ${applyK(kelvin)}` }}
              />
            ))}
          </div>
          <div className="text-xs font-mono mt-2">80/20 sodium/LED mix</div>
          <div className="text-xs text-zinc-500">Real city distribution</div>
        </div>
      </div>
    </section>
  );
}

function HexReference({
  brightness,
  wbGain,
}: {
  brightness: number;
  wbGain: { r: number; g: number; b: number };
}) {
  const refs = [
    { label: "Brightest warm (lobby)", hex: "#ffe0b0", k: "~3500K" },
    { label: "Standard warm", hex: "#ffd590", k: "~3000K" },
    { label: "Dim warm (deep room)", hex: "#d49a55", k: "~2400K" },
    { label: "Sodium streetlight cast", hex: "#e89030", k: "~1900K" },
    { label: "Cool LED office", hex: "#cee0ff", k: "~5500K" },
    { label: "Cool fluorescent", hex: "#dbe6e8", k: "~4500K" },
    { label: "Neon white sign", hex: "#e8f4ff", k: "~6500K" },
    { label: "Cyan signage", hex: "#5a9cff", k: "gamut" },
    { label: "TV blue glow", hex: "#8aa8ff", k: "~6800K" },
  ];
  const apply = (hex: string) => {
    const c = new THREE.Color(hex);
    return applyBrightness(c, 1, brightness, wbGain);
  };
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold mb-3">4 · NYC photo eyedrop reference (from doc)</h2>
      <div className="grid grid-cols-3 gap-3 max-w-3xl">
        {refs.map((r) => (
          <div key={r.hex} className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded border border-zinc-800 shrink-0"
              style={{ background: apply(r.hex) }}
            />
            <div className="min-w-0">
              <div className="font-mono text-sm">{r.label}</div>
              <div className="text-xs text-zinc-500">
                {r.hex} · {r.k}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LiveValues({
  proposedBuckets,
  warmShift,
  coolPop,
  whitePoint,
  brightness,
}: {
  proposedBuckets: Bucket[];
  warmShift: number;
  coolPop: number;
  whitePoint: number;
  brightness: number;
}) {
  const json = useMemo(() => {
    return JSON.stringify(
      {
        controls: { brightness, whitePoint, warmShift, coolPop },
        buckets: proposedBuckets,
        coolPopApplied: {
          extraOfficeRatio: coolPop * 0.2,
          extraNeutralRatio: coolPop * 0.15,
          appliedTo: ["warm", "neutral", "neutral-white"],
        },
      },
      null,
      2,
    );
  }, [proposedBuckets, warmShift, coolPop, whitePoint, brightness]);
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold mb-3">5 · Live tuned values</h2>
      <p className="text-xs text-zinc-500 mb-2">
        Read off the numbers below once tuning feels right. These map directly to{" "}
        <span className="font-mono">lib/seed/lightingGen.ts</span>.
      </p>
      <button
        onClick={() => navigator.clipboard.writeText(json)}
        className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-3 py-1 text-xs mb-2"
      >
        Copy JSON
      </button>
      <pre className="text-xs bg-zinc-950 border border-zinc-800 rounded p-3 overflow-auto max-w-2xl">
        {json}
      </pre>
    </section>
  );
}

export default function PalettePage() {
  const [seed, setSeed] = useState("starry-night");
  const [brightness, setBrightness] = useState(1.0);
  const [whitePoint, setWhitePoint] = useState(6500);
  const [warmShift, setWarmShift] = useState(0);
  const [coolPop, setCoolPop] = useState(0);
  const wbGain = useMemo(() => whiteBalanceGain(whitePoint), [whitePoint]);
  const proposedBuckets = useMemo(
    () => shiftBuckets(BUCKETS_PROPOSED, warmShift),
    [warmShift],
  );
  return (
    <main
      className="bg-black text-white p-8"
      style={{ position: "fixed", inset: 0, overflow: "auto" }}
    >
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Palette Recalibration Prototype</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-3xl">
          Swatches use the same kelvinToColor() math the scene uses but bypass ACES tone mapping
          and emissive boost. Brightness slider is a coarse stand-in for emissive lift &mdash; it
          multiplies linearly and won&apos;t perfectly match the rendered look.
        </p>
      </header>
      <div className="flex gap-4 mb-6 sticky top-0 bg-black/90 backdrop-blur p-2 z-10 items-center">
        <label className="flex items-center gap-2 text-sm">
          Seed
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-sm w-40"
          />
        </label>
        <button
          onClick={() => setSeed(Math.random().toString(36).slice(2, 10))}
          className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-3 py-1 text-sm"
        >
          Reroll
        </button>
        <label className="flex items-center gap-2 text-sm">
          Brightness {brightness.toFixed(2)}×
          <input
            type="range"
            min="0.3"
            max="2.0"
            step="0.05"
            value={brightness}
            onChange={(e) => setBrightness(parseFloat(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          White point {whitePoint}K
          <input
            type="range"
            min="2700"
            max="9000"
            step="100"
            value={whitePoint}
            onChange={(e) => setWhitePoint(parseInt(e.target.value, 10))}
          />
          <button
            onClick={() => setWhitePoint(6500)}
            className="text-xs text-zinc-400 hover:text-white underline"
            title="Reset to sRGB D65"
          >
            reset
          </button>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Warm K shift {warmShift >= 0 ? "+" : ""}
          {warmShift}K
          <input
            type="range"
            min="-500"
            max="2000"
            step="50"
            value={warmShift}
            onChange={(e) => setWarmShift(parseInt(e.target.value, 10))}
          />
          <button
            onClick={() => setWarmShift(0)}
            className="text-xs text-zinc-400 hover:text-white underline"
          >
            reset
          </button>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Cool pop {(coolPop * 100).toFixed(0)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={coolPop}
            onChange={(e) => setCoolPop(parseFloat(e.target.value))}
          />
          <button
            onClick={() => setCoolPop(0)}
            className="text-xs text-zinc-400 hover:text-white underline"
          >
            reset
          </button>
        </label>
        <a
          href="/"
          className="ml-auto text-sm text-zinc-400 hover:text-white underline"
        >
          &larr; Back to scene
        </a>
      </div>
      <BucketComparison
        proposedBuckets={proposedBuckets}
        brightness={brightness}
        wbGain={wbGain}
        seed={seed}
      />
      <MoodGrid
        proposedBuckets={proposedBuckets}
        coolPop={coolPop}
        brightness={brightness}
        wbGain={wbGain}
        seed={seed}
      />
      <Streetlights brightness={brightness} wbGain={wbGain} warmShift={warmShift} />
      <HexReference brightness={brightness} wbGain={wbGain} />
      <LiveValues
        proposedBuckets={proposedBuckets}
        warmShift={warmShift}
        coolPop={coolPop}
        whitePoint={whitePoint}
        brightness={brightness}
      />
      <footer className="mt-12 text-xs text-zinc-600 max-w-3xl">
        Source:{" "}
        <span className="font-mono">wiki/research/color-usage-night-skyline.md</span>. Throwaway
        route &mdash; delete after sign-off.
      </footer>
    </main>
  );
}
