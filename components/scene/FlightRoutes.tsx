"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { buildFlights } from "@/lib/seed/flights";

// Air-route debug overlay (#67 follow-up; multi-route in the #67 follow-up
// dated 2026-07-04). Every seeded corridor is drawn as a real 3D polyline —
// the departure corridor's climb is actual geometry (aA low over the airport,
// aB climbed near the city), so switching this on shows that line visibly
// RISING across the frame, not a flat map annotation; fly-by corridors are
// level (aA/aB share an altitude) since they carry no airport story. Amber,
// additive, vertex-colour gradient that brightens toward the aB end (a
// departure's direction of travel; arbitrary but consistent for fly-bys) — a
// small marker point sits at the airport anchor ONLY for the departure
// corridor, so the runway end reads before the eye follows the line; fly-bys
// get no marker, since they don't have an airport to mark.
//
// Debug aid, not scene art: depthTest stays ON (the default) so buildings
// occlude it like the real corridor would, unlike the depthTest:false
// GIS-style planning overlays (DistrictShells, TrafficDensityOverlay). fog
// off + toneMapped off match the flights material's raw-colour treatment.
const AMBER: [number, number, number] = [1.0, 0.62, 0.16];
const DIM_FACTOR = 0.3; // brightness at the airport (origin) end of the gradient
const MARKER_SIZE_PX = 10;

export function FlightRoutes({ masterSeed }: { masterSeed: string }) {
  const show = useSceneStore((s) => s.debug.showFlightRoutes);
  const citySize = useSceneStore((s) => s.citySize);

  const { lines, marker } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const data = buildFlights(masterSeed);
    const n = data.corridors.length;

    const positions = new Float32Array(n * 2 * 3);
    const colors = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const corridor = data.corridors[i];
      const a = i * 6;
      positions[a + 0] = corridor.aA[0];
      positions[a + 1] = corridor.aA[1];
      positions[a + 2] = corridor.aA[2];
      positions[a + 3] = corridor.aB[0];
      positions[a + 4] = corridor.aB[1];
      positions[a + 5] = corridor.aB[2];
      // Dim at the aA end, full brightness at aB — a departure's actual
      // direction of travel; arbitrary (but still a consistent gradient) for
      // the level, undirected fly-by corridors.
      colors[a + 0] = AMBER[0] * DIM_FACTOR;
      colors[a + 1] = AMBER[1] * DIM_FACTOR;
      colors[a + 2] = AMBER[2] * DIM_FACTOR;
      colors[a + 3] = AMBER[0];
      colors[a + 4] = AMBER[1];
      colors[a + 5] = AMBER[2];
    }

    // Airport marker: ONLY the departure corridor has an airport to mark —
    // fly-bys carry no anchor (see the Corridor.kind union in lib/seed/flights.ts).
    const departures = data.corridors.filter((c) => c.kind === "departure");
    const markerPositions = new Float32Array(departures.length * 3);
    for (let i = 0; i < departures.length; i++) {
      markerPositions[i * 3 + 0] = departures[i].aA[0];
      markerPositions[i * 3 + 1] = departures[i].aA[1];
      markerPositions[i * 3 + 2] = departures[i].aA[2];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false, // display-space amber straight to screen (TrafficDensityOverlay precedent)
    });
    const seg = new THREE.LineSegments(geo, mat);
    seg.frustumCulled = false;

    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute("position", new THREE.BufferAttribute(markerPositions, 3));
    const markerMat = new THREE.PointsMaterial({
      color: new THREE.Color(...AMBER),
      size: MARKER_SIZE_PX,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const pts = new THREE.Points(markerGeo, markerMat);
    pts.frustumCulled = false;

    return { lines: seg, marker: pts };
  }, [masterSeed, citySize]);

  useEffect(() => {
    return () => {
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    };
  }, [lines, marker]);

  if (!show) return null;
  return (
    <>
      <primitive object={lines} />
      <primitive object={marker} />
    </>
  );
}
