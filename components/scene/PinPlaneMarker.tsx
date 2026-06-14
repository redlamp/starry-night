"use client";

import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";

// Throwaway camera-tuning aid (2026-06-14): visualises the plane through the focal
// pin, perpendicular to the view axis — the plane where perspective and ortho frame
// identical content. Two coplanar rectangles outline each projection's footprint on
// it: ORTHO in sky-blue (= orthoSize), PERSPECTIVE in soil-brown (= radius·tan(fov/2),
// the pin colours above/below ground). Dial perspective fov/distance until the brown
// rect lands on the blue one → matched framing. Each rect is shifted vertically by the
// Screen-Y pivot exactly as applyScreenFocus shifts the real view, so the outlines sit
// on the actual frame edges, not on the (off-centre) pin. Display-only; remove once the
// perspective default is dialed in. Visible in orbit when debug.showPinPlane.
const COLOR_ORTHO = "#7dd3fc"; // pin colour above ground (sky) — DreiSceneControls COLOR_ABOVE
const COLOR_PERSP = "#b5835a"; // pin colour below ground (soil) — DreiSceneControls COLOR_BELOW
const DEG = Math.PI / 180;

const _focal = new THREE.Vector3();

// A unit (−1..1) rectangle highlight: faint fill + crisp outline, scaled per frame.
function makeRect(color: string): THREE.Group {
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.07,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  fill.renderOrder = 10;
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, -1, 0),
      new THREE.Vector3(1, -1, 0),
      new THREE.Vector3(1, 1, 0),
      new THREE.Vector3(-1, 1, 0),
    ]),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false, // always visible — never occluded by the city
    }),
  );
  outline.renderOrder = 12;
  const g = new THREE.Group();
  g.add(fill, outline);
  return g;
}

function disposeRect(g: THREE.Group): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh | THREE.LineLoop;
    if (m.geometry) m.geometry.dispose();
    if (m.material) (m.material as THREE.Material).dispose();
  });
}

export function PinPlaneMarker() {
  const show = useSceneStore((s) => s.debug.showPinPlane);
  const mode = useSceneStore((s) => s.cameraMode);
  const group = useRef<THREE.Group>(null);

  const orthoRect = useMemo(() => makeRect(COLOR_ORTHO), []);
  const perspRect = useMemo(() => makeRect(COLOR_PERSP), []);

  useEffect(
    () => () => {
      disposeRect(orthoRect);
      disposeRect(perspRect);
    },
    [orthoRect, perspRect],
  );

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const visible = show && mode === "orbit";
    g.visible = visible;
    if (!visible) return;
    const s = useSceneStore.getState();
    // Centre on the focal pin and face the camera, so the group's XY plane is
    // perpendicular to the view axis (the plane we described).
    _focal.set(s.orbit.centerX, s.orbit.lookAtY, s.orbit.centerZ);
    g.position.copy(_focal);
    g.lookAt(state.camera.position);

    const aspect = state.size.width / Math.max(1, state.size.height);
    // Screen-Y pivot: the pin sits `pivot` up from the bottom, so each frustum's
    // CENTRE is (0.5 − pivot)·fullHeight above the pin → shift the rect up by
    // (1 − 2·pivot)·halfHeight along the plane's local up. Mirrors applyScreenFocus.
    const pivotShift = 1 - 2 * s.orbitPivotFromBottom;

    // Ortho footprint: half-height = orthoSize; half-width = aspect × orthoSize.
    const oH = s.orthoSize;
    orthoRect.scale.set(aspect * oH, oH, 1);
    orthoRect.position.set(0, pivotShift * oH, 0);

    // Perspective footprint at this radius/fov: half-height = d·tan(fov/2).
    const pH = s.orbit.radius * Math.tan((s.cameraIntent.fov * DEG) / 2);
    perspRect.scale.set(aspect * pH, pH, 1);
    perspRect.position.set(0, pivotShift * pH, 0);
  });

  return (
    <group ref={group} visible={false}>
      <primitive object={orthoRect} />
      <primitive object={perspRect} />
    </group>
  );
}
