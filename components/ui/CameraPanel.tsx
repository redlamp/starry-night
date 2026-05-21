"use client";

import { useEffect, useState } from "react";
import { useSceneStore, type Vec3, PRESETS } from "@/lib/state/sceneStore";
import { randomSeed } from "@/lib/seed/rng";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

function fmt(n: number, p = 2) {
  return n.toFixed(p);
}

function Vec3Input({
  label,
  value,
  disabled,
  hint,
  step = 0.5,
  onChange,
}: {
  label: string;
  value: Vec3;
  disabled: boolean;
  hint?: string;
  step?: number;
  onChange: (v: Vec3) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex w-16 shrink-0 flex-col text-white/60">
        <span>{label}</span>
        {hint ? <span className="text-[10px] text-white/35">{hint}</span> : null}
      </div>
      {(["x", "y", "z"] as const).map((axis, i) => (
        <input
          key={axis}
          type="number"
          step={step}
          disabled={disabled}
          value={value[i]}
          onChange={(e) => {
            const v = [...value] as Vec3;
            v[i] = parseFloat(e.target.value) || 0;
            onChange(v);
          }}
          className="w-16 rounded border border-white/15 bg-black/50 px-1.5 py-0.5 text-white tabular-nums disabled:opacity-50"
        />
      ))}
    </div>
  );
}

export function CameraPanel() {
  const {
    cameraMode,
    cameraIntent,
    cameraLive,
    setCameraMode,
    setCameraIntent,
    resetCamera,
    snapIntentToLive,
    tweenCameraTo,
  } = useSceneStore();

  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "H") setHidden((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (hidden) {
    return (
      <div className="pointer-events-auto absolute right-3 top-3 rounded bg-black/60 px-2 py-1 text-xs text-white/60 backdrop-blur">
        press H to show camera panel
      </div>
    );
  }

  const flying = cameraMode === "fly";
  const livePos = cameraLive.position;
  const liveRotDeg: Vec3 = [
    cameraLive.rotation[0] * RAD2DEG,
    cameraLive.rotation[1] * RAD2DEG,
    cameraLive.rotation[2] * RAD2DEG,
  ];
  const intentRotDeg: Vec3 = [
    cameraIntent.rotation[0] * RAD2DEG,
    cameraIntent.rotation[1] * RAD2DEG,
    cameraIntent.rotation[2] * RAD2DEG,
  ];

  return (
    <div className="pointer-events-auto absolute right-3 top-3 flex w-[22rem] flex-col gap-2 rounded-lg border border-white/10 bg-black/70 p-3 text-xs text-white backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="font-medium">Camera</span>
        <div className="flex gap-1">
          <button
            onClick={() => {
              if (flying) snapIntentToLive();
              setCameraMode(flying ? "still" : "fly");
            }}
            className={`rounded px-2 py-0.5 text-xs ${
              flying ? "bg-orange-500/80 text-black" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {flying ? "Stop fly (F)" : "Fly (F)"}
          </button>
          <button
            onClick={() => resetCamera()}
            className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
          >
            Reset
          </button>
          <button
            onClick={() => setHidden(true)}
            className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
            title="Hide (H)"
          >
            ×
          </button>
        </div>
      </div>

      {flying ? (
        <div className="text-white/60">
          Click scene to lock · WASD move · Space up · C down · Q/E roll · Shift sprint · Esc release
        </div>
      ) : null}

      <div className="flex items-center gap-1">
        <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
          tween to
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            disabled={flying}
            onClick={() => tweenCameraTo(p.intent, 900)}
            className="rounded bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20 disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      <Vec3Input
        label="position"
        value={cameraIntent.position}
        disabled={flying}
        onChange={(position) => setCameraIntent({ position })}
      />

      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-white/40">orient by</span>
        <div className="flex gap-1">
          {(["lookAt", "rotation"] as const).map((o) => (
            <button
              key={o}
              disabled={flying}
              onClick={() => setCameraIntent({ orient: o })}
              className={`rounded px-2 py-0.5 text-[10px] ${
                cameraIntent.orient === o
                  ? "bg-white/25 text-white"
                  : "bg-white/5 text-white/60 hover:bg-white/15"
              } disabled:opacity-50`}
            >
              {o}
            </button>
          ))}
        </div>
      </div>

      <Vec3Input
        label="lookAt"
        value={cameraIntent.lookAt}
        disabled={flying || cameraIntent.orient !== "lookAt"}
        onChange={(lookAt) => setCameraIntent({ lookAt, orient: "lookAt" })}
      />

      <Vec3Input
        label="rotation"
        hint="degrees"
        step={1}
        value={intentRotDeg}
        disabled={flying || cameraIntent.orient !== "rotation"}
        onChange={(rotDeg) =>
          setCameraIntent({
            rotation: [rotDeg[0] * DEG2RAD, rotDeg[1] * DEG2RAD, rotDeg[2] * DEG2RAD],
            orient: "rotation",
          })
        }
      />

      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-white/60">fov</span>
        <input
          type="range"
          min={15}
          max={90}
          step={1}
          disabled={flying}
          value={cameraIntent.fov}
          onChange={(e) => setCameraIntent({ fov: parseFloat(e.target.value) })}
          className="flex-1"
        />
        <input
          type="number"
          step={1}
          disabled={flying}
          value={cameraIntent.fov}
          onChange={(e) => setCameraIntent({ fov: parseFloat(e.target.value) || 38 })}
          className="w-14 rounded border border-white/15 bg-black/50 px-1.5 py-0.5 text-white tabular-nums disabled:opacity-50"
        />
      </div>

      <hr className="border-white/10" />

      <div className="grid grid-cols-[5rem_1fr] gap-1 font-mono text-[10px] text-white/70">
        <div>live pos</div>
        <div className="tabular-nums">
          {fmt(livePos[0])} {fmt(livePos[1])} {fmt(livePos[2])}
        </div>
        <div>live rot°</div>
        <div className="tabular-nums">
          {fmt(liveRotDeg[0], 1)} {fmt(liveRotDeg[1], 1)} {fmt(liveRotDeg[2], 1)}
        </div>
        <div>live fov</div>
        <div className="tabular-nums">{fmt(cameraLive.fov)}</div>
      </div>

      <hr className="border-white/10" />

      <SeedRow />

      <hr className="border-white/10" />

      <PerfReadout />

      <div className="text-[10px] text-white/40">H to hide · F to toggle fly</div>
    </div>
  );
}

function SeedRow() {
  const seed = useSceneStore((s) => s.masterSeed);
  const setSeed = useSceneStore((s) => s.setSeed);
  const [draft, setDraft] = useState(seed);

  useEffect(() => setDraft(seed), [seed]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== seed) setSeed(v);
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-white/60">seed</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="min-w-0 flex-1 rounded border border-white/15 bg-black/50 px-1.5 py-0.5 font-mono text-white"
      />
      <button
        onClick={() => setSeed(randomSeed())}
        className="rounded bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20"
        title="Reroll seed"
      >
        Reroll
      </button>
    </div>
  );
}

function PerfReadout() {
  const perf = useSceneStore((s) => s.perf);
  const fpsColor =
    perf.fps >= 55 ? "text-emerald-300" : perf.fps >= 35 ? "text-amber-300" : "text-rose-400";
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-1 font-mono text-[10px] text-white/70">
      <div>fps</div>
      <div className={`tabular-nums ${fpsColor}`}>{Math.round(perf.fps)}</div>
      <div>triangles</div>
      <div className="tabular-nums">{perf.triangles.toLocaleString()}</div>
      <div>draw calls</div>
      <div className="tabular-nums">{perf.calls}</div>
      <div>geometries</div>
      <div className="tabular-nums">{perf.geometries}</div>
      <div>textures</div>
      <div className="tabular-nums">{perf.textures}</div>
    </div>
  );
}
