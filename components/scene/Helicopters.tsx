"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, DEFAULT_HELICOPTERS } from "@/lib/state/sceneStore";
import { buildHelicopters } from "@/lib/seed/helicopters";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { sharedIntroProgress } from "@/lib/shaders/sharedIntro";
import { helicoptersVertexShader, helicoptersFragmentShader } from "@/lib/shaders/helicopters";

// Third air-transit class (#89) — lights-only Points cloud, no fuselage mesh,
// same visibility reasoning as Flights.tsx (a ~12m hull is sub-degree at
// range and invisible at night regardless). Distinct MOTION MODEL from
// Flights' point-to-point corridors: each helicopter samples a CLOSED loop of
// 2-4 waypoints (rooftop helipads + distant off-map pads) and alternates
// transit legs with hover holds, so it reads as patrolling rather than flying
// through. See lib/seed/helicopters.ts for the loop-building maths and
// wiki/notes/plan-overnight-agents-2026-07-05.md (#89) for the design brief.
//
// Honest risk (flagged in the design plan, not resolved here): lights-only
// means "landed" and "hovering" look identical, and rooftop hovers sit close
// to camera (tens-200m) unlike the 5-12km fixed-wing corridors — eyeball
// before shipping; a silhouette may be needed if it reads as "just a light
// cluster".
//
// "Redder/slower" signature: beacon brighter + slower than a single centred
// strobe (inverted vs. Flights, whose strobe is the bright/fast light) — see
// lib/shaders/helicopters.ts.
const HELI_CFG = {
  spreadHalf: 1.8, // nav light spread (m) — a fuselage, not a wingspan
  beaconPeriod: 1.6, // slower than the strobe (inverted vs Flights' CLASS_CFG)
  beaconIntensity: 6,
  navIntensity: 2.2,
  strobePeriod: 0.85, // faster than the beacon
  strobeIntensity: 3.5, // dimmer than the beacon (inverted vs Flights)
  pointSize: 4,
};

// Per-leg light roles, in emission order: beacon (centre), nav port/
// starboard, ONE centred strobe (aSide 0 — not a wingtip pair; the brief's
// "single strobe" cue).
const ROLE_KIND = [0, 1, 1, 2]; // 0 beacon, 1 nav, 2 strobe
const ROLE_SIDE = [0, -1, 1, 0];
const VERTS_PER_LEG = ROLE_KIND.length;

// Debug spawn pool (mirrors Flights.tsx): a fixed reserve of instances, each
// parked invisible until a Debug-panel click rewrites its phase to "start
// now". #89 follow-up (user feedback, 2026-07-08): every slot used to ride a
// copy of helicopter 0's own route, so every debug spawn looked identical —
// now slot i rides data.helicopters[i % data.helicopters.length].legs, so
// spawns cycle through DEBUG_POOL_SIZE different routes (wrapping once the
// pool outgrows AMBIENT_HELI_POOL). Smaller than Flights' 24-per-class pool:
// helicopters are a rarer, closer-range detail, and each pool instance
// already costs a whole multi-leg loop (2-4x the vertices of one Flights
// debug plane).
const DEBUG_POOL_SIZE = 12;
// Any phase that keeps uTime/cycleSec+phase (aClock.y/aClock.x) comfortably
// above 1 from boot, so a not-yet-launched pool instance reads as "parked"
// (see aRole.w/oneShot in lib/shaders/helicopters.ts) and stays invisible +
// uncounted until a trigger rewrites it.
const DEBUG_PARKED_PHASE = 1e6;

export function Helicopters({ masterSeed }: { masterSeed: string }) {
  // "Max Helicopters" live cap — how many ambient helicopters are shown (0 =
  // off; see the cap effect + render gate below). NOT a memo dep: dragging it
  // must never rebuild the geometry.
  const count = useSceneStore((s) => s.helicopters.count ?? DEFAULT_HELICOPTERS.count);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const heliSpawn = useSceneStore((s) => s.heliSpawn);
  const setFlightsAirborne = useSceneStore((s) => s.setFlightsAirborne);

  const {
    geometry,
    material,
    debugBase,
    debugLegCounts,
    ambientCount,
    ambientHeliBounds,
    ambientIntensityX,
  } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const data = buildHelicopters(masterSeed, cityShape, cityShapeScale);
    const totalAmbientLegs = data.helicopters.reduce((sum, h) => sum + h.legs.length, 0);
    // Each debug pool slot rides its OWN route (#89 follow-up) — slot i takes
    // data.helicopters[i % data.helicopters.length].legs — rather than every
    // slot parking a copy of helicopter 0's route, so spawns actually vary.
    const debugRoutes = Array.from(
      { length: DEBUG_POOL_SIZE },
      (_, i) => data.helicopters[i % data.helicopters.length],
    );
    const debugLegCounts = debugRoutes.map((h) => h.legs.length);
    const totalDebugLegs = debugLegCounts.reduce((sum, cnt) => sum + cnt, 0);
    const n = (totalAmbientLegs + totalDebugLegs) * VERTS_PER_LEG;

    const position = new Float32Array(n * 3);
    const aA = new Float32Array(n * 3);
    const aB = new Float32Array(n * 3);
    const aDir = new Float32Array(n * 3);
    // Packed attributes (lib/shaders/helicopters.ts) — this shader hit a real
    // "too many attributes" WebGLProgram compile failure at one-float-per-
    // attribute (Flights' own layout was already close to this GPU/driver's
    // budget); packing floats that travel together into vec2/vec3/vec4 costs
    // nothing (a vecN attribute is still exactly one attribute slot).
    const aWin = new Float32Array(n * 2); // x winStart, y winEnd
    const aClock = new Float32Array(n * 2); // x phase, y cycleSec
    const aRole = new Float32Array(n * 4); // x side, y kind, z spreadHalf, w oneShot
    const aLight = new Float32Array(n * 3); // x intensity, y flashPeriod, z size

    let c = 0;
    const writeLeg = (
      leg: { aA: [number, number, number]; aB: [number, number, number]; dir: [number, number, number] },
      phase: number,
      cycleSec: number,
      winStart: number,
      winEnd: number,
      oneShot: number,
    ) => {
      for (let j = 0; j < VERTS_PER_LEG; j++) {
        position[c * 3 + 0] = leg.aA[0];
        position[c * 3 + 1] = leg.aA[1];
        position[c * 3 + 2] = leg.aA[2];
        aA[c * 3 + 0] = leg.aA[0];
        aA[c * 3 + 1] = leg.aA[1];
        aA[c * 3 + 2] = leg.aA[2];
        aB[c * 3 + 0] = leg.aB[0];
        aB[c * 3 + 1] = leg.aB[1];
        aB[c * 3 + 2] = leg.aB[2];
        aDir[c * 3 + 0] = leg.dir[0];
        aDir[c * 3 + 1] = leg.dir[1];
        aDir[c * 3 + 2] = leg.dir[2];
        aWin[c * 2 + 0] = winStart;
        aWin[c * 2 + 1] = winEnd;
        aClock[c * 2 + 0] = phase;
        aClock[c * 2 + 1] = cycleSec;
        const kind = ROLE_KIND[j];
        aRole[c * 4 + 0] = ROLE_SIDE[j];
        aRole[c * 4 + 1] = kind;
        aRole[c * 4 + 2] = HELI_CFG.spreadHalf;
        aRole[c * 4 + 3] = oneShot;
        const intensity =
          kind === 0
            ? HELI_CFG.beaconIntensity
            : kind === 1
              ? HELI_CFG.navIntensity
              : HELI_CFG.strobeIntensity;
        const flashPeriod = kind === 0 ? HELI_CFG.beaconPeriod : kind === 2 ? HELI_CFG.strobePeriod : 1;
        // Strobe stays tighter than beacon/nav (mirrors Flights' round-2
        // visibility pass — spotting comes from the floor + brightness, not a
        // bigger flash).
        const size = kind === 2 ? HELI_CFG.pointSize * 0.8 : HELI_CFG.pointSize;
        aLight[c * 3 + 0] = intensity;
        aLight[c * 3 + 1] = flashPeriod;
        aLight[c * 3 + 2] = size;
        c += 1;
      }
    };

    // Ambient helicopters — each a contiguous run of leg-vertices. Record the
    // [start, end) vertex range per helicopter so the Max Helicopters cap effect
    // can hide/restore a whole helicopter by zeroing its point size (aLight.z).
    const ambientHeliBounds: { start: number; end: number }[] = [];
    for (const heli of data.helicopters) {
      const start = c;
      for (const leg of heli.legs) {
        writeLeg(leg, heli.phase, heli.cycleSec, leg.winStart, leg.winEnd, 0);
      }
      ambientHeliBounds.push({ start, end: c });
    }
    const ambientVertCount = c; // vertices used by ambient helis (the debug pool follows)
    // Untouched build-time INTENSITY (aLight.x) for every ambient vertex, so the
    // cap effect can hide/restore whole helicopters live. We cap on intensity,
    // NOT size: the shader floors point size to MIN_PX, so a zeroed aLight.z
    // still draws a 4px light — but a zero-intensity point is zero-rgb, which
    // adds nothing under additive blending (invisible).
    const ambientIntensityX = new Float32Array(ambientVertCount);
    for (let v = 0; v < ambientVertCount; v++) ambientIntensityX[v] = aLight[v * 3 + 0];

    // Debug spawn reserve — a POOL of instances, all parked invisible
    // (DEBUG_PARKED_PHASE) until a Debug-panel trigger rewrites one's phase
    // (see the effect below). #89 follow-up: slot i rides its OWN route
    // (debugRoutes[i] = data.helicopters[i % data.helicopters.length].legs),
    // not a shared representative one, so spawns actually vary — debugBase[i]
    // is the vertex offset of pool instance i's FIRST leg's FIRST vertex.
    const debugBase: number[] = [];
    for (let i = 0; i < DEBUG_POOL_SIZE; i++) {
      debugBase.push(c);
      const route = debugRoutes[i];
      for (const leg of route.legs) {
        writeLeg(leg, DEBUG_PARKED_PHASE, route.cycleSec, leg.winStart, leg.winEnd, 1);
      }
    }

    const geo = new THREE.BufferGeometry();
    // `position` only defines the draw count; the real location is computed
    // in the vertex shader from aA/aB (the Traffic/Flights convention).
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("aA", new THREE.BufferAttribute(aA, 3));
    geo.setAttribute("aB", new THREE.BufferAttribute(aB, 3));
    geo.setAttribute("aDir", new THREE.BufferAttribute(aDir, 3));
    geo.setAttribute("aWin", new THREE.BufferAttribute(aWin, 2));
    geo.setAttribute("aClock", new THREE.BufferAttribute(aClock, 2));
    geo.setAttribute("aRole", new THREE.BufferAttribute(aRole, 4));
    geo.setAttribute("aLight", new THREE.BufferAttribute(aLight, 3));

    const mat = new THREE.ShaderMaterial({
      vertexShader: helicoptersVertexShader,
      fragmentShader: helicoptersFragmentShader,
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
    mat.name = "helicopters"; // so a shader error names its material

    return {
      geometry: geo,
      material: mat,
      debugBase,
      debugLegCounts,
      ambientCount: data.helicopters.length,
      ambientHeliBounds,
      ambientIntensityX,
    };
  }, [masterSeed, cityShape, cityShapeScale, citySize]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // "Max Helicopters" cap (user 2026-07-06): show the first `count` helicopters
  // and hide the rest by zeroing their INTENSITY (aLight.x) — a live buffer
  // write on the long-lived geometry (no rebuild / recompile). We cap on
  // intensity, not size: the shader floors point size to MIN_PX, so a zeroed
  // aLight.z still draws a 4px light; a zero-intensity point is zero-rgb and adds
  // nothing under additive blending. ambientIntensityX restores exact values
  // when the cap is raised. The debug pool sits past the ambient region.
  useEffect(() => {
    const aLight = geometry.getAttribute("aLight") as THREE.BufferAttribute;
    for (let i = 0; i < ambientHeliBounds.length; i++) {
      const visible = i < count;
      const { start, end } = ambientHeliBounds[i];
      for (let v = start; v < end; v++) aLight.setX(v, visible ? ambientIntensityX[v] : 0);
    }
    aLight.needsUpdate = true;
  }, [geometry, ambientHeliBounds, ambientIntensityX, count]);

  // Debug spawn trigger (mirrors Flights.tsx): each click rewrites the next
  // pool instance's aClock.x (phase) so uTime/cycleSec+phase reads 0 at the
  // CURRENT shared clock — the helicopter starts its loop right now instead of
  // waiting to be re-triggered. Round-robins over the pool on the monotonic
  // trigger counter, recycling the oldest once the pool is full (its lap
  // restarts from the loop's first leg). Not depending on `geometry`/
  // `debugBase`: a click must fire exactly once, not again on every unrelated
  // re-render or reseed.
  useEffect(() => {
    if (heliSpawn === 0) return;
    const aClock = geometry.getAttribute("aClock") as THREE.BufferAttribute;
    const slot = (heliSpawn - 1) % DEBUG_POOL_SIZE;
    const base = debugBase[slot];
    const phase = -sharedTime.value / aClock.getY(base);
    const count = debugLegCounts[slot] * VERTS_PER_LEG;
    for (let i = 0; i < count; i++) aClock.setX(base + i, phase);
    aClock.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heliSpawn]);

  // Live "helicopters in the air" tally (#89), throttled like Flights.tsx.
  // Ambient helicopters have no idle gap — their loop is 100% transit/hover —
  // so every ambient one counts continuously while enabled; only the debug
  // pool's spawned-vs-parked state needs per-frame replication (mirrors the
  // shader's own oneShot clamp: active while raw = now/cycleSec+phase sits
  // in [0, 1)).
  const tallyAcc = useRef(0);
  const lastHeli = useRef(-1);
  useFrame((_, delta) => {
    tallyAcc.current += delta;
    if (tallyAcc.current < 0.35) return;
    tallyAcc.current = 0;
    let heli = 0;
    if (count > 0) {
      heli += Math.min(count, ambientCount); // capped helis are hidden (Max Helicopters)
      const now = sharedTime.value;
      const aClockAttr = geometry.getAttribute("aClock") as THREE.BufferAttribute;
      for (let i = 0; i < DEBUG_POOL_SIZE; i++) {
        const base = debugBase[i];
        const raw = now / aClockAttr.getY(base) + aClockAttr.getX(base);
        if (raw >= 0 && raw < 1) heli += 1;
      }
    }
    if (heli !== lastHeli.current) {
      lastHeli.current = heli;
      // Partial merge (sceneStore.ts) — only the `heli` key changes; Flights
      // owns airliner/lightGA and is never stomped by this write.
      setFlightsAirborne({ heli });
    }
  });

  if (count === 0) return null; // Max Helicopters at 0 = off (replaced the enabled switch)
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
