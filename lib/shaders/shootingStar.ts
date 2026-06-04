// Shooting star (#26 slice 2) — homage to the original module's rare streaks
// (≤ every ~25s, ~1s, tapering tail). One streak at a time, rendered as a
// short trail of point sprites whose positions are computed ENTIRELY in the
// vertex shader from (uTime, uSeed): each ~22s bucket rolls a hash — most
// buckets fire, some stay quiet — and picks a start point high on the dome, a
// travel direction, and a length. Deterministic per seed; no per-frame CPU.

export const shootingStarVertexShader = /* glsl */ `
  attribute float aTrail; // 0 = head … 1 = tail end

  uniform float uTime;
  uniform float uSeed;
  uniform float uRadius;
  uniform float uPixelRatio;

  varying float vFade;

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  void main() {
    const float PERIOD = 22.0;   // bucket length (s)
    const float DURATION = 1.1;  // streak lifetime (s)
    float bucket = floor(uTime / PERIOD);
    float age = fract(uTime / PERIOD) * PERIOD / DURATION; // 0..1 while alive

    float h1 = hash11(bucket * 17.13 + uSeed);
    float h2 = hash11(bucket * 31.7 + uSeed * 1.7);
    float h3 = hash11(bucket * 47.9 + uSeed * 2.3);
    float h4 = hash11(bucket * 71.3 + uSeed * 3.1);

    // ~55% of buckets fire → a streak every ~40s on average.
    float active = step(0.45, h1) * step(age, 1.0);

    // Path on the dome: start high (alt 35°–70°), travel down-sky.
    float az0 = h2 * 6.2831853;
    float alt0 = radians(35.0 + h3 * 35.0);
    float travel = radians(14.0 + h4 * 10.0); // arc length of the streak path
    float azDrift = (h3 - 0.5) * 1.6;         // sideways slew

    // This sprite's position: head leads at the current age, trail points lag.
    float lag = aTrail * 0.22; // trail spread along the path (fraction of life)
    float t = clamp(age - lag, 0.0, 1.0);
    float alt = alt0 - travel * t;
    float az = az0 + azDrift * travel * t;

    vec3 pos = uRadius * vec3(cos(alt) * cos(az), sin(alt), cos(alt) * sin(az));
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    // Head bright, tail tapering; whole streak eases in fast / out slow.
    float life = sin(min(age, 1.0) * 3.14159265);
    vFade = active * life * (1.0 - aTrail) * (1.0 - aTrail);

    float d = -mv.z;
    gl_PointSize = (3.5 - 2.4 * aTrail) * uPixelRatio * (300.0 / max(d, 1.0)) * active;
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
    // Cool white-blue, HDR headroom — reads icy against the warm city.
    gl_FragColor = vec4(vec3(1.15, 1.25, 1.45) * alpha, alpha);
  }
`;
