"use client";

import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";

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

export function ProjectionBlender() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const blend = useSceneStore((s) => s.projectionBlend);
  const orthoSize = useSceneStore((s) => s.orthoSize);
  const fov = useSceneStore((s) => s.cameraIntent.fov);
  const radius = useSceneStore((s) => s.orbit.radius);

  useFrame(() => {
    if (!(camera as THREE.Camera & { isPerspectiveCamera?: boolean }).isPerspectiveCamera) return;
    // Always rebuild the pure perspective matrix first, so when a blend ends at
    // 0 the camera doesn't keep rendering with the last-computed override.
    camera.fov = fov;
    camera.updateProjectionMatrix();
    if (blend <= 0.0001) return; // pure perspective

    const aspect = size.width / Math.max(1, size.height);
    const near = camera.near;
    const far = camera.far;

    if (blend >= 0.9999) {
      // Pure orthographic — exact, and avoids the huge virtual-eye numbers.
      _ortho.makeOrthographic(
        -aspect * orthoSize,
        aspect * orthoSize,
        orthoSize,
        -orthoSize,
        near,
        far,
      );
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
    const perspK = d * Math.tan((fov * Math.PI) / 180 / 2);
    const Hb = perspK + (orthoSize - perspK) * blend;
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
