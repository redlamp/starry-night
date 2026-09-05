// Deterministic, cross-engine-identical replacements for the transcendental
// Math.* functions used by the city generator (sin/cos/atan2/exp/hypot).
//
// Why this exists: ECMA-262 does not require Math.sin/cos/atan2/exp/hypot to
// be correctly rounded, so V8 (Node/Chrome) and JavaScriptCore (Bun/Safari)
// can differ by 1 ULP on the same input. Everywhere else in lib/seed that
// difference washes out, but a couple of call sites feed a hard tie-break
// (see lattice.ts's dominantHighwayTilt) where a 1-ULP wobble flips which
// branch wins and cascades into a visibly different city. See
// wiki/notes/decision-cross-runtime-determinism.md for the full writeup.
//
// Every function here is built ONLY from + - * / Math.sqrt Math.floor
// Math.abs and comparisons — operations ECMA-262 requires to be exact
// (or, for sqrt, correctly rounded per IEEE-754, which every engine
// implements identically). No FMA is used (JS has none). That makes the
// bit pattern of every output identical across engines by construction;
// the polynomial degrees below were picked for a few-ULP match against the
// native Math.* functions, not for bit-identical agreement with them — see
// scripts/dmathCheck.ts for the measured error bounds.
//
// dlog/dpow are not implemented: no lib/seed call site needs them (grepped
// during the spike — only sin/cos/atan2/exp/hypot are used in the affected
// files).

// Spec-literal constants (ECMA-262 pins Math.PI/Math.LN2/Math.LOG2E to exact
// decimal values, so any conformant engine parses these numeric literals to
// the identical bit pattern — this is not a "transcendental call", just a
// fixed double, same as writing 3.14 would be).
const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586; // 2 * PI, exact (doubling never rounds)
const HALF_PI = 1.5707963267948966; // PI / 2, exact (halving never rounds)
const LN2 = 0.6931471805599453;
const INV_LN2 = 1.4426950408889634; // 1 / LN2, precomputed to avoid a division per dexp call

// --- sin/cos --------------------------------------------------------------

// Reduce x to y in [-PI/4, PI/4] plus a quadrant 0..3, so sin/cos only ever
// need to approximate a small argument (fast-converging polynomial, below).
// Single-term Cody-Waite reduction (no hi/lo split): every call site in
// lib/seed keeps |x| well under ~15 (see the topology/tensorField angle
// derivations), so the reduction multiplier k stays tiny (|k| <= ~3) and the
// rounding error this skips (a hi/lo split would remove) stays under 1e-15 —
// negligible next to the polynomial's own error budget below.
function reduceQuadrant(x: number): { y: number; q: number } {
  const k = Math.floor(x / TWO_PI + 0.5);
  const r = x - k * TWO_PI; // r in ~[-PI, PI]
  const q = Math.floor(r / HALF_PI + 0.5); // nearest quadrant, |q| <= 2
  const y = r - q * HALF_PI; // y in [-PI/4, PI/4]
  const qq = ((q % 4) + 4) % 4;
  return { y, q: qq };
}

// Taylor series to the y^13 term (7 nonzero terms). Max truncation error over
// |y| <= PI/4 is ~1e-11 — see scripts/dmathCheck.ts for the measured bound.
function sinPoly(y: number): number {
  const y2 = y * y;
  return (
    y *
    (1 +
      y2 *
        (-1 / 6 +
          y2 *
            (1 / 120 +
              y2 * (-1 / 5040 + y2 * (1 / 362880 + y2 * (-1 / 39916800 + y2 * (1 / 6227020800)))))))
  );
}

// Taylor series to the y^14 term (8 nonzero terms, same error budget as sinPoly.
function cosPoly(y: number): number {
  const y2 = y * y;
  return (
    1 +
    y2 *
      (-1 / 2 +
        y2 *
          (1 / 24 +
            y2 *
              (-1 / 720 +
                y2 *
                  (1 / 40320 +
                    y2 * (-1 / 3628800 + y2 * (1 / 479001600 + y2 * (-1 / 87178291200)))))))
  );
}

export function dsin(x: number): number {
  const { y, q } = reduceQuadrant(x);
  const s = sinPoly(y);
  const c = cosPoly(y);
  switch (q) {
    case 0:
      return s;
    case 1:
      return c;
    case 2:
      return -s;
    default:
      return -c; // q === 3
  }
}

export function dcos(x: number): number {
  const { y, q } = reduceQuadrant(x);
  const s = sinPoly(y);
  const c = cosPoly(y);
  switch (q) {
    case 0:
      return c;
    case 1:
      return -s;
    case 2:
      return -c;
    default:
      return s; // q === 3
  }
}

// --- atan2 ------------------------------------------------------------

// atan(t) for t in [0, 1], via the half-angle identity
// atan(t) = 2*atan(t / (1 + sqrt(1 + t^2))) applied twice (brings the
// argument under ~0.2), then a Taylor series that converges fast at that
// size. Uses only + - * / and Math.sqrt.
function atanCore(t: number): number {
  const t1 = t / (1 + Math.sqrt(1 + t * t));
  const t2 = t1 / (1 + Math.sqrt(1 + t1 * t1));
  const u = t2 * t2;
  const poly =
    t2 *
    (1 + u * (-1 / 3 + u * (1 / 5 + u * (-1 / 7 + u * (1 / 9 + u * (-1 / 11 + u * (1 / 13)))))));
  return 4 * poly;
}

function atanFull(t: number): number {
  const neg = t < 0;
  const at = neg ? -t : t;
  const r = at <= 1 ? atanCore(at) : HALF_PI - atanCore(1 / at);
  return neg ? -r : r;
}

export function datan2(z: number, x: number): number {
  if (x > 0) return atanFull(z / x);
  if (x < 0) {
    const base = atanFull(z / x);
    return z >= 0 ? base + PI : base - PI;
  }
  // x === 0
  if (z > 0) return HALF_PI;
  if (z < 0) return -HALF_PI;
  return 0; // atan2(0, 0) — undefined by convention, matches Math.atan2(0, 0)
}

// --- exp ----------------------------------------------------------------

// 2^k for a small integer k (|k| bounded by dexp's range-reduction, below),
// via exponentiation by squaring — O(log k) multiplies instead of O(k),
// which matters here since dexp sits in tensorField's ~450k-call hot loop.
function pow2i(k: number): number {
  let n = k < 0 ? -k : k;
  let base = 2;
  let result = 1;
  while (n > 0) {
    if (n % 2 === 1) result *= base;
    base *= base;
    n = Math.floor(n / 2);
  }
  return k < 0 ? 1 / result : result;
}

// Every lib/seed call site only ever passes x <= 0 (Gaussian falloff
// weights). x <= -37 is clamped to 0 — real Math.exp(-37) ~= 8.5e-17, already
// far below any weight that could move a sum, so the clamp costs nothing
// visible while keeping the reduction's |k| small (cheap pow2i).
export function dexp(x: number): number {
  if (x <= -37) return 0;
  if (x === 0) return 1;
  const k = Math.floor(x * INV_LN2 + 0.5);
  const r = x - k * LN2; // |r| <= LN2 / 2
  const p =
    1 +
    r *
      (1 +
        r *
          (1 / 2 +
            r *
              (1 / 6 +
                r *
                  (1 / 24 +
                    r *
                      (1 / 120 + r * (1 / 720 + r * (1 / 5040 + r * (1 / 40320 + r / 362880))))))));
  return p * pow2i(k);
}

// --- hypot ----------------------------------------------------------------

// Scaled to avoid overflow/underflow on the larger factor, matching the
// standard hypot algorithm. Only + - * / Math.sqrt Math.abs.
export function dhypot(a: number, b: number): number {
  const aa = Math.abs(a);
  const bb = Math.abs(b);
  if (aa === 0 && bb === 0) return 0;
  const m = aa > bb ? aa : bb;
  const n = aa > bb ? bb : aa;
  const r = n / m;
  return m * Math.sqrt(1 + r * r);
}
