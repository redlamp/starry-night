"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { subscribeGenProgress } from "@/lib/workers/cityGenClient";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { sharedRoadRevealProgress } from "@/lib/shaders/sharedIntro";
import { genTraceVertexShader, genTraceFragmentShader } from "@/lib/shaders/genTrace";
import { sketchKey } from "@/lib/seed/citySketch";

// #59 Phase B, softened (spec 2026-06-05-road-reveal-cascade): accepted
// streamlines stroke on (draw-on via aBirth/aFrac) in a dim blueprint palette,
// then the whole overlay fades beneath the road cascade (uFade = 1 − progress)
// and disposes itself once invisible. Mounted unconditionally — renders null
// when there is nothing to show. Display-only; nothing deterministic reads it.
const TRACE_Y = 0.6;
const DRAW_DUR = 0.4; // s per accepted line
const ARTERIAL_RGB: [number, number, number] = [0.38, 0.48, 0.66]; // dimmed from #59
const MINOR_RGB: [number, number, number] = [0.12, 0.18, 0.32];

export function GenTrace({ masterSeed }: { masterSeed: string }) {
  // Composite key mirrors RoadRevealTicker's: any gen-input change that produces
  // a different city resets the accumulators, even without a seed change. This
  // became necessary once GenTrace is mounted unconditionally — previously a
  // tier/shape change would unmount+remount it and clear the refs via component
  // lifetime. Now we drive the same reset explicitly.
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const fieldDeviation = useSceneStore((s) => s.fieldDeviation);
  const key = `${masterSeed}::${cityShape}::${cityShapeScale}::${citySize}::${sketchKey()}::${fieldDeviation}`;

  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const positionsRef = useRef<number[]>([]);
  const colorsRef = useRef<number[]>([]);
  const birthsRef = useRef<number[]>([]);
  const fracsRef = useRef<number[]>([]);
  const disposeArmed = useRef(false);

  const materialRef = useRef<THREE.ShaderMaterial>(
    null,
  ) as React.MutableRefObject<THREE.ShaderMaterial | null>;
  if (!materialRef.current) {
    materialRef.current = new THREE.ShaderMaterial({
      vertexShader: genTraceVertexShader,
      fragmentShader: genTraceFragmentShader,
      uniforms: {
        uTime: sharedTime, // singleton by reference
        uDrawDur: { value: DRAW_DUR },
        uOpacity: { value: 0.55 },
        uFade: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
  }

  useEffect(() => {
    positionsRef.current = [];
    colorsRef.current = [];
    birthsRef.current = [];
    fracsRef.current = [];
    disposeArmed.current = false;
    const unsubscribe = subscribeGenProgress((e) => {
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
      const birth = birthsRef.current;
      const frac = fracsRef.current;
      const now = sharedTime.value;
      for (const line of e.lines) {
        const rgb = line.tier === "arterial" ? ARTERIAL_RGB : MINOR_RGB;
        const p = line.pts; // [x0, z0, x1, z1, ...]
        // Cumulative length → per-vertex fraction so the line strokes on.
        let total = 0;
        const segLen: number[] = [];
        for (let i = 0; i + 3 < p.length; i += 2) {
          const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
          segLen.push(L);
          total += L;
        }
        let acc = 0;
        for (let k = 0, i = 0; i + 3 < p.length; i += 2, k++) {
          const f0 = total > 0 ? acc / total : 0;
          acc += segLen[k];
          const f1 = total > 0 ? acc / total : 1;
          pos.push(p[i], TRACE_Y, p[i + 1], p[i + 2], TRACE_Y, p[i + 3]);
          col.push(...rgb, ...rgb);
          birth.push(now, now);
          frac.push(f0, f1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos.slice(), 3));
      geo.setAttribute("aColor", new THREE.Float32BufferAttribute(col.slice(), 3));
      geo.setAttribute("aBirth", new THREE.Float32BufferAttribute(birth.slice(), 1));
      geo.setAttribute("aFrac", new THREE.Float32BufferAttribute(frac.slice(), 1));
      disposeArmed.current = false; // a late batch after a dispose must be able to dispose again
      setGeometry((old) => {
        old?.dispose();
        return geo;
      });
    });
    return () => {
      unsubscribe();
      positionsRef.current = [];
      colorsRef.current = [];
      birthsRef.current = [];
      fracsRef.current = [];
      setGeometry((old) => {
        old?.dispose();
        return null;
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- masterSeed is encoded in key; listing both would be redundant but the linter can't see through the template literal
  }, [key]); // key matches RoadRevealTicker's composite identity — see declaration above

  // Fade beneath the cascade; release the geometry once fully invisible.
  // disposeArmed prevents redundant setState calls in the 1–2 frames that run
  // with the stale closure after the first setGeometry(null) is dispatched.
  useFrame(() => {
    const m = materialRef.current;
    if (!m) return;
    const fade = 1 - sharedRoadRevealProgress.value;
    m.uniforms.uFade.value = fade;
    if (fade <= 0 && geometry && !disposeArmed.current) {
      disposeArmed.current = true;
      setGeometry((old) => {
        old?.dispose();
        return null;
      });
    }
  });

  useEffect(() => () => materialRef.current?.dispose(), []);

  if (!geometry) return null;
  return <lineSegments geometry={geometry} material={materialRef.current} frustumCulled={false} />;
}
