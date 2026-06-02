---
tags:
  - domain/ux
  - domain/stack
  - status/draft
  - scope/m3-plus
---

# Settings Panel — IA Evaluation & Proposals

Evaluation of the current settings panel (`components/ui/CameraPanel.tsx`) and five
proposed information-architecture (IA) layouts. Goal: a layout that scales as
controls grow, reads well on mobile, and separates "ambient viewer" needs from
"power tuner" needs. The fifth proposal is a drag-and-drop custom dashboard on a
dedicated route (sibling to `/plan`).

**Status:** Option D v1 built, reviewed, and **reverted** (2026-06-02). The control
manifest is worth keeping. See "Verdict & feedback" below for what carries into v2.

---

## 1. Current state (inventory)

One right-docked panel, full height, ~26rem wide. Three zones:

- **Header** — title, theme toggle (light/grey/dark), mode tabs (Fly / Orbit /
  Top-down), contextual Pause/Resume, hide (×).
- **Body** — a flat `Accordion` of **15 peer sections** (all same visual weight,
  all collapsed by default).
- **Footer** — Reset · Revert (if a config is saved) · Copy · Save.
- Plus a **seed overlay** pinned bottom-left, independent of the panel.

The 15 body sections, their controls, and a rough audience/concern tag:

| # | Section | Controls | Audience | Concern |
|---|---|---|---|---|
| 1 | Camera | projection, fov/ortho-size, position xyz, orient, lookAt xyz, rotation xyz, fly-speed | power | camera/motion |
| 2 | Orbit | default-orbit, focal indicator, speed °/s, radius, elev, azim, focal-y | enthusiast | camera/motion |
| 3 | Districts | shell overlay toggle + district list | enthusiast | world |
| 4 | Roads | tier highlights, streetlights (toggle/size/brightness), traffic (toggle/density/per-tier) | enthusiast | world |
| 5 | City Details | read-only: topology + tier counts | power | world (readout) |
| 6 | Stars | size, radius, depth, count | enthusiast | atmosphere |
| 7 | Moon | follow-cam, az, el, dist, size, halo (size/core/glow), readout | enthusiast | atmosphere |
| 8 | Fog | fog on/color/mode/near-far/density + ground-haze on/color/band/strength/radius | enthusiast | atmosphere |
| 9 | Anti-Aliasing | edge AA, LOD near, LOD range | power | rendering |
| 10 | Windows | simple (w/h) or advanced (per-archetype w/h) | enthusiast→power | surfaces |
| 11 | Intro | play, speed preset, window/star/streetlight timing + modes | mixed | timing |
| 12 | Live readout | position, rotation, fov | power | inspect |
| 13 | Seed | seed input, reroll | casual | world |
| 14 | Performance | quality tier + read-only fps/tris/draw-calls/etc. | mixed | system |
| 15 | Debug View | city shape, building tint, render modes, tensor-field overlay | dev | inspect |

---

## 2. Problems (the evaluation)

1. **No hierarchy.** 15 equal-weight accordions. Everything is a peer, so nothing
   is primary. Scanning = reading every label top to bottom.
2. **Audience mixing.** "Seed" and "Quality" (a casual viewer's whole world) sit
   in the same flat list as "Tensor-field overlay" and "Render modes" (dev-only).
   No way to hide depth you don't want.
3. **Concern mixing.** Camera, world, atmosphere, rendering, and meta/inspection
   are interleaved by historical accident of when each shipped, not by topic.
4. **Readouts mixed with controls.** City Details, Live readout, and half of
   Performance are *outputs*, sitting among *inputs*.
5. **No search / filter.** Finding "haze radius" means knowing it lives under Fog
   and scrolling there. Gets worse as settings grow.
6. **Mobile scroll length.** 15 sections + a sticky footer is a long column on a
   phone; even collapsed the headers are a tall stack.
7. **Discoverability splits.** Mode lives in the header tabs, but mode-specific
   controls (fly-speed, orbit framing, pause) are scattered (header, Camera,
   Orbit). The relationship isn't visible.
8. **Persisted vs runtime is invisible.** Some settings Save/Copy into a config
   (`persist:true`); others are transient (`debug`, `orbitPaused`). The UI gives
   no hint which is which.

**Enabling refactor (shared by B / D / E below):** today `SETTINGS_REGISTRY`
(28 store-field entries) governs Reset/Save/Copy/Revert, but the *UI* is hand-coded
JSX. Promote to a **control manifest** — one entry per slider/toggle/select with
`{ key, label, group, audience, control, persisted }`. Then every layout below
renders from data instead of bespoke JSX, and the drag-drop builder (E) becomes
tractable. This refactor is the real unlock; the layouts are mostly how we *read*
that manifest.

---

## 3. Goals for the new IA

- Progressive disclosure — casual viewers see ~5 things, depth on demand.
- Group by concern, not by ship date.
- Separate controls from readouts.
- Mobile-first: short default height, search beats scroll.
- Keep the determinism/Save-config story legible.
- One data source (the manifest) feeding every view.

---

## 4. Option A — Audience Tiers

A segmented control at the top swaps the whole body between three curated depths.

```
┌───────────────────────────────────────────┐
│ ⚙ Settings        ☼ ◐ ☾   ⏸ Pause   ×     │
│ ┌─────────┬──────────┬───────────┐         │
│ │  Basic  │  Studio  │ Developer │  ← tier │
│ └─────────┴──────────┴───────────┘         │
├───────────────────────────────────────────┤
│  (Basic shown)                              │
│  Seed            [ moss-otter ] ⟳           │
│  Quality         [ High ▼ ]                 │
│  Intro           ▶ play   ( Default | Fast )│
│  Theme           ☼ ◐ ☾                      │
├───────────────────────────────────────────┤
│  Reset · Copy · Save                        │
└───────────────────────────────────────────┘
```

- **Basic** → Seed, Quality, Intro (play + speed preset), Theme, mode + pause.
- **Studio** → + Camera, Orbit, Stars, Moon, Fog, Districts, Roads, Windows (simple).
- **Developer** → everything, incl. Debug View, Anti-Aliasing, Live readout, City
  Details, window profiles, numeric pose entry.

**Pros:** instant complexity drop; matches "how deep am I going" intent; one
toggle. **Cons:** hides controls (a Basic user can't *find* depth without learning
tiers exist); some controls legitimately belong to two tiers; we must assign every
control a tier. **Effort:** Low-Med (tier tag per control + a filter).

---

## 5. Option B — Domain Groups (two-level)

Collapse the 15 sections under ~6 super-groups. Two-level accordion: top groups,
each expands to today's sections.

```
┌───────────────────────────────────────────┐
│ ▸ Camera & Motion      (Camera, Orbit)     │
│ ▾ World                                     │
│     ▸ Seed                                  │
│     ▸ Districts                             │
│     ▸ Roads                                 │
│     ▸ City Details                          │
│ ▸ Atmosphere           (Stars, Moon, Fog)  │
│ ▸ Surfaces & FX        (Windows, AA)        │
│ ▸ Timing               (Intro)              │
│ ▸ System & Inspect     (Perf, Live, Debug) │
└───────────────────────────────────────────┘
```

**Pros:** keeps every control, just nests; smallest behavioural change; top level
scans in 6 lines. **Cons:** two clicks to reach a leaf; deep nesting feels heavy on
mobile; an expanded group is still a long column. **Effort:** Low (pure grouping of
existing JSX).

---

## 6. Option C — Task / Workflow framing

Organize by *what the user is trying to do* (verbs), not by object.

```
┌───────────────────────────────────────────┐
│ 🎬 Frame the shot                          │
│     projection · orbit/fly · pose · focal  │
│ 🏙 Shape the city                          │
│     seed · shape · districts · roads        │
│ 🌙 Set the night                           │
│     stars · moon · fog · windows · intro    │
│ ⚡ Tune performance                         │
│     quality · AA · LOD                       │
│ 🔍 Inspect & debug                         │
│     readouts · tints · render modes · field │
└───────────────────────────────────────────┘
```

**Pros:** maps to newcomer mental model; great for onboarding / marketing copy;
naturally hides dev depth under "Inspect." **Cons:** ambiguous home for some
controls (is "windows" shaping the city or setting the night?); power users think
in objects, not tasks; biggest label churn. **Effort:** Med (regroup + rename +
some controls move).

---

## 7. Option D — Command-bar + Searchable drawer

A pinned compact quick-bar of the top ~6 controls always visible; everything else
in one drawer with **category chips + text search** across control labels.

```
┌───────────────────────────────────────────┐
│ ⚙  Seed⟳  Quality▾  ⏸  ▶intro  ☾   ×       │ ← quick-bar
│ ┌───────────────────────────────────────┐  │
│ │ 🔍 search settings…                    │  │
│ └───────────────────────────────────────┘  │
│ [All][Camera][Sky][City][FX][System]        │ ← filter chips
├───────────────────────────────────────────┤
│ haze radius        ──●────────  3000        │
│ fog far            ────●──────  7200        │
│ star count         ──────●────  9000        │
│ … (filtered list)                           │
└───────────────────────────────────────────┘
```

**Pros:** fastest path to top tasks + true findability (type "haze"); scales
indefinitely as settings grow; search beats scroll on mobile; chips double as both
domain and audience filters. **Cons:** needs search/filter infra + per-control
label metadata (the manifest); less "browsable" for someone who likes structure.
**Effort:** Med (manifest + search/filter); highest payoff-per-effort.

---

## 8. Option E — Drag-and-drop Custom Dashboard (`/studio`)

A dedicated route (sibling to `/plan`) where the user builds their own panel. Every
setting is a draggable **widget** sourced from the control manifest. Drag widgets
into zones/columns, pin favourites to a compact "My Controls" bar, hide the rest;
layout persists to `localStorage`. The live scene renders alongside.

```
 /studio
┌──────────────── live scene ───────────────┬─ palette ─┐
│                                            │ Camera ▸  │
│   ┌── My Controls (pinned) ──┐             │ Orbit  ▸  │
│   │ Seed⟳  Quality  ⏸  Fog   │             │ Stars  ▸  │
│   └──────────────────────────┘             │ Moon   ▸  │
│   ┌── Column A ──┐  ┌── Column B ──┐        │ Fog    ▸  │
│   │ [Stars]      │  │ [Haze]       │        │ …drag    │
│   │ [Moon]       │  │ [Fog]        │        │  from    │
│   │ + drop here  │  │ [Intro]      │        │  here →  │
│   └──────────────┘  └──────────────┘        │           │
│   Preset: ( Basic | Studio | Dev | mine )   │  Reset    │
└────────────────────────────────────────────┴───────────┘
```

- **Presets = the other four options.** "Load preset → Studio" seeds the canvas
  with Option A's Studio set; the user then tweaks. So A–D become *starting
  templates*, not mutually exclusive choices.
- Pin/hide/reorder; "reset to preset"; export/import a layout (shareable, like the
  seed URL).

**Pros:** ultimate personalization; A–D become presets; future-proof; showcases the
manifest. **Cons:** biggest build (dnd lib, persistence schema, widget registry,
empty/overflow/responsive states); risk of users making an unusable mess (mitigate
with presets + reset); hard dependency on the manifest refactor. **Effort:** High.

---

## 9. Comparison

| Criterion | A Tiers | B Groups | C Tasks | D Cmd+Search | E Dashboard |
|---|---|---|---|---|---|
| Scannability | ●●● | ●● | ●●● | ●●● | ●● |
| Findability | ●● | ●● | ●● | ●●●● | ●●● |
| Mobile | ●●● | ●● | ●●● | ●●●● | ●● |
| Dev access | ●● | ●●● | ●● | ●●● | ●●●● |
| New-user friendly | ●●●● | ●● | ●●●● | ●●● | ●● |
| Build effort (less=better) | ●●● | ●●●● | ●●● | ●● | ● |
| Personalization | ● | ● | ● | ●● | ●●●● |

---

## 10. Recommendation

1. **Do the manifest refactor first** — it's the dependency for B, D, and E and
   pays off regardless of which layout wins.
2. **Ship Option D** (command-bar + searchable drawer) as the default panel: it
   absorbs most of A/B/C's wins (chips = domain *and* audience filters), is the
   best mobile answer, and scales.
3. **Then build Option E** at `/studio`, reading the same manifest, with A–D
   wired up as the selectable presets.

This sequences low-risk → high-value → showcase, and never throws work away: the
manifest, the search, and the presets all carry forward into the dashboard.

## Build log

**2026-06-01 — manifest + Option D v1 (uncommitted, on `arch/city-planning`).**

- `lib/state/settingsManifest.ts` — the control manifest: 55 scalar/toggle/select/
  colour controls, each `{ id, label, group, audience, spec, get, set, keywords }`.
  7 groups (Camera/Orbit/Sky/City/Surfaces/Timing/System), 3 audiences
  (basic/studio/dev). `filterControls(query, group, maxAudience)` does the search +
  filter. `SceneState` is now exported from the store.
- `components/ui/ControlRow.tsx` — renders one manifest control (slider/toggle/
  select/colour) from its `get`/`set`.
- `components/ui/SettingsPanel.tsx` — Option D: quick-bar (seed, quality, ▶intro,
  theme, pause, mode tabs), search box, group chips, Basic/Studio/Dev depth
  segmented filter, grouped/filtered control list, footer (Reset/Revert/Copy/Save).
- `components/ui/SettingsRoot.tsx` — swaps D ↔ classic (non-lossy migration); D is
  default. `CameraPanel` gained an optional `onUseNewPanel` swap button.
- `app/page.tsx` — renders `SettingsRoot` instead of `CameraPanel`.

Verified live: default grouped view, `haze` search filter, Sky chip, Studio→Dev
depth expansion; tsc + lint clean.

**Still pending (port composites → retire classic):** numeric XYZ pose + orient,
per-archetype window profiles, render-mode matrix, district list, live/perf/moon/
city-details readouts, default-orbit + focal-indicator buttons. These remain in the
classic panel (reachable via the swap button) until ported into the manifest /
an "Advanced" group. After parity: delete `CameraPanel` + the swap, then build
**Option E** (`/studio`) on the same manifest with A–D as presets.

## Verdict & feedback (2026-06-02)

Option D was tried live and **rejected** — the flat command-drawer didn't read
well. Reverted on `arch/city-planning`; the code is parked on branch
**`wip/settings-panel-d`** (don't rebuild the 55-control manifest from scratch —
mine it from there). Live app is back on the classic `CameraPanel`.

**Keep (these worked / are wanted):**
- **Basic / Advanced mode** — the audience tiers idea (Option A). A simple
  Basic↔Advanced toggle, not the 3-way Basic/Studio/Dev.
- **Search field** — keep it.
- **Content clustering** — grouping controls by topic was good.
- **Pinned quick-actions at the top** — seed, reroll/refresh, and intro buttons
  belong up top, always visible.

**Avoid (why D failed):**
- **Crowded horizontal top-level menu** — the row of group chips was too busy.
- **Lumping** — controls all ran together; groups need clearer visual separation,
  not a single flat filtered list.

**v2 direction:** a **vertical, grouped** layout (closer to Option B — distinct
collapsible sections with clear separators) + a **Basic/Advanced** toggle (A) +
**search** + **top quick-actions**. NOT horizontal chips, NOT one flat list. The
control manifest (group + audience + spec/get/set per control) still underpins it.
