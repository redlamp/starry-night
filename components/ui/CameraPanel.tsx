"use client";

import { useEffect, useState, type ReactNode } from "react";
import gsap from "gsap";
import { useSceneStore, type Vec3, PRESETS } from "@/lib/state/sceneStore";
import { randomSeed } from "@/lib/seed/rng";

const PROJECTION_TWEEN_DURATION = 0.5;

function tweenProjectionTo(target: "perspective" | "orthographic") {
  const s = useSceneStore.getState();
  if (s.projection === target) return;
  // Match framing at the lookAt distance so the projection swap is visually
  // continuous: ortho's frustum half-height matches perspective's tangent
  // half-extent at distance d (≈ orbit.radius).
  const d = Math.max(1, s.orbit.radius);
  const fovRad = (s.cameraIntent.fov * Math.PI) / 180;
  if (target === "orthographic") {
    s.setOrthoSize(d * Math.tan(fovRad / 2));
  } else {
    const matchedFov = (2 * Math.atan(s.orthoSize / d) * 180) / Math.PI;
    s.setCameraIntent({ fov: matchedFov });
  }
  s.setProjection(target);
  const from = s.projectionBlend;
  const to = target === "orthographic" ? 1 : 0;
  const proxy = { v: from };
  gsap.to(proxy, {
    v: to,
    duration: PROJECTION_TWEEN_DURATION,
    ease: "power2.inOut",
    onUpdate: () => useSceneStore.getState().setProjectionBlend(proxy.v),
  });
}

const DEBUG_VISIBLE_KEY = "starry-night.debugVisible";

function useDebugVisible(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setV(window.localStorage.getItem(DEBUG_VISIBLE_KEY) === "1");
  }, []);
  const setter = (next: boolean) => {
    setV(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(DEBUG_VISIBLE_KEY, next ? "1" : "0");
      } catch {
        // localStorage may be unavailable in private modes
      }
    }
  };
  return [v, setter];
}

function copyConfigToClipboard() {
  const s = useSceneStore.getState();
  const snippet = JSON.stringify(
    {
      cameraIntent: s.cameraIntent,
      orbit: s.orbit,
      moon: s.moon,
      stars: s.stars,
    },
    null,
    2,
  );
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(snippet);
  }
}

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
    saveCurrentAsDefault,
    snapIntentToLive,
    tweenCameraTo,
  } = useSceneStore();

  const [hidden, setHidden] = useState(false);
  const captureMode = useSceneStore((s) => s.captureMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "H") setHidden((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (captureMode) return null;

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        className="pointer-events-auto absolute right-3 top-3 flex h-11 min-w-11 items-center gap-2 rounded-full bg-black/70 px-4 text-xs font-medium text-white/85 backdrop-blur active:bg-black/85"
        title="Show camera panel (H)"
        aria-label="Show camera panel"
      >
        <span aria-hidden="true" className="text-base leading-none">⚙</span>
        <span>panel</span>
      </button>
    );
  }

  const flying = cameraMode === "fly";
  const orbiting = cameraMode === "orbit";
  const locked = flying || orbiting;
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
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Camera</span>
        <div className="flex items-center gap-1">
          <ModeButton
            label="Still"
            hotkey="S"
            active={cameraMode === "still"}
            activeClass="bg-white/85 text-black"
            onClick={() => {
              if (flying) snapIntentToLive();
              setCameraMode("still");
            }}
          />
          <ModeButton
            label="Fly"
            hotkey="F"
            active={flying}
            activeClass="bg-orange-500/80 text-black"
            onClick={() => {
              if (flying) snapIntentToLive();
              setCameraMode(flying ? "still" : "fly");
            }}
          />
          <ModeButton
            label="Orbit"
            hotkey="G"
            active={orbiting}
            activeClass="bg-sky-400/80 text-black"
            onClick={() => setCameraMode(orbiting ? "still" : "orbit")}
          />
          <button
            onClick={() => setHidden(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-base leading-none hover:bg-white/20 active:bg-white/30"
            title="Hide (H)"
            aria-label="Hide camera panel"
          >
            ×
          </button>
        </div>
      </div>

      {flying ? (
        <div className="flex flex-col gap-1 rounded border border-orange-400/30 bg-orange-400/5 p-2 text-white/70">
          <div className="text-[10px]">
            Hold left mouse to look · WASD move · Space up · C down · Q/E roll · Shift sprint · wheel = speed · F to exit
          </div>
          <FlySpeedSlider />
        </div>
      ) : null}
      {orbiting ? (
        <div className="text-sky-300/80">
          Drag to spin · Shift+drag = focal Y · pinch or wheel = zoom · two-finger pan = focal Y
        </div>
      ) : null}

      <div className="flex items-center gap-1">
        <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
          tween to
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            disabled={locked}
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
        disabled={locked}
        onChange={(position) => setCameraIntent({ position })}
      />

      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-white/40">orient by</span>
        <div className="flex gap-1">
          {(["lookAt", "rotation"] as const).map((o) => (
            <button
              key={o}
              disabled={locked}
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
        disabled={locked || cameraIntent.orient !== "lookAt"}
        onChange={(lookAt) => setCameraIntent({ lookAt, orient: "lookAt" })}
      />

      <Vec3Input
        label="rotation"
        hint="degrees"
        step={1}
        value={intentRotDeg}
        disabled={locked || cameraIntent.orient !== "rotation"}
        onChange={(rotDeg) =>
          setCameraIntent({
            rotation: [rotDeg[0] * DEG2RAD, rotDeg[1] * DEG2RAD, rotDeg[2] * DEG2RAD],
            orient: "rotation",
          })
        }
      />

      <ProjectionRow />
      <FovOrSizeSlider />

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

      <DebugRow />

      <hr className="border-white/10" />

      <SeedRow />

      <hr className="border-white/10" />

      <PerfReadout />

      <hr className="border-white/10" />

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => resetCamera()}
          className="rounded bg-transparent px-3 py-1 text-xs font-medium text-rose-400 hover:bg-rose-400/10 hover:text-rose-300"
          title="Restore last saved values (falls back to hardcoded defaults if none saved)"
        >
          Reset
        </button>
        <button
          onClick={() => saveCurrentAsDefault()}
          className="rounded bg-emerald-400/80 px-3 py-1 text-xs text-black hover:bg-emerald-400"
          title="Snapshot current camera + orbit + moon + stars as the new Reset target"
        >
          Save
        </button>
      </div>

      <div className="text-[10px] text-white/40">
        S still · F fly · G orbit · H hide
      </div>
    </div>
  );
}

function FlySpeedSlider() {
  const flySpeed = useSceneStore((s) => s.flySpeed);
  const setFlySpeed = useSceneStore((s) => s.setFlySpeed);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-orange-200/80">fly speed</span>
      <input
        type="range"
        min={0.1}
        max={500}
        step={0.1}
        value={flySpeed}
        onChange={(e) => setFlySpeed(parseFloat(e.target.value))}
        className="flex-1"
      />
      <input
        type="number"
        step={0.1}
        value={flySpeed}
        onChange={(e) => setFlySpeed(parseFloat(e.target.value) || 0.1)}
        className="w-16 rounded border border-white/15 bg-black/50 px-1.5 py-0.5 text-white tabular-nums"
      />
    </div>
  );
}

function ProjectionRow() {
  const projection = useSceneStore((s) => s.projection);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-white/40">
        projection
      </span>
      <div className="flex flex-1 gap-1">
        {(["perspective", "orthographic"] as const).map((p) => (
          <button
            key={p}
            onClick={() => tweenProjectionTo(p)}
            className={`flex-1 rounded px-2 py-0.5 text-[11px] ${
              projection === p
                ? "bg-white/85 text-black"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
            title={`Switch to ${p} projection (tweens via GSAP)`}
          >
            {p === "perspective" ? "Perspective" : "Orthographic"}
          </button>
        ))}
      </div>
    </div>
  );
}

function FovOrSizeSlider() {
  const projection = useSceneStore((s) => s.projection);
  const fov = useSceneStore((s) => s.cameraIntent.fov);
  const orthoSize = useSceneStore((s) => s.orthoSize);
  const setCameraIntent = useSceneStore((s) => s.setCameraIntent);
  const setOrthoSize = useSceneStore((s) => s.setOrthoSize);

  if (projection === "orthographic") {
    return (
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-white/60">size</span>
        <input
          type="range"
          min={5}
          max={2000}
          step={1}
          value={orthoSize}
          onChange={(e) => setOrthoSize(parseFloat(e.target.value))}
          className="flex-1"
        />
        <input
          type="number"
          step={1}
          value={orthoSize}
          onChange={(e) => setOrthoSize(parseFloat(e.target.value) || 5)}
          className="w-14 rounded border border-white/15 bg-black/50 px-1.5 py-0.5 text-white tabular-nums"
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-white/60">fov</span>
      <input
        type="range"
        min={5}
        max={150}
        step={1}
        value={fov}
        onChange={(e) => setCameraIntent({ fov: parseFloat(e.target.value) })}
        className="flex-1"
      />
      <input
        type="number"
        step={1}
        value={fov}
        onChange={(e) => setCameraIntent({ fov: parseFloat(e.target.value) || 38 })}
        className="w-14 rounded border border-white/15 bg-black/50 px-1.5 py-0.5 text-white tabular-nums"
      />
    </div>
  );
}

function ModeButton({
  label,
  hotkey,
  active,
  activeClass,
  onClick,
}: {
  label: string;
  hotkey: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs ${
        active ? activeClass : "bg-white/10 text-white hover:bg-white/20"
      }`}
      title={`${label} mode (${hotkey})`}
    >
      {label} <span className="text-[9px] opacity-70">({hotkey})</span>
    </button>
  );
}

function DebugRow() {
  const [visible, setVisible] = useDebugVisible();
  const followCamera = useSceneStore((s) => s.moonFollowCamera);
  const setFollowCamera = useSceneStore((s) => s.setMoonFollowCamera);
  const stars = useSceneStore((s) => s.stars);
  const setStars = useSceneStore((s) => s.setStars);
  const moon = useSceneStore((s) => s.moon);
  const setMoon = useSceneStore((s) => s.setMoon);
  const orbit = useSceneStore((s) => s.orbit);
  const setOrbit = useSceneStore((s) => s.setOrbit);

  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const onCopy = () => {
    copyConfigToClipboard();
    setCopyState("copied");
    setTimeout(() => setCopyState("idle"), 1200);
  };

  return (
    <div className="flex flex-col gap-1 rounded border border-indigo-400/30 bg-indigo-400/5 p-2">
      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-[10px] uppercase tracking-wide text-indigo-300/80">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
            className="h-3 w-3 accent-indigo-400"
          />
          debug
        </label>
        <button
          onClick={onCopy}
          className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20"
          title="Copy camera + orbit + moon + stars as JSON to clipboard"
        >
          {copyState === "copied" ? "copied" : "copy values"}
        </button>
      </div>

      {visible ? (
        <>
          <SubSection label="🌀 orbit">
            <OrbitSlider
              label="speed"
              value={orbit.periodSec}
              min={5}
              max={3600}
              step={5}
              onChange={(periodSec) => setOrbit({ periodSec })}
            />
            <OrbitSlider
              label="radius"
              value={orbit.radius}
              min={50}
              max={5000}
              step={5}
              onChange={(radius) => setOrbit({ radius })}
            />
            <OrbitSlider
              label="elev°"
              value={orbit.elevationDeg}
              min={0.01}
              max={90}
              step={0.5}
              onChange={(elevationDeg) => setOrbit({ elevationDeg })}
            />
            <OrbitSlider
              label="azim°"
              value={orbit.azimuthDeg}
              min={0}
              max={360}
              step={1}
              onChange={(azimuthDeg) => setOrbit({ azimuthDeg })}
            />
            <OrbitSlider
              label="lookAt y"
              value={orbit.lookAtY}
              min={-200}
              max={2000}
              step={1}
              onChange={(lookAtY) => setOrbit({ lookAtY })}
            />
          </SubSection>

          <SubSection label="⭐ stars">
            <OrbitSlider
              label="size"
              value={stars.factor}
              min={5}
              max={500}
              step={1}
              onChange={(factor) => setStars({ factor })}
            />
            <OrbitSlider
              label="radius"
              value={stars.radius}
              min={500}
              max={30000}
              step={100}
              onChange={(radius) => setStars({ radius })}
            />
            <OrbitSlider
              label="depth"
              value={stars.depth}
              min={50}
              max={8000}
              step={50}
              onChange={(depth) => setStars({ depth })}
            />
            <OrbitSlider
              label="count"
              value={stars.count}
              min={100}
              max={30000}
              step={100}
              onChange={(count) => setStars({ count })}
            />
          </SubSection>

          <SubSection
            label="🌙 moon"
            action={
              <button
                onClick={() => setFollowCamera(!followCamera)}
                className={`rounded px-2 py-0.5 text-[10px] ${
                  followCamera ? "bg-indigo-400/80 text-black" : "bg-white/10 hover:bg-white/20"
                }`}
                title="Moon tracks the camera so it stays opposite the city"
              >
                {followCamera ? "follow cam (on)" : "follow cam"}
              </button>
            }
          >
            <OrbitSlider
              label="az°"
              value={moon.azimuthDeg}
              min={0}
              max={360}
              step={1}
              onChange={(azimuthDeg) => setMoon({ azimuthDeg })}
            />
            <OrbitSlider
              label="el°"
              value={moon.elevationDeg}
              min={-10}
              max={90}
              step={0.5}
              onChange={(elevationDeg) => setMoon({ elevationDeg })}
            />
            <OrbitSlider
              label="dist"
              value={moon.distance}
              min={500}
              max={30000}
              step={50}
              onChange={(distance) => setMoon({ distance })}
            />
            <MoonReadout />
          </SubSection>
        </>
      ) : null}
    </div>
  );
}

function SubSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded border border-white/10 bg-black/30 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-white/55">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function MoonReadout() {
  const moon = useSceneStore((s) => s.moonLive);
  return (
    <div className="mt-1 grid grid-cols-[5rem_1fr] gap-1 border-t border-indigo-400/15 pt-1 font-mono text-[10px] text-white/70">
      <div>moon pos</div>
      <div className="tabular-nums">
        {fmt(moon.position[0], 0)} {fmt(moon.position[1], 0)} {fmt(moon.position[2], 0)}
      </div>
      <div>moon az°</div>
      <div className="tabular-nums">{fmt(moon.azimuthDeg, 1)}</div>
      <div>moon el°</div>
      <div className="tabular-nums">{fmt(moon.elevationDeg, 1)}</div>
      <div>moon dist</div>
      <div className="tabular-nums">{fmt(moon.distance, 0)}</div>
    </div>
  );
}

function OrbitSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0 text-white/70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1"
      />
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || min)}
        className="w-16 rounded border border-white/15 bg-black/50 px-1.5 py-0.5 text-white tabular-nums"
      />
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
