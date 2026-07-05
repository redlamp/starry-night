"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

// The app fakes orthographic projection by overriding a PerspectiveCamera's
// projectionMatrix each frame (see ProjectionBlender) — the camera stays
// `isPerspectiveCamera === true`. three's Raycaster.setFromCamera branches on the
// camera TYPE, so R3F's event raycaster always builds PERSPECTIVE rays (fanning
// out from the eye) even in ortho. That mis-picks everything away from screen
// centre: in ortho the rays should be PARALLEL, so hover/selection land on the
// wrong building (or none). Detect the ortho projection from the live matrix
// (perspective has elements[11] === -1; a true ortho matrix has 0) and build the
// correct parallel ray — origin on the near plane under the cursor, direction =
// camera forward. Restores the native behaviour on unmount.
export function OrthoPickingFix() {
  const raycaster = useThree((s) => s.raycaster);

  useEffect(() => {
    const original = raycaster.setFromCamera.bind(raycaster);
    raycaster.setFromCamera = (coords: THREE.Vector2, cam: THREE.Camera) => {
      const pm = (cam as THREE.PerspectiveCamera).projectionMatrix;
      if (pm && Math.abs(pm.elements[11]) < 1e-6) {
        // Orthographic: parallel rays. unproject uses cam.projectionMatrixInverse
        // (ProjectionBlender keeps it in sync with the ortho override each frame).
        raycaster.ray.origin.set(coords.x, coords.y, -1).unproject(cam);
        raycaster.ray.direction.set(0, 0, -1).transformDirection(cam.matrixWorld);
        raycaster.camera = cam;
        return;
      }
      original(coords, cam);
    };
    return () => {
      raycaster.setFromCamera = original;
    };
  }, [raycaster]);

  return null;
}
