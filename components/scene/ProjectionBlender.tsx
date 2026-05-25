"use client";

import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";

// Keeps a single PerspectiveCamera under the hood but overrides its projection
// matrix each frame when projectionBlend > 0, lerping toward an orthographic
// matrix derived from orthoSize. At blend = 0 the camera renders pure
// perspective; at blend = 1 it renders pure ortho; in between it's a smooth
// matrix lerp (used during the GSAP swap tween).
//
// Also applies cameraIntent.fov to the camera every frame so the FOV slider
// works in orbit / fly modes too (which don't run the still-mode intent effect).
const _persp = new THREE.Matrix4();
const _ortho = new THREE.Matrix4();
const _blended = new THREE.Matrix4();

export function ProjectionBlender() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const blend = useSceneStore((s) => s.projectionBlend);
  const orthoSize = useSceneStore((s) => s.orthoSize);
  const fov = useSceneStore((s) => s.cameraIntent.fov);

  useFrame(() => {
    if (!(camera as THREE.Camera & { isPerspectiveCamera?: boolean }).isPerspectiveCamera)
      return;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (blend <= 0.0001) return;

    const aspect = size.width / Math.max(1, size.height);
    const near = camera.near;
    const far = camera.far;

    _persp.copy(camera.projectionMatrix);
    _ortho.makeOrthographic(
      -aspect * orthoSize,
      aspect * orthoSize,
      orthoSize,
      -orthoSize,
      near,
      far,
    );

    if (blend >= 0.9999) {
      _blended.copy(_ortho);
    } else {
      for (let i = 0; i < 16; i++) {
        _blended.elements[i] =
          _persp.elements[i] * (1 - blend) + _ortho.elements[i] * blend;
      }
    }
    camera.projectionMatrix.copy(_blended);
    camera.projectionMatrixInverse.copy(_blended).invert();
  });

  return null;
}
