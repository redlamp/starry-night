---
tags:
  - domain/stack
  - status/adopted
---

# Decision: Shader Varying Precision Rules (2026-07-03)

**Context.** The #82 endgame ([[window-lod-moire-diagnosis]] round 5) traced a
"major dithering" report to a mechanism none of the sampling-theory rounds
covered: rasterizers reconstruct varyings — even ones that are constant across
the primitive — via perspective-corrected plane-equation evaluation, which
carries a few ulps of **per-pixel wobble**. Harmless (~2e-4 at magnitude 1e3)
until it meets non-linear consumers:

- `hash11()` amplifies input error ~×480 → per-building "constants" (window
  size rolls) become per-pixel noise;
- binary thresholds (duty-cycle on/off) turn any residual noise into
  full-contrast flips on knife-edge cells;
- `mod(int, varying)` flips between 0 and divisor−1 when the index lands on an
  exact multiple — opposite ends of an atlas row, per pixel.

Severity grows with view distance + narrow FOV, so it hid at the poses we
tuned at and erupted at telephoto ones.

**Options considered.**

1. `flat` interpolation qualifiers — the textbook fix, but GLSL ES 1.00 (our
   target) has none; migrating the city shader to GLSL3 is a large, risky
   diff for the same result.
2. Quantise `aBuildingHash` at the source to integers — kills the noise but
   re-rolls every building once and risks seed collisions (fp32 `fract`
   degrades above ~1e4, so the bucket count is capped).
3. **Hash in the vertex stage; snap integers fragment-side** (chosen).

**Chosen rules** (all in `cityInstanced`, apply to future shader work):

1. **Per-instance derived constants are computed in the VERTEX shader** from
   the raw attribute (exact, no interpolation) and passed as small [0,1)-scale
   varyings consumed linearly. Same formulas, same inputs → zero visual
   re-roll, and JS-parity mirrors (`bakeCommon.rollFractions`) stay valid.
   Bonus: ~2M/frame fragment hash evals became ~150k vertex ones.
2. **Anything feeding a binary threshold must be EXACT**: quantise to an
   integer lattice vertex-side (`floor(hash·4096)`), snap fragment-side
   (`floor(v + 0.5)`).
3. **Integer-valued varyings (`vFaceId`, `vGrid`, mode flags) snap before any
   discontinuous consumption** — `mod`, `ceil`, `floor`-of-products,
   equality-ish thresholds. Plain comparisons with ≥ 0.5 margin are fine.
4. **Verification is quantitative**: 3×3-median deviant count + parity tally,
   plus stripe probes (`fract(signal · k)`) to bisect which signal in the
   chain is noisy. Speckle metrics cannot adjudicate sharpness-vs-noise —
   supersampled-reference MSE can ([[window-lod-moire-diagnosis]] round 4).

**Why it matters.** Determinism is the project contract; this class of bug is
determinism's GPU-side sibling — the same seed rendering differently per
pixel. The rules make the fragment shader's per-building inputs bit-stable by
construction instead of by luck of the pose.

Cross-project version: `~/.claude/memory/tools/glsl-hash-of-interpolated-varyings.md`.
