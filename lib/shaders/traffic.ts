// Car head/tail-light points. Position is computed entirely on the GPU from the
// shared clock — each car slides along its baked segment via fract(uTime·speed +
// phase) — so there is zero per-frame CPU and the motion is deterministic for a
// seed. Rendered additively as soft round glows; fog off so they stay crisp.

export const trafficVertexShader = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform vec3 uViewDir;        // camera forward (world), updated per frame
uniform float uHeadIntensity;
uniform float uTailIntensity;
uniform float uIntro;         // streetlight intro progress 0..1 (shared driver)
uniform vec3 uIntroCenter;    // city centre, for the center-out wake
uniform float uIntroMaxRadius;

attribute vec3 aA;     // travel-start (lane-offset world point)
attribute vec3 aB;     // travel-end
attribute float aPhase;
attribute float aSpeed; // segment-fractions per second
attribute vec3 aColor;  // headlight colour (bulb-pool pick)
attribute vec3 aTail;   // taillight colour
attribute float aHead;  // 1 = flows headlight-first (top-down ribbon fallback)
attribute float aSize;

varying vec3 vColor;
varying float vAlpha;
varying float vEmit;

void main() {
  float t = fract(uTime * aSpeed + aPhase);
  vec3 p = mix(aA, aB, t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Fade in/out at the segment ends so the loop wrap doesn't pop.
  vAlpha = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.92, 1.0, t));

  // Center-out intro wake, sharing the streetlights' progress + spread so the
  // traffic eases in on the same timeline (#45 follow-up). Cars near the city
  // centre light up first.
  vec2 dc = p.xz - uIntroCenter.xz;
  float rr = clamp(length(dc) / max(1.0, uIntroMaxRadius), 0.0, 1.0);
  float thr = rr * 0.7;
  vAlpha *= smoothstep(thr, thr + 0.08, uIntro);

  // Camera-relative head/tail (#45): a car driving toward the camera shows white
  // headlights, one driving away shows red tails. heading = travel direction.
  vec3 hd = normalize(aB - aA);
  float facing = -dot(hd, uViewDir);            // >0 = moving toward the camera
  float camHead = smoothstep(-0.15, 0.15, facing);
  // Straight-down (orthographic top-down) the dot degenerates to ~0 for every
  // car. Blend toward the baked flow direction near vertical so divided roads
  // keep clean paired white/red ribbons from above instead of muddy amber.
  float vert = clamp(abs(uViewDir.y), 0.0, 1.0);
  float headness = mix(camHead, aHead, vert * vert);

  vColor = mix(aTail, aColor, headness);
  vEmit = mix(uTailIntensity, uHeadIntensity, headness);

  // Fixed apparent size (correct under the default orthographic projection;
  // points stay legible dots in perspective too). uSizeScale tunes globally.
  gl_PointSize = clamp(aSize * uPixelRatio * uSizeScale, 1.0, 16.0);
}
`;

export const trafficFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vEmit;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  float glow = smoothstep(1.0, 0.0, r2); // soft round falloff
  // Hot core + glow, pushed above 1.0 so ACES gives it a little bloomy HDR pop.
  // Headlights emit brighter than tails (vEmit baked per car in the vertex stage).
  gl_FragColor = vec4(vColor * vEmit * (0.35 + 0.65 * glow), vAlpha * glow);
}
`;
