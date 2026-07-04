// Ambient plane lights (#67 v1). Position slides A->B entirely on the GPU —
// originally a bare fract(uTime*aSpeed+aPhase) loop, the same clocking as
// Traffic (lib/shaders/traffic.ts:41); see the #67 follow-up note below for
// the transit+gap cycle it grew into — so there is zero per-frame CPU and
// motion is deterministic for a seed. Five points per plane share one baked
// segment (aA/aB/aPhase/aTransit) and pick their light role from aKind/aSide,
// the ShootingStars aTrail trick (lib/shaders/shootingStar.ts:10-11) applied
// to a discrete role selector instead of a continuous trail position:
//   aKind 0 = beacon (centre), 1 = nav (port/starboard), 2 = strobe (port/starboard)
//   aSide  -1 = port, 0 = centre, +1 = starboard
// Wingtip/nav/strobe offsets are built from the segment's own heading in the
// vertex shader, so the ~35 m (airliner) / ~11 m (light GA) light spread reads
// as separate port/starboard points rather than one blob.
//
// #67 follow-up: a few extra instances at the end of the buffer are reserved
// debug spawns (aOneShot=1) — Flights.tsx rewrites their aPhase so
// uTime/aTransit+aPhase reads 0 at the moment a Debug-panel button fires, and
// this shader clamps (rather than fracts) their progress so they can't loop
// back around afterward. aFadeFrac moved from a uniform to a per-vertex
// attribute so each corridor (v2 adds a second, for arrivals) can carry its
// own fade width.
//
// #67 visibility pass: at 5-12 km slant range the old plain 1/d point size
// (clamp(...,1.5,10.0), no pixel-ratio floor on the low end) fell under a
// pixel and lost the plane against city glow. The flash envelope also moved
// from the fragment stage into the vertex stage here (vLevel replaces
// vFlashPeriod/vPulses/vKind as what crosses the vertex/fragment boundary) —
// per-vertex is cheaper than the old per-fragment recompute, and it leaves one
// place to read the strobe's brightness pulse.
//
// #67 visibility pass, round 2 (user 2026-07-04): a first pass also grew the
// white strobe's POINT SIZE at the flash peak — user feedback was that it then
// read too large. Spotting now comes from size (the MIN_PX floor, applied to
// every light including the steady beacon/nav) and brightness only; the
// strobe does not swell — see the size multiplier in Flights.tsx CLASS_CFG,
// which sits BELOW 1.0 (tighter than beacon/nav), and vLevel's ceiling below,
// which stayed at the original 1.0 rather than the round-1 1.4.
//
// #67 follow-up — time-between-flights + route deviation (user 2026-07-04):
// ambient slots used to loop a bare transit forever (fract(uTime*aSpeed+
// aPhase)), so a route always had a plane on it. They now loop a TRANSIT+GAP
// cycle: aTransit (baked seconds to cross the segment, replacing aSpeed) plus
// a per-plane gapSec hashed UNIFORMLY from aPhase into [uGapMin, uGapMax] — 0/0
// reproduces the old always-flying loop exactly, since cycleSec then equals
// aTransit. `t` sweeps 0..1 across the transit portion of the cycle and then
// CLAMPS (not wraps) at 1 for the remaining gap — the existing corridor-end
// fade below already closes vAlpha to 0 by t=1, so staying pinned there is
// all that's needed to hide the plane for the whole gap; no separate
// visibility gate. Each PASS (one full cycle) also gets a small lateral +
// altitude wander off the baked A->B line, hashed from (passIndex, aPhase) and
// scaled by uFlightDeviation, so repeat passes of the same slot read as
// slightly different lines. Debug one-shot spawns (aOneShot) are untouched:
// same clamp-based single-transit formula as before, no gap, no deviation —
// there's only ever one pass to vary.

export const flightsVertexShader = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uIntroProgress; // shared window-intro progress (Beacons pattern)
uniform float uGapMin; // #67 follow-up: seconds, low end of the per-plane gap range
uniform float uGapMax; // seconds, high end — 0/0 reproduces the old always-flying loop
uniform float uFlightDeviation; // #67 follow-up: 0..1, per-pass lateral/altitude wander

attribute vec3 aA;
attribute vec3 aB;
attribute float aPhase;
attribute float aTransit;    // seconds to cross the segment (baked segLen/speed; was aSpeed)
attribute float aSide;       // -1 port, 0 centre, +1 starboard
attribute float aKind;       // 0 beacon, 1 nav, 2 strobe
attribute float aSpreadHalf; // half wingspan (m)
attribute float aIntensity;
attribute float aFlashPeriod;
attribute float aPulses;     // 0 steady, 1 single-flash, 2 double-flash
attribute float aSize;
attribute float aFadeFrac;   // corridor-end fade width, as a fraction of segment length (per-corridor, #67 follow-up)
attribute float aOneShot;    // 0 ambient loop, 1 debug one-shot spawn (#67 follow-up)

varying vec3 vColor;
varying float vAlpha;
varying float vIntensity;
varying float vLevel; // flash envelope, 0..1 — see #67 visibility pass note above

// Screen-space (CSS-pixel) floor/ceiling on point size, so a plane light
// reads at any corridor distance without either bound silently re-shrinking
// on a hi-DPI screen — both are multiplied by uPixelRatio at use, unlike the
// old flat device-pixel clamp(1.5, 10.0). Applies to every light kind alike
// (beacon/nav/strobe) — this is the spotting fix; the strobe gets no extra
// size on top of it (brightness is its lever, see vLevel below).
const float MIN_PX = 4.0;
const float MAX_PX = 10.0;

// #67 follow-up: per-pass deviation offsets at uFlightDeviation = 1.0.
const float DEVIATION_LATERAL_M = 300.0;
const float DEVIATION_ALT_M = 100.0;

// Cheap 1D hash (same family as lib/shaders/window.ts / starField.ts hash11).
// Gap + deviation are pure functions of (aPhase[, passIndex]) — never uTime
// alone — so both stay a deterministic function of the seed + clock, per the
// PRD's no-Math.random/no-Date.now contract.
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  vec3 seg = aB - aA;
  vec2 dir = normalize(seg.xz);
  vec2 perp = vec2(-dir.y, dir.x); // horizontal perpendicular to the flight path

  float t;
  vec3 basePos;
  if (aOneShot > 0.5) {
    // Debug one-shot spawn: unchanged — clamp (not fract/gap) so it flies once
    // and parks at the end (raw keeps climbing past 1 once uTime does, but t
    // pins at 1 where the fade below is already fully closed — no separate
    // "kill" flag needed). No deviation either: there's only ever one pass.
    t = clamp(uTime / aTransit + aPhase, 0.0, 1.0);
    basePos = mix(aA, aB, t);
  } else {
    // Ambient slot: a TRANSIT+GAP cycle. gapSec is seeded per-plane, UNIFORMLY
    // in [uGapMin, uGapMax], via a hash of aPhase (the plane's identity) so
    // planes don't all gap in lockstep.
    float gapSec = mix(uGapMin, uGapMax, hash11(aPhase * 41.0 + 7.0));
    float cycleSec = aTransit + gapSec;
    float raw = uTime / cycleSec + aPhase;
    float cyclePos = fract(raw);
    float passIndex = floor(raw);
    // t sweeps 0..1 across the TRANSIT portion of the cycle, then clamps (not
    // wraps) for the rest — the corridor-end fade below closes vAlpha to 0 by
    // t=1, so staying pinned there hides the plane for the whole gap.
    t = clamp(cyclePos * cycleSec / aTransit, 0.0, 1.0);

    // Per-pass route deviation: a small lateral + altitude wander off the
    // baked A->B line, re-rolled once per loop via passIndex (constant for the
    // whole cycle — it only changes when a new pass starts), so pass N and
    // pass N+1 read as slightly different lines. Pure hash of (passIndex,
    // aPhase): no Math.random/Date.now, deterministic for a given seed+clock.
    float devLat = (hash11(passIndex * 17.0 + aPhase * 131.0 + 3.0) - 0.5) * 2.0;
    float devAlt = (hash11(passIndex * 29.0 + aPhase * 131.0 + 41.0) - 0.5) * 2.0;
    basePos = mix(aA, aB, t);
    basePos += vec3(perp.x, 0.0, perp.y) * (devLat * DEVIATION_LATERAL_M * uFlightDeviation);
    basePos.y += devAlt * DEVIATION_ALT_M * uFlightDeviation;
  }

  vec3 p = basePos + vec3(perp.x, 0.0, perp.y) * (aSide * aSpreadHalf);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // Corridor-end fade (proposal: ~500 m at each end) so spawn/despawn never pops,
  // gated by the shared intro progress — flights wake LATE (after the city and
  // traffic are already lit), mirroring Beacons' wake gate (Beacons.tsx:52) but
  // shifted later in the sequence. Also the ONLY thing hiding an ambient plane
  // during its gap — see the t clamp above.
  vAlpha = smoothstep(0.0, aFadeFrac, t) * (1.0 - smoothstep(1.0 - aFadeFrac, 1.0, t));
  vAlpha *= smoothstep(0.55, 0.85, uIntroProgress);

  vColor = aKind < 0.5
    ? vec3(1.0, 0.1, 0.06)                                                  // beacon: red
    : aKind < 1.5
      ? mix(vec3(1.0, 0.15, 0.1), vec3(0.15, 1.0, 0.35), step(0.0, aSide))   // nav: port red / starboard green
      : vec3(1.0, 1.0, 1.0);                                                // strobe: white
  vIntensity = aIntensity;

  // Flash envelope (moved here from the fragment stage — see file header).
  float level = 1.0; // nav lights: steady, port-red / starboard-green (proposal)
  if (aKind < 0.5) {
    // Beacon: the SAME soft/wide envelope as the tower obstruction lights
    // (Beacons.tsx:46-48), but mostly dark between flashes — a rotating
    // anti-collision beacon, not a steady-burning obstruction light.
    float ph = fract(uTime / aFlashPeriod);
    float flash = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.18, 0.5, ph));
    level = mix(0.12, 1.0, flash);
  } else if (aKind > 1.5) {
    // Strobe: sharp pulse(s) — single (light GA) or double (airliner). A
    // slightly wider pulse than the original ~60 ms proposal so it catches
    // the eye a touch longer, but the peak ceiling (1.0) matches the steady
    // lights — brightness comes from aIntensity (Flights.tsx CLASS_CFG)
    // alone, not a second multiplier stacked on top (round 1 of the #67
    // visibility pass did that plus a size-pop and read too big/blown out).
    float period = aFlashPeriod;
    float phSec = fract(uTime / period) * period;
    float w = 0.08;
    float p1 = smoothstep(0.0, w * 0.5, phSec) * (1.0 - smoothstep(w, w * 1.5, phSec));
    float gap = w * 3.0;
    float p2 = step(1.5, aPulses) *
      smoothstep(gap, gap + w * 0.5, phSec) * (1.0 - smoothstep(gap + w, gap + w * 1.5, phSec));
    level = mix(0.02, 1.0, max(p1, p2));
  }
  vLevel = level;

  float d = -mv.z;
  float sizePx = aSize * uPixelRatio * (3600.0 / max(d, 1.0));
  sizePx = max(sizePx, MIN_PX * uPixelRatio); // screen-size floor — never sub-pixel, at any range
  gl_PointSize = min(sizePx, MAX_PX * uPixelRatio);
}
`;

export const flightsFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vIntensity;
varying float vLevel;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);

  float intensity = pow(core, 1.3) * vIntensity * vLevel;
  gl_FragColor = vec4(vColor * intensity, core * vAlpha * vLevel);
}
`;
