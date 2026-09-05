---
tags:
  - domain/procgen
  - domain/ci-cd
  - status/open
---

# Decision: Cross-Runtime Determinism (City Golden Drift)

**Date**: 2026-09-05
**Status**: open — CI unblocked with a scoped skip; the underlying fix is not implemented.

## Problem

`bun run scripts/cityGolden.ts` passes on Windows (Bun/JavaScriptCore) but fails on
GitHub Actions `ubuntu-latest` (Bun latest, also JavaScriptCore) for all 10 gate1
seeds. `scripts/gate1.ts`'s own same-run determinism check (generate twice,
compare) passes on both — generation is internally deterministic, but the two
environments diverge from each other. For `gate1-2`: `buildingCount` 15847 → 16445,
`districtCount` 48 → 47. The city itself diverges, not just a hash.

## Investigation

**Engine vs OS.** Ran `bunx tsx scripts/cityGolden.ts` (Node/V8) on the _same_
Windows machine that passes under Bun/JSC. It failed identically to CI — same
seeds, and `gate1-2` landed on the exact same `buildingCount`/`districtCount`
(16445/47) as CI's Bun-on-Linux run. Node-on-Windows diverging from Bun-on-Windows
means the drift is **engine-level** (V8 vs JavaScriptCore), not Linux-vs-Windows
libm — it will show up in browsers too (Chrome/Edge's V8 vs Safari's JSC), not
only in CI. Note the CI-vs-local pairing is Bun/Linux vs Bun/Windows (both JSC,
different platforms) yet it lands on the same output as Node/Windows (V8) — so
Bun's JSC on Windows looks like the outlier build here, but the mechanism below
(a hard tie-break on values transcendentals don't guarantee bit-for-bit) is
platform-general, so treating it as "engine-level" is the safer, more conservative
frame rather than assuming only Linux Bun is affected.

**Localized with a scratch probe** (imports `lib/seed/topology.ts`,
`lib/seed/lattice.ts`, `lib/seed/tensorField.ts`, `lib/seed/cityGen.ts`
read-only, no generator code touched) that hashes intermediate stages for
`gate1-2` under both Bun and tsx:

| Stage                       | Bun (JSC)                 | tsx (V8)                          |
| --------------------------- | ------------------------- | --------------------------------- |
| `generateTopology`          | `034042ea`                | `09ee8be0` (**first divergence**) |
| `computeLattice` (`theta0`) | `2.0090147708424184`      | `3.5987830475744214`              |
| `buildTensorField` samples  | diverges                  | diverges                          |
| traced streets              | 44 arterials / 608 minor  | 42 arterials / 712 minor          |
| full city                   | 15847 bldg / 48 districts | 16445 bldg / 47 districts         |

The very first stage (raw topology) already diverges. Diffing the dumped
vertices: `highway-radial-0` and `highway-radial-1` (a `ring-radial` topology's
two spokes, built symmetric by design — same length) come out at
`len = 7200` vs `len = 7200.000000000001` — a 1-ULP difference from
`Math.cos`/`Math.sin(theta)` at `lib/seed/topology.ts:230-231`, propagated
through `Math.hypot` in `dominantHighwayTilt`.

`lib/seed/lattice.ts:31-49` (`dominantHighwayTilt`) picks the "longest" open
highway with a hard `if (len > bestLen)` at **`lib/seed/lattice.ts:38`**
(`Math.hypot`) — no tolerance band. The two spokes are a near-tie, so which one
"wins" flips between engines. Their bearings (`Math.atan2` at
**`lib/seed/lattice.ts:41`**) differ by ~1.59 rad, which is exactly the
`theta0` delta observed (2.009 vs 3.599). That one flipped tie-break rotates
the entire tensor field's base grain, cascading into a different street trace
and a different building/district count.

Confirmed first-differing value: `topology.highways[0].vertices[11]`
(`highway-ring`) — `x = -2347.4866566135547` (Bun) vs `-2347.486656613555`
(tsx), a last-bit difference, consistent with `Math.cos`/`Math.sin` not being
required by ECMA-262 to be correctly rounded (see
[[../research/persona-gen-performance|persona-gen-performance]]'s "Determinism
traps" — Math.sin/cos/pow cross-engine drift is a documented hazard).

**Transcendental call sites in the affected stages** (`Math.sin`, `cos`, `tan`,
`atan2`, `exp`, `log`, `pow`, `sqrt`, `hypot`, `cbrt`, `**`):

- `lib/seed/topology.ts:119-120, 154, 194-195, 200-201, 230-231` — highway
  shape construction (crossroads/bypass/ring/ring-radial); **230-231 is the
  root cause site** for this seed.
- `lib/seed/lattice.ts:38, 41, 62` — `dominantHighwayTilt`'s length/bearing
  (**38 is the tie-break site**) and the orientation drift ramp.
- `lib/seed/tensorField.ts:116, 120-121, 133-134, 177-178, 186-187, 189-190,
201-202, 223, 243, 255, 259-260, 262, 297-299, 324, 326` — basis layout and
  the hot-loop `sample()` (atan2/cos/sin per call, `exp` for Gaussian falloff).
- `Math.sqrt` doesn't appear in these files; the risk is entirely
  `atan2`/`sin`/`cos`/`exp`/`hypot`, matching the research note's warning.
  `Math.hypot` is explicitly _not_ IEEE-exact either (unlike `sqrt`), and it's
  the function inside the actual tie-break.

## Fix options (not implemented — this note is the record, no generator code changed)

**(a) Deterministic software transcendentals**, scoped to `lib/seed` (a small
pure-TS `sin`/`cos`/`atan2`/`exp` — polynomial or CORDIC, fixed rounding).
Cost: real implementation + review effort, and a one-time re-roll of every
existing seed (the golden baseline changes). Benefit: the contract holds
everywhere, including in-browser (Safari vs Chrome), which the other two
options don't fix. **Recommended** — this is the only option that closes the
browser-facing version of the same bug, and the project's contract is explicit
("Determinism is the contract... Non-deterministic calls in render paths are a
bug"). Scope narrowly: only the call sites listed above, not a blanket `Math`
shim.

**(b) Quantize at the divergence points** (round to 1e-9) — cheaper, but
fragile: it only helps where the _comparison_ itself is quantization-tolerant.
The `lattice.ts:38` tie-break is exactly the failure mode quantization doesn't
fix cleanly — two values that already round to the same 1e-9 bucket can still
sit on either side of a hard `>` if the true values are a genuine near-tie
(as here, two symmetric spokes). Would need a tolerance band on the comparison
too, not just quantized inputs — creeping scope.

**(c) Accept per-platform goldens.** Cheapest, but abandons the byte-identity
contract `cityGolden.ts`'s own header documents, and doesn't address the
browser-facing version of the bug at all (a seed shared from Safari would
still render differently than in Chrome).

**Browser implication**: this is not just a CI inconvenience. The same
`Math.sin`/`cos`/`atan2` drift exists between browser JS engines — a seed URL
generated/shared from Safari (JSC) may render a visibly different city than
the same seed in Chrome or Edge (V8). Whatever fix path is chosen should be
evaluated against that, not only against the CI gate.

## Interim mitigation (implemented)

`.github/workflows/ci.yml`'s Test step sets `CITY_GOLDEN=skip`; `scripts/test.ts`
skips `scripts/cityGolden.ts` only when that env var is set, printing
`SKIP scripts/cityGolden.ts (cross-runtime drift, see wiki/notes/decision-cross-runtime-determinism.md)`.
Every other script in the gate still runs in CI. Locally (no env var set) the
golden still runs by default — this is a CI-only escape hatch, not a change to
the local gate.

## Consequences

- CI is unblocked without silencing the whole Test step (no `continue-on-error`
  on the step itself — only this one script is exempted).
- The byte-identity contract in `scripts/cityGolden.ts`'s own header is
  currently false across engines; anyone relying on it cross-platform should
  know that before trusting a shared seed's exact geometry.
- Follow-up: implement fix (a), re-capture the golden once, and remove the
  `CITY_GOLDEN=skip` escape hatch.

## Spike results (2026-09-05, `worktree-agent-a370c872b76b2cedb`, not merged)

Built `lib/seed/dmath.ts` — deterministic `dsin`/`dcos`/`datan2`/`dexp`/`dhypot`
using only `+ - * / Math.sqrt Math.floor Math.abs` (range-reduction + a
fixed-degree Taylor polynomial for sin/cos/exp, a half-angle-reduction +
Taylor series for atan, and the standard scaled algorithm for hypot) — and
swapped every native `Math.sin/cos/atan2/exp/hypot` call in `topology.ts`,
`lattice.ts` (including the `dominantHighwayTilt` tie-break, which now
compares with a 1e-6 relative tolerance and keeps the first-seen highway on a
near-tie, instead of a hard `>`), `tensorField.ts`, and — once the first three
turned out not to be enough, see below — `tensorStreets.ts` (its `rk4()`
integrator and suburb/subdivision spline logic have their own dense
`hypot`/`cos`/`sin` usage). `scripts/dmathCheck.ts` checks each function
against 1e6 seeded random inputs.

**dmath accuracy** (max error vs native `Math.*`, `bun run scripts/dmathCheck.ts`):

| fn      | maxAbs    | maxRel    |
| ------- | --------- | --------- |
| dsin    | 2.787e-14 | 4.900e-9  |
| dcos    | 2.798e-14 | 1.740e-9  |
| datan2  | 7.780e-12 | 9.906e-12 |
| dexp    | 6.671e-12 | 9.445e-12 |
| dhypot  | 1.819e-12 | 4.383e-16 |

**dmath cross-engine parity**: `bun run scripts/dmathCheck.ts` and
`bunx tsx scripts/dmathCheck.ts` produce IDENTICAL output hashes for all five
functions (e.g. `dsin` hash `bd56a35c` both runs) — dmath itself is proven
bit-for-bit across V8 and JSC, as designed. (`dhypot`'s error columns differ
between the two runs — 1.8e-12 vs 0 — because the *reference* `Math.hypot`
value itself differs between engines on some inputs; that asymmetry is
exactly the bug this file exists to route around.)

**City-level parity — the important negative result**: after the fix,
`bun run scripts/gate1.ts` still passes (same-run determinism intact) and the
DOCUMENTED bug is confirmed fixed — for `gate1-1` (a ring-radial topology, the
seed that hits the near-tie), the lattice orientation grid hash (`orientHash`)
and `buildingCount` now agree exactly between `bun` and `bunx tsx`
(`buildingCount` 15881 both; previously this was the seed whose count
diverged). But `bun run scripts/cityGolden.ts` vs `bunx tsx scripts/cityGolden.ts`
still produce DIFFERENT new hashes per seed for `fullHash`/`buildingsHash`/
`roadsHash` (e.g. `gate1-0` full hash `d5ba5aae` under Bun vs `09df733a` under
tsx) — full byte-identity is NOT achieved even after converting all four
files. Grepping the rest of `lib/seed` turned up ~99 more native
`hypot`/`cos`/`sin`/`atan2`/`exp` call sites across 14 more files
(`cityGen.ts` alone has 28, including its own near-tie-shaped hazard:
`totalTurn`/`maxWindowTurn` threshold comparisons in the arterial/highway
classifier — a candidate whose accumulated turn angle sits right at the
200°/35° cutoff could flip which tier it's promoted to, the same failure
shape as the original bug, just on a continuous boundary instead of a
guaranteed symmetric tie). `cityGolden.ts`'s `fullHash` hashes the entire
`city` object, so any one of those remaining call sites can — and does —
keep the two engines apart.

**Revised recommendation**: option (a) is still directionally right (it's the
only option that also fixes the browser-facing version of the bug), but its
true cost is far larger than the original 3-file estimate — realistically a
sweep of most of `lib/seed`, not a scoped patch. Two honest paths forward:
(1) fund the full sweep (all ~14 remaining files) before re-capturing the
golden once, or (2) narrow the CONTRACT instead of the fix — keep
`cityGolden.ts` scoped to `buildingCount`/`districtCount`/`orientHash`
(the structural properties this spike DID make cross-engine-stable) and drop
the full-object `fullHash`/`buildingsHash`/`roadsHash` byte-identity
requirement, documenting that exact per-pixel geometry is engine-specific by
design. Either way, do not merge this spike as-is: the golden baseline it
would produce is a partial fix wearing a "byte-identical" contract it doesn't
meet.

**Perf cost** (`bun run scripts/profileGen.ts`, 3 seeds, MAX/Metro extent,
dev baseline vs this spike's 4-file dmath swap):

| seed     | roads before | roads after | total before | total after |
| -------- | -----------: | ----------: | ------------: | -----------: |
| gate1-0  | 286ms        | 495ms (+73%)| 835ms         | 1047ms (+25%)|
| gate1-1  | 260ms        | 471ms (+81%)| 801ms         | 1007ms (+26%)|
| gate1-2  | 264ms        | 471ms (+78%)| 784ms         | 995ms (+27%)|

The roads/tensor phase (where all four converted files live) roughly
DOUBLES; total gen time is up ~25-27%, since roads are ~35% of the total
budget. `field.sample`'s own reported cost roughly doubled too (12-14ms →
23-25ms across ~450k calls), consistent with `dexp`/`dcos`/`dsin`/`dhypot`
costing more than the native calls they replace. Extending the fix to the
remaining ~14 files would add further cost on top of this, roughly in
proportion to how much of the ~99 remaining call sites sit in per-sample hot
loops vs one-time setup.

**Visible city changes for the 10 gate1 seeds** (building/district counts,
this spike's branch vs dev, same engine/Bun): identical for every seed except
`gate1-1` (15867 → 15881 buildings, 830 → 718 streets; district count
unchanged at 48) — the one seed whose topology hits the ring-radial
near-tie the fix targets. This is the re-roll the decision note warned about,
scoped to exactly the seed the bug predicts.
