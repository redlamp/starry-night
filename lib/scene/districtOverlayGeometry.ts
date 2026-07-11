import * as THREE from "three";
import { loopSignedArea, type BoundaryLoop } from "@/lib/seed/districtOutline";

// THREE geometry builders over districtOutline's traced loops — shared by the
// SelectedDistrictOutline highlight overlay and the DistrictShells planning
// layer so every district drawing in the app is the same street-following
// shape (user 2026-07-10: one drawing option, everywhere).

// Line-segment soup (x,y,z triples) for a set of closed loops at height y.
export function loopsToSegments(loops: BoundaryLoop[], y: number): number[] {
  const pts: number[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      pts.push(a.x, y, a.z, b.x, y, b.z);
    }
  }
  return pts;
}

// Ray-cast point-in-polygon, used to assign hole loops to their outer loop.
function pointInLoop(p: { x: number; z: number }, loop: BoundaryLoop): boolean {
  let ins = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      ins = !ins;
    }
  }
  return ins;
}

// Filled district area as ShapeGeometries. CCW loops are outers, CW are holes
// (districtOutline contract); each hole attaches to the outer containing it.
// ShapeGeometry lives in the XY plane: points map z → -y, so the caller must
// set `mesh.rotation.x = -Math.PI / 2` (and position.y) to land it back on XZ
// with the original z sign.
export function loopsToFillGeometries(loops: BoundaryLoop[]): THREE.ShapeGeometry[] {
  const outers = loops.filter((l) => loopSignedArea(l) > 0);
  const holes = loops.filter((l) => loopSignedArea(l) < 0);
  const geoms: THREE.ShapeGeometry[] = [];
  for (const outer of outers) {
    const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, -p.z)));
    for (const hole of holes) {
      if (pointInLoop(hole[0], outer)) {
        shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, -p.z))));
      }
    }
    geoms.push(new THREE.ShapeGeometry(shape));
  }
  return geoms;
}

// Group of flat fill meshes at height y sharing one material.
export function loopsToFillGroup(
  loops: BoundaryLoop[],
  mat: THREE.Material,
  y: number,
  renderOrder: number,
): THREE.Group {
  const group = new THREE.Group();
  for (const geo of loopsToFillGeometries(loops)) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    group.add(mesh);
  }
  return group;
}
