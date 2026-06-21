"use client";

// Continuous perspective ↔ orthographic MORPH for the camera-controls methods (app parity: the
// main app's projection blender). ONE PerspectiveCamera renders everything; "orthographic" is
// faked by overriding the camera's projectionMatrix. blend 0 = perspective, 1 = (near-)ortho;
// toggling eases the blend across so the projection MORPHS instead of snapping.
//
// The morph is a RECEDING-EYE construction, NOT an element-wise matrix lerp. A naive lerp of the
// perspective and ortho matrices blends the clip-w from -z toward 1, but for a scene whose depths
// are large in world units the -z term dominates until blend ≈ 0.999 — so the view stays fully
// perspective and then SNAPS to ortho at the very end. Instead we keep full perspective division
// (w = -z + C) and pull a virtual eye back from the focal plane (distance E = d/k, k: 1→0), adding
// a constant C = d·(1-k)/k to w while scaling x/y to hold the focal-plane size fixed. That makes
// the foreshortening change smoothly across the whole blend (k=1 → exact perspective; k→0 → ortho).
//
// Because it is always one camera, the pose is inherently continuous (no drei rebuild on toggle)
// and project/unproject use the live blended matrix — so the lever-arm screen math and the
// ground-anchored pan keep working at any blend (groundHit casts through the same matrix).
//
// Also owns the per-frame upkeep shared by every camera-controls method: the Screen-Y pivot park
// (lever-arm), the ground clamp (ortho horizon floor easing in by blend), the live readout, and
// the __labCC debug handle. `window.__labBlend` (a number) force-overrides the blend for headless
// verification of a frozen mid-morph.

import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type CameraControlsImpl from "camera-controls";
import { parkFocal, clampPolarToGround, cameraHalfHeight } from "./labProjection";
import type { CamReadout } from "@/components/scene/CameraDiagram";

const DEG = Math.PI / 180;
const K_MIN = 0.003; // virtual-eye factor at full ortho (k = d/E); ~0.17% residual foreshortening, visually parallel
const _t = new THREE.Vector3();

export function ProjectionRig({
  controls,
  leverArm,
  projection,
  focusRef,
  onReadout,
}: {
  controls: React.RefObject<CameraControlsImpl | null>;
  leverArm: boolean;
  projection: "perspective" | "orthographic";
  focusRef: React.RefObject<THREE.Vector3>;
  onReadout: (r: CamReadout) => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const blend = useRef(0);
  const seeded = useRef(false);

  // Restore the natural perspective matrix when this rig unmounts (switching to a method that runs
  // its own camera), so a left-over ortho override doesn't bleed into the next method.
  useEffect(() => () => camera.updateProjectionMatrix(), [camera]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    (window as unknown as Record<string, unknown>).__labCC = c;

    // Ease the blend toward the target. Snap on the first frame (so a persisted ortho doesn't morph
    // on load); a numeric window.__labBlend force-overrides (headless mid-morph capture).
    const forced = (window as unknown as { __labBlend?: number }).__labBlend;
    const target = projection === "orthographic" ? 1 : 0;
    if (typeof forced === "number") blend.current = THREE.MathUtils.clamp(forced, 0, 1);
    else if (!seeded.current) blend.current = target;
    else {
      blend.current = THREE.MathUtils.damp(blend.current, target, 9, dt);
      if (Math.abs(blend.current - target) < 0.001) blend.current = target;
    }
    seeded.current = true;
    const t = blend.current;

    // Apply the projection. updateProjectionMatrix() restores the natural perspective (current
    // aspect / near / far); above ~0 we overwrite it with the receding-eye morph matrix.
    camera.updateProjectionMatrix();
    if (t > 0.0005) {
      const tanH = Math.tan((camera.fov * DEG) / 2);
      const aspect = camera.aspect;
      const near = camera.near;
      const far = camera.far;
      const d = c.distance; // focal-plane distance — held at constant apparent size through the morph
      const k = 1 - (1 - K_MIN) * t; // virtual-eye factor: 1 = perspective, K_MIN = (near-)ortho
      const C = (d * (1 - k)) / k; // constant added to clip-w (0 → perspective, large → ortho)
      const A = 1 / (k * tanH * aspect); // x scale (holds focal-plane width as the eye recedes)
      const B = 1 / (k * tanH); // y scale
      const a = -(near + far + 2 * C) / (far - near); // z-clip terms (depth maps [near,far] → [-1,1])
      const b = -(near + C) + near * a;
      // column-major: clip.x=A·x, clip.y=B·y, clip.z=a·z+b, clip.w=-z+C
      camera.projectionMatrix.set(
        A, 0, 0, 0,
        0, B, 0, 0,
        0, 0, a, b,
        0, 0, -1, C,
      );
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }

    parkFocal(c, camera, leverArm);
    clampPolarToGround(c, camera, t);
    // read the LIVE (animating) target, not the end goal — so the pin + readout track a reset's
    // setLookAt transition smoothly instead of snapping to the destination while the camera tweens.
    c.getTarget(_t, false);
    focusRef.current.copy(_t);
    // Write the readout EVERY frame (cheap — the consumer is a ref-backed HUD that self-drives its
    // own re-render, so this no longer re-renders CameraLab and needs no throttle).
    onReadout({
      elev: 90 - (c.polarAngle * 180) / Math.PI,
      dist: c.distance,
      focalY: _t.y,
      camY: camera.position.y,
      parallel: t > 0.5,
      frustumHh: cameraHalfHeight(c, camera),
      blend: t,
    });
  });

  return null;
}
