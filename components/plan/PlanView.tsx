"use client";

import { useEffect, useMemo, useRef } from "react";
import { generateTopology, CITY_CENTER, CITY_HALF_EXTENT } from "@/lib/seed/topology";
import {
  generateCity,
  generateStreetlights,
  tensorDistrictField,
  dropRadialSpokes,
  DEFAULT_TUNING,
  type GridTuning,
} from "@/lib/seed/cityGen";
import { stripGridFirst } from "@/lib/seed/lattice";

export type PlanLayers = {
  districts: boolean;
  buildings: boolean;
  blocks: boolean;
  highways: boolean;
  arterials: boolean;
  streets: boolean;
  streetlights: boolean;
};

type Props = {
  seed: string;
  size: number;
  layers: PlanLayers;
  tuning?: GridTuning;
};

export function PlanView({ seed, size, layers, tuning = DEFAULT_TUNING }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const data = useMemo(() => {
    // The ::gridfirst sentinel selects the grid-first path. generateCity /
    // generateStreetlights strip the sentinel + branch internally, so they take
    // the raw seed. generateTopology / generateDistricts / generateArterials do
    // NOT, so derive base + useGrid + θ0 here and pass them through — matching
    // exactly what generateCity computes internally, so every layer agrees.
    const base = stripGridFirst(seed);
    // Tensor is the only city model now: drop radial spokes + L∞ districts in the
    // θ0=0 frame, matching generateCity exactly so the overlay agrees with it.
    const topo = dropRadialSpokes(generateTopology(base));
    // Districts now follow the arterial network (built inside generateCity);
    // read that exact field so the overlay matches where the buildings sit.
    const field = tensorDistrictField(base);
    // Roads come off the city artifact (city.arterials + city.streets) so /plan
    // draws the exact same network the buildings were derived from.
    const city = generateCity(seed, tuning);
    const lights = generateStreetlights(seed, tuning);
    return { topo, field, city, lights };
  }, [seed, tuning]);

  useEffect(() => {
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
    const half = CITY_HALF_EXTENT;

    // World → canvas pixel helper
    const toX = (x: number) => ((x - (cx - half)) / (2 * half)) * size;
    const toY = (z: number) => ((z - (cz - half)) / (2 * half)) * size;
    const worldWToPx = (w: number) => (w / (2 * half)) * size;

    // 1. Background
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, size, size);

    // Draw order (bottom → top): districts, blocks, streets, arterials,
    // highways, buildings, streetlights.

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

    // Block outlines (above districts, below roads). Empty on the tensor path.
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
  }, [seed, size, layers, data]);

  return (
    <canvas ref={canvasRef} style={{ width: size, height: size, display: "block" }} title={seed} />
  );
}
