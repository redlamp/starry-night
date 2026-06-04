import * as THREE from "three";

// Builds flat road-surface geometry from road polylines (highways, arterials,
// streets). Each segment becomes a quad extruded perpendicular to the segment
// direction by width/2 on each side; a ROUND join (triangle fan) at each bend
// fills the wedge so the stroke reads as a smooth vector ribbon with rounded
// joins + caps rather than the old square-cap notches. All polys merge into one
// BufferGeometry so a tier draws in a single call. Geometry lies in the XZ
// plane at y=0 — the consuming mesh lifts it just above the ground plane.

export type RoadPoly = {
  vertices: Array<{ x: number; z: number }>;
  width: number;
  closed?: boolean;
};

const JOIN_SEGS = 8; // fan segments per round join / cap
const JOIN_ANGLE = 0.05; // rad ≈ 3° — only round an interior vertex that actually bends

export function buildRoadGeometry(polys: RoadPoly[]): THREE.BufferGeometry {
  const positions: number[] = [];

  const quad = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    dx: number,
    dz: number,
  ) => {
    positions.push(ax, 0, az, bx, 0, bz, cx, 0, cz);
    positions.push(ax, 0, az, cx, 0, cz, dx, 0, dz);
  };

  // Round join / cap: a triangle fan disc of radius `r` centred on (vx,vz).
  const disc = (vx: number, vz: number, r: number) => {
    for (let k = 0; k < JOIN_SEGS; k++) {
      const a0 = (k / JOIN_SEGS) * Math.PI * 2;
      const a1 = ((k + 1) / JOIN_SEGS) * Math.PI * 2;
      positions.push(
        vx,
        0,
        vz,
        vx + Math.cos(a0) * r,
        0,
        vz + Math.sin(a0) * r,
        vx + Math.cos(a1) * r,
        0,
        vz + Math.sin(a1) * r,
      );
    }
  };

  for (const p of polys) {
    const v = p.vertices;
    if (v.length < 2) continue;
    const half = p.width / 2;
    const segCount = p.closed ? v.length : v.length - 1;

    for (let i = 0; i < segCount; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      const dxs = b.x - a.x;
      const dzs = b.z - a.z;
      const len = Math.hypot(dxs, dzs) || 1;
      // Perpendicular offset (rotate direction 90°), scaled to half-width.
      const nx = (-dzs / len) * half;
      const nz = (dxs / len) * half;
      quad(a.x + nx, a.z + nz, a.x - nx, a.z - nz, b.x - nx, b.z - nz, b.x + nx, b.z + nz);
    }

    // Round caps at the two open ends; round joins only at interior vertices
    // that bend enough to leave a notch (most tensor steps are near-straight, so
    // this keeps the triangle count low while smoothing the visible corners).
    for (let i = 0; i < v.length; i++) {
      const interior = i > 0 && i < v.length - 1;
      const isEndCap = !p.closed && (i === 0 || i === v.length - 1);
      if (interior || p.closed) {
        const prev = v[(i - 1 + v.length) % v.length];
        const next = v[(i + 1) % v.length];
        const a1 = Math.atan2(v[i].z - prev.z, v[i].x - prev.x);
        const a2 = Math.atan2(next.z - v[i].z, next.x - v[i].x);
        let d = Math.abs(a2 - a1) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d < JOIN_ANGLE) continue; // near-collinear → no notch to fill
      } else if (!isEndCap) {
        continue;
      }
      disc(v[i].x, v[i].z, half);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.computeVertexNormals();
  return geo;
}
