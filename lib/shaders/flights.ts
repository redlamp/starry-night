// Ambient plane lights (#67 v1). Position slides A->B entirely on the GPU —
// fract(uTime*aSpeed+aPhase), the same clocking as Traffic (lib/shaders/traffic.ts:41)
// — so there is zero per-frame CPU and motion is deterministic for a seed.
// Five points per plane share one baked segment (aA/aB/aPhase/aSpeed) and pick
// their light role from aKind/aSide, the ShootingStars aTrail trick
// (lib/shaders/shootingStar.ts:10-11) applied to a discrete role selector
// instead of a continuous trail position:
//   aKind 0 = beacon (centre), 1 = nav (port/starboard), 2 = strobe (port/starboard)
//   aSide  -1 = port, 0 = centre, +1 = starboard
// Wingtip/nav/strobe offsets are built from the segment's own heading in the
// vertex shader, so the ~35 m (airliner) / ~11 m (light GA) light spread reads
// as separate port/starboard points rather than one blob.

export const flightsVertexShader = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uFadeFrac;     // corridor-end fade width, as a fraction of segment length
uniform float uIntroProgress; // shared window-intro progress (Beacons pattern)

attribute vec3 aA;
attribute vec3 aB;
attribute float aPhase;
attribute float aSpeed;      // segment-fractions per second
attribute float aSide;       // -1 port, 0 centre, +1 starboard
attribute float aKind;       // 0 beacon, 1 nav, 2 strobe
attribute float aSpreadHalf; // half wingspan (m)
attribute float aIntensity;
attribute float aFlashPeriod;
attribute float aPulses;     // 0 steady, 1 single-flash, 2 double-flash
attribute float aSize;

varying vec3 vColor;
varying float vAlpha;
varying float vIntensity;
varying float vFlashPeriod;
varying float vPulses;
varying float vKind;

void main() {
  float t = fract(uTime * aSpeed + aPhase);
  vec3 seg = aB - aA;
  vec2 dir = normalize(seg.xz);
  vec2 perp = vec2(-dir.y, dir.x); // horizontal perpendicular to the flight path
  vec3 p = mix(aA, aB, t) + vec3(perp.x, 0.0, perp.y) * (aSide * aSpreadHalf);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // Corridor-end fade (proposal: ~500 m at each end) so spawn/despawn never pops,
  // gated by the shared intro progress — flights wake LATE (after the city and
  // traffic are already lit), mirroring Beacons' wake gate (Beacons.tsx:52) but
  // shifted later in the sequence.
  vAlpha = smoothstep(0.0, uFadeFrac, t) * (1.0 - smoothstep(1.0 - uFadeFrac, 1.0, t));
  vAlpha *= smoothstep(0.55, 0.85, uIntroProgress);

  vColor = aKind < 0.5
    ? vec3(1.0, 0.1, 0.06)                                                  // beacon: red
    : aKind < 1.5
      ? mix(vec3(1.0, 0.15, 0.1), vec3(0.15, 1.0, 0.35), step(0.0, aSide))   // nav: port red / starboard green
      : vec3(1.0, 1.0, 1.0);                                                // strobe: white
  vIntensity = aIntensity;
  vFlashPeriod = aFlashPeriod;
  vPulses = aPulses;
  vKind = aKind;

  float d = -mv.z;
  gl_PointSize = clamp(aSize * uPixelRatio * (3600.0 / max(d, 1.0)), 1.5, 10.0);
}
`;

export const flightsFragmentShader = /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
varying float vIntensity;
varying float vFlashPeriod;
varying float vPulses;
varying float vKind;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);

  float level = 1.0; // nav lights: steady, port-red / starboard-green (proposal)
  if (vKind < 0.5) {
    // Beacon: the SAME soft/wide envelope as the tower obstruction lights
    // (Beacons.tsx:46-48), but mostly dark between flashes — a rotating
    // anti-collision beacon, not a steady-burning obstruction light.
    float ph = fract(uTime / vFlashPeriod);
    float flash = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.18, 0.5, ph));
    level = mix(0.12, 1.0, flash);
  } else if (vKind > 1.5) {
    // Strobe: sharp ~60 ms pulse(s) — single (light GA) or double (airliner).
    float period = vFlashPeriod;
    float phSec = fract(uTime / period) * period;
    float w = 0.06;
    float p1 = smoothstep(0.0, w * 0.5, phSec) * (1.0 - smoothstep(w, w * 1.5, phSec));
    float gap = w * 3.0;
    float p2 = step(1.5, vPulses) *
      smoothstep(gap, gap + w * 0.5, phSec) * (1.0 - smoothstep(gap + w, gap + w * 1.5, phSec));
    level = mix(0.02, 1.0, max(p1, p2));
  }

  float intensity = pow(core, 1.3) * vIntensity * level;
  gl_FragColor = vec4(vColor * intensity, core * vAlpha * level);
}
`;
