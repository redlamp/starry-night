// Helicopter lights (#89) — third air-transit class. Reuses Flights' light-
// role grammar wholesale (lib/shaders/flights.ts: vColor/vAlpha/vIntensity/
// vLevel varyings, the MIN_PX/MAX_PX screen-size floor, hash11, the additive
// discard-circle fragment shader) but the POSITION math is Traffic's
// journey-window technique (lib/shaders/traffic.ts: raw/u/localT/inWin over
// aWinStart/aWinEnd) rather than Flights' single-segment transit+gap cycle —
// a helicopter's closed loop has no idle/dark gap, so every leg's window
// tiles the shared 0..1 cycle back to back (lib/seed/helicopters.ts).
//
// Attributes are PACKED into vectors (aWin/aClock/aRole/aLight below), unlike
// Flights' one-float-per-attribute layout: this shader hit a real "too many
// attributes" WebGLProgram compile failure at 14 separate attributes (Flights
// itself sits at 13 + the implicit `position` ShaderMaterial always adds, so
// it was already close to whatever this GPU/driver's MAX_VERTEX_ATTRIBS is).
// Packing floats that travel together into vec2/vec3/vec4 attributes costs
// nothing (a vec4 attribute occupies exactly ONE attribute slot, same as a
// float) and drops this shader to 7 custom attributes + position = 8, safely
// under Flights' proven-working 14.
//
// Heading comes from a PRECOMPUTED aDir attribute, never normalize(aB-aA):
// a hover leg has aA==aB, which would divide-by-zero into NaN. aDir is baked
// per leg on the CPU (carried forward from the preceding transit leg for any
// hover that follows it) and just read here.
//
// aRole.w (oneShot) mirrors Flights' debug-spawn convention: 0 = ambient,
// loops forever (fract); 1 = a Debug-panel spawn, sweeps the loop exactly
// ONCE (clamp) then parks. Parking relies on an EXCLUSIVE upper-bound window
// test (inWin uses 1.0-step(winEnd,u), not step(u,winEnd)): a parked instance
// sits at u==1.0 exactly, which must read as outside every leg's window —
// including the final leg, whose winEnd is itself pinned to 1.0 — so the
// whole helicopter stays fully invisible pre-spawn (Flights achieves the same
// end via a corridor-fade that closes to zero at its clamped t==1; a closed
// loop has no such fade, so the window test itself has to be exclusive).
//
// "Redder/slower" signature (design brief): the beacon/strobe dominance
// inverts vs. Flights — beacon brighter + slower, a single centred strobe
// dimmer + faster — so helicopters read as a distinct light pattern without
// changing any hue. hash11 offsets each helicopter's flash phase (keyed off
// its own clock phase) so multiple helicopters don't blink in lockstep.

export const helicoptersVertexShader = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uIntroProgress;

attribute vec3 aA;
attribute vec3 aB;
attribute vec3 aDir;   // precomputed unit heading (x, 0, z) — never normalize(aB-aA)
attribute vec2 aWin;   // x = this leg's winStart, y = winEnd — fractions of the FULL closed-loop cycle
attribute vec2 aClock; // x = shared per-helicopter phase 0..1, y = shared per-helicopter cycle length (seconds)
attribute vec4 aRole;  // x = side (-1/0/+1), y = kind (0 beacon/1 nav/2 strobe), z = nav spreadHalf, w = oneShot
attribute vec3 aLight; // x = intensity, y = flash period (seconds), z = point size

varying vec3 vColor;
varying float vAlpha;
varying float vIntensity;
varying float vLevel;

// Screen-space (CSS-pixel) floor/ceiling on point size (Flights' spotting
// fix) — multiplied by uPixelRatio at use. Doubles as the close-hover cap:
// rooftop hovers sit tens-200 m from camera (vs. Flights' 5-12 km corridors),
// so without MAX_PX a near hover would balloon into a blob.
const float MIN_PX = 4.0;
const float MAX_PX = 10.0;

// Cheap 1D hash (same family as lib/shaders/window.ts / flights.ts hash11).
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  float side = aRole.x;
  float kind = aRole.y;
  float spreadHalf = aRole.z;
  float oneShot = aRole.w;
  float phase = aClock.x;
  float cycleSec = aClock.y;
  float winStart = aWin.x;
  float winEnd = aWin.y;

  vec2 dir = aDir.xz;
  vec2 perp = vec2(-dir.y, dir.x); // horizontal perpendicular to the current leg's heading

  // Traffic's journey-window technique (lib/shaders/traffic.ts): u sweeps the
  // WHOLE closed loop, localT is this leg's own progress across just its
  // window (frozen at the window's start/end outside it — harmless, inWin
  // gates it invisible then). Ambient loops wrap (fract); a debug spawn
  // clamps instead so it sweeps the loop exactly once, then parks.
  float raw = uTime / cycleSec + phase;
  float u = oneShot > 0.5 ? clamp(raw, 0.0, 1.0) : fract(raw);
  float span = max(1e-5, winEnd - winStart);
  float localT = clamp((u - winStart) / span, 0.0, 1.0);
  // Exclusive upper bound (see file header) — a parked one-shot sits at
  // u==1.0, which must fall OUTSIDE every leg's window, including the final
  // one (winEnd itself pinned to 1.0).
  float inWin = step(winStart, u) * (1.0 - step(winEnd, u));

  vec3 basePos = mix(aA, aB, localT);
  vec3 p = basePos + vec3(perp.x, 0.0, perp.y) * (side * spreadHalf);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // Helicopters wake latest of the three transit layers (after the city,
  // traffic, and fixed-wing flights are already lit).
  vAlpha = inWin * smoothstep(0.6, 0.9, uIntroProgress);

  vColor = kind < 0.5
    ? vec3(1.0, 0.1, 0.06)                                                // beacon: red
    : kind < 1.5
      ? mix(vec3(1.0, 0.15, 0.1), vec3(0.15, 1.0, 0.35), step(0.0, side))  // nav: port red / starboard green
      : vec3(1.0, 1.0, 1.0);                                              // strobe: white
  vIntensity = aLight.x;
  float flashPeriod = aLight.y;

  // Flash envelope — same shapes as Flights (lib/shaders/flights.ts), plus a
  // per-helicopter hash11 phase offset (keyed off the shared clock phase) so
  // beacons/strobes across a handful of concurrent helicopters don't pulse in
  // lockstep.
  float level = 1.0;
  if (kind < 0.5) {
    // Beacon: soft/wide flash, mostly dark between — the dominant light here
    // (brighter + SLOWER than the strobe — inverted vs. Flights' CLASS_CFG).
    float offset = hash11(phase * 71.0 + 11.0);
    float ph = fract(uTime / flashPeriod + offset);
    float flash = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.18, 0.5, ph));
    level = mix(0.12, 1.0, flash);
  } else if (kind < 1.5) {
    // Nav lights: red port / green starboard, view-directional like Flights'
    // (bright on the camera's own side, dims — not off — on the far side) so
    // the dominant colour reads which side of the helicopter you're seeing.
    vec2 toCam = cameraPosition.xz - basePos.xz;
    float cl = length(toCam);
    vec2 toCamDir = cl > 1e-3 ? toCam / cl : vec2(0.0);
    float facing = dot(toCamDir, perp) * side;
    level = mix(0.15, 1.0, smoothstep(-0.4, 0.4, facing));
  } else {
    // Strobe: ONE centred flash (side 0 — no wingtip pair), single pulse,
    // subordinate to the beacon (dimmer + FASTER — inverted vs. Flights).
    float offset = hash11(phase * 71.0 + 53.0);
    float phSec = fract(uTime / flashPeriod + offset) * flashPeriod;
    float w = 0.08;
    float pulse = smoothstep(0.0, w * 0.5, phSec) * (1.0 - smoothstep(w, w * 1.5, phSec));
    level = mix(0.02, 1.0, pulse);
  }
  vLevel = level;

  float d = -mv.z;
  float sizePx = aLight.z * uPixelRatio * (3600.0 / max(d, 1.0));
  sizePx = max(sizePx, MIN_PX * uPixelRatio); // screen-size floor — never sub-pixel, at any range
  gl_PointSize = min(sizePx, MAX_PX * uPixelRatio);
}
`;

export const helicoptersFragmentShader = /* glsl */ `
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
