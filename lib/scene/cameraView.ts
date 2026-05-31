"use client";

import gsap from "gsap";
import { useSceneStore, PRESETS } from "@/lib/state/sceneStore";

// Shared "Default ↔ Top-down" view logic. Single source of truth for what the
// Camera panel's tween-to tabs AND the `t` hotkey do, so both produce the exact
// same animation and end state. The behaviour is mode-dependent:
//   - orbit mode  → swing-arm orbit tween that stays in orbit (pauses sweep)
//   - still / fly → still-mode pose tween via tweenCameraTo
// Keeping this in one place is the whole point — the hotkey used to always take
// the still-mode path, which diverged from the panel while orbiting.

export type ViewPresetId = "default" | "top-down";

// Orbit top-down: tilt the orbit straight down, pull the camera back, and pause
// the auto-sweep — all without leaving orbit mode. Tweens elevation→90, radius
// up to a city-fitting distance, and orthoSize up so the framing also works in
// ortho (where radius alone doesn't change visible extent). The pre-top-down
// orbit + projection state is captured into orbitRestore the first time so the
// Default preset can put the user back where they were.
const TOP_DOWN_RADIUS = 4500;
const TOP_DOWN_ORTHO_SIZE = 1000;
const ORBIT_TWEEN_MS = 0.9;
const PRESET_TWEEN_MS = 900;

function tweenOrbitTowards(
  targetEl: number,
  targetR: number,
  targetOrtho: number,
  onComplete?: () => void,
) {
  const s = useSceneStore.getState();
  const fromEl = s.orbit.elevationDeg;
  const fromR = s.orbit.radius;
  const fromOrtho = s.orthoSize;

  // Two-phase swing-arm tween. The angular swing happens at constant radius
  // first, so the camera reads as an arm pivoting around the city centre.
  // Radius + orthoSize (zoom-out) ramp in over the late half, overlapping the
  // tail of the swing so the whole motion still feels like one continuous arc
  // rather than two distinct beats.
  const tl = gsap.timeline({ onComplete });

  const elProxy = { v: fromEl };
  tl.to(
    elProxy,
    {
      v: targetEl,
      duration: ORBIT_TWEEN_MS,
      ease: "power2.inOut",
      onUpdate: () => useSceneStore.getState().setOrbit({ elevationDeg: elProxy.v }),
    },
    0,
  );

  const zoomProxy = { v: 0 };
  tl.to(
    zoomProxy,
    {
      v: 1,
      duration: ORBIT_TWEEN_MS * 0.7,
      ease: "power2.inOut",
      onUpdate: () => {
        const t = zoomProxy.v;
        const st = useSceneStore.getState();
        st.setOrbit({ radius: fromR + (targetR - fromR) * t });
        st.setOrthoSize(fromOrtho + (targetOrtho - fromOrtho) * t);
      },
    },
    ORBIT_TWEEN_MS * 0.4,
  );
}

export function tweenOrbitTopDown() {
  const s = useSceneStore.getState();
  if (s.orbitRestore === null) {
    s.setOrbitRestore({
      elevationDeg: s.orbit.elevationDeg,
      radius: s.orbit.radius,
      orthoSize: s.orthoSize,
      paused: s.orbitPaused,
    });
  }
  s.setOrbitPaused(true);
  tweenOrbitTowards(90, TOP_DOWN_RADIUS, TOP_DOWN_ORTHO_SIZE);
}

export function tweenOrbitRestore() {
  const s = useSceneStore.getState();
  const r = s.orbitRestore;
  if (!r) return;
  tweenOrbitTowards(r.elevationDeg, r.radius, r.orthoSize, () => {
    const st = useSceneStore.getState();
    st.setOrbitPaused(r.paused);
    st.setOrbitRestore(null);
  });
}

// Apply a view preset using the same mode-aware dispatch the Camera panel tabs
// use. Re-derives orbiting/orbitRestore from the live store so it matches the
// panel exactly.
export function applyViewPreset(id: ViewPresetId) {
  const s = useSceneStore.getState();
  const orbiting = s.cameraMode === "orbit";
  const orbitRestoreSet = s.orbitRestore !== null;
  if (orbiting && id === "top-down") tweenOrbitTopDown();
  else if (orbiting && id === "default" && orbitRestoreSet) tweenOrbitRestore();
  else {
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) s.tweenCameraTo(preset.intent, PRESET_TWEEN_MS);
  }
}

// Tracks the last applied preset for still/fly mode, where the store has no
// signal for which framing is active. In orbit mode we ignore this and read
// orbitRestore instead (kept in sync below) so the hotkey mirrors the panel.
let lastPreset: ViewPresetId = "default";

export function toggleViewPreset() {
  const s = useSceneStore.getState();
  const current: ViewPresetId =
    s.cameraMode === "orbit"
      ? s.orbitRestore !== null
        ? "top-down"
        : "default"
      : lastPreset;
  const next: ViewPresetId = current === "top-down" ? "default" : "top-down";
  lastPreset = next;
  applyViewPreset(next);
}
