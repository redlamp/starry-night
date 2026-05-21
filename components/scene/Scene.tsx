"use client";

import { Canvas } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import { PlaceholderBuilding } from "./PlaceholderBuilding";

export function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 4, 18], fov: 45 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#000"]} />
      <ambientLight intensity={0.05} />
      <directionalLight position={[10, 20, 5]} intensity={0.2} />

      <Stars radius={150} depth={80} count={6000} factor={5} saturation={0} fade speed={0} />

      <PlaceholderBuilding />
    </Canvas>
  );
}
