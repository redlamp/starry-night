---
tags:
  - domain/ui
  - status/superseded
  - scope/m1
---

# Decision: Debug Panel Architecture

**Date:** 2026-05-25
**Status:** Superseded by [[decision-settings-sidebar-shadcn]] later the same day

## Context

The right-side panel had grown organically — camera intent inputs and presets at top, an orbit subsection that appeared only when orbiting, and a Debug subsection containing follow-cam toggle, star sliders, and moon sliders. Several controls (orbit speed, moon position, star size) were really debug knobs but lived outside the Debug box, while others were Debug-only but felt promoted. Reset reverted only the camera, leaving orbit / moon / stars sliders out of sync with what the user expected.

The user wanted four things at once:

1. Information architecture pass — group controls predictably
2. Section headers with star and moon emojis
3. Copy-to-clipboard for current values
4. Master debug toggle (checkbox) to hide the noise
5. Reset that goes back to a *saved* state, not hardcoded defaults

## Decision

Consolidate everything optional into the Debug section, and add a save / reset / copy workflow.

Structure (top to bottom):

- Header: mode buttons + Save + Reset + ×
- Tween presets row
- Camera intent inputs (position / orient / lookAt / rotation / fov)
- Live readouts
- Debug box
  - Master visibility checkbox + Copy values button (always shown)
  - When checked, three subsections:
    - 🌀 orbit — speed, radius, elev°, azim°, lookAt y
    - ⭐ stars — size, radius, depth, count
    - 🌙 moon — follow-cam toggle (header action), az°, el°, dist, live readout
- Seed row
- Perf readout

The master checkbox persists to `localStorage` (`starry-night.debugVisible`) so panel state survives reloads. Default is **off** — first-time visitors see a tidy panel.

Save / Reset semantics use a separate `localStorage` key (`starry-night.savedConfig`):

- **Save** snapshots `cameraIntent + orbit + moon + stars` as JSON
- **Reset** restores from that snapshot; falls back to hardcoded defaults only if nothing has been saved
- **Copy values** writes the same snapshot to the clipboard as a JSON code block

The snapshot keys are intentionally exposed as `export const DEFAULT_*` in `lib/state/sceneStore.ts` so the same shape works for both the hardcoded fallback and the persisted snapshot.

## Why this matters

- Putting orbit sliders inside Debug means they're reachable without engaging orbit mode — useful for previewing values before clicking Orbit
- Master checkbox lets a casual viewer enjoy the scene without the slider thicket; the user can flip it on once per session
- Save / Reset gives the user a guaranteed "good state" to return to after exploring with sliders. Without it, Reset would either overwrite their tuning or be useless
- Copy values closes the loop: tune, copy, paste the snippet back into code as the new hardcoded default

## Open

- The Save button doesn't currently surface confirmation feedback; if it becomes load-bearing, add a toast or button-flash
