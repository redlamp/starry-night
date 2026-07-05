---
tags: [plan, overnight, issues]
---

# Overnight agent results — 2026-07-05

Planning / assessment agents run overnight (user request) for issues **#89, #86,
#56, #70, #67**. For morning review. Outward actions (merges to main/deploy,
tags, issue closes) are **held for the user's go** after their live test.

> Process finding (from the #67 agent, applies to everything): all recent work
> — flights follow-ups, camera #83/#84, building #87 / inspect / focus / pin —
> is stacked on **`feat/scene-polish` only**; `dev` (`5d9045a`) and `fable`
> (`9805d0d`) are behind and nothing is pushed. The morning wrap-up needs a
> merge plan (feat/scene-polish → fable → dev), ideally grouping flights vs.
> camera vs. building commits.

---

## #67 — Planes flying by — ASSESS → recommend **CLOSE** (after the merge)

All in-scope acceptance criteria are shipped once the thread's own scope cuts
are tracked (helicopters → #89; arrivals + landing-lights → v2/unscheduled):

- **Shipped**: seeded departure + 2-4 fly-by corridors (`lib/seed/flights.ts:195,247-290`);
  red beacon + port-red/starboard-green nav (now view-directional, elevation-
  independent, `lib/shaders/flights.ts:186-201`) + white strobes (double airliner
  / single light-GA); shader-clocked, gate1-clean; real speeds/altitudes; two
  fixed-wing classes; debug spawn pool + gap/deviation sliders + live B/S count.
- **Deferred (v2, in-thread)**: arrivals + altitude-gated landing lights,
  ortho/map size blend, on-map airport/ground pads.
- **Split**: helicopters → #89 (design-complete).

**Open before close:**
1. Merge gap (above) — the 4 flights-only commits `55a0efa` / `fe13cd1` /
   `f892d4b` / `c36f19b` are only on `feat/scene-polish`, not `dev`/`fable`.
2. **Nav-light sidedness at range** (the flagged one): port/starboard sit ~20 m
   (airliner) / ~7 m (light-GA) apart — under the 4px point-size floor
   (`lib/shaders/flights.ts:92-93`) past ~8-10 km, so red/green stop resolving.
   Minor; a fast-follow ticket, not a #67 blocker.

**Recommendation:** merge the flights commits to `fable`→`dev`, then close #67
with a summary comment (draft saved in the agent transcript). Remaining items
are tracked in-thread; helicopters continue at #89.

---

## #89 — Helicopters as an air-transit class — PLAN

**Approach:** a **new file trio** (`lib/seed/helicopters.ts`,
`lib/shaders/helicopters.ts`, `components/scene/Helicopters.tsx`), NOT a third
`FlightClass` — helicopters are a distinct motion model (multi-leg
point-to-point + hover holds), and the precedent is Traffic/Beacons/Flights each
being their own additive Points draw. Reuses Traffic's "journey window"
technique (`traffic.ts:50-69`) for the legs + Flights' light grammar.

- **Data:** a seeded waypoint pool — rooftop helipads (`height >= 45`, exclude
  industrial/oldtown, tallest-per-450m-cell dedupe, same shape as
  `generateAviationBeacons` `cityGen.ts:1558-1580`) + 2 distant off-map pads.
  Each of 1-3 helicopters samples a 2-4-stop **closed loop** of alternating
  **transit / hover legs**, each a time-windowed GPU vertex group.
- **Key gotcha:** a hover leg has `aA==aB`, so heading can't be
  `normalize(aB-aA)` (NaN) — precompute `aDir` as a CPU attribute (carried
  forward from the preceding transit leg).
- **"Redder/slower" signature:** invert the beacon-vs-strobe dominance (beacon
  brighter + slower than the strobe, single centred strobe not a wingtip pair) —
  reads redder without changing any hue.
- **Header count:** change `setFlightsAirborne` to a **Partial merge** so Flights
  and Helicopters each own their key (Flights currently hardcodes `heli:0` and
  would stomp it). Add `helicopters.enabled` + `heliSpawn` + a Spawn Helicopter
  button and an enable switch in `FlightsGroup`.
- **Determinism/arch:** clean (own rng chain `::helicopters`, reads generateCity
  non-mutating, no InstancedMesh, gate1 unaffected).

**Honest risk flagged:** lights-only means "landed on a roof" and "hovering" look
identical, AND rooftop hovers sit close to camera (tens-200m) unlike the 5-12km
fixed-wing corridors — so "just a light cluster" may not read as well here.
Eyeball before committing; a silhouette/rotor may be needed. **Open qs:** gate
numbers, lights-only vs silhouette, enable toggle (own switch recommended), heli
count, and a fresh `feature/*` off `dev`. Full plan in the agent transcript.

## #86 — Ground-floor storefronts — PLAN → recommend **Option A** (shader-only)

**Recommendation:** build it as a **pure rendering feature** in
`cityInstanced.ts` — a shader/uniform floor-0 override, exactly like the curtain
walls — **not** a gen-time `Building.height`/`floors` change (Option B). Zero new
`Building` fields, zero new vertex attributes (format is at the 16-slot cap),
zero rng risk, zero regen cost, gate1 untouched. This **deviates from the
issue's "Gen input" framing → needs your sign-off** (Open Q).

- **Eligibility gate:** archetype (exclude warehouse + spire), district
  (**downtown only** — the shader only sees the 4-value lighting class, so
  "commercial/mixed-use" folds into residential; downtown-only is a known v1
  gap), size (≥4 floors, via existing `vGrid.y`), and a share roll (a new
  *varying* hashed from `aBuildingHash` in the **vertex** shader — no new
  attribute, no fragment-hash dithering bug).
- **Taller floor 0:** a piecewise UV remap, written as an explicit `if/else` so
  it's **byte-identical for every ineligible building**. Storefront override =
  wide panes + bright display-space colour (`kelvinToColor`, no SRGB
  conversion) + always-on duty cycle. Found a **required guard**: the
  fractional-band segment cut would otherwise re-zero the storefront row.
- **Far-field limitation:** the band lives only in the near-field path (the
  hybrid far-field wash reads atlas bytes, which Option A never writes) — v1
  accepts this (storefronts are a street-level embellishment).
- **Files:** `cityInstanced.ts` + `InstancedCity.tsx` (uniforms/sync) +
  `sceneDefaults`/`sceneMigration` + `WindowsPanel` (2 sliders) + a **required
  parity edit** to window-lab's `CurrentShaderRack.tsx` (same shader).
- **Verify:** typecheck/lint/gate1 (zero diffs) + a CDP close-up. **Open qs:**
  Option A vs B (sign-off), downtown-only-vs-mixed-use, colour slider,
  always-on. Full plan in the agent transcript.

## #56 — Camera + look follow the crop — PLAN

**Means:** camera resting poses should derive from the **displayed radius**
(`citySize` tier × `cityShapeScale` crop) instead of fixed constants. Today
every camera default is `constant × CITY_SCALE` (frozen at the old single-size
era), so a Truck Stop and a Metropolis boot to the *same* distance.

**Key finding — three independent "default camera" mechanisms, not one:**
1. `DEFAULT_INTENT` (the snv2 mount hero shot, `sceneDefaults.ts:52-58`) — the
   pose users actually first see; NOT named in the issue.
2. `DEFAULT_ORBIT.radius` / `DEFAULT_ORTHO_SIZE` / `DEFAULT_PERSP_RADIUS` (Map
   model + the cameraView tweens) — the literal issue scope.
3. `TopDownModel.fitOrthoSize` (live top-down; the old `cameraView.topDownFraming`
   is dead in the live path). Plus `PlanView` 2D minimap.

**Approach:** a pure `displayedRadius(shape, scale, half)` helper +
`cropFollowScale() = displayedRadius / REFERENCE_HALF_EXTENT`, **multiplied at
each consumption site** (NOT baked into the `DEFAULT_*` constants — that breaks
Settings Reset/Revert; "persistence landmine"). At current defaults it's exactly
`1.0`, so byte-identical until a tier/crop actually changes (good regression
posture).

**Critical policy:** crop-follow must be **framing-time only** (mount / Reset /
Home / top-down entry), never a live/reactive binding — because
`AdaptiveQuality.stepCrop()` steps `cityShapeScale` for perf, so a live binding
would dolly the resting camera on a frame-rate hiccup (same lesson as #70 and
#84's `restPerspK` freeze). Composes cleanly with #83/#84.

**Risks:** don't functionize `DEFAULT_*` (reset machinery); scale relative to
`CITY_CENTER` not origin; scale **horizontal only** — never Y/elevation (#47
vertical-invariance); the hero shot is a hand-authored design object → needs a
live look, not a blind ship. Phase 1 = the named scope + modern equivalents;
Phase 2 = 6 more model reset sites (Drift/Turntable/Fly/GoogleEarth/DreiMap/
DreiCamera), mechanically trivial once the helper exists.

**Also flagged:** #83/#84 shipped as commit messages only — no `decision-*.md`
note. Worth writing one. Full plan in the agent transcript.

## #70 — Crop as a tile operation (parked) — PLAN → recommend **Option 3** (staged, gated)

**Asks:** crop without rebuilding meshes (today `cityShapeScale` is a mesh-memo
dep in `InstancedCity`, so every crop notch regenerates window textures + atlas
+ all 7 archetype meshes); newly-revealed tiles "materialise dark" and wake by
light, center-out. A 3-stage draft already exists (unposted) at
`samples/issue-clearout-2026-07-04/comments/70.md` (line refs drifted since 07-03).

**Key finding — the owner's concern, sharpened:** `cityShapeScale` has a SECOND,
automatic writer besides the crop slider — `AdaptiveQuality.stepCrop()` nudges it
on every fps decline/incline (default-off now, but #85 will enable it to test).
A naive "wake on newly-included range" trigger would fire the wake light-show on
every frame-rate recovery step — literally "relighting culled tiles for perf
reasons," the artifact the owner feared. (Plain frustum re-entry is already safe
via a durable per-instance `wakeAt` in the stable SRC array.)

**Bonus live bug found:** a crop notch TODAY replays the FULL intro cascade for
the whole city (`useGeneratedCity` keys on scale → `ready` false→true →
`IntroTicker` replays). Stage 1 fixes this regardless of wake-by-light.

**Recommendation — Option 3:** (1) Stage 1 = crop as a no-rebuild tile/prefix
slice-copy (same path as frustum re-entry) — strictly a bug fix, unblocks #56,
low risk; (2) Stage 2 wake-by-light with the wake trigger **gated to the user
crop action only** (never AdaptiveQuality/boot-fit) — resolves the concern by
construction; (3) Stage 3 center-out ordering after a visual pass. Do it
before/with #85. Option 4 (split `cityShapeScale` into user-crop vs perf-radius,
~10 consumers) is the principled longer-horizon answer.

**Crux questions:** Option 3 gate vs Option 4 split? Per-building
radius-prefix-within-tile granularity OK (it's finer than "tile-level" reads)?
Circle-shape-only acceptable (square never crops)? Use a fresh `feature/*` off
`dev` (not `feat/scene-polish`). Full proposal in the agent transcript.
