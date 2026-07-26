"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { tensorDistrictField } from "@/lib/seed/cityGen";

// Reverse of the directory's district hover (review 2026-07-25 4.x): while the
// directory is showing its districts list, pointing at a district in the CITY
// writes the same hoverDistrictId the list rows set — so the scene fill lights
// AND the row shows its hover style + scrolls into view. No mesh raycast: the
// cursor ray is dropped onto the ground plane and the district field's label
// raster answers "which district?" (field.classify, the O(1) lookup every
// other district consumer uses) — the same structure-not-geometry approach as
// RoadHover. The shared R3F raycaster keeps OrthoPickingFix's parallel-ray
// override in faked-ortho views.

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export function DistrictHover({ masterSeed }: { masterSeed: string }) {
  const active = useSceneStore((s) => s.directoryOpen && s.directoryDistrictsVisible);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const gl = useThree((s) => s.gl);
  const hitPoint = useRef(new THREE.Vector3());
  const lastEval = useRef(0);
  // Only ever CLEAR a hover this component set — the list rows' own
  // mouseenter/mouseleave must never be stomped by a stale scene pick.
  const mine = useRef<string | null>(null);
  const overCanvas = useRef(false);

  const field = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    void citySketch;
    return tensorDistrictField(masterSeed);
  }, [masterSeed, citySize, citySketch]);

  // R3F's pointer stops updating once the cursor moves onto DOM UI — without
  // this gate the last canvas position would keep a stale district lit (and
  // fight the list's own hover) while the user browses the panel.
  useEffect(() => {
    const dom = gl.domElement;
    const on = () => {
      overCanvas.current = true;
    };
    const off = () => {
      overCanvas.current = false;
    };
    dom.addEventListener("pointermove", on);
    dom.addEventListener("pointerleave", off);
    return () => {
      dom.removeEventListener("pointermove", on);
      dom.removeEventListener("pointerleave", off);
      overCanvas.current = false;
    };
  }, [gl]);

  useFrame((state) => {
    const release = () => {
      if (mine.current !== null) {
        const s = useSceneStore.getState();
        if (s.hoverDistrictId === mine.current) s.setHoverDistrictId(null);
        mine.current = null;
      }
    };
    if (!active || !overCanvas.current) {
      release();
      return;
    }
    // ~10 Hz, same cadence as RoadHover — the classify is O(1) but the store
    // write re-renders the list row highlight.
    const now = state.clock.elapsedTime;
    if (now - lastEval.current < 0.1) return;
    lastEval.current = now;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const point = state.raycaster.ray.intersectPlane(GROUND, hitPoint.current);
    const idx = point ? field.classify(point.x, point.z) : -1;
    const d = idx >= 0 ? field.districts.find((x) => x.index === idx) : undefined;
    if (!d) {
      release();
      return;
    }
    const s = useSceneStore.getState();
    if (s.hoverDistrictId !== d.id) s.setHoverDistrictId(d.id);
    mine.current = d.id;
  });

  return null;
}
