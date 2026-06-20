"use client";

// Grey-box "zoo" for the Camera Lab: a city-scale field of neutral stand-in blocks
// so camera feel transfers to the real scene, but rendered flat-grey under bright
// ambient + key light so it reads unmistakably as a test rig, not the city. A few
// coloured LANDMARKS give the test-plan tasks ("frame the amber tower") concrete
// targets. Fully deterministic (seeded PRNG, no Math.random in the render path).

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Grid } from "@react-three/drei";

// Half-extent of the block field (~2.8 km across, in the city's scale ballpark so
// the camera distances/feel match the real scene).
export const LAB_EXTENT = 1400;

const SPACING = 150;
const AXIS = Math.floor(LAB_EXTENT / SPACING); // grid runs -AXIS..AXIS

export type Landmark = {
  id: string;
  label: string;
  color: string;
  pos: [number, number, number]; // ground position (y is the base, 0)
  size: [number, number, number]; // w, h, d
};

// Cardinal coloured markers — distinct shapes at the four quadrants for framing
// tasks and orientation. y in `pos` is ignored (base sits on the ground).
export const LANDMARKS: Landmark[] = [
  { id: "amber-tower", label: "Amber tower (NE)", color: "#e0a35f", pos: [820, 0, 820], size: [120, 760, 120] },
  { id: "teal-slab", label: "Teal slab (NW)", color: "#5fb8b0", pos: [-720, 0, 520], size: [340, 200, 90] },
  { id: "red-cube", label: "Red cube (SE)", color: "#d06868", pos: [640, 0, -780], size: [170, 170, 170] },
  { id: "violet-spire", label: "Violet spire (SW)", color: "#9a7fd0", pos: [-820, 0, -640], size: [80, 540, 80] },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Box = { x: number; z: number; w: number; d: number; h: number; grey: number };

function GreyBoxes() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const boxes = useMemo<Box[]>(() => {
    const rnd = mulberry32(0x5747); // fixed seed → identical field every load
    const out: Box[] = [];
    for (let gx = -AXIS; gx <= AXIS; gx++) {
      for (let gz = -AXIS; gz <= AXIS; gz++) {
        if (rnd() < 0.34) continue; // gaps read as streets / plazas
        const j = SPACING * 0.3;
        const x = gx * SPACING + (rnd() * 2 - 1) * j;
        const z = gz * SPACING + (rnd() * 2 - 1) * j;
        if (Math.hypot(x, z) > LAB_EXTENT) continue;
        const w = 55 + rnd() * 70;
        const d = 55 + rnd() * 70;
        // Taller toward the centre, mostly low with a long tail of towers.
        const central = 1 - Math.min(1, Math.hypot(x, z) / LAB_EXTENT);
        const h = 30 + rnd() * rnd() * (110 + central * 470);
        out.push({ x, z, w, d, h, grey: 0.16 + rnd() * 0.13 });
      }
    }
    return out;
  }, []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    boxes.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.h / 2, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setScalar(b.grey));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [boxes]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, boxes.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.92} metalness={0} />
    </instancedMesh>
  );
}

export function GreyBoxCity() {
  return (
    <group>
      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[LAB_EXTENT * 3, LAB_EXTENT * 3]} />
        <meshStandardMaterial color="#2a2d33" roughness={1} metalness={0} />
      </mesh>

      {/* zoo grid — makes scale + motion legible (clearly a test rig) */}
      <Grid
        position={[0, 0.2, 0]}
        args={[LAB_EXTENT * 2, LAB_EXTENT * 2]}
        cellSize={SPACING}
        cellThickness={0.6}
        cellColor="#3a3e46"
        sectionSize={SPACING * 5}
        sectionThickness={1.1}
        sectionColor="#51e0c8"
        fadeDistance={LAB_EXTENT * 2.4}
        fadeStrength={1.2}
        infiniteGrid={false}
      />

      <GreyBoxes />

      {LANDMARKS.map((l) => (
        <mesh key={l.id} position={[l.pos[0], l.size[1] / 2, l.pos[2]]} castShadow receiveShadow>
          <boxGeometry args={l.size} />
          <meshStandardMaterial color={l.color} roughness={0.7} metalness={0} emissive={l.color} emissiveIntensity={0.12} />
        </mesh>
      ))}
    </group>
  );
}
