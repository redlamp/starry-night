# Starry Night (working title)

A modernized homage to the Berkeley Systems After Dark "Starry Night" screensaver, rebuilt with 3D web technology, procedural generation, and a deeper sense of place.

---

## Status

This is the v1 spec, written May 2026. v1 shipped. The living record of what was actually
built - architecture decisions, superseded approaches, and current system state - is in
`wiki/notes/fable-codebase-survey-2026-07-02.md` and the `wiki/notes/decision-*.md` notes
linked throughout this document.

| Milestone           | Status                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------- |
| M1: The still frame | Shipped and exceeded - slow orbit motion was added on top of the still-frame foundation |
| M2: Window dynamics | Infrastructure ready (shader flicker, data textures); not yet fully user-facing         |
| M3: Distant orbit   | Shipped - pluggable camera-model registry with 7 models, drone-style default            |
| M4: Seed sharing    | Shipped - URL seed parameter, SeedControls UI with shadcn/ui                            |

---

## 1. Overview and Goals

A web-based ambient cityscape that evokes the original Starry Night screensaver while introducing depth, atmosphere, and a sense of inhabited place. The city sits beneath a star-filled sky, lit from within by warm residential and cool commercial windows, with a slow distant orbit that rewards long looks rather than demanding attention.

**Primary goals**

- Recreate the emotional register of the original: small city, vast sky, quiet wonder
- Add modern depth through 3D geometry, socioeconomic lighting logic, and procedural variety
- Build a deterministic, seed-based foundation that supports future features without rework
- Ship a v1 that already feels right as a still image, before any motion or interaction is added

**Success criteria for v1**

The still frame (no orbit, no animation) should already feel like the project. If the static composition does not carry the mood, no amount of motion will save it.

---

## 2. Non-Goals

Explicit exclusions for v1 to keep scope honest:

- No interactivity (hover, click, resident details)
- No day/night cycle
- No atmospheric effects (haze, distance fog)
- No street-level or in-city camera positions
- No mobile support
- No persistence layer (Supabase deferred)
- No commitment to a single visual style; samples first, decision later
- No vignette system or curated camera moments
- No character models or visible figures

---

## 3. Design Direction

### Emotional register

The city as a place where people live, not a spectacle. Closer to Stalenhag and Hopper than Blade Runner. Lived-in, slightly melancholy, contemplative. Something you would leave running on a second monitor.

### Visual references

- **Streets of Rage (Sega Genesis, 1991) — primary direct anchor for v1.** Tile-able skyline backdrop. Three-layer depth (foreground silhouette / mid teal-glowing towers / distant back row), deep navy sky (not pure black), warm yellow/amber windows, streetlights and road dashes at base. See `wiki/research/streets-of-rage-intro.md` and `wiki/notes/decision-streets-of-rage-direction.md`.
- **PS2-era low poly**: Shadow of the Colossus, ICO, Silent Hill 2, Jet Set Radio. Polygon limits as aesthetic choice, not technical constraint
- **Ghost in the Shell (1995)**: establishing montages, aspect-to-aspect sequencing per Scott McCloud's "Understanding Comics," world beyond the story
- **Edward Hopper and Simon Stalenhag**: flat planes of color, hard light boundaries, "Nighthawks" lighting psychology (most windows dark, a few warm pockets where life is happening), implied human presence, atmosphere as storytelling
- **Berkeley Systems After Dark "Starry Night" (original Macintosh screensaver)**: the source. Small city silhouette, vast sky, twinkling stars, occasional shooting star. The proportion of city to sky is the proportion we want to honor

### Visual principles

- Two halves doing different work: the city dense and warm below, the sky vast and cold above
- Human presence implied through artifact (lit windows, the occasional flicker) rather than depicted
- Stars are the anchor and the namesake; they must dominate the upper frame
- Low poly is a feature, not a compromise
- v1 starts zoomed out; everything reads as silhouette and light at orbit distance

### Lighting logic

Socioeconomic layers, each with its own character:

- **Residential warmth**: yellows, oranges, occasional blue TV flicker
- **Office cool**: fluorescent white-blue, mostly dark after hours with a few cleaners or workaholics
- **Street network** (backlog): amber and red flowing lines, sodium vs LED as district markers
- **Civic signal** (backlog): traffic lights, crosswalk signals
- **Commercial shout** (backlog): billboards, oversized emissive signage
- **Ambient sky**: stars, moon, possibly a slow aircraft blinker

### Window state model

- **Classic mode**: windows that are on stay on, with occasional flicker (faithful to the original)
- **Modern mode** (future): windows respond to a simulated night, residents go to bed, offices power down on different curves

### City generation grammar

_Superseded: see `wiki/notes/decision-tensor-field-roads.md` (tensor-field streamlines replaced the grid/streets-first approach) and `wiki/notes/decision-additive-growth-citygen.md` (generate-at-max-extent + crop replaced fixed building count and extent; metro-scale ~1,500 buildings per seed)._

The city is generated **streets-first**: highway and arterial network is laid down before buildings exist; the network's geometric closure defines where districts can form; buildings emerge inside lots bounded by streets — never overlapping, always respecting per-zone setbacks and per-district height caps.

The acceptance criterion is that **different seeds produce categorically different cities**, not variations of one template. A viewer doing a slow orbit can read a city's identity at a glance: its network topology, where its centres of gravity lie, what its dominant heights look like.

**Plausibility lives at the grammar level** — real urban-planning topologies (Crossroads / Bypass / Ring / Ring + radial), real zoning categories (Residential / Commercial / Industrial / Mixed-use), real silhouette templates (Tabletop / Wedding cake / Twin-peak / Landmark). Street-level details (sidewalks, awnings, ground-floor commerce, fenestration) are deliberately out of scope until a closer-camera milestone is scheduled.

Determinism is preserved end-to-end: every choice (topology, district placement, character, silhouette, zone, block, lot, building) derives from sub-seeds of the master seed. _Districts_ and _Roads_ debug panels expose generator state in a verifiable way.

Full grammar: `wiki/notes/decision-streets-first-city-generation.md`. Glossary: `CONTEXT.md`.

---

## 4. Technical Stack

- **Framework**: Next.js (App Router)
- **Runtime**: Bun (fallback to pnpm if Next.js + R3F + Bun friction appears)
- **Styling**: Tailwind CSS, shadcn/ui (deferred install — first UI lands at M4)
- **3D**: Three.js, React Three Fiber, drei
- **Animation**: R3F `useFrame` + drei tweening for v1. GSAP reserved for later motion-graphics work (vignettes, curated camera moments) if needed.
- **State**: Zustand (runtime-only state — see §5 _Runtime vs derived state_)
- **RNG**: seedrandom (deterministic procedural generation)
- **Linting**: ESLint + Prettier baseline
- **Hosting**: Vercel
- **Persistence (deferred)**: Supabase

### 4.1 Performance budget

- **Target**: 60fps fullbleed on mid-spec laptop (2020-baseline integrated GPU survivable; discrete GPU smooth)
- **Headroom**: dev machine is RTX 3080 Ti at 5120×1440 — quality tiers let high-end render denser cities without forcing mid-spec into stutter
- **Draw-call ceiling**: <50 total for full scene (city + sky + moon)
- **Building strategy**: `InstancedMesh` per archetype (5-10 archetypes), per-instance attributes for height / window-seed / district
- **Window strategy**: shader-painted on building faces, not geometry — one fragment shader reads per-window state from a small data texture, draws hundreds of windows per face at zero extra draw-call cost
- **Quality tiers** (low / med / high / ultra): scale building count, window density, star count, DPR cap, post-fx. Initially toggled via `?quality=` URL param; settings UI later.

### 4.2 Color pipeline

- `outputColorSpace = SRGBColorSpace` (three.js default, matches monitor)
- `toneMapping = ACESFilmicToneMapping` so emissive values >1.0 bloom naturally without clipping
- Window/star emissive intensity exceeds 1.0 for HDR-feel glow under ACES
- Source colors stay sRGB (hex codes work directly); data textures stay linear

---

## 5. Core Systems

### Seed architecture

One master seed derives sub-seeds for each subsystem. This lets layout stay constant while lighting or residents are reshuffled, and lets shareable URLs encode an exact city state.

```ts
type CitySeed = {
  master: string;
  layout: number; // derived
  lighting: number; // derived
  residents: number; // derived, unused in v1
};
```

Sub-seeds are derived deterministically from the master so the same string always produces the same city.

### Scene graph

```
Scene
├── Sky
│   ├── Stars (single Points cloud, custom twinkle shader)
│   └── Moon
├── City
│   └── BuildingInstances[archetype]  (InstancedMesh per archetype)
│       └── per-instance attrs: height, window-seed, district
│       └── window grid + emissive painted by fragment shader
│           reading from per-instance data texture
└── Camera (aspect-bucket framing, static in v1)
```

Windows are _not_ React components or geometry. Each building face's fragment shader computes window grid from UVs and samples per-window state (lit / unlit / flicker phase) from a small data texture. One quad face renders hundreds of windows at zero extra draw-call cost.

### Rendering strategy

- One `InstancedMesh` per building archetype (5-10 archetypes for v1)
- Per-instance attributes pass height-scale, window-seed offset, district type into vertex shader
- Fragment shader on building faces draws window grid + emissive states from data texture
- Stars: single `Points` cloud with custom shader for size attenuation + twinkle
- Moon: single mesh, possibly with custom shader for soft edge
- Total draw calls for full scene: <50

### Runtime vs derived state

Two kinds of state exist in this project, and they live in different places:

| Kind                  | Examples                                                                                    | Where it lives                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Derived from seed** | Building positions, archetype assignment, which windows start lit, per-window flicker phase | Computed when seed changes, held in refs / memos / instanced buffer attributes. **Not** in Zustand. |
| **Runtime / UI**      | Current seed string, lighting mode, quality tier, paused flag, settings-panel open?         | Zustand.                                                                                            |

Rule of thumb: if the same seed always produces the same value, it's derived — recompute it, do not store it. Storing derived state wastes memory and tempts mutation that breaks the determinism guarantee.

For v1, Zustand will hold roughly: `{ masterSeed, lightingMode, qualityTier, paused }`. Everything about buildings and windows is derived.

### Deterministic flicker

A core promise of seed-based generation: share the URL, your friend sees the same city. That promise has to cover motion too.

- Naive flicker (`Math.random()` each frame) breaks the promise — two viewers see different windows blinking.
- Deterministic flicker: each window has a seeded flicker profile (`phase`, `period`, `intensity`) baked from the lighting sub-seed. Visible brightness is then a pure function of `(windowSeed, timeElapsed)`.

Implementation: a fragment shader uniform `uTime` (seconds since page load) combined with the per-window seed produces brightness via `mix(low, high, noise(seed + uTime * frequency))`. Same inputs, same output, every frame, every viewer. Per-session phase offset on page load is fine — pattern parity matters, frame-by-frame parity across sessions does not.

### Aspect-bucket camera

_Superseded in part: see `wiki/notes/decision-camera-model-registry.md`. The aspect-bucket framing logic still holds, but the camera is now a pluggable registry of 7 named models (Drift, Turntable, Map, Top-down, Fly, Drei-MapControls, Drei-CameraControls) with a drone-style ambient default ("Drift"), not a simple orbit._

Canvas is fullbleed and resizable; the viewer can be ultrawide, square, or portrait. Camera framing snaps to one of three aspect buckets (landscape / square / portrait), each with its own framing variant:

- **Landscape**: original Starry Night proportions, wide skyline, vast sky above
- **Square**: tighter skyline crop, sky still dominates upper half
- **Portrait**: vertical-emphasis sky, narrower city band at bottom — prep work for future mobile support

### File structure (proposed)

```
/app
  /page.tsx              # Scene mount, seed from URL hash
  /layout.tsx
/components
  /scene
    Scene.tsx            # Canvas + camera rig + aspect-bucket switch
    AspectCamera.tsx     # Landscape / square / portrait framing
    City.tsx             # Building field — InstancedMesh per archetype
    BuildingArchetypes/  # Geometry + shader per archetype
    Sky.tsx              # Stars (Points + shader), moon
  /ui
    SeedControls.tsx     # Display, copy, regenerate (M4)
    ModeToggle.tsx       # Classic vs modern lighting (post-v1)
/lib
  /seed
    rng.ts               # Master seed, sub-seed derivation
    cityGen.ts           # Building layout from seed
    lightingGen.ts       # Window state + flicker profile data textures
  /state
    sceneStore.ts        # Zustand: { masterSeed, lightingMode, qualityTier, paused }
  /shaders
    window.frag          # Window-grid fragment shader
    star.vert / .frag    # Star twinkle
/scripts
  capture.ts             # Headless screenshot — see §6 still-frame review
/samples                 # Curated seed PNGs (gitignored or LFS, TBD)
/types
```

---

## 6. v1 Scope

### Milestone 1: The still frame

A static composition with:

- Black sky (review: see §8 sky color)
- Stars (procedural, seeded; start ~2000 points, tune later)
- Moon
- Seeded skyline of low-poly building silhouettes (instanced)
- Windows lit per the lighting sub-seed (warm residential, cool office, mostly dark) — rendered via fragment shader on building faces
- No camera movement, no flicker, no interaction

If this still image feels right, the project is on track. If not, iterate here before adding anything else.

#### Still-frame review process

- A `bun run capture` script loads `/?seed=X&capture=1` in a headless browser, screenshots the canvas, writes PNG to `/samples/`
- Loop the script over a list of seeds → folder of candidates
- Review by eye; promote favourites into a curated `samples/curated/` list committed to the repo
- Same script doubles as a regression-snapshot tool once a baseline is locked in

### Milestone 2: Window dynamics

- Classic flicker behavior on a subset of lit windows
- Window states managed in Zustand, deterministic per seed but with subtle animated variance

### Milestone 3: Distant orbit

- Slow orbit around the city using `useFrame` (or drei camera helpers)
- Camera path tuned for ambient viewing, no jarring transitions
- GSAP only if motion-graphics complexity warrants it later (vignettes, curated moments)

### Milestone 4: Seed sharing

- URL hash (`/#seed=...`) encodes the master seed — hash avoids server-render bounce
- shadcn/ui lands here for `SeedControls`: display, copy, regenerate
- Quality tier surfaced as URL param (`?quality=high`) initially; settings panel later

### First three GitHub issues

1. Scaffold Next.js + Bun + R3F, render one placeholder building under a starry sky
2. Implement master seed and deterministic city layout
3. Window component with lighting modes driven by the lighting sub-seed

---

## 7. Backlog

Captured for future iterations, with reasoning:

- **Visual style commitment**: defer until v1 still frame is reviewed in multiple sample styles
- **Distance fog**: nice depth cue, not essential for v1, easy to add later
- **Atmospheric haze**: low haze band beneath clear star layer; deferred as a separate decision from fog
- **Day/night cycle**: very slow dusk-to-dawn with lighting socioeconomics shifting through the night
- **Modern lighting mode**: residents going to bed, offices powering down on different curves
- **Street and traffic lighting**: headlights and taillights on splines, sodium vs LED streetlights as district markers
- **Traffic lights**: tiny rhythm at intersections
- **Billboards and commercial signage**: animated emissive surfaces in commercial districts
- **Aircraft blinker**: slow point of light crossing the sky
- **Vignette system**: curated camera moments inspired by Ghost in the Shell establishing shots and Scott McCloud's aspect-to-aspect sequencing — GSAP becomes a candidate here if `useFrame` + drei don't carry the motion-graphics weight
- **In-city camera positions**: street-level views, rooftop angles
- **Hover-for-resident**: procedural residents tied to specific windows, deterministic per seed
- **Supabase integration**: enters when residents need persistence or when seed sharing needs a backend
- **Mobile support**: requires LOD work, building count budget, shader simplification

---

## 8. Open Questions

_Some starting values below have since been resolved. See `wiki/notes/fable-codebase-survey-2026-07-02.md` for current numbers. Notable: building count is metro-scale (~1,500 per seed) per `wiki/notes/decision-additive-growth-citygen.md`; sky color resolved to deep navy; visual style committed to Streets of Rage direction per `wiki/notes/decision-streets-of-rage-direction.md`._

Practical starting values picked for v1; bigger decisions deferred until the still-frame review surfaces direction.

- Visual style commitment: deferred — decide after still-frame review of sampled seeds
- Building count budget: start 200-400 instanced, raise per quality tier — measure at M1
- Star count: start ~2000 points (single `Points` cloud), tune after still review
- Moon treatment: simple disc with soft-edge shader, defer detail
- Sky color: pure black for v1 baseline; deep-navy / gradient explored after still review
- Window grid: shader-procedural, parametrised per archetype (column count, row count, gap ratios)
- Building variety: 5-10 archetypes for v1; procedural variation via per-instance height + window-seed within each

## 9. Agents and tooling

This project will lean on Claude Code subagents and tools when they help. Starting modestly — solo greenfield work has limited surface area for agents — but baking in patterns now.

**Available now**

- `cavecrew-investigator` — locate symbols / files / call sites once codebase is non-trivial
- `cavecrew-builder` — surgical 1-2 file edits
- `cavecrew-reviewer` — diff / file review
- `Plan` — multi-step implementation plans for non-trivial milestones
- `Explore` — open-ended codebase searches

**Likely useful at M2+**

- Parallel agents for content scaling: one per building archetype, one per shader variant
- Snapshot diff agent: given two PNGs from `/samples/`, describe perceptual difference — useful for regressions and style A/B
- Vercel Agent for automated PR review on preview deploys
- `Plan` agent to break M2-M4 into ticket-sized chunks once M1 lands

**Not yet useful**

- Full multi-agent fan-out — project too small until codebase has multiple independent surfaces

## 10. Documentation conventions

This PRD lives in `docs/` (formal artefact). Project state, decisions, daily logs, and half-formed thoughts live in `wiki/` per the conventions in `wiki/CLAUDE.md`. Significant decisions reached during PRD evolution should be captured as `wiki/notes/decision-*.md` and linked from the relevant MOC.

---

_This PRD is a living document. Update as decisions are made and as the v1 still frame review surfaces new direction._
