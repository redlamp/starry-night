"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, DEFAULT_FLIGHTS } from "@/lib/state/sceneStore";
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
    spreadHalf: 10, // ~20 m apparent half-span (tightened 2026-07-04: real 35 m read too wide at range)
    beaconPeriod: 1.1,
    beaconIntensity: 5.5,
    navIntensity: 2.9,
    strobePeriod: 1.2, // proposal: 1.2 s period, two ~60 ms pulses (shader widens the pulse itself)
    strobePulses: 2,
    strobeIntensity: 9,
    pointSize: 5,
  },
  lightGA: {
    spreadHalf: 3.5, // ~7 m apparent half-span (tightened with the airliner)
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

// Debug spawn triggers (#67 follow-up): a fixed POOL of reserved instances per
// class, appended after the seeded ambient slots so their buffer offsets are
// stable for the lifetime of a given seed/geometry. Each Spawn click launches
// the NEXT instance in the pool (round-robin on the monotonic trigger counter,
// see the effects below), so the buttons stack — spam them and the airborne
// count climbs, then falls as each one-shot completes its transit and parks.
// DEBUG_POOL_PER_CLASS is the ceiling on simultaneous debug planes per class;
// past it the round-robin wraps and recycles the oldest still-flying instance
// (its transit restarts from the corridor start). Riding the departure corridor
// (corridors[0] — the only one in v1.5) keeps them on the same axis the ambient
// traffic uses; v2's second (arrival) corridor can give debug spawns their own
// corridor choice later without touching this mechanic.
const DEBUG_CLASSES: FlightClass[] = ["airliner", "lightGA"];
const DEBUG_POOL_PER_CLASS = 24;
// Any phase that keeps `uTime/aTransit + aPhase` comfortably above 1 from
// boot, so a not-yet-launched pool instance reads as "already landed" (see
// aOneShot in lib/shaders/flights.ts) and stays invisible + uncounted until a
// trigger rewrites it.
const DEBUG_PARKED_PHASE = 1e6;

// JS mirror of the shader's hash11 (lib/shaders/flights.ts) + fract, so the
// live "planes in the air" tally computes each plane's transit/gap cycle
// exactly as the GPU does.
const frac = (x: number) => x - Math.floor(x);
function hash11(p: number): number {
  p = frac(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return frac(p);
}

export function Flights({ masterSeed }: { masterSeed: string }) {
  const enabled = useSceneStore((s) => s.flights.enabled);
  // #67 follow-up live look settings — `?? DEFAULT` covers configs saved
  // before these existed (revertToSaved/boot-hydration replace the whole
  // `flights` object, so an old save can leave these keys missing).
  const gapMin = useSceneStore((s) => s.flights.gapMin ?? DEFAULT_FLIGHTS.gapMin);
  const gapMax = useSceneStore((s) => s.flights.gapMax ?? DEFAULT_FLIGHTS.gapMax);
  const deviation = useSceneStore((s) => s.flights.deviation ?? DEFAULT_FLIGHTS.deviation);
  const citySize = useSceneStore((s) => s.citySize);
  const spawnAirliner = useSceneStore((s) => s.flightsSpawn.airliner);
  const spawnLightGA = useSceneStore((s) => s.flightsSpawn.lightGA);
  const setFlightsAirborne = useSceneStore((s) => s.setFlightsAirborne);

  const { geometry, material, debugBase, slotMeta } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const data = buildFlights(masterSeed);
    const n =
      (data.slots.length + DEBUG_CLASSES.length * DEBUG_POOL_PER_CLASS) * VERTS_PER_PLANE;

    const position = new Float32Array(n * 3);
    const aA = new Float32Array(n * 3);
    const aB = new Float32Array(n * 3);
    const aPhase = new Float32Array(n);
    const aTransit = new Float32Array(n);
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
      transitSec: number,
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
        aTransit[c] = transitSec;
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
        slot.transitSec,
        slot.cls,
        0,
      );
    }

    // Debug spawn reserve — a POOL per class, all parked invisible
    // (DEBUG_PARKED_PHASE) until a Debug-panel trigger rewrites one instance's
    // phase (see the effects below). No jitter on speed: a debug spawn should
    // behave exactly like an ambient plane of its class, just on demand.
    // debugBase[cls] is the vertex offset of the pool's FIRST instance; pool
    // instance i sits at debugBase[cls] + i * VERTS_PER_PLANE.
    const debugCorridor = data.corridors[0];
    const debugSegLen = corridorLength(debugCorridor);
    const debugBase: Record<FlightClass, number> = { airliner: 0, lightGA: 0 };
    for (const cls of DEBUG_CLASSES) {
      debugBase[cls] = c;
      for (let i = 0; i < DEBUG_POOL_PER_CLASS; i++) {
        writePlane(
          debugCorridor.aA,
          debugCorridor.aB,
          debugCorridor.fadeFrac,
          DEBUG_PARKED_PHASE,
          debugSegLen / CLASS_SPEED[cls],
          cls,
          1,
        );
      }
    }

    const geo = new THREE.BufferGeometry();
    // `position` only defines the draw count; the real location is computed in
    // the vertex shader from aA/aB (the Traffic convention, Traffic.tsx:88-90).
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("aA", new THREE.BufferAttribute(aA, 3));
    geo.setAttribute("aB", new THREE.BufferAttribute(aB, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
    geo.setAttribute("aTransit", new THREE.BufferAttribute(aTransit, 1));
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
        // Live look settings (#67 follow-up) — kept in sync post-creation by
        // the effect below; deliberately excluded from this memo's deps (see
        // the eslint-disable at its dependency array) so a slider tick never
        // rebuilds the geometry/material.
        uGapMin: { value: gapMin },
        uGapMax: { value: gapMax },
        uFlightDeviation: { value: deviation },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    mat.name = "flights"; // so a shader error names its material
    // Per-plane cycle inputs for the live airborne tally in the useFrame below
    // (ambient slots only — debug spawns don't count toward "in the air").
    const slotMeta = data.slots.map((sl) => ({
      transitSec: sl.transitSec,
      phase: sl.phase,
      cls: sl.cls,
    }));
    return { geometry: geo, material: mat, debugBase, slotMeta };
    // gapMin/gapMax/deviation seed the uniforms above but must NOT trigger a
    // rebuild on every slider tick — the effect below re-syncs their live
    // values onto this same long-lived material instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterSeed, citySize]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Live uniform sync (#67 follow-up): gap + deviation are look settings, not
  // gen inputs — push them onto the long-lived material instead of rebuilding
  // geometry, mirroring Moon.tsx's termStyle/edgeSharpness effect.
  useEffect(() => {
    material.uniforms.uGapMin.value = gapMin;
    material.uniforms.uGapMax.value = gapMax;
    material.uniforms.uFlightDeviation.value = deviation;
  }, [material, gapMin, gapMax, deviation]);

  // Debug spawn triggers (#67 follow-up): each counter increment rewrites the
  // reserved instance's aPhase so uTime/aTransit+aPhase reads 0 at the CURRENT
  // shared clock (read from the sharedTime module, not the window global) —
  // the plane appears at the airport end right now instead of waiting out the
  // ambient loop. The shader clamps this instance's progress instead of
  // wrapping it (aOneShot), so it can't loop.
  //
  // Guarded on the initial 0 so mounting/reseeding never auto-fires. Not
  // depending on `geometry`/`debugBase`: a click must fire exactly once, not
  // again on every unrelated re-render or reseed (mirrors the periodSec
  // tracking effect in CameraControls.tsx).
  useEffect(() => {
    if (spawnAirliner === 0) return;
    const aPhase = geometry.getAttribute("aPhase") as THREE.BufferAttribute;
    const aTransit = geometry.getAttribute("aTransit") as THREE.BufferAttribute;
    // Round-robin over the pool on the monotonic trigger counter so each click
    // launches a fresh instance (stacking), wrapping to recycle the oldest once
    // the pool is full.
    const slot = (spawnAirliner - 1) % DEBUG_POOL_PER_CLASS;
    const base = debugBase.airliner + slot * VERTS_PER_PLANE;
    const phase = -sharedTime.value / aTransit.getX(base);
    for (let j = 0; j < VERTS_PER_PLANE; j++) aPhase.setX(base + j, phase);
    aPhase.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnAirliner]);

  useEffect(() => {
    if (spawnLightGA === 0) return;
    const aPhase = geometry.getAttribute("aPhase") as THREE.BufferAttribute;
    const aTransit = geometry.getAttribute("aTransit") as THREE.BufferAttribute;
    const slot = (spawnLightGA - 1) % DEBUG_POOL_PER_CLASS;
    const base = debugBase.lightGA + slot * VERTS_PER_PLANE;
    const phase = -sharedTime.value / aTransit.getX(base);
    for (let j = 0; j < VERTS_PER_PLANE; j++) aPhase.setX(base + j, phase);
    aPhase.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnLightGA]);

  // Live "planes in the air" readout (#67): count ambient planes currently in
  // their transit phase (not idling in the between-flights gap), throttled to a
  // few times a second. Replicates the shader's per-plane gap/cycle so the
  // count matches the sky; writes to the store only on change, so the panel
  // re-renders when a plane appears/lands, not every frame.
  const tallyAcc = useRef(0);
  const lastAirborne = useRef({ airliner: -1, lightGA: -1 });
  useFrame((_, delta) => {
    tallyAcc.current += delta;
    if (tallyAcc.current < 0.35) return;
    tallyAcc.current = 0;
    let airliner = 0;
    let lightGA = 0;
    if (enabled) {
      const now = sharedTime.value;
      for (const m of slotMeta) {
        const gap = gapMin + hash11(m.phase * 41 + 7) * (gapMax - gapMin);
        const cycle = m.transitSec + gap;
        // Airborne while the cycle position is within the transit fraction; the
        // remainder of the cycle is the on-ground gap.
        if (frac(now / cycle + m.phase) < m.transitSec / cycle) {
          if (m.cls === "airliner") airliner += 1;
          else lightGA += 1;
        }
      }
      // Debug spawns (one-shot): a spawned plane you can see crossing the sky
      // is a plane in the air, so it counts too — and the pool stacks, so sum
      // every in-flight instance. Read the LIVE aPhase (a Spawn button rewrites
      // it) and mirror the shader's clamp — airborne while raw = now/aTransit +
      // aPhase is in [0, 1); it parks at ≥1 after the single transit, and the
      // pre-spawn sentinel (DEBUG_PARKED_PHASE ≫ 1) reads as parked too, so a
      // not-yet-launched pool instance never counts.
      const aPhaseAttr = geometry.getAttribute("aPhase") as THREE.BufferAttribute;
      const aTransitAttr = geometry.getAttribute("aTransit") as THREE.BufferAttribute;
      for (const cls of DEBUG_CLASSES) {
        for (let i = 0; i < DEBUG_POOL_PER_CLASS; i++) {
          const base = debugBase[cls] + i * VERTS_PER_PLANE;
          const raw = now / aTransitAttr.getX(base) + aPhaseAttr.getX(base);
          if (raw >= 0 && raw < 1) {
            if (cls === "airliner") airliner += 1;
            else lightGA += 1;
          }
        }
      }
    }
    if (airliner !== lastAirborne.current.airliner || lightGA !== lastAirborne.current.lightGA) {
      lastAirborne.current = { airliner, lightGA };
      setFlightsAirborne({ airliner, lightGA, heli: 0 });
    }
  });

  if (!enabled) return null;
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
