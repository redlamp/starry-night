"use client";

import { Canvas } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { InstancedCity } from "./InstancedCity";
import { Moon } from "./Moon";
import { Ground } from "./Ground";
import { Streetlights } from "./Streetlights";
import { CameraControls } from "./CameraControls";
import { PerfMonitor } from "./PerfMonitor";
import { TimeTicker } from "./TimeTicker";

export function Scene() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const intent = useSceneStore((s) => s.cameraIntent);

  return (
    <Canvas
      camera={{ position: intent.position, fov: intent.fov, near: 0.5, far: 4000 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      dpr={[1, 2]}
    >
      <CameraControls />
      <PerfMonitor />
      <TimeTicker />

      <color attach="background" args={["#0a1838"]} />
      <fog attach="fog" args={["#0a1838", 220, 1100]} />
      <ambientLight intensity={0.04} />

      <Stars radius={1200} depth={400} count={8000} factor={20} saturation={0} fade speed={0} />

      <Moon />
      <Ground />
      <InstancedCity masterSeed={masterSeed} />
      <Streetlights masterSeed={masterSeed} />
    </Canvas>
  );
}
