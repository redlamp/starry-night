"use client";

import { useEffect, useMemo, useRef } from "react";
import { generateTopology, CITY_CENTER, CITY_HALF_EXTENT } from "@/lib/seed/topology";
import { generateDistricts } from "@/lib/seed/district";
import { generateArterials } from "@/lib/seed/arterials";
import { generateCity, generateStreetlights } from "@/lib/seed/cityGen";
import { stripGridFirst, gridFirst, computeLattice } from "@/lib/seed/lattice";

export type PlanLayers = {
  districts: boolean;
  buildings: boolean;
  blocks: boolean;
  highways: boolean;
  arterials: boolean;
  seams: boolean;
  streetlights: boolean;
};

type Props = {
  seed: string;
  size: number;
  layers: PlanLayers;
};

export function PlanView({ seed, size, layers }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const data = useMemo(() => {
    // The ::gridfirst sentinel selects the grid-first path. generateCity /
    // generateStreetlights strip the sentinel + branch internally, so they take
    // the raw seed. generateTopology / generateDistricts / generateArterials do
    // NOT, so derive base + useGrid + θ0 here and pass them through — matching
    // exactly what generateCity computes internally, so every layer agrees.
    const base = stripGridFirst(seed);
    const useGrid = gridFirst(seed);
    const theta0 = useGrid ? computeLattice(base).theta0 : 0;
    const topo = generateTopology(base);
    const field = generateDistricts(base, topo, useGrid, theta0);
    const arts = generateArterials(base, topo, field, useGrid, theta0);
    const city = generateCity(seed);
    const lights = generateStreetlights(seed);
    return { topo, field, arts, city, lights };
  }, [seed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const { topo, field, arts, city, lights } = data;
    const cx = CITY_CENTER.x;
    const cz = CITY_CENTER.z;
    const half = CITY_HALF_EXTENT;

    // World → canvas pixel helper
    const toX = (x: number) => ((x - (cx - half)) / (2 * half)) * size;
    const toY = (z: number) => ((z - (cz - half)) / (2 * half)) * size;
    const worldWToPx = (w: number) => (w / (2 * half)) * size;

    // 1. Background
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, size, size);

    // 2. Districts — sampled grid
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

    // 3. Buildings — rotated footprints
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

    // 3b. Block outlines — the local street grid (gaps between blocks = streets).
    // Makes block proportions + per-district grid orientation legible.
    if (layers.blocks) {
      ctx.save();
      ctx.strokeStyle = "rgba(170,195,230,0.45)";
      ctx.lineWidth = 1;
      for (const b of city.blocks) {
        if (b.empty) continue;
        const px = toX(b.cx);
        const py = toY(b.cz);
        const pw = worldWToPx(b.w);
        const pd = worldWToPx(b.d);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(b.rotationY);
        ctx.strokeRect(-pw / 2, -pd / 2, pw, pd);
        ctx.restore();
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

    // 4. Highways
    if (layers.highways) {
      ctx.save();
      for (const hw of topo.highways) {
        const lw = Math.max(2, worldWToPx(hw.width));
        drawPolyline(hw.vertices, hw.closed, "#f0c850", lw);
      }
      ctx.restore();
    }

    // 5. Arterials
    if (layers.arterials) {
      ctx.save();
      for (const art of arts) {
        const lw = Math.max(1.5, worldWToPx(art.width));
        drawPolyline(art.vertices, art.closed, "#7fa8d0", lw);
      }
      ctx.restore();
    }

    // 5b. Seam streets (grid-first) — promoted major district boundaries.
    if (layers.seams) {
      ctx.save();
      for (const s of city.seams) {
        const lw = Math.max(2, worldWToPx(s.width));
        drawPolyline(s.vertices, s.closed, "#9fe0c0", lw);
      }
      ctx.restore();
    }

    // 6. Streetlights
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
  }, [seed, size, layers, data]);

  return (
    <canvas ref={canvasRef} style={{ width: size, height: size, display: "block" }} title={seed} />
  );
}
