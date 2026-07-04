"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { buildFlights, type FlightClass } from "@/lib/seed/flights";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { sharedIntroProgress } from "@/lib/shaders/sharedIntro";
import { flightsVertexShader, flightsFragmentShader } from "@/lib/shaders/flights";

// Ambient departure corridor (#67 v1) — lights-only Points cloud, no fuselage
// mesh. At 2.8-5.6 km slant range a ~40 m hull subtends well under a degree
// and is invisible at night anyway (the After Dark original was moving
// blinking lights); see the GH #67 design comment for the v2 silhouette-quad
// fallback if this reads as loose fireflies. Two fixed-wing classes read at a
// glance by light pattern + speed, not geometry:
//   - AIRLINER: white double-flash wingtip strobes, ~35 m spread, faster.
//   - LIGHT GA (Cessna-class): single-flash strobe, ~11 m spread, dimmer, slower.
// Mirrors Traffic's shader-clocked slot pattern (Traffic.tsx) and Beacons'
// wake-on-intro + soft-flash envelope (Beacons.tsx).

type ClassCfg = {
  spreadHalf: number; // half wingspan (m)
  beaconPeriod: number;
  beaconIntensity: number;
  navIntensity: number;
  strobePeriod: number;
  strobePulses: 1 | 2;
  strobeIntensity: number;
  pointSize: number;
};

// Beacon period held equal across classes (a rotating anti-collision beacon's
// rate doesn't vary by aircraft size); everything else — spread, strobe
// pattern/period, brightness — carries the class identity per the brief.
const CLASS_CFG: Record<FlightClass, ClassCfg> = {
  airliner: {
    spreadHalf: 17.5, // ~35 m wingspan
    beaconPeriod: 1.1,
    beaconIntensity: 4.5,
    navIntensity: 2.4,
    strobePeriod: 1.2, // proposal: 1.2 s period, two ~60 ms pulses
    strobePulses: 2,
    strobeIntensity: 7.5, // proposal: HDR ~6-8 for ACES bloom
    pointSize: 5,
  },
  lightGA: {
    spreadHalf: 5.5, // ~11 m wingspan
    beaconPeriod: 1.1,
    beaconIntensity: 2.6,
    navIntensity: 1.4,
    strobePeriod: 1.7, // slower, single flash — the brief's "relative movement/pattern" cue
    strobePulses: 1,
    strobeIntensity: 4.5,
    pointSize: 3.5,
  },
};

// Per-plane light roles, in emission order: beacon (centre), nav port/starboard,
// strobe port/starboard. Co-located per side (nav + strobe share a wingtip, as
// on a real aircraft); only the beacon sits on the centreline.
const ROLE_KIND = [0, 1, 1, 2, 2]; // 0 beacon, 1 nav, 2 strobe
const ROLE_SIDE = [0, -1, 1, -1, 1];
const VERTS_PER_PLANE = ROLE_KIND.length;

export function Flights({ masterSeed }: { masterSeed: string }) {
  const enabled = useSceneStore((s) => s.flights.enabled);
  const citySize = useSceneStore((s) => s.citySize);

  const { geometry, material } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const data = buildFlights(masterSeed);
    const n = data.slots.length * VERTS_PER_PLANE;

    const position = new Float32Array(n * 3);
    const aA = new Float32Array(n * 3);
    const aB = new Float32Array(n * 3);
    const aPhase = new Float32Array(n);
    const aSpeed = new Float32Array(n);
    const aSide = new Float32Array(n);
    const aKind = new Float32Array(n);
    const aSpreadHalf = new Float32Array(n);
    const aIntensity = new Float32Array(n);
    const aFlashPeriod = new Float32Array(n);
    const aPulses = new Float32Array(n);
    const aSize = new Float32Array(n);

    let c = 0;
    for (const slot of data.slots) {
      const cfg = CLASS_CFG[slot.cls];
      for (let j = 0; j < VERTS_PER_PLANE; j++) {
        position[c * 3 + 0] = slot.aA[0];
        position[c * 3 + 1] = slot.aA[1];
        position[c * 3 + 2] = slot.aA[2];
        aA[c * 3 + 0] = slot.aA[0];
        aA[c * 3 + 1] = slot.aA[1];
        aA[c * 3 + 2] = slot.aA[2];
        aB[c * 3 + 0] = slot.aB[0];
        aB[c * 3 + 1] = slot.aB[1];
        aB[c * 3 + 2] = slot.aB[2];
        aPhase[c] = slot.phase;
        aSpeed[c] = slot.speedFrac;
        const kind = ROLE_KIND[j];
        aSide[c] = ROLE_SIDE[j];
        aKind[c] = kind;
        aSpreadHalf[c] = cfg.spreadHalf;
        aIntensity[c] =
          kind === 0 ? cfg.beaconIntensity : kind === 1 ? cfg.navIntensity : cfg.strobeIntensity;
        aFlashPeriod[c] = kind === 0 ? cfg.beaconPeriod : kind === 2 ? cfg.strobePeriod : 1;
        aPulses[c] = kind === 2 ? cfg.strobePulses : 0;
        aSize[c] = kind === 2 ? cfg.pointSize * 1.1 : cfg.pointSize;
        c += 1;
      }
    }

    const geo = new THREE.BufferGeometry();
    // `position` only defines the draw count; the real location is computed in
    // the vertex shader from aA/aB (the Traffic convention, Traffic.tsx:88-90).
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("aA", new THREE.BufferAttribute(aA, 3));
    geo.setAttribute("aB", new THREE.BufferAttribute(aB, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(aSpeed, 1));
    geo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
    geo.setAttribute("aKind", new THREE.BufferAttribute(aKind, 1));
    geo.setAttribute("aSpreadHalf", new THREE.BufferAttribute(aSpreadHalf, 1));
    geo.setAttribute("aIntensity", new THREE.BufferAttribute(aIntensity, 1));
    geo.setAttribute("aFlashPeriod", new THREE.BufferAttribute(aFlashPeriod, 1));
    geo.setAttribute("aPulses", new THREE.BufferAttribute(aPulses, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: flightsVertexShader,
      fragmentShader: flightsFragmentShader,
      uniforms: {
        uTime: sharedTime,
        uIntroProgress: sharedIntroProgress,
        uFadeFrac: { value: data.fadeFrac },
        uPixelRatio: {
          value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
        },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    mat.name = "flights"; // so a shader error names its material
    return { geometry: geo, material: mat };
  }, [masterSeed, citySize]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (!enabled) return null;
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
