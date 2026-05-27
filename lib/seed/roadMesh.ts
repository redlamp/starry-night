import * as THREE from "three";

// Builds flat road-surface geometry from road polylines (highways, arterials).
// Each segment becomes a quad extruded perpendicular to the segment direction
// by width/2 on each side; a square cap at every vertex fills the wedge gaps at
// bends. All polys merge into one BufferGeometry so the whole road network
// draws in a single call. Geometry lies in the XZ plane at y=0 — the consuming
// mesh lifts it just above the ground plane.

export type RoadPoly = {
  vertices: Array<{ x: number; z: number }>;
  width: number;
  closed?: boolean;
};

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
      quad(
        a.x + nx,
        a.z + nz,
        a.x - nx,
        a.z - nz,
        b.x - nx,
        b.z - nz,
        b.x + nx,
        b.z + nz,
      );
    }

    // Square cap at each vertex fills the outer-bend notch where consecutive
    // quads meet. Cheap and robust for the moderate bend angles in play.
    for (let i = 0; i < v.length; i++) {
      const vx = v[i].x;
      const vz = v[i].z;
      quad(vx - half, vz - half, vx + half, vz - half, vx + half, vz + half, vx - half, vz + half);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.computeVertexNormals();
  return geo;
}
