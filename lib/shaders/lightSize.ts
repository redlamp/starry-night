// Shared on-screen sizing for every point-light sprite family — cars, streetlights,
// flights, helicopters, beacons (issue #99). Before this, five shaders each rolled their
// own gl_PointSize with hand-tuned magic numerators (3600, 180, none) and only Traffic
// knew about the faked-ortho projection; apparent sizes were near-constant with camera
// distance (see wiki/notes/light-sprite-sizing-survey.md and
// wiki/research/light-size-vs-distance.md).
//
// The trick (research doc, "derive from the projection itself"): a world-space diameter D
// at clip position C covers  D * P[1][1] * viewH / (2 * C.w)  device pixels — exact under
// ANY projection matrix, so it is right in perspective, in faked ortho (ProjectionBlender
// overwrites projectionMatrix per frame), and at every point of the morph. No
// persp/ortho branching, no view-z ambiguity.
//
// Drop-off shape (Settings → Lights): a bright point's visible glow shrinks SLOWER than
// geometry (fixed-angle eye/camera PSF — Spencer et al. 1995, Jensen et al. 2001). The
// response is a user-tunable CSS-style cubic bezier mapping normalized geometric size to
// displayed size, CPU-sampled into a 16-entry lookup (LIGHT_CURVE_SAMPLES). Floors stay
// per-family — the lesson from the old streetlight collapse (raw 1/d with no floor
// vanishes at city range). Brightness may optionally FOLLOW the same curve
// (uBrightFollow) so far lights dim as they shrink instead of popping at the floor.
//
// Rendering-only camera-state math — outside the determinism contract.

export const LIGHT_CURVE_SAMPLES = 16;

export const lightSizeChunk = /* glsl */ `
uniform float uViewH;                 // drawing-buffer height in DEVICE pixels
uniform float uGlowScale;             // global multiplier on every glow diameter
uniform float uSizeMinScale;          // multiplier on the per-family pixel floors
uniform float uSizeMaxScale;          // multiplier on the per-family pixel ceilings
uniform float uBrightFollow;          // 0..1 — brightness follows the size drop-off
uniform float uSizeCurve[16];         // sampled drop-off curve (normalized size response)

// Brightness factor produced by the last lightSizePx call: mix(1, curveY, uBrightFollow).
// Multiply it into the family's brightness varying after sizing.
float lightSizeBright;

// On-screen diameter (device px) of worldDiameter (m) at this vertex's clip position.
// minPx/maxPx are DEVICE pixels (multiply logical px by uPixelRatio at the call site).
float lightSizePx(float worldDiameter, vec4 clipPos, float minPx, float maxPx) {
  float px = worldDiameter * uGlowScale * projectionMatrix[1][1] * uViewH
    / (2.0 * max(clipPos.w, 1e-4));
  float ceilPx = maxPx * uSizeMaxScale;
  // Normalized geometric size through the user drop-off curve (vertex shader, so the
  // variable uniform-array index is fine under GLSL ES 1).
  float x = clamp(px / max(ceilPx, 1.0), 0.0, 1.0);
  float f = x * 15.0;
  float fi = min(floor(f), 14.0);
  float y = mix(uSizeCurve[int(fi)], uSizeCurve[int(fi) + 1], f - fi);
  lightSizeBright = mix(1.0, y, uBrightFollow);
  return clamp(ceilPx * y, minPx * uSizeMinScale, ceilPx);
}
`;

// One shared uniform OBJECT set (the sharedTime pattern): every light material spreads
// these same instances, and ProjectionBlender writes them once per frame for all.
export const sharedLightSize = {
  uViewH: { value: 1000 },
  uGlowScale: { value: 1 },
  uSizeMinScale: { value: 1 },
  uSizeMaxScale: { value: 1 },
  uBrightFollow: { value: 0 },
  uSizeCurve: { value: new Float32Array(LIGHT_CURVE_SAMPLES) },
};

// Spread into a material's uniforms so every family shares the single live set.
export function lightSizeUniforms() {
  return {
    uViewH: sharedLightSize.uViewH,
    uGlowScale: sharedLightSize.uGlowScale,
    uSizeMinScale: sharedLightSize.uSizeMinScale,
    uSizeMaxScale: sharedLightSize.uSizeMaxScale,
    uBrightFollow: sharedLightSize.uBrightFollow,
    uSizeCurve: sharedLightSize.uSizeCurve,
  };
}

// CSS-style cubic bezier (0,0) → (x1,y1) → (x2,y2) → (1,1), evaluated as y(x) by
// bisection on the monotonic-in-t x polynomial (same approach as CSS easing), sampled
// into `out`. Called on curve changes only (ProjectionBlender caches the signature).
export function sampleLightCurve(
  out: Float32Array,
  [x1, y1, x2, y2]: [number, number, number, number],
): void {
  const bez = (t: number, a: number, b: number) => {
    const mt = 1 - t;
    return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t;
  };
  for (let i = 0; i < out.length; i++) {
    const x = i / (out.length - 1);
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (bez(mid, x1, x2) < x) lo = mid;
      else hi = mid;
    }
    out[i] = Math.min(1, Math.max(0, bez((lo + hi) / 2, y1, y2)));
  }
}

// Seed the lookup with the default curve so the first frames (before ProjectionBlender's
// first write) already render with the shipped drop-off.
sampleLightCurve(sharedLightSize.uSizeCurve.value, [0.35, 0.42, 0.75, 0.82]);
