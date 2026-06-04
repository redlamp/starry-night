// Shooting star (#26 slice 2) — homage to the original module's rare streaks
// (~1s, tapering tail). One streak at a time, rendered as a short trail of
// point sprites animated ENTIRELY in the vertex shader from uTime. Scheduling
// lives CPU-side (ShootingStars): each fired streak rolls the next gap
// uniformly in [min, max] off a seeded rng chain, then pushes the streak's
// start time (uFireTime) + index (uFireSeed) here. Path geometry hashes off
// (uFireSeed, uSeed) — deterministic per masterSeed.

export const shootingStarVertexShader = /* glsl */ `
  attribute float aTrail; // 0 = head, 1 = tail end

  uniform float uTime;
  uniform float uSeed;
  uniform float uRadius;
  uniform float uPixelRatio;
  uniform float uFireTime; // start time (s, uTime clock) of the current streak
  uniform float uFireSeed; // streak index - hash key for this streak's geometry
  uniform float uEnabled;  // 0 = off
  uniform float uBaseSize; // head sprite size (px at d=1) - tied to the stars' size factor
  uniform float uCamAz;   // camera view azimuth (rad), sampled at each fire
  uniform float uAzHalf;  // half-width (rad) of the spawn wedge inside the frame

  varying float vFade;

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  void main() {
    float duration = 1.1; // streak lifetime (s)

    float h2 = hash11(uFireSeed * 31.7 + uSeed * 1.7);
    float h3 = hash11(uFireSeed * 47.9 + uSeed * 2.3);
    float h4 = hash11(uFireSeed * 71.3 + uSeed * 3.1);

    // Alive only inside [uFireTime, uFireTime + duration] - the CPU scheduler
    // moves uFireTime forward when the next rolled gap elapses.
    // ("active" is a GLSL reserved word - hence "firing".)
    float age = (uTime - uFireTime) / duration; // 0..1 while alive
    float firing = uEnabled * step(0.0, age) * step(age, 1.0);

    // Path geometry: the star camera sits at the dome centre copying only the
    // main camera's ORIENTATION, and the orbit camera pitches DOWN at the city
    // - so the sky band actually in frame is near-horizontal rays (alt ~0-15
    // deg). Meteors fly there: a low start, a mostly-LATERAL slide with a
    // gentle downward slope, like a streak skimming over the skyline.
    // Spawn inside the camera's horizontal wedge (uCamAz +- uAzHalf) so every
    // fired streak is actually on screen - a full-dome azimuth roll wasted
    // ~3/4 of them off-frame. The wedge is sampled at bucket start, so the
    // streak stays world-fixed for its life instead of dragging with orbit.
    float az0 = uCamAz + (h2 * 2.0 - 1.0) * uAzHalf;
    float alt0 = (4.0 + h3 * 12.0) * 0.01745329;  // deg -> rad, low band
    float travel = (16.0 + h4 * 12.0) * 0.01745329; // path arc length
    float azSign = step(0.5, h3) * 2.0 - 1.0;       // left or right
    float lag = aTrail * 0.22; // trail spread along the path (fraction of life)
    float t = clamp(age - lag, 0.0, 1.0);
    float alt = alt0 - travel * 0.35 * t;           // shallow descent
    float az = az0 + azSign * travel * t;           // dominant lateral motion

    vec3 pos = uRadius * vec3(cos(alt) * cos(az), sin(alt), cos(alt) * sin(az));
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    // Head bright, tail tapering; whole streak eases in fast / out slow.
    float life = sin(min(age, 1.0) * 3.14159265);
    vFade = firing * life * (1.0 - aTrail) * (1.0 - aTrail);

    // Same distance attenuation as the star field - without the star-factor
    // scale a streak at the sky-dome distance lands sub-pixel and vanishes.
    float d = -mv.z;
    gl_PointSize = uBaseSize * (1.0 - 0.65 * aTrail) * uPixelRatio * (300.0 / max(d, 1.0)) * firing;
  }
`;

export const shootingStarFragmentShader = /* glsl */ `
  precision mediump float;

  varying float vFade;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float r = length(uv);
    if (r > 0.5) discard;
    float alpha = smoothstep(0.5, 0.1, r) * vFade;
    if (alpha <= 0.002) discard;
    // Cool white-blue, HDR headroom - reads icy against the warm city.
    gl_FragColor = vec4(vec3(1.15, 1.25, 1.45) * alpha, alpha);
  }
`;
