"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { buildHelicopters } from "@/lib/seed/helicopters";

// #89 helicopter patrol-route debug overlay — mirrors FlightRoutes.tsx. Each
// helicopter's TRANSIT legs are drawn as 3D polylines and every waypoint stop
// gets a marker point, so you can SEE where the (small, easily-missed)
// helicopters patrol: rooftop pads sit high on the towers, off-map pads low
// just past the disc edge, so the lines visibly climb and dive. Cyan (distinct
// from flights' amber), additive, depthTest ON so buildings occlude it like the
// real route. Off by default (Debug → Transport → Heli Routes).
const CYAN: [number, number, number] = [0.25, 0.85, 1.0];
const MARKER_SIZE_PX = 11;

export function HelicopterRoutes({ masterSeed }: { masterSeed: string }) {
  const show = useSceneStore((s) => s.debug.showHeliRoutes);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);

  const { lines, markers } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const data = buildHelicopters(masterSeed, cityShape, cityShapeScale);
    const segPts: number[] = [];
    const markPts: number[] = [];
    for (const heli of data.helicopters) {
      for (const leg of heli.legs) {
        // Only transit legs are real lines; a hover leg is aA===aB (a point).
        if (leg.kind === "transit") {
          segPts.push(leg.aA[0], leg.aA[1], leg.aA[2], leg.aB[0], leg.aB[1], leg.aB[2]);
        }
        markPts.push(leg.aA[0], leg.aA[1], leg.aA[2]); // waypoint / pad marker
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segPts), 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(...CYAN),
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false, // display-space cyan straight to screen (FlightRoutes precedent)
    });
    const seg = new THREE.LineSegments(geo, mat);
    seg.frustumCulled = false;

    const mGeo = new THREE.BufferGeometry();
    mGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(markPts), 3));
    const mMat = new THREE.PointsMaterial({
      color: new THREE.Color(...CYAN),
      size: MARKER_SIZE_PX,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const pts = new THREE.Points(mGeo, mMat);
    pts.frustumCulled = false;

    return { lines: seg, markers: pts };
  }, [masterSeed, cityShape, cityShapeScale, citySize]);

  useEffect(() => {
    return () => {
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
      markers.geometry.dispose();
      (markers.material as THREE.Material).dispose();
    };
  }, [lines, markers]);

  if (!show) return null;
  return (
    <>
      <primitive object={lines} />
      <primitive object={markers} />
    </>
  );
}
