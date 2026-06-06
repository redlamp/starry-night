"use client";

import { useEffect, useMemo, useRef } from "react";
import { generateTopology, CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import {
  generateCity,
  generateStreetlights,
  tensorDistrictField,
  dropRadialSpokes,
} from "@/lib/seed/cityGen";
import { useSceneStore } from "@/lib/state/sceneStore";
import { useGeneratedCity } from "@/lib/hooks/useGeneratedCity";

export type PlanLayers = {
  districts: boolean;
  buildings: boolean;
  highways: boolean;
  arterials: boolean;
  streets: boolean;
  streetlights: boolean;
};

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
  const { ready } = useGeneratedCity(seed, cityShape, cityShapeScale);

  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const fieldDeviation = useSceneStore((s) => s.fieldDeviation);
  const data = useMemo(() => {
    if (!ready) return null;
    void citySize; // tier drives the module-level gen extent (#58) — a switch must redraw
    void citySketch; // a registered sketch is a different city (#40) — likewise
    void fieldDeviation; // deviation scale (#51) — likewise
    // Tensor is the only city model. Districts follow the arterial network
    // (built inside generateCity); read that exact field + roads so the overlay
    // matches where the buildings were placed. The cache is warm here, so these
    // all return synchronously.
    const topo = dropRadialSpokes(generateTopology(seed));
    const field = tensorDistrictField(seed);
    const city = generateCity(seed, cityShape, cityShapeScale);
    const lights = generateStreetlights(seed, cityShape, cityShapeScale);
    return { topo, field, city, lights };
  }, [ready, seed, cityShape, cityShapeScale, citySize, citySketch, fieldDeviation]);

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

    const { topo, field, city, lights } = data;
    const cx = CITY_CENTER.x;
    const cz = CITY_CENTER.z;
    // Frame the current tier's full gen extent (#58) — not the fixed default
    // CITY_HALF_EXTENT, which would crop big tiers and shrink small ones.
    const half = CITY_TIERS[citySize];

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
  }, [seed, size, layers, data, citySize]);

  return <canvas ref={canvasRef} style={{ width: size, height: size, display: "block" }} />;
}
