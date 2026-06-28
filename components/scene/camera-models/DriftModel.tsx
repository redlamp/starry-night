"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { orbitFramingFactor } from "@/lib/scene/aspectFraming";
import { GROUND_APRON_M } from "../Ground";

// "Drift" — an ambient, hands-off cinematic camera model (the screensaver at rest).
// A slow seeded crane-orbit around the city: azimuth creeps around, elevation
// rises and falls gently, the dolly breathes. There is NO pointer input —
// camera-controls' own actions are disabled and a per-frame setLookAt fully owns
// the pose. Space pauses. Kept entirely separate from the map controller
// (DreiSceneControls), which is the whole point of the camera-model registry.
//
// Determinism: the motion is a pure function of the R3F clock + a seed-derived
// phase (no Math.random / Date.now / performance.now), so it replays identically
// per seed — the same basis the rest of the scene's animation uses.
//
// Projection: works in BOTH persp and ortho without touching the projection state.
// The orbit radius is held at >= the ortho clip-safe park (tier x 1.7, cf.
// DreiSceneControls' ORTHO_RADIUS_FACTOR 1.5), so the faked-ortho near plane never
// clips the city; in perspective it reads as a wide establishing distance.

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const round1 = (n: number) => Math.round(n * 10) / 10;

// Feel constants (initial; tune live). Deliberately slow — this is an ambient
// establishing shot, not a turntable.
// Fixed shape constants — the tunable feel knobs (wander reach/speed, elevation
// mean/bob, revolve, breathe) live in the store as `drift` / DEFAULT_DRIFT and are
// surfaced as the Drift controls in Settings -> Orbit -> Drift.
const RADIUS_FACTOR = 1.7; // orbit radius as a multiple of the city half-extent (+ apron); clip-safe in ortho
const RADIUS_FREQ = 0.02; // rad/s — dolly-breathe period ~5 min
const EL_FREQ = 0.035; // rad/s — elevation-sway period ~3 min
const WANDER_W = [0.013, 0.029, 0.047] as const; // rad/s, incommensurate base wander freqs; periods ~8/3.6/2.2 min
// Near-horizon elevation is required: ORTHOGRAPHIC projection has no perspective
// compression, so even ~10 deg of downward tilt turns the view into rooftops. The
// elevation knobs (DEFAULT_DRIFT.elevMid/elevAmp) stay in a low band for this reason.
//
// "Starry Night" framing: aim AT the city, then park that focal low on screen via the
// focal offset, reusing the map model's low-angle ground pull (driven toward
// groundFrameLow near the horizon) so the skyline sits low with the star sky above.
const FOCAL_Y = 0; // focal height: aim at the ground centre (skyline sits near the horizon)

// A stable [0,1) phase from the seed (FNV-1a) so different cities open on a
// different bearing / sway offset — deterministic, no RNG.
function seedPhase(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// One axis of the brownian-like wander, normalised to ~[-1,1] (weights sum to 1).
function wander1(t: number, seedPh: number, axisPh: number): number {
  return (
    0.55 * Math.sin(t * WANDER_W[0] + seedPh + axisPh) +
    0.3 * Math.sin(t * WANDER_W[1] + seedPh * 1.7 + axisPh) +
    0.15 * Math.sin(t * WANDER_W[2] + seedPh * 2.3 + axisPh)
  );
}

// Shared low-angle curve (mirrors DreiSceneControls.lowAngleT): 0 above lowAngleDeg,
// smoothly 1 at/below the horizon. Drives the ground pull that lands the skyline low.
function lowAngleT(elevDeg: number, lowAngleDeg: number): number {
  const x = Math.max(0, Math.min(1, (lowAngleDeg - elevDeg) / Math.max(1, lowAngleDeg)));
  return x * x * (3 - 2 * x);
}

export function DriftModel() {
  const controls = useRef<CameraControlsImpl | null>(null);
  const mode = useSceneStore((s) => s.cameraMode);
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const t = useRef(0); // accumulated drift time (frozen while paused)
  const lastWrite = useRef(0);
  const phase = useRef<{ seed: string; value: number }>({ seed: "", value: 0 });

  // Disable camera-controls' own input + clamps — the per-frame setLookAt owns the
  // pose, so a stray drag/wheel must not fight it.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const A = CameraControlsImpl.ACTION;
    c.mouseButtons.left = A.NONE;
    c.mouseButtons.middle = A.NONE;
    c.mouseButtons.right = A.NONE;
    c.mouseButtons.wheel = A.NONE;
    c.touches.one = A.NONE;
    c.touches.two = A.NONE;
    c.touches.three = A.NONE;
    c.minDistance = 1;
    c.maxDistance = Infinity;
    c.minPolarAngle = 0;
    c.maxPolarAngle = Math.PI;
  }, [mode]);

  // Space pauses / resumes the drift via the shared orbitPaused flag — the same one
  // the Orbit play button and Map's auto-revolution use, so one control governs all.
  useEffect(() => {
    if (mode !== "orbit") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      const st = useSceneStore.getState();
      st.setOrbitPaused(!st.orbitPaused);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  useFrame((state, dt) => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    const s = useSceneStore.getState();

    if (phase.current.seed !== String(masterSeed)) {
      phase.current = { seed: String(masterSeed), value: seedPhase(String(masterSeed)) };
    }
    const ph = phase.current.value;

    if (!s.orbitPaused) t.current += dt;
    const tt = t.current;
    const cam = state.camera as THREE.PerspectiveCamera;

    const d = s.drift;
    const tier = CITY_TIERS[s.citySize] + GROUND_APRON_M;
    const R = tier * RADIUS_FACTOR * (1 + d.breathe * Math.sin(tt * RADIUS_FREQ + ph * TAU));
    const revRate = d.revolveSec > 0 ? 360 / d.revolveSec : 0;
    const azDeg = (ph * 360 + revRate * tt) % 360;
    const elDeg = d.elevMid + d.elevAmp * Math.sin(tt * EL_FREQ + ph * TAU + 1.7);

    const az = azDeg * DEG;
    const polar = (90 - elDeg) * DEG;
    const sp = Math.sin(polar); // = cos(elevation): horizontal share of the radius
    const cp = Math.cos(polar); // = sin(elevation): vertical share of the radius
    // Slow brownian-like wander of the focal across the ground (see WANDER_*), so the
    // camera tours the city instead of circling one fixed point. Different X/Z phases
    // decorrelate the two axes into an organic 2-D drift.
    const roam = d.wanderRadius * tier;
    const wt = tt * d.wanderSpeed; // wander-speed multiplier on the base frequencies
    const cx = CITY_CENTER.x + roam * wander1(wt, ph * TAU, 0);
    const cz = CITY_CENTER.z + roam * wander1(wt, ph * TAU, 2.1);
    // Aim AT the wandering focal so the city stays in frame.
    void c.setLookAt(
      cx + R * sp * Math.sin(az),
      FOCAL_Y + R * cp,
      cz + R * sp * Math.cos(az),
      cx,
      FOCAL_Y,
      cz,
      false,
    );
    // Then park that focal low on screen (focal offset) so the star sky fills the
    // space above it — the same screen-Y pivot the map model uses. halfH bridges
    // perspective (distance*tan(fov/2)) -> ortho (orthoSize*framingFactor) by blend,
    // matching ProjectionBlender, so the pivot tracks a projection morph. Negative
    // offY shifts the rendered focal toward the bottom of the frame.
    const oeff = s.orthoSize * orbitFramingFactor(cam.aspect);
    const perspK = R * Math.tan((cam.fov * DEG) / 2);
    const halfH = perspK + (oeff - perspK) * s.projectionBlend;
    // Pivot: base screen-Y pulled down toward groundFrameLow as the view nears the
    // horizon (the map model's low-angle pull, simplified by the ground focal), so the
    // skyline sits low with the star sky above. Negative offY shifts the focal downward.
    const tLow = lowAngleT(elDeg, s.rotateSlowBelowDeg);
    const pivot = s.orbitPivotFromBottom + (s.groundFrameLow - s.orbitPivotFromBottom) * tLow;
    c.setFocalOffset(0, (pivot - 0.5) * 2 * halfH, 0, false);

    // Sync focal + pose into the store ~10/s so the camera-anchored fog,
    // moon-follow, projection morph (orbit.radius), and panel readouts track the
    // drift — same cadence as the map controller's writeback.
    if (state.clock.elapsedTime - lastWrite.current >= 0.1) {
      lastWrite.current = state.clock.elapsedTime;
      s.setCameraLive({
        position: [cam.position.x, cam.position.y, cam.position.z],
        rotation: [cam.rotation.x, cam.rotation.y, cam.rotation.z],
        fov: cam.fov,
      });
      s.setOrbit({
        azimuthDeg: round1(((azDeg % 360) + 360) % 360),
        elevationDeg: round1(elDeg),
        radius: Math.round(R),
        centerX: Math.round(cx),
        centerZ: Math.round(cz),
        lookAtY: FOCAL_Y,
      });
    }
  });

  if (mode !== "orbit") return null;
  return <CameraControls ref={controls} />;
}
