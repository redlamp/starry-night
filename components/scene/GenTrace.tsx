"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { subscribeGenProgress } from "@/lib/workers/cityGenClient";

// #59 Phase B — the city "draws itself" while the worker generates. The road
// tracer streams accepted streamlines mid-compute; this overlay accumulates them
// into one additive LineSegments (a faint blueprint of the network tracing in),
// and unmounts the moment cityReady flips and the real scene takes over.
//
// Display-only: the lines are decimated copies of the traced roads — nothing
// deterministic reads them. Silent when the cache is warm (no progress events,
// ready flips immediately) and under the sync fallback path.
const TRACE_Y = 0.6; // just above ground + district shells
const ARTERIAL_RGB: [number, number, number] = [0.62, 0.78, 1.0]; // bright blue-white
const MINOR_RGB: [number, number, number] = [0.18, 0.28, 0.48]; // dim slate

export function GenTrace({ masterSeed }: { masterSeed: string }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  // Accumulated segment soup across batches (positions + per-vertex colors).
  const positionsRef = useRef<number[]>([]);
  const colorsRef = useRef<number[]>([]);

  useEffect(() => {
    positionsRef.current = [];
    colorsRef.current = [];
    const unsubscribe = subscribeGenProgress((e) => {
      // Only this scene's generation: /plan tiles stream other seeds, and a
      // mid-flight tier/crop switch leaves a stale request still posting.
      const s = useSceneStore.getState();
      if (
        e.seed !== masterSeed ||
        e.tier !== s.citySize ||
        e.shape !== s.cityShape ||
        e.scale !== s.cityShapeScale
      )
        return;
      const pos = positionsRef.current;
      const col = colorsRef.current;
      for (const line of e.lines) {
        const rgb = line.tier === "arterial" ? ARTERIAL_RGB : MINOR_RGB;
        const p = line.pts; // [x0, z0, x1, z1, ...]
        for (let i = 0; i + 3 < p.length; i += 2) {
          pos.push(p[i], TRACE_Y, p[i + 1], p[i + 2], TRACE_Y, p[i + 3]);
          col.push(rgb[0], rgb[1], rgb[2], rgb[0], rgb[1], rgb[2]);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos.slice(), 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col.slice(), 3));
      setGeometry((old) => {
        old?.dispose();
        return geo;
      });
    });
    return () => {
      unsubscribe();
      positionsRef.current = [];
      colorsRef.current = [];
      setGeometry((old) => {
        old?.dispose();
        return null;
      });
    };
  }, [masterSeed]);

  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.55}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}
