"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { buildFlights, corridorLength, CLASS_SPEED, type FlightClass } from "@/lib/seed/flights";
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
//
// #67 visibility pass: beacon/nav intensities raised (~20-25%) so the STEADY
// lights — the shader's MIN_PX screen-size floor is what actually guarantees
// they never go sub-pixel — also punch through the ACES bloom against city
// glow at the 5-12 km slant ranges the full-transit corridor covers.
// Round 2 (user 2026-07-04): the white strobe is NOT a size lever — it keeps
// a modest brightness bump but its point size (see the kind===2 multiplier
// below) sits BELOW the original, tighter/brief rather than a bigger flash.
// Relative ordering (strobe > beacon > nav, airliner > lightGA) is unchanged.
const CLASS_CFG: Record<FlightClass, ClassCfg> = {
  airliner: {
    spreadHalf: 17.5, // ~35 m wingspan
    beaconPeriod: 1.1,
    beaconIntensity: 5.5,
    navIntensity: 2.9,
    strobePeriod: 1.2, // proposal: 1.2 s period, two ~60 ms pulses (shader widens the pulse itself)
    strobePulses: 2,
    strobeIntensity: 9,
    pointSize: 5,
  },
  lightGA: {
    spreadHalf: 5.5, // ~11 m wingspan
    beaconPeriod: 1.1,
    beaconIntensity: 3.2,
    navIntensity: 1.7,
    strobePeriod: 1.7, // slower, single flash — the brief's "relative movement/pattern" cue
    strobePulses: 1,
    strobeIntensity: 5.5,
    pointSize: 3.5,
  },
};

// Per-plane light roles, in emission order: beacon (centre), nav port/starboard,
// strobe port/starboard. Co-located per side (nav + strobe share a wingtip, as
// on a real aircraft); only the beacon sits on the centreline.
const ROLE_KIND = [0, 1, 1, 2, 2]; // 0 beacon, 1 nav, 2 strobe
const ROLE_SIDE = [0, -1, 1, -1, 1];
const VERTS_PER_PLANE = ROLE_KIND.length;

// Debug spawn triggers (#67 follow-up): one reserved instance per class,
// appended after the seeded ambient slots so their buffer offsets are stable
// for the lifetime of a given seed/geometry. Riding the departure corridor
// (corridors[0] — the only one in v1.5) keeps them on the same axis the
// ambient traffic uses; v2's second (arrival) corridor can give debug spawns
// their own corridor choice later without touching this reserve mechanic.
const DEBUG_CLASSES: FlightClass[] = ["airliner", "lightGA"];
// Any phase that keeps `uTime*aSpeed + aPhase` comfortably above 1 from boot,
// so the reserved instance reads as "already landed" (see aOneShot in
// lib/shaders/flights.ts) and stays invisible until a trigger rewrites it.
const DEBUG_PARKED_PHASE = 1e6;

export function Flights({ masterSeed }: { masterSeed: string }) {
  const enabled = useSceneStore((s) => s.flights.enabled);
  const citySize = useSceneStore((s) => s.citySize);
  const spawnAirliner = useSceneStore((s) => s.flightsSpawn.airliner);
  const spawnLightGA = useSceneStore((s) => s.flightsSpawn.lightGA);

  const { geometry, material, debugBase } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const data = buildFlights(masterSeed);
    const n = (data.slots.length + DEBUG_CLASSES.length) * VERTS_PER_PLANE;

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
    const aFadeFrac = new Float32Array(n);
    const aOneShot = new Float32Array(n);

    let c = 0;
    const writePlane = (
      pA: [number, number, number],
      pB: [number, number, number],
      fadeFrac: number,
      phase: number,
      speedFrac: number,
      cls: FlightClass,
      oneShot: number,
    ) => {
      const cfg = CLASS_CFG[cls];
      for (let j = 0; j < VERTS_PER_PLANE; j++) {
        position[c * 3 + 0] = pA[0];
        position[c * 3 + 1] = pA[1];
        position[c * 3 + 2] = pA[2];
        aA[c * 3 + 0] = pA[0];
        aA[c * 3 + 1] = pA[1];
        aA[c * 3 + 2] = pA[2];
        aB[c * 3 + 0] = pB[0];
        aB[c * 3 + 1] = pB[1];
        aB[c * 3 + 2] = pB[2];
        aPhase[c] = phase;
        aSpeed[c] = speedFrac;
        const kind = ROLE_KIND[j];
        aSide[c] = ROLE_SIDE[j];
        aKind[c] = kind;
        aSpreadHalf[c] = cfg.spreadHalf;
        aIntensity[c] =
          kind === 0 ? cfg.beaconIntensity : kind === 1 ? cfg.navIntensity : cfg.strobeIntensity;
        aFlashPeriod[c] = kind === 0 ? cfg.beaconPeriod : kind === 2 ? cfg.strobePeriod : 1;
        aPulses[c] = kind === 2 ? cfg.strobePulses : 0;
        aSize[c] = kind === 2 ? cfg.pointSize * 0.8 : cfg.pointSize; // strobe stays tighter/brief than beacon/nav (#67 round 2) — spotting comes from the floor + brightness, not a bigger strobe
        aFadeFrac[c] = fadeFrac;
        aOneShot[c] = oneShot;
        c += 1;
      }
    };

    for (const slot of data.slots) {
      const corridor = data.corridors[slot.corridor];
      writePlane(
        corridor.aA,
        corridor.aB,
        corridor.fadeFrac,
        slot.phase,
        slot.speedFrac,
        slot.cls,
        0,
      );
    }

    // Debug spawn reserve — parked invisible (DEBUG_PARKED_PHASE) until a
    // Debug-panel trigger rewrites this instance's phase (see the effects
    // below). No jitter on speed: a debug spawn should behave exactly like
    // an ambient plane of its class, just on demand.
    const debugCorridor = data.corridors[0];
    const debugSegLen = corridorLength(debugCorridor);
    const debugBase: Record<FlightClass, number> = { airliner: 0, lightGA: 0 };
    for (const cls of DEBUG_CLASSES) {
      debugBase[cls] = c;
      writePlane(
        debugCorridor.aA,
        debugCorridor.aB,
        debugCorridor.fadeFrac,
        DEBUG_PARKED_PHASE,
        CLASS_SPEED[cls] / debugSegLen,
        cls,
        1,
      );
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
    geo.setAttribute("aFadeFrac", new THREE.BufferAttribute(aFadeFrac, 1));
    geo.setAttribute("aOneShot", new THREE.BufferAttribute(aOneShot, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: flightsVertexShader,
      fragmentShader: flightsFragmentShader,
      uniforms: {
        uTime: sharedTime,
        uIntroProgress: sharedIntroProgress,
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
    return { geometry: geo, material: mat, debugBase };
  }, [masterSeed, citySize]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Debug spawn triggers (#67 follow-up): each counter increment rewrites the
  // reserved instance's aPhase so fract(uTime*aSpeed+aPhase) reads 0 at the
  // CURRENT shared clock (read from the sharedTime module, not the window
  // global) — the plane appears at the airport end right now instead of
  // waiting out the ambient ~40-90s loop. The shader clamps this instance's
  // progress instead of wrapping it (aOneShot), so it can't loop.
  //
  // Guarded on the initial 0 so mounting/reseeding never auto-fires. Not
  // depending on `geometry`/`debugBase`: a click must fire exactly once, not
  // again on every unrelated re-render or reseed (mirrors the periodSec
  // tracking effect in CameraControls.tsx).
  useEffect(() => {
    if (spawnAirliner === 0) return;
    const aPhase = geometry.getAttribute("aPhase") as THREE.BufferAttribute;
    const aSpeed = geometry.getAttribute("aSpeed") as THREE.BufferAttribute;
    const base = debugBase.airliner;
    const phase = -sharedTime.value * aSpeed.getX(base);
    for (let j = 0; j < VERTS_PER_PLANE; j++) aPhase.setX(base + j, phase);
    aPhase.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnAirliner]);

  useEffect(() => {
    if (spawnLightGA === 0) return;
    const aPhase = geometry.getAttribute("aPhase") as THREE.BufferAttribute;
    const aSpeed = geometry.getAttribute("aSpeed") as THREE.BufferAttribute;
    const base = debugBase.lightGA;
    const phase = -sharedTime.value * aSpeed.getX(base);
    for (let j = 0; j < VERTS_PER_PLANE; j++) aPhase.setX(base + j, phase);
    aPhase.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnLightGA]);

  if (!enabled) return null;
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
