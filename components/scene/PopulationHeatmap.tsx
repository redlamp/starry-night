"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { buildPopulationField } from "@/lib/seed/population";
import { buildRadialDensity, CORE_T, SUBURB_T, EXURB_T, RURAL_T } from "@/lib/seed/density";
import { CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";

// Population-density heat map (Population panel). One plane over the city,
// textured straight from the population grid through an inferno-style ramp —
// the texture is grid-resolution and LinearFilter does the smoothing. Same
// GIS-layer treatment as DistrictShells (depthTest off, high renderOrder,
// fog/tone-mapping off) so the read survives buildings and camera angle.
const HEAT_Y = 0.35; // above the district fill (0.25) + borders (0.3)

// Ramp stops: density 0..1 → display-space colour + alpha. Near-transparent
// through the empty fringe so the heat map doesn't curtain the whole disc.
const RAMP: Array<{ t: number; c: [number, number, number]; a: number }> = [
  { t: 0.0, c: [0, 0, 0], a: 0.0 },
  { t: 0.15, c: [32, 17, 75], a: 0.3 },
  { t: 0.35, c: [120, 28, 109], a: 0.5 },
  { t: 0.55, c: [187, 55, 84], a: 0.65 },
  { t: 0.75, c: [237, 105, 37], a: 0.78 },
  { t: 0.9, c: [252, 181, 25], a: 0.88 },
  { t: 1.0, c: [252, 255, 164], a: 0.95 },
];

function rampAt(t: number): [number, number, number, number] {
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i].t) {
      const lo = RAMP[i - 1];
      const hi = RAMP[i];
      const f = (t - lo.t) / (hi.t - lo.t);
      return [
        lo.c[0] + (hi.c[0] - lo.c[0]) * f,
        lo.c[1] + (hi.c[1] - lo.c[1]) * f,
        lo.c[2] + (hi.c[2] - lo.c[2]) * f,
        lo.a + (hi.a - lo.a) * f,
      ];
    }
  }
  const last = RAMP[RAMP.length - 1];
  return [...last.c, last.a];
}

export function PopulationHeatmap({ masterSeed }: { masterSeed: string }) {
  const show = useSceneStore((s) => s.cityPlanning.showPopulationHeat);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  // Density-panel draft (user 2026-06-08): while a draft profile is being
  // edited, this overlay PREVIEWS the draft's radial field live (pure math —
  // no regeneration) with band-contour lines, instead of the built census.
  const draft = useSceneStore((s) => s.densityProfileDraft);

  const mesh = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild

    let n: number;
    let cell: number;
    let minX: number;
    let minZ: number;
    let valueAt: (i: number, j: number) => number;
    if (draft) {
      // Preview: sample the draft radial field over the tier extent.
      const radial = buildRadialDensity(masterSeed, draft);
      const half = CITY_TIERS[citySize];
      n = 96;
      cell = (2 * half) / n;
      minX = CITY_CENTER.x - half;
      minZ = CITY_CENTER.z - half;
      valueAt = (i, j) => radial.at(minX + (i + 0.5) * cell, minZ + (j + 0.5) * cell);
    } else {
      const field = buildPopulationField(masterSeed, cityShape, cityShapeScale);
      n = field.n;
      cell = field.cell;
      minX = field.minX;
      minZ = field.minZ;
      valueAt = (i, j) => field.grid[j * n + i];
    }

    const canvas = document.createElement("canvas");
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(n, n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = valueAt(i, j);
        let [r, g, b, a] = rampAt(v);
        // Preview only: etch the band edges so spread/shoulder read as moving
        // contour rings, not just a brightness change.
        if (draft) {
          for (const t of [CORE_T, SUBURB_T, EXURB_T, RURAL_T]) {
            if (Math.abs(v - t) < 0.012) {
              r = 255;
              g = 255;
              b = 255;
              a = Math.max(a, 0.85);
              break;
            }
          }
        }
        const o = (j * n + i) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const extent = n * cell;
    const geo = new THREE.PlaneGeometry(extent, extent);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2; // lay flat; plane +Y maps to grid row order (+Z)
    m.position.set(minX + extent / 2, HEAT_Y, minZ + extent / 2);
    m.frustumCulled = false;
    m.renderOrder = 1001; // above the district fill + borders when both are on
    return m;
  }, [masterSeed, cityShape, cityShapeScale, citySize, draft]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    };
  }, [mesh]);

  // A live draft always previews — that's the point of editing it; the toggle
  // governs the census overlay outside preview.
  if (!show && !draft) return null;
  return <primitive object={mesh} />;
}
