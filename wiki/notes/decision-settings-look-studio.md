---
tags:
  - domain/ui
  - status/adopted
---

# Decision: Settings Look/Studio Split

**Date:** 2026-09-05. Related: [[settings-ia-evaluation]].

## Context

The June IA evaluation ([[settings-ia-evaluation]]) audited the settings drawer as one flat `Accordion` of 15 peer sections, mixing "ambient viewer" controls (seed, quality, intro) with "power tuner" and dev-only ones (render modes, tensor-field overlay, per-archetype window profiles) with no hierarchy. It tried Option D (a command-bar + searchable drawer) live, and **reverted** it — the flat filtered list didn't read well, controls ran together with no visual separation. The verdict asked for a v2 direction instead: a **vertical, grouped** layout (Option B) plus a **Basic/Advanced** toggle (Option A) plus the search field, explicitly **not** horizontal chips or one flat list.

By 2026-09-05 a fresh audit counted **~180 controls across 15 flat sections** — the same shape the June evaluation flagged, now larger.

## Options

1. **Keep the flat 15-section accordion** — status quo. Rejected: doesn't scale past 180 controls, mixes audiences on every scroll.
2. **Basic/Advanced two-way split** (per the June verdict's letter) with the June regroupings folded in as vertical, distinctly-separated sections; search spans both depths with a cross-depth tag. Chosen.
3. **Task/workflow framing** (Option C from June: "Frame the shot" / "Shape the city" / "Set the night" / …) — rejected again: ambiguous home for some controls (is Buildings shaping the city or setting the night?), biggest label churn, power users think in objects not tasks.

## Choice

Option 2, named **Look / Studio** rather than Basic/Advanced — "Look" is the curated viewer/screensaver experience, "Studio" is where an author generates and debugs. A segmented control (shadcn `Tabs`) in the drawer header switches `studioMode` (new persisted boolean, `SETTINGS_REGISTRY`, default `false`). Studio's tab shows a lowercase hint line under the header: "author tools: generation, debug, labs".

Sections are rendered from one mounted list (`components/ui/CameraPanel.tsx`); each tab is a `LOOK_SECTIONS` / `STUDIO_SECTIONS` array of section values, and a section's visual position is CSS flex `order` (not DOM order) so both tabs share the same `Accordion` without duplicating panel JSX. A section not in the active tab (or not matching a search) unmounts (`hidden` returns `null`), same mechanism the old search already used.

Two sections — **Buildings** and **Performance** — appear in *both* tabs with different sub-groups, implemented as a single component reading `studioMode` directly (`BuildingsSection` in `components/ui/panels/BuildingsPanel.tsx`; the Performance section body inline in `CameraPanel.tsx`) rather than two copies of panel code.

### Section map per tab

**Look** (default): Camera, Orbit, Drift, Lights, Stars, Moon, Atmosphere, Buildings (Facade + Debug Highlight/tint sub-groups only), Performance (quality-tier select + the header badge/stats toggle only), Intro.

**Studio**: World (**new** — city shape, size tier, crop, field deviation; extracted out of Debug View so it reads as an authoring control, not an inspection tool), Transport (all of it, including the traffic density-debug overlay switch), Population (all), City Details, Buildings (Windows sub-group: classic/hybrid far-field switch, per-archetype profiles, stagger/curtain/storefront controls + Hover Highlight), Performance (Adaptive/AA/DPR/LOD/Stats sub-groups — everything except the tier select), Debug View (render modes, windows-layers view, tensor field, tile culling, pin plane, plus **Fog Bounds** — the "always show fog boundary walls" switch, moved here from Atmosphere since it's an inspection aid, not a look-and-feel control), Labs.

### Search

Unchanged keyword-matching mechanism (`SETTINGS_SECTIONS`, AND-over-tokens against label + value + keywords), but matching now spans **both** tabs. A match inside the active tab renders as a normal (auto-expanded) accordion section; a match that lives in the *other* tab renders as a small row below the accordion tagged "in Studio" / "in Look" — clicking it flips `studioMode`, which re-evaluates the match against the new active tab and expands it automatically (no extra state to track). Keywords for moved controls were re-homed: "city shape / size tier / deviation" moved from Debug View's keyword list to World's; City Details' keywords trimmed to seed/naming/topology only.

### Other renames folded in

- Every `ValueSlider` label in Stars, Moon, and Atmosphere is Title Case (`size` → `Size`, `az°` → `Azimuth`, `el°` → `Elevation`, `dist` → `Distance`, `sharp` → `Sharpness`, `mode`/`color`/`near`/`far`/`amount`/`bottom`/`top`/`strength`/`radius` → capitalized, etc).
- The district-boundaries toggle is now labeled **"Show Boundaries"** in both the City Directory and the Population panel's Districts sub-group (previously "boundaries" in Population, "Show Boundaries" in the Directory — same store field, two different labels).
- Footer buttons (Reset, Link, Copy, Save, plus the conditional Revert/Clear) now show visible icon + text instead of icon-only-with-tooltip; the tooltip wrapper was dropped since the label is no longer hidden.

## Why

The June verdict was explicit about what worked (Basic/Advanced, search, content clustering, pinned quick-actions) and what didn't (horizontal chips, a flat filtered list with no visual separation) — this implementation is that verdict, applied to today's larger control count, with the vertical-grouped Section/SubGroup structure the app already had. Two names ("Look"/"Studio") read better for this app's audience (screensaver viewers vs. the person tuning generation) than the generic "Basic/Advanced," without changing the underlying mechanism the evaluation recommended.

## Rollback

The owner reserved the right to roll this back. The change is scoped to the settings drawer only (`CameraPanel.tsx`, the `panels/*.tsx` files it composes, `DistrictsPanel.tsx`'s boundaries label, and the `studioMode` store field) — no scene/store fields outside the drawer were touched, and `studioMode` defaults to `false` (Look) so a rollback just needs the drawer changes reverted, not a data migration.
