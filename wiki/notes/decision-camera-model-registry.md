---
tags:
  - domain/3d
  - status/adopted
  - scope/m2
---

# Decision: Pluggable Camera-Model Registry ("3 Cs" models)

**Date:** 2026-06-28 · **Status:** Adopted (v1 landed, uncommitted)

## Context

The camera audit ([[plan-camera-refactor-optimization]]) found the orbit controller
(`DreiSceneControls.tsx`) is a 1758-line monolith, currently mid-edit, and that
refactoring it in place is the highest-risk path. Separately, the project wants to
**flesh out different "3 Cs" camera models** (Camera / Controls / Character) and
**switch between them in the settings** — the production analogue of what
`/camera-lab` does on a grey-box, but in the real scene.

## Decision

Add a **camera-model registry**: a runtime-selectable layer that mounts one of N
self-contained controller components into the orbit slot. New models live in their
own files; the existing controller is registered **unmodified** as the default.

- **Store** (`lib/state/sceneStore.ts`): `cameraModel: CameraModelId`
  (`"map" | "drift" | "turntable" | "topdown" | "fly"` as of Stage B),
  `setCameraModel`, default `"drift"`, `persist:true` via the `SETTINGS_REGISTRY`
  (so it round-trips through Save/Revert/Reset/Copy for free). `cameraMode`
  (fly/orbit) is kept in sync as a bridge (fly → `"fly"`, else `"orbit"`).
- **`components/scene/camera-models/`** (all new):
  - `catalog.ts` — pure metadata (id, label, character, blurb); no component
    imports, so the settings UI reads labels without pulling in three.js.
  - `registry.tsx` — `Record<CameraModelId, ComponentType>` mapping id → component.
    `map` → the existing `DreiSceneControls` (untouched); `drift` → `DriftModel`.
    The `Record` type makes adding an id to the union without wiring a component a
    compile error, so store/catalog/registry can't silently drift.
  - `CameraModelHost.tsx` — reads `cameraModel`, renders the active model.
- **`Scene.tsx`**: mounts `<CameraModelHost/>` where `<DreiSceneControls/>` was.
  For `"map"` this is behaviourally identical (the host renders DreiSceneControls,
  still mounted across modes, still self-gating to orbit).
- **`CameraPanel.tsx`**: a "Camera model" segmented selector under the mode tabs,
  shown in orbit mode, with the active model's one-line character below it.

Each model **self-gates to orbit** (returns null otherwise), so fly/still still
fall through to the legacy controller exactly as before.

## Why this shape

- **Zero edits to the in-flight `DreiSceneControls.tsx`** — it's registered by
  reference. Sidesteps colliding with the uncommitted vertical-seam work / a
  parallel session.
- **It's *intentional* variation, not the *accidental* duplication** the migration
  ([[plan-drei-camera-migration]]) set out to remove — so the two coexist. Legacy
  fly/still can later become models too, which is a clean way to *finish* the
  migration rather than fight it.
- The eventual `InputArbiter` refactor (audit P2) can ship as a new model and be
  proven in the real scene alongside `map` before promotion — de-risks the monolith.

## First new model — "Drift" (`DriftModel.tsx`)

An ambient, hands-off cinematic camera (the screensaver at rest). No pointer input —
camera-controls' actions are disabled and a per-frame `setLookAt` owns the pose; Space
pauses. **Motion** (all deterministic from the R3F clock + a seed phase, no RNG): a slow
**brownian-like wander** of the focal across the ground (a sum of incommensurate slow
sines per axis, bounded to ~0.45× the city half-extent), an **elevation sine** bob, a
gentle azimuth revolution (~6 min), and a breathing dolly. **Framing:** it aims AT the
wandering focal (so the city is always in frame) and parks that focal low on screen via
the focal offset, reusing the map model's **low-angle ground pull** (driven to
`groundFrameLow` near the horizon) so the skyline sits low with the star sky filling the
frame above — this is *Starry Night*. Near-horizon elevation (≈2–6°) is required because
**orthographic** has no perspective compression, so even ~10° of tilt fills the frame
with rooftops. Works in **both** projections (radius held at tier × 1.7, past the ortho
near-plane clip); syncs `cameraLive`/`orbit` ~10/s so fog, moon-follow, and the morph
track it. Iterated through three framing bugs on 2026-06-28 (no-stars → no-city →
city-heavy), each verified by headless capture.

Ties to the project identity + [[city-life-montages]] (establishing-shot camera
language) — the closest model to the original After Dark "Starry Night" feel.

**Determinism: clean.** Motion is a pure function of the R3F clock + a seed-derived
phase (no `Math.random`/`Date.now`/`performance.now`); camera is runtime state, so
`gate1` is unaffected.

## Second new model — "Turntable" (`TurntableModel.tsx`)

A showcase spin (added 2026-06-28): the city rotates steadily at a fixed, default-low
elevation, framed as a skyline with the star sky above (same ground-pull as Drift).
Unlike Drift it is *interactive* — drag horizontally to grab and spin it; the auto-spin
pauses then resumes after a beat, Space pauses. Auto-spin is clock-driven (deterministic);
the drag is live pointer input. Raising the elevation gives a 3/4 "rotating model" view
(best in perspective — in ortho a high angle fills the frame with rooftops, so the default
stays low at 8°). Verified by headless capture.

## Live controls (Settings → Orbit)

Each new model exposes its feel knobs as a store-backed, persisted controls group that
appears (open) when the model is active, and the Map pose sliders hide: **Drift** — wander
reach/speed, elevation mean/bob, revolve seconds, breathe; **Turntable** — elevation, spin
seconds. The shared Screen Y / ground-pull controls below affect all three models.

## Per-model transport default + unified play/pause (2026-06-28)

The Orbit header's play/pause button (and Space, and the controls guide) all write one
`orbitPaused` flag. Drift and Turntable originally kept **local** `paused` refs, so that
button never reached them. Fixed: both now read the shared `orbitPaused` in their frame
loop, so **one transport control governs Map, Drift, and Turntable**.

A single shared flag can't encode three *different* defaults, so the natural starting
state is declared per model in the catalog (`CameraModelMeta.startsPaused`) and applied
on every **user** switch — the selector (`pickCamera`) and the `t` / `f` hotkeys
(`cameraView.applyTransportDefault`). It is deliberately **not** applied in the generic
`setCameraModel` setter, so boot **hydration** still restores a saved pose exactly as
saved. Defaults: **Map** `startsPaused: true` (the curated still pose); **Drift** /
**Turntable** play (field omitted). Initial `orbitPaused` flipped `true → false` because
the default model is now Drift, which should drift on load.

## Verification

`tsc --noEmit` clean · ESLint clean · Prettier clean (touched code) · `bun run build`
green. **Feel is unverified** — the Drift cadence/framing and the selector UX are
the user's live test ([[feedback_interaction-feel-verification]]); the constants in
`DriftModel.tsx` are first-pass and meant to be tuned. (Headless capture for the
2026-06-28 transport work was blocked by the Windows Playwright launch hang, so the
play/pause behaviour rests on tsc/lint/build + the live session.)

## Follow-ups / open

- The `ControlsGuide` cheat-sheet still documents only the map controls; it doesn't
  yet reflect the active model (Drift = "watch; Space pauses"). Generate guide rows
  from the model descriptor later (audit item).
- ~~Drift's pause is self-contained (its own Space), so the guide's Auto-Orbit switch
  (`orbitPaused`) doesn't drive it.~~ **Resolved 2026-06-28** — Drift/Turntable now read
  the shared `orbitPaused`; see "Per-model transport default" above.
- Confirmed via the build route table: `/camera-lab` + `/drei-lab` ship on the
  public GH-Pages build (audit P4 open question) — decide whether to guard them.
- Candidate future models: Fly (promote the legacy rig — starts finishing the migration),
  a cinematic "Director" with composed shot changes / cuts.
