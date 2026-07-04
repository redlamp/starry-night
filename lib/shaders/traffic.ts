// Car head/tail-light points. Position is computed entirely on the GPU from the
// shared clock — each car slides along its baked segment via fract(uTime·speed +
// phase) — so there is zero per-frame CPU and the motion is deterministic for a
// seed. Rendered additively as soft round glows; fog off so they stay crisp.
//
// #57: aWinStart/aWinEnd/aRoadEnd generalise a single instance's segment into a
// WINDOW within a shared cycle (lib/seed/traffic.ts journeys). Highway/arterial
// instances carry aWinStart=0, aWinEnd=1, aRoadEnd=1 — the window math below
// then reduces exactly to the original single-segment fract() loop (localT ==
// t, inWindow always true, fade widths == the original 0.06/0.08 constants).

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
uniform float uLodEnabled;    // distance LOD (#52)
uniform float uLodNear;
uniform float uLodFar;
uniform float uLodCull;
uniform float uLodSizeFloor;
uniform float uLodBrightFloor;
uniform float uOrthoT;          // 0 = perspective, 1 = orthographic (projection blend)
uniform float uOrthoSizeScale;  // ortho zoom ratio (refOrthoSize / orthoSize)

attribute vec3 aA;     // travel-start (lane-offset world point)
attribute vec3 aB;     // travel-end
attribute float aPhase;
attribute float aSpeed; // cycle-fractions per second (whole journey, or a legacy segment)
attribute vec3 aColor;  // headlight colour (bulb-pool pick)
attribute vec3 aTail;   // taillight colour
attribute float aHead;  // 1 = flows headlight-first (top-down ribbon fallback)
attribute float aReveal; // per-car intro reveal time 0..1 (density ramp)
attribute float aSize;
attribute float aWinStart; // #57: this instance's visible window, as a fraction of the shared cycle
attribute float aWinEnd;
attribute float aRoadEnd;  // #57: traverse-only fraction of the cycle (1 = legacy, no respawn gap)

varying vec3 vColor;
varying float vAlpha;
varying float vEmit;
varying float vLodBright;

void main() {
  // u sweeps the WHOLE shared cycle (one journey, or one legacy segment);
  // localT is this instance's own progress across just its window, so its
  // position freezes at its window's start/end point outside that window
  // (harmless — inWin gates it invisible then).
  float u = fract(uTime * aSpeed + aPhase);
  float span = max(1e-5, aWinEnd - aWinStart);
  float localT = clamp((u - aWinStart) / span, 0.0, 1.0);
  float inWin = step(aWinStart, u) * step(u, aWinEnd);

  vec3 p = mix(aA, aB, localT);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Fade in/out at the JOURNEY's start/end (not at every macro-segment join —
  // only the first/last window in a journey ever nears u=0 / u=aRoadEnd), so
  // a multi-segment journey hands off segment-to-segment at full brightness.
  // Legacy instances (aRoadEnd=1) reduce this to the original 0.06/0.08-wide
  // fade at the single segment's own start/end.
  float fadeInW = 0.06 * aRoadEnd;
  float fadeOutW = 0.08 * aRoadEnd;
  vAlpha = inWin * smoothstep(0.0, fadeInW, u) * (1.0 - smoothstep(aRoadEnd - fadeOutW, aRoadEnd, u));

  // Intro density ramp, sharing the streetlights' progress (#45 follow-up):
  // each car has its own reveal time = a center-out radial term plus a random
  // per-car jitter, so the roads fill from sparse to the full default rate over
  // the intro rather than every car fading in together.
  vec2 dc = p.xz - uIntroCenter.xz;
  float rr = clamp(length(dc) / max(1.0, uIntroMaxRadius), 0.0, 1.0);
  float thr = rr * 0.3 + aReveal * 0.6;
  vAlpha *= smoothstep(thr, thr + 0.06, uIntro);

  // Camera-relative head/tail (#45): white headlights face the viewer, red tails
  // drive away. Decision is purely HORIZONTAL — the camera's orbit bearing (azim)
  // vs the car heading — so it's independent of camera elevation; tilting down no
  // longer shifts the colour. normalize(uViewDir.xz) drops the cos(elev) term,
  // leaving the azimuth bearing. A car crossing at ~90° sits mid-blend with a
  // soft easing band (the smoothstep edges = the wiggle room near broadside).
  vec2 camDir = uViewDir.xz;
  float cl = length(camDir);
  camDir = cl > 1e-3 ? camDir / cl : vec2(0.0, 1.0); // exact top-down: stable fallback bearing
  vec2 hd = normalize((aB - aA).xz);
  float facing = -dot(hd, camDir);              // >0 = moving toward the camera
  float headness = smoothstep(-0.2, 0.2, facing); // ±~11.5° wiggle around broadside

  vColor = mix(aTail, aColor, headness);
  vEmit = mix(uTailIntensity, uHeadIntensity, headness);

  // Distance LOD (#52): attenuate by CAMERA distance in world space (matches the
  // streetlights), so far cars shrink + dim and cars past uLodCull are dropped —
  // the additive-overdraw cut that keeps framerate as the city scales to Metro.
  vec3 worldPos = (modelMatrix * vec4(p, 1.0)).xyz;
  float camDist = distance(worldPos, cameraPosition);
  float lodT = uLodEnabled > 0.5 ? smoothstep(uLodNear, uLodFar, camDist) : 0.0;
  // Cull only on the perspective side — in ortho the camera is parked far, so the
  // camera-distance test would wrongly drop cars regardless of the ortho zoom.
  float keep = (uLodEnabled > 0.5 && camDist > uLodCull && uOrthoT < 0.5) ? 0.0 : 1.0;

  // Size + brightness drivers, blended persp ↔ ortho by uOrthoT:
  //  - perspective: camera-distance LOD (near full, far shrinks/dims to the floor) —
  //    a real depth cue.
  //  - ortho: no perspective depth, and the parked-far camera makes camDist useless.
  //    Drive size by the ortho zoom ratio so lights stay full at the default frame
  //    and scale WITH the city as orthoSize shrinks (zoom in); brightness stays full.
  float perspSize = mix(1.0, uLodSizeFloor, lodT);
  float sizeFactor = mix(perspSize, uOrthoSizeScale, uOrthoT);
  vLodBright = mix(mix(1.0, uLodBrightFloor, lodT), 1.0, uOrthoT);

  gl_PointSize = keep * clamp(aSize * uPixelRatio * uSizeScale * sizeFactor, 1.0, 16.0);
}
`;

export const trafficFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vEmit;
varying float vLodBright;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  float glow = smoothstep(1.0, 0.0, r2); // soft round falloff
  // Hot core + glow, pushed above 1.0 so ACES gives it a little bloomy HDR pop.
  // Headlights emit brighter than tails (vEmit baked per car in the vertex stage).
  // vLodBright dims distant cars (#52).
  gl_FragColor = vec4(vColor * vEmit * (0.35 + 0.65 * glow) * vLodBright, vAlpha * glow * vLodBright);
}
`;
