"use client";

import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { orbitFramingFactor } from "@/lib/scene/aspectFraming";

// Keeps a single PerspectiveCamera under the hood but overrides its projection
// matrix each frame when projectionBlend > 0. The swap is driven by a RECEDING
// VIRTUAL EYE, not an element-wise matrix lerp: orthographic == perspective with
// the eye at infinity, so we render a perspective from a virtual eye whose
// distance recedes d → ∞ as blend 0 → 1 (the camera itself never moves — the
// pull-back is baked into the projection matrix). Foreshortening then scales
// linearly with (1 − blend), so the morph is perceptually uniform and symmetric
// in both directions. (An element-wise persp/ortho matrix lerp collapses almost
// entirely in the last sliver near blend = 1, which made persp→ortho feel like a
// delay-then-snap and ortho→persp feel instant.)
//
// Also applies cameraIntent.fov to the camera every frame so the FOV slider
// works in orbit / fly modes too (which don't run the still-mode intent effect).
const _persp = new THREE.Matrix4();
const _ortho = new THREE.Matrix4();
const _trans = new THREE.Matrix4();
const _blended = new THREE.Matrix4();
// Frozen perspective-end anchor for the framing bridge (#84) — see the capture site (the
// pure-perspective early return) and the read site (perspK) below.
let restPerspK: number | null = null;

export function ProjectionBlender() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const blend = useSceneStore((s) => s.projectionBlend);
  const orthoSize = useSceneStore((s) => s.orthoSize);
  const fov = useSceneStore((s) => s.cameraIntent.fov);
  const radius = useSceneStore((s) => s.orbit.radius);

  // Debug exposure (capture mode only): the #84 size-invariance verify script reads the
  // ACTUAL projectionMatrix baked below each frame — a black-box measurement of apparent
  // size, not a re-derivation of the framing-bridge math. See
  // scripts/verifyProjectionSizeInvariance.ts.
  useEffect(() => {
    if (!useSceneStore.getState().captureMode) return;
    (window as unknown as Record<string, unknown>).__projectionDebug = { camera };
  }, [camera]);

  useFrame(() => {
    if (!(camera as THREE.Camera & { isPerspectiveCamera?: boolean }).isPerspectiveCamera) return;
    // Narrow screens widen the framing so the skyline sits low with starry sky above — a portrait
    // frame otherwise shows only the city's tall centre. 1× landscape, up to ~1.5× at a phone;
    // still/orbit only (top-down/fly self-frame). f drives BOTH the ortho half-height (oeff) and the
    // perspective fov (fovEff) — and the morph's ortho end — so both projections + the morph between
    // them widen together. applyScreenFocus / pinScreenHit / groundHit read camera.fov + the live
    // matrix, so they pick up fovEff for free. See aspectFraming. (2026-06-14)
    const aspect = size.width / Math.max(1, size.height);
    const f = orbitFramingFactor(aspect);
    const fovRad = (fov * Math.PI) / 180;
    // Always rebuild the pure perspective matrix first, so when a blend ends at 0 the camera
    // doesn't keep rendering with the last-computed override.
    camera.fov = f === 1 ? fov : (Math.atan(f * Math.tan(fovRad / 2)) * 2 * 180) / Math.PI;
    camera.updateProjectionMatrix();
    if (blend <= 0.0001) {
      // At rest in pure perspective: (re)capture the un-widened focal-plane half-height as the
      // anchor perspK freezes to once a blend starts (see below). Recaptured every frame spent
      // here, so zooming while at rest keeps it current — it only goes stale (on purpose) the
      // moment blend leaves 0, which is what stops radius drift during a blend from reading as
      // the apparent size "breathing" (#84).
      restPerspK = Math.max(1, radius) * Math.tan(fovRad / 2);
      return; // pure perspective
    }

    const near = camera.near;
    const far = camera.far;
    const oeff = orthoSize * f;

    if (blend >= 0.9999) {
      // Pure orthographic — exact, and avoids the huge virtual-eye numbers.
      // #88: camera.near (0.5, tuned for the PERSPECTIVE lens) used to double as the
      // ortho near plane too, clipping anything within 0.5 world units of the real
      // eye. That's fine for perspective (the eye is a real vanishing point) but
      // wrong for a true ortho matrix: there's no perspective divide, so the near
      // plane can sit far BEHIND the eye without moving the image at all. At a
      // shallow, oblique tilt with a wide frustum (large oeff), the bottom rows of
      // the frame project to world points that are behind the eye along the view
      // axis — camera.near excluded them, which read as close buildings sliced by a
      // plane parallel to the image, and the ground clipped at the frame's bottom
      // edge. Mirror `far` behind the eye instead: it's already sized to the scene
      // with generous headroom, so it covers the worst case without a new constant.
      // Left untouched: the partial-blend branch below (0 < blend < 1) — its dz-shifted
      // near/far already keep the near-clip plane fixed in world space (E + near·F)
      // for the whole tween, and swapping in a very negative near there would need a
      // much larger dz to stay positive inside makePerspective, which it doesn't have
      // early in the tween.
      const nearOrtho = -far;
      _ortho.makeOrthographic(-aspect * oeff, aspect * oeff, oeff, -oeff, nearOrtho, far);
      camera.projectionMatrix.copy(_ortho);
      camera.projectionMatrixInverse.copy(_ortho).invert();
      return;
    }

    // Virtual eye distance E recedes from d (perspective) toward ∞ (ortho).
    const d = Math.max(1, radius);
    const u = Math.max(1 - blend, 1e-4); // 1 = perspective … 0 = ortho
    const E = d / u;
    const dz = E - d; // how far the virtual eye sits behind the real camera
    const nearV = near + dz;
    const farV = far + dz;
    // Framing BRIDGE: the half-height held at the focal plane is not a fixed orthoSize but
    // a lerp from what PERSPECTIVE frames there (perspK = d·tan(fov/2), at blend 0) to what
    // ORTHO frames there (orthoSize, at blend 1). This is what lets perspective distance and
    // ortho size be authored independently (different K) while the morph stays continuous at
    // BOTH ends: the focal-plane content grows/shrinks smoothly across the blend instead of
    // popping the instant blend leaves 0. When the two views are already K-matched
    // (d·tan(fov/2) == orthoSize) Hb is constant and this is byte-for-byte the old
    // orthoSize-only matrix. (2026-06-14)
    // Frozen at the last rest-in-perspective anchor (above), NOT live off `d` — a radius that
    // tweens alongside blend (tweenProjectionTo, or top-down's remembered-radius gap vs its
    // K-matched anchor) would otherwise drag perspK with it, so the bridge no longer returns to
    // the SAME value it started from and the apparent size visibly breathes mid-blend. Null only
    // on a frame that blends before any pure-perspective frame ever ran (e.g. booting straight
    // into a blend) — fall back to the live d for that one frame.
    const perspK = (restPerspK ?? d * Math.tan(fovRad / 2)) * f; // aspect-widened perspective end
    const Hb = perspK + (oeff - perspK) * blend; // both ends widened by f → morph stays consistent
    const top = (nearV * Hb) / E;
    const right = top * aspect;
    _persp.makePerspective(-right, right, top, -top, nearV, farV);
    // Shift view-space geometry back by dz so it's measured from the virtual eye.
    _trans.makeTranslation(0, 0, -dz);
    _blended.multiplyMatrices(_persp, _trans);
    camera.projectionMatrix.copy(_blended);
    camera.projectionMatrixInverse.copy(_blended).invert();
  });

  return null;
}
