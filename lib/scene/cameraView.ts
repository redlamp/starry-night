"use client";

import gsap from "gsap";
import {
  useSceneStore,
  DEFAULT_ORBIT,
  DEFAULT_ORTHO_SIZE,
  DEFAULT_PERSP_RADIUS,
  type RenderGroup,
  type RenderMode,
} from "@/lib/state/sceneStore";
import { maxHalfExtent } from "@/lib/seed/topology";

// Shared camera-mode logic — the single source of truth for the Fly / Orbit /
// Top-down switch, used by the Camera panel's mode tabs, the `t` hotkey, and the
// F/G keys in CameraControls so they all behave identically.
//
// The three modes:
//   Fly      — free-fly (own controls).
//   Orbit    — spherical revolution around the city.
//   Top-down — a VARIANT of orbit: elevation tweened to 90°, pulled back, sweep
//              paused, camera.up tipped to north. The pre-top-down orbit framing
//              is snapshotted in orbitRestore so returning to Orbit tweens back
//              from wherever top-down currently sits.

const ORBIT_TWEEN_SEC = 2.0;

// Top-down must frame the WHOLE city plus a margin, in any aspect — the
// CURRENT tier's gen extent (maxHalfExtent, runtime), not the fixed look-scale
// CITY_HALF_EXTENT, which stopped tracking the city when the size tiers (#58)
// landed (a Metropolis only showed its central 3 km). orthoSize is the ortho
// frustum half-height; half-width = aspect × orthoSize (see ProjectionBlender),
// so the limiting axis sets
//   orthoSize = H / min(1, aspect).
// The margin also absorbs the orbit-centre Z offset (the camera pivots on the
// orbit centre, not the city centre). Perspective frames the same extent at
// radius = orthoSize / tan(fov/2); clamped so a tiny FOV can't fling the camera
// past the far plane.
const TOP_DOWN_MARGIN = 1.15;

function topDownFraming(): { orthoSize: number; radius: number } {
  const H = maxHalfExtent() * TOP_DOWN_MARGIN;
  const aspect =
    typeof window !== "undefined" ? window.innerWidth / Math.max(1, window.innerHeight) : 1;
  const orthoSize = H / Math.min(1, aspect);
  const fovRad = (useSceneStore.getState().cameraIntent.fov * Math.PI) / 180;
  const radius = Math.min(12000, Math.max(1000, orthoSize / Math.max(0.05, Math.tan(fovRad / 2))));
  return { orthoSize, radius };
}

// Exported for the Camera header's default/free pose toggle (CameraPanel).
export function tweenOrbitTowards(
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
  // Radius + orthoSize ramp in over the late half, overlapping the tail of the
  // swing so the whole motion feels like one continuous arc.
  const tl = gsap.timeline({ onComplete });

  const elProxy = { v: fromEl };
  tl.to(
    elProxy,
    {
      v: targetEl,
      duration: ORBIT_TWEEN_SEC,
      ease: "power1.inOut",
      onUpdate: () => useSceneStore.getState().setOrbit({ elevationDeg: elProxy.v }),
    },
    0,
  );

  // North "up" roll, tweened over the WHOLE transition (target 1 only when
  // arriving at top-down, el≈90). Eased in lockstep with the arc so the roll
  // spreads across the tween instead of snapping in the final elevation degrees.
  const tipProxy = { v: s.topDownTip };
  tl.to(
    tipProxy,
    {
      v: targetEl >= 89 ? 1 : 0,
      duration: ORBIT_TWEEN_SEC,
      ease: "power1.inOut",
      onUpdate: () => useSceneStore.getState().setTopDownTip(tipProxy.v),
    },
    0,
  );

  const zoomProxy = { v: 0 };
  tl.to(
    zoomProxy,
    {
      v: 1,
      duration: ORBIT_TWEEN_SEC * 0.7,
      ease: "power1.inOut",
      onUpdate: () => {
        const t = zoomProxy.v;
        const st = useSceneStore.getState();
        st.setOrbit({ radius: fromR + (targetR - fromR) * t });
        st.setOrthoSize(fromOrtho + (targetOrtho - fromOrtho) * t);
      },
    },
    ORBIT_TWEEN_SEC * 0.4,
  );
}

function tweenOrbitTopDown() {
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
  const { orthoSize, radius } = topDownFraming();
  tweenOrbitTowards(90, radius, orthoSize);
}

function tweenOrbitRestore() {
  const s = useSceneStore.getState();
  const r = s.orbitRestore;
  if (!r) return;
  tweenOrbitTowards(r.elevationDeg, r.radius, r.orthoSize, () => {
    const st = useSceneStore.getState();
    st.setOrbitPaused(r.paused);
    st.setOrbitRestore(null);
  });
}

// Drop a held top-down snapshot back into the orbit config without animating —
// used when switching to a mode where the tween would be invisible (Fly), so
// orbit state is always "normal" when not actively in top-down.
function restoreOrbitSilently() {
  const s = useSceneStore.getState();
  const r = s.orbitRestore;
  if (!r) return;
  s.setOrbit({ elevationDeg: r.elevationDeg, radius: r.radius });
  s.setOrthoSize(r.orthoSize);
  s.setOrbitPaused(r.paused);
  s.setOrbitRestore(null);
  s.setTopDownTip(0); // silent exit lands at a low elevation — drop the roll
}

export function isTopDown(): boolean {
  const s = useSceneStore.getState();
  return s.cameraMode === "orbit" && s.orbitRestore !== null;
}

export type CameraTab = "fly" | "orbit" | "top-down";

export function currentCameraTab(cameraMode: string, orbitRestoreSet: boolean): CameraTab {
  if (cameraMode === "fly") return "fly";
  if (cameraMode === "orbit" && orbitRestoreSet) return "top-down";
  return "orbit";
}

export function enterFlyMode() {
  restoreOrbitSilently();
  useSceneStore.getState().setCameraMode("fly");
}

export function enterOrbitMode() {
  const s = useSceneStore.getState();
  if (s.cameraMode === "orbit" && s.orbitRestore !== null) {
    tweenOrbitRestore(); // exit top-down → animate back from the current overhead view
    return;
  }
  restoreOrbitSilently();
  s.setCameraMode("orbit");
}

export function enterTopDownMode() {
  const s = useSceneStore.getState();
  if (s.cameraMode !== "orbit") s.setCameraMode("orbit"); // works from Fly too
  tweenOrbitTopDown();
}

export function setCameraTab(tab: CameraTab) {
  if (tab === "fly") enterFlyMode();
  else if (tab === "orbit") enterOrbitMode();
  else enterTopDownMode();
}

// `t` hotkey: toggle top-down on/off (enter from orbit or fly, exit back to orbit).
export function toggleTopDown() {
  if (isTopDown()) enterOrbitMode();
  else enterTopDownMode();
}

// "Default Orbit" button: reset the orbit framing to DEFAULT_ORBIT with a tween
// (elevation / radius / orthoSize animate; azimuth is kept so it doesn't spin).
export function tweenOrbitToDefault() {
  const s = useSceneStore.getState();
  s.setOrbitRestore(null);
  if (s.cameraMode !== "orbit") s.setCameraMode("orbit");
  s.setOrbitPaused(false);
  s.setOrbit({ lookAtY: DEFAULT_ORBIT.lookAtY, periodSec: DEFAULT_ORBIT.periodSec });
  tweenOrbitTowards(DEFAULT_ORBIT.elevationDeg, DEFAULT_ORBIT.radius, DEFAULT_ORTHO_SIZE);
}

const PROJECTION_TWEEN_DURATION = 1.0;

// Per-mode distance memory. DISTANCE is the "slack" value, decoupled from the zoom: in
// perspective it's the hero-shot dolly (mouse-wheel); in orthographic it only sets
// clip-safety (orthoSize fixes the apparent size, so radius parks far out — see
// orthoMinRadius in DreiSceneControls). Seeded with the page-load defaults and updated to
// the live radius whenever a mode is left, so toggling away and back restores the distance
// that mode was last at.
const rememberedRadius: Record<"perspective" | "orthographic", number> = {
  perspective: DEFAULT_PERSP_RADIUS,
  orthographic: DEFAULT_ORBIT.radius,
};

// The single in-flight projection tween. Killed before a new one starts so a
// mid-tween reversal (toggling back before the swap finishes) animates cleanly
// from the current blend instead of two tweens fighting over projectionBlend.
let projTween: gsap.core.Tween | null = null;

// Projection swap (perspective ⇄ orthographic) — shared by the Camera panel's projection
// toggle and the `p` hotkey so both animate identically. fov (perspective) and orthoSize
// (ortho) are the user's SOVEREIGN zoom and are never rewritten on a toggle. DISTANCE is the
// slack: it tweens to whatever the target mode last sat at (rememberedRadius) while
// projectionBlend tweens 0↔1. The two views need NOT be K-matched — ProjectionBlender's
// framing bridge interpolates the focal-plane half-height (perspK ↔ orthoSize) across the
// morph, so the swap stays continuous even when perspective frames a different slice than
// ortho. See camera-tuning-notes #2 (2026-06-14 framing-bridge rework). Interruptible.
export function tweenProjectionTo(target: "perspective" | "orthographic") {
  const s = useSceneStore.getState();
  if (s.projection === target) return;
  // Remember where the mode we're leaving sat, then slide to the target mode's distance.
  rememberedRadius[s.projection] = s.orbit.radius;
  const targetRadius = rememberedRadius[target];
  s.setProjection(target);
  // Start from the LIVE blend + radius (mid-tween if interrupted), not a stale snapshot.
  projTween?.kill();
  const proxy = { v: s.projectionBlend, r: s.orbit.radius };
  const to = target === "orthographic" ? 1 : 0;
  projTween = gsap.to(proxy, {
    v: to,
    r: targetRadius,
    duration: PROJECTION_TWEEN_DURATION,
    ease: "power1.inOut",
    onUpdate: () => {
      const st = useSceneStore.getState();
      st.setProjectionBlend(proxy.v);
      st.setOrbit({ radius: proxy.r });
    },
    onComplete: () => {
      projTween = null;
    },
  });
}

// `p` hotkey: toggle to whichever projection isn't current.
export function toggleProjection() {
  const s = useSceneStore.getState();
  tweenProjectionTo(s.projection === "orthographic" ? "perspective" : "orthographic");
}

// `d` hotkey (orbit only): flip every render group to wireframe, remembering the
// exact prior modes; press again to restore them. Snapshot is module-level, so a
// reload/HMR just starts fresh (next `d` re-snapshots).
let wireframeSnapshot: Record<RenderGroup, RenderMode> | null = null;
export function toggleAllWireframe() {
  const s = useSceneStore.getState();
  if (wireframeSnapshot) {
    s.setRenderModes(wireframeSnapshot);
    wireframeSnapshot = null;
  } else {
    wireframeSnapshot = { ...s.debug.renderModes };
    s.setAllRenderModes("wireframe");
  }
}
