"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { buildTrafficDensity } from "@/lib/seed/traffic";

// Traffic-density debug overlay (#78). Colours every road macro-segment by its
// EXPECTED traffic density (pre-MAX_CARS-cap) so the intended distribution is
// legible — busy downtown arterials warm, country roads cool. Shares the
// population heat-map's inferno ramp + GIS-layer treatment (depthTest off, high
// renderOrder, fog/tone-mapping off) so it reads over buildings + lights at any
// angle, exactly like PopulationHeatmap.
//
// Rendering: ONE LineSegments with per-vertex colours — no per-segment mesh, no
// custom shader. Vertex colours are authored in DISPLAY space (the same raw
// values the population ramp uses): MeshBasicMaterial / LineBasicMaterial with
// vertexColors + toneMapped:false writes them straight to the screen, so they
// must NOT be linearised.
const ROAD_Y = 0.07; // just above the road ribbons (0.05) so the overlay wins

// Population heat-map ramp (mirrors PopulationHeatmap.RAMP): density 0..1 →
// display-space colour. Cool→warm inferno. Kept in 0..1 channels for the
// THREE.Color buffer (the heat map's are 0..255 for an ImageData canvas).
const RAMP: Array<{ t: number; c: [number, number, number] }> = [
  { t: 0.0, c: [32 / 255, 17 / 255, 75 / 255] },
  { t: 0.15, c: [32 / 255, 17 / 255, 75 / 255] },
  { t: 0.35, c: [120 / 255, 28 / 255, 109 / 255] },
  { t: 0.55, c: [187 / 255, 55 / 255, 84 / 255] },
  { t: 0.75, c: [237 / 255, 105 / 255, 37 / 255] },
  { t: 0.9, c: [252 / 255, 181 / 255, 25 / 255] },
  { t: 1.0, c: [252 / 255, 255 / 255, 164 / 255] },
];

function rampAt(t: number): [number, number, number] {
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i].t) {
      const lo = RAMP[i - 1];
      const hi = RAMP[i];
      const f = (t - lo.t) / (hi.t - lo.t);
      return [
        lo.c[0] + (hi.c[0] - lo.c[0]) * f,
        lo.c[1] + (hi.c[1] - lo.c[1]) * f,
        lo.c[2] + (hi.c[2] - lo.c[2]) * f,
      ];
    }
  }
  return RAMP[RAMP.length - 1].c;
}

export function TrafficDensityOverlay({ masterSeed }: { masterSeed: string }) {
  const show = useSceneStore((s) => s.cityPlanning.showTrafficDensity);
  // Same generation inputs as Traffic — so the overlay describes the cars the
  // user actually sees (tier multipliers + global density + population coupling).
  const density = useSceneStore((s) => s.traffic.density);
  const highway = useSceneStore((s) => s.traffic.highway);
  const arterial = useSceneStore((s) => s.traffic.arterial);
  const minor = useSceneStore((s) => s.traffic.minor);
  const popCoupling = useSceneStore((s) => s.traffic.popCoupling ?? 1);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);

  const lines = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const field = buildTrafficDensity(
      masterSeed,
      density,
      { highway, arterial, minor },
      cityShape,
      cityShapeScale,
      popCoupling,
    );

    const n = field.segments.length;
    const positions = new Float32Array(n * 2 * 3);
    const colors = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const s = field.segments[i];
      const [r, g, b] = rampAt(s.density);
      const a = i * 6;
      positions[a + 0] = s.ax;
      positions[a + 1] = ROAD_Y;
      positions[a + 2] = s.az;
      positions[a + 3] = s.bx;
      positions[a + 4] = ROAD_Y;
      positions[a + 5] = s.bz;
      // Both endpoints share the segment colour (flat per-chord shading).
      colors[a + 0] = r;
      colors[a + 1] = g;
      colors[a + 2] = b;
      colors[a + 3] = r;
      colors[a + 4] = g;
      colors[a + 5] = b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false, // display-space colours straight to screen (no linearise)
    });
    const seg = new THREE.LineSegments(geo, mat);
    seg.frustumCulled = false;
    seg.renderOrder = 1002; // above the population heat plane (1001)
    return seg;
  }, [
    masterSeed,
    density,
    highway,
    arterial,
    minor,
    popCoupling,
    cityShape,
    cityShapeScale,
    citySize,
  ]);

  useEffect(() => {
    return () => {
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    };
  }, [lines]);

  if (!show) return null;
  return <primitive object={lines} />;
}
