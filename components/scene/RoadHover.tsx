"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useSceneStore } from "@/lib/state/sceneStore";
import { roadQueryFor, buildCityNames, type RoadHit } from "@/lib/seed/naming";

// Inspect-mode road hover: point at a street and get its name plus the
// buildings addressed onto it. No mesh raycast — the cursor ray is dropped
// onto the ground plane and the naming layer's segment grid answers "which
// road is this?", the same structure that assigned the addresses in the first
// place. The shared R3F raycaster is used so OrthoPickingFix's parallel-ray
// override applies in faked-ortho views.
//
// drei <Html> stays MOUNTED and toggles visibility (unmount/remount flashes at
// the origin for a frame — see tools/r3f-drei-html-projection-lag.md).

const TIER_LABEL: Record<RoadHit["tier"], string> = {
  highway: "Highway",
  arterial: "Avenue",
  minor: "Street",
};

const TIER_COLOR: Record<RoadHit["tier"], string> = {
  highway: "#e8b04a",
  arterial: "#d9c27a",
  minor: "#9fb3d1",
};

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const MAX_LIST = 4;

export function RoadHover({ masterSeed }: { masterSeed: string }) {
  const inspectMode = useSceneStore((s) => s.inspectMode);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const resetColumns = useSceneStore((s) => s.resetColumns);

  const [hit, setHit] = useState<RoadHit | null>(null);
  const anchorRef = useRef<THREE.Group>(null);
  const hitPoint = useRef(new THREE.Vector3());
  const lastEval = useRef(0);
  // Mirror of `hit` for the window pointer listeners (refs-in-render rule:
  // update inside an effect, not during render).
  const hitRef = useRef<RoadHit | null>(null);
  useEffect(() => {
    hitRef.current = hit;
  }, [hit]);

  // Street CLICK → open the street column. Same press/release-distance idiom
  // as building selection (an orbit drag must not select), and only when no
  // building is under the cursor (the hover pick state answers that — see
  // r3f-events-pass-through: rays hit everything, so we arbitrate here).
  useEffect(() => {
    if (!inspectMode) return;
    let downX = 0;
    let downY = 0;
    let downOnCanvas = false;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      // Only a primary-button press that STARTS on the canvas can become a
      // street click — otherwise UI clicks (or the tail of a camera drag)
      // steal the column stack and replace it with one street card.
      downOnCanvas = e.button === 0 && e.target instanceof HTMLCanvasElement;
    };
    const onUp = (e: PointerEvent) => {
      if (!downOnCanvas || !(e.target instanceof HTMLCanvasElement)) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return;
      const road = hitRef.current;
      if (!road) return;
      // A building under the cursor wins — its own click handler runs.
      const s = useSceneStore.getState();
      if (s.pickInstance >= 0) return;
      // With a stack already open, the street JOINS the drill; a street click
      // from nothing starts a fresh path.
      if (s.columnCursor >= 0) s.pushColumn({ kind: "street", id: road.roadId });
      else resetColumns([{ kind: "street", id: road.roadId }]);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [inspectMode, resetColumns]);

  const { query, names } = useMemo(() => {
    void citySize;
    void citySketch;
    return {
      query: roadQueryFor(masterSeed, cityShape, cityShapeScale),
      names: buildCityNames(masterSeed, cityShape, cityShapeScale),
    };
  }, [masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  // ~10 Hz is plenty for a hover; the grid query itself is microseconds but
  // setState churn at 60 Hz would re-render the chip needlessly.
  useFrame((state) => {
    if (!inspectMode) {
      if (hit) setHit(null);
      return;
    }
    const now = state.clock.elapsedTime;
    if (now - lastEval.current < 0.1) return;
    lastEval.current = now;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const point = state.raycaster.ray.intersectPlane(GROUND, hitPoint.current);
    const next = point ? query.nearestRoad(point.x, point.z) : null;
    if (point && anchorRef.current) {
      anchorRef.current.position.set(point.x, 4, point.z);
    }
    if ((next?.roadId ?? null) !== (hit?.roadId ?? null)) setHit(next);
  });

  // Highlight polyline for the hovered road, x-ray like the selection outline.
  const line = useMemo(() => {
    if (!hit) return null;
    const pts: number[] = [];
    for (const v of hit.vertices) pts.push(v.x, 2, v.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(TIER_COLOR[hit.tier]),
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const l = new THREE.Line(geo, mat);
    l.renderOrder = 1001;
    l.frustumCulled = false;
    return l;
  }, [hit]);

  const occupants = useMemo(() => {
    if (!hit) return { count: 0, sample: [] as string[] };
    const ids = names.buildingsByRoad.get(hit.roadId) ?? [];
    const sample = ids.slice(0, MAX_LIST).map((id) => {
      const address = names.addresses.get(id);
      const name = names.buildingNames.get(id);
      const number = address ? `${address.number}` : `#${id}`;
      return name ? `${number} · ${name}` : number;
    });
    return { count: ids.length, sample };
  }, [hit, names]);

  return (
    <group>
      {line && <primitive object={line} />}
      <group ref={anchorRef}>
        <Html
          center={false}
          zIndexRange={[19, 0]}
          style={{
            pointerEvents: "none",
            visibility: hit ? "visible" : "hidden",
            transform: "translate(14px, -50%)",
          }}
        >
          {hit && (
            <div className="w-max max-w-64 rounded-lg border border-border bg-popover/95 px-3 py-2 text-popover-foreground shadow-md backdrop-blur-sm">
              <div className="text-sm font-medium" style={{ color: TIER_COLOR[hit.tier] }}>
                {hit.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {TIER_LABEL[hit.tier]} · {occupants.count} building{occupants.count === 1 ? "" : "s"}
              </div>
              {occupants.sample.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {occupants.sample.join("  ·  ")}
                  {occupants.count > MAX_LIST && `  ·  +${occupants.count - MAX_LIST} more`}
                </div>
              )}
            </div>
          )}
        </Html>
      </group>
    </group>
  );
}
