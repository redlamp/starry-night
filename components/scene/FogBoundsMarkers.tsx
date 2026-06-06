"use client";

import { useMemo, useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { fogBoundsVertexShader, fogBoundsFragmentShader } from "@/lib/shaders/fogBounds";

// In-world readout for the atmosphere near/far brackets: while the user drags
// those sliders (`fogAdjusting`), two boundary curtains show where the fog
// actually starts and ends — 300 m walls, solid at the ground fading to
// nothing at the top. The brackets are camera-distance spheres, so the walls
// are centred on the CAMERA's ground projection (not the city centre) — radii
// read straight from the live scene.fog that FogTicker just wrote, so the
// marker can never disagree with the real fog. Display-only.
const RING_COLORS = { near: "#4dd0e1", far: "#ff8fa3" } as const;
const WALL_HEIGHT = 300; // m

function makeWall(color: string): THREE.Mesh {
  // Unit-radius open cylinder, full height baked in; scaled per frame on XZ to
  // the bracket radius.
  const geo = new THREE.CylinderGeometry(1, 1, WALL_HEIGHT, 96, 1, true);
  const mat = new THREE.ShaderMaterial({
    vertexShader: fogBoundsVertexShader,
    fragmentShader: fogBoundsFragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0.55 },
      uHeight: { value: WALL_HEIGHT },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WALL_HEIGHT / 2;
  mesh.renderOrder = 10;
  return mesh;
}

export function FogBoundsMarkers() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const adjusting = useSceneStore((s) => s.fogAdjusting);
  const mode = useSceneStore((s) => s.fog.mode);

  const near = useMemo(() => makeWall(RING_COLORS.near), []);
  const far = useMemo(() => makeWall(RING_COLORS.far), []);
  const group = useRef<THREE.Group>(null);

  useEffect(
    () => () => {
      for (const m of [near, far]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
    [near, far],
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const fog = scene.fog as THREE.Fog | null;
    const show = adjusting && mode === "linear" && !!fog && (fog as THREE.Fog).isFog;
    g.visible = show;
    if (!show) return;
    // Centre on the camera's ground projection; radius = the live brackets
    // (XZ only — wall height is baked into the geometry).
    g.position.set(camera.position.x, 0, camera.position.z);
    near.scale.set(Math.max(1, fog.near), 1, Math.max(1, fog.near));
    far.scale.set(Math.max(1, fog.far), 1, Math.max(1, fog.far));
  });

  return (
    <group ref={group} visible={false}>
      <primitive object={near} />
      <primitive object={far} />
    </group>
  );
}
