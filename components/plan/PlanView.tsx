"use client";

import { useEffect, useMemo, useRef } from "react";
import { generateTopology, CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import {
  generateCity,
  generateStreetlights,
  tensorDistrictField,
  dropRadialSpokes,
} from "@/lib/seed/cityGen";
import {
  buildDensityField,
  CORE_T,
  SUBURB_T,
  EXURB_T,
  RURAL_T,
  type DensityBand,
} from "@/lib/seed/density";
import { sampleSuburbNodes } from "@/lib/seed/suburbField";
import { makeShapeMask, resolveCityShape, displayedRadius } from "@/lib/seed/cityShape";
import { useSceneStore } from "@/lib/state/sceneStore";
import { useGeneratedCity } from "@/lib/hooks/useGeneratedCity";

export type PlanLayers = {
  districts: boolean;
  density: boolean;
  buildings: boolean;
  highways: boolean;
  arterials: boolean;
  streets: boolean;
  streetlights: boolean;
};

// Density bands as a luminance ramp — bright core fading to near-background
// fringe, matching the night-view metaphor (bright core, dim sprawl, dark gaps).
const BAND_FILL: Record<DensityBand, string> = {
  core: "#ffd34daa",
  suburban: "#4f9e6baa",
  exurban: "#46795aaa", // the 2026-06-08 tier — between suburban and rural greens
  rural: "#3e5a4aaa",
  fringe: "#1e2735aa",
};
const BAND_EDGE: Array<{ t: number; color: string }> = [
  { t: CORE_T, color: "#ffd34d" },
  { t: SUBURB_T, color: "#4f9e6b" },
  { t: EXURB_T, color: "#5d8a68" },
  { t: RURAL_T, color: "#7a8a6b" },
];

type Props = {
  seed: string;
  size: number;
  layers: PlanLayers;
};

export function PlanView({ seed, size, layers }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);

  // #44: the /plan grid renders up to 64 tiles, each a cold city generation for a
  // distinct seed. Warming each tile's cache on an idle callback staggers that
  // work across frames instead of blocking the main thread in one ~64×200ms wall
  // on mount. `data` + the draw stay gated on `ready` so we never touch the cache
  // before it is warm.
  // #70: no `cityShapeScale` arg — the gate now only guarantees the MAX-extent
  // (scale 1) cache is warm (see useGeneratedCity's MAX_SCALE comment). The
  // `generateCity`/`generateStreetlights` calls below still read the LIVE
  // (possibly cropped) scale directly, so a non-default crop can still cost a
  // synchronous regen here — unchanged from before for any crop != 1, and out
  // of Stage 1's scope (InstancedCity + the ready gate only).
  const { ready } = useGeneratedCity(seed, cityShape);

  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const fieldDeviation = useSceneStore((s) => s.fieldDeviation);
  const densityProfile = useSceneStore((s) => s.densityProfile);
  const data = useMemo(() => {
    if (!ready) return null;
    void citySize; // tier drives the module-level gen extent (#58) — a switch must redraw
    void citySketch; // a registered sketch is a different city (#40) — likewise
    void fieldDeviation; // deviation scale (#51) — likewise
    void densityProfile; // population profile (#49) — likewise
    // Tensor is the only city model. Districts follow the arterial network
    // (built inside generateCity); read that exact field + roads so the overlay
    // matches where the buildings were placed. The cache is warm here, so these
    // all return synchronously.
    const topo = dropRadialSpokes(generateTopology(seed));
    const field = tensorDistrictField(seed);
    const city = generateCity(seed, cityShape, cityShapeScale);
    const lights = generateStreetlights(seed, cityShape, cityShapeScale);
    // Cheap (one rng draw per district) — rebuilt per redraw, never cached.
    const density = buildDensityField(seed, field);
    // #49 node-field rebuild Stage 1: suburb population nodes (cheap grid scan).
    // Same mask as the street generator so the overlay shows the real pod set.
    const nodes = sampleSuburbNodes(
      seed,
      density.radial,
      makeShapeMask(resolveCityShape(cityShape, seed), cityShapeScale),
    );
    return { topo, field, city, lights, density, nodes };
  }, [
    ready,
    seed,
    cityShape,
    cityShapeScale,
    citySize,
    citySketch,
    fieldDeviation,
    densityProfile,
  ]);

  useEffect(() => {
    if (!data) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const { topo, field, city, lights, density, nodes } = data;
    const cx = CITY_CENTER.x;
    const cz = CITY_CENTER.z;
    // Frame the current DISPLAYED extent (#56: tier × crop) — not the fixed default
    // CITY_HALF_EXTENT (would crop big tiers and shrink small ones) and not the raw
    // tier alone (would leave a crop's dead margin baked into the minimap).
    const half = displayedRadius(
      resolveCityShape(cityShape, seed),
      cityShapeScale,
      CITY_TIERS[citySize],
    );

    // World → canvas pixel helper
    const toX = (x: number) => ((x - (cx - half)) / (2 * half)) * size;
    const toY = (z: number) => ((z - (cz - half)) / (2 * half)) * size;
    const worldWToPx = (w: number) => (w / (2 * half)) * size;

    // 1. Background
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, size, size);

    // Draw order (bottom → top): districts, streets, arterials, highways,
    // buildings, streetlights.

    // Districts — sampled fill (very bottom).
    if (layers.districts) {
      const gridN = 70;
      const step = (2 * half) / gridN;
      const cellPx = size / gridN;
      for (let gi = 0; gi < gridN; gi++) {
        for (let gj = 0; gj < gridN; gj++) {
          const wx = cx - half + (gi + 0.5) * step;
          const wz = cz - half + (gj + 0.5) * step;
          const idx = field.classify(wx, wz);
          if (idx < 0) continue;
          const d = field.districts[idx];
          if (!d) continue;
          ctx.fillStyle = d.color + "80"; // ~0.5 alpha via hex suffix
          ctx.fillRect(toX(wx - step / 2), toY(wz - step / 2), cellPx, cellPx);
        }
      }
    }

    // Density bands (#49) — per-district development density as band-filled
    // cells (what the building/lamp/window consumers act on) + the raw radial
    // band edges as contours (the unjittered field the districts sampled).
    // Where a cell's band disagrees with its contour ring, that's the per-
    // district jitter / character floor doing its job.
    if (layers.density) {
      const gridN = 70;
      const step = (2 * half) / gridN;
      const cellPx = size / gridN;
      for (let gi = 0; gi < gridN; gi++) {
        for (let gj = 0; gj < gridN; gj++) {
          const wx = cx - half + (gi + 0.5) * step;
          const wz = cz - half + (gj + 0.5) * step;
          ctx.fillStyle = BAND_FILL[density.bandAt(wx, wz)];
          ctx.fillRect(toX(wx - step / 2), toY(wz - step / 2), cellPx, cellPx);
        }
      }
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.2;
      const SEGS = 180;
      for (const { t, color } of BAND_EDGE) {
        ctx.beginPath();
        for (let s = 0; s <= SEGS; s++) {
          const th = (s / SEGS) * Math.PI * 2;
          const r = density.radial.radiusAt(t, th);
          const px = toX(cx + Math.cos(th) * r);
          const py = toY(cz + Math.sin(th) * r);
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      ctx.restore();

      // Suburb population nodes (#49 node-field rebuild, Stage 1): pod centre
      // dots + elliptical pod footprints. These are the organising centres the
      // Stage-2 crescents/entries will trace around — placement is what this
      // overlay verifies (spacing by density, band coverage, squash variety).
      ctx.save();
      for (const n of nodes) {
        const px = toX(n.x);
        const py = toY(n.z);
        const rMaj = worldWToPx(n.r);
        const rMin = rMaj * n.squash;
        ctx.beginPath();
        ctx.ellipse(px, py, rMaj, rMin, n.angle, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffd34d";
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = "#ffe9a0";
        ctx.globalAlpha = 0.95;
        ctx.fill();
      }
      ctx.restore();
    }

    // Road polyline helper
    const drawPolyline = (
      vertices: Array<{ x: number; z: number }>,
      closed: boolean,
      strokeColor: string,
      lineWidth: number,
    ) => {
      if (vertices.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(toX(vertices[0].x), toY(vertices[0].z));
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(toX(vertices[i].x), toY(vertices[i].z));
      }
      if (closed) ctx.closePath();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    };

    // Minor (local) streets — bottom road tier.
    if (layers.streets) {
      ctx.save();
      for (const s of city.streets) {
        const lw = Math.max(0.6, worldWToPx(s.width));
        drawPolyline(s.vertices, s.closed, "#54627a", lw);
      }
      ctx.restore();
    }

    // Arterials — above streets.
    if (layers.arterials) {
      ctx.save();
      for (const art of city.arterials) {
        const lw = Math.max(1.5, worldWToPx(art.width));
        drawPolyline(art.vertices, art.closed, "#7fa8d0", lw);
      }
      ctx.restore();
    }

    // Highways — above arterials (top road tier).
    if (layers.highways) {
      ctx.save();
      for (const hw of city.topology.highways) {
        const lw = Math.max(2, worldWToPx(hw.width));
        drawPolyline(hw.vertices, hw.closed, "#f0c850", lw);
      }
      ctx.restore();
    }

    // Buildings — rotated footprints, on top of the roads.
    if (layers.buildings) {
      const districtColorMap = new Map<string, string>();
      for (const d of field.districts) {
        districtColorMap.set(d.id, d.color);
      }
      ctx.save();
      for (const b of city.buildings) {
        const px = toX(b.x);
        const py = toY(b.z);
        const pw = worldWToPx(b.width);
        const pd = worldWToPx(b.depth);
        const color = districtColorMap.get(b.districtId) ?? "#888888";
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(b.rotationY);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = color;
        ctx.fillRect(-pw / 2, -pd / 2, pw, pd);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Streetlights — very top.
    if (layers.streetlights) {
      ctx.save();
      for (const light of lights) {
        const px = toX(light.x);
        const py = toY(light.z);
        let color = "#e8e8ff";
        if (light.kelvin < 3300) color = "#ffd9a0";
        else if (light.kelvin > 3800) color = "#cfe0ff";
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();
    }

    // 7. Label
    ctx.save();
    ctx.font = "10px monospace";
    ctx.fillStyle = "rgba(200,210,230,0.85)";
    ctx.fillText(`${seed}`, 4, 13);
    ctx.fillText(`${topo.kind} · ${field.districts.length}d`, 4, 24);
    ctx.restore();
  }, [seed, size, layers, data, citySize, cityShape, cityShapeScale]);

  return <canvas ref={canvasRef} style={{ width: size, height: size, display: "block" }} />;
}
