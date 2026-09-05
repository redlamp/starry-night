---
tags:
  - domain/camera
  - domain/visual-language
  - status/open
---

# Vignette Lab

**Started:** 2026-09-05. `/vignette-lab`. Owner's framing: "Vignettes as the Ghost in the Shell montage section" — curated camera moments over the real seeded city, no plot, no UI tour. Backlog item in `docs/PRD.md` §7 (Backlog): "curated camera moments inspired by Ghost in the Shell establishing shots and Scott McCloud's aspect-to-aspect sequencing — GSAP becomes a candidate here if `useFrame` + drei don't carry the motion-graphics weight." This lab is the first pass at that item.

## Shot model

A **vignette** is an ordered shot list generated deterministically from `${masterSeed}::vignette::${kind}` (`lib/vignette/shotList.ts`, `generateVignette`). A **shot** is:

- `pose` — a `ViewLinkPose` (`lib/scene/viewLink.ts`: position, lookAt, fov) — the same pose shape `?cam=` links use.
- `holdSec` — how long the shot holds before advancing.
- `move` — continuous motion WHILE holding: `static`, `push-in` (slow dolly toward lookAt), `drift` (slow lateral truck), `orbit` (slow azimuth sweep around lookAt). Math in `lib/vignette/moveMath.ts`.
- `transitionIn` — how the camera arrives from the PREVIOUS shot: `cut` (instant) or `move` (a timed, eased camera move over `transitionSec`, GSAP's `parseEase` driving the interpolation — see [[decision-camera-transition-tween]] for the tween idiom this follows).
- `mccloud` — this shot's relationship to the previous one, tagged with Scott McCloud's panel-transition taxonomy (*Understanding Comics*):
  - **moment-to-moment** — barely any time passes; almost the same instant.
  - **action-to-action** — a single subject progresses through a distinct action.
  - **subject-to-subject** — stays within one scene/idea but jumps between different subjects.
  - **scene-to-scene** — crosses significant distance in space or time to a new setting.
  - **aspect-to-aspect** — bypasses time to linger on different aspects of one place or mood.
  - **non-sequitur** — no logical relationship between the two.

The default ("establishing") kind produces 7 shots: wide skyline (the aspect-bucket default pose) → the moon → a district from above → a tall downtown building's facade → a lit residential window (low angle) → a street at ~3m height looking along it (traffic) → back to the wide. Picks (which district/building/road) are rng draws off the same seeded stream, so a seed always yields the same vignette.

## The GitS reference

Per [[city-life-montages]]'s anchor entry: the ~3.5-minute wordless "謡II — Ghost City" interlude in *Ghost in the Shell* (1995) — the Major's boat ride through New Port City's canals, camera drifting through rain, storefronts, and crowds, rhyming citizens against mannequins. That note doesn't break the sequence down shot-by-shot; the beats above (sky, skyline, facade, window) are read off the note's own summary ("sky, skyline, a canal, a sign, a window, rain on glass, no dialogue") plus general familiarity with the sequence — **mark this for a re-check** against the actual film before treating the shot order as a real analysis rather than an homage sketch. Rain, signage, and sound are explicitly out of scope for this lab (see Open questions).

## What shipped 2026-09-05

- `lib/vignette/shotList.ts` — types (`VignetteShot`, `MoveKind`, `TransitionKind`, `McCloudTransition`) + `generateVignette(masterSeed, city, kind)`. Reads the city via `generateCity()` directly (same call every scene component makes), never regenerates.
- `lib/vignette/moveMath.ts` — pure pose math for hold-moves and transition lerps. Uses `gsap.parseEase()` for the easing curve only — no GSAP ticker; the player's own clock drives progress (see below).
- `lib/vignette/shotIO.ts` — JSON export/import (validated, never throws on bad paste) + a per-shot `?cam=` link.
- `components/vignette-lab/VignettePlayer.tsx` — the playback engine + shadcn control panel (`LabSidebar`/`LabSection`, matching the `/camera-lab` idiom): Play/Pause, Previous/Next, Loop, a scrubber over the whole vignette, and the shot table (index, McCloud tag, hold, move, Capture Pose From Camera, Copy Link, Delete, Add Shot After).
- `components/vignette-lab/ShotTable.tsx` — the per-shot row UI.
- `components/vignette-lab/VignetteLab.tsx` — mounts the REAL `Scene` (dynamic import, `ssr:false`, same as every WebGL lab route) plus the player; reads `?seed=`/`#seed=` on mount (a local re-read, not `CaptureBoot` itself — `CaptureBoot` also wires `?cam=` and live-view-link URL sync, which would fight the player's own per-frame `cameraIntent` writes).
- `app/vignette-lab/page.tsx`.

**How the camera is driven:** the player claims `cameraMode: "still"` (the same channel `?cam=` view links use — see `lib/scene/viewLink.ts`) and writes `cameraIntent` every frame. If the canvas gets grabbed (drag/wheel — `CameraControls`' existing "release-in-place" behavior flips still → orbit), the player auto-pauses rather than fighting the user for the camera. Clock discipline: every animation reads elapsed seconds off `sharedTime` (`lib/shaders/sharedTime`, advanced by the Canvas's own `useFrame` delta) — `requestAnimationFrame` only schedules the check, never feeds a value into the math. No `Math.random`/`Date.now`/`performance.now` anywhere in the shot generation or playback math.

**Gates:** `bun run lint`, `bun run typecheck`, `bun run build`, `bunx prettier --check` — see the session's own report for pass/fail (not duplicated here; update this line if a gate needed a follow-up fix).

## Open questions

- Rain, signage detail, and sound/score are explicitly out of scope for this lab — the GitS reference leans on all three, but none of them exist in the scene yet.
- Which shots need genuinely NEW in-city camera framing (the PRD backlog's separate "in-city camera positions: street-level views, rooftop angles" item) vs. reusing existing poses — the street-level shot here is a first, rough stab at that ask, not a considered street-level camera system.
- Whether vignettes become a screensaver mode on `/` (idle → auto-play a vignette) — raised by the concept, not decided.
- A second `kind` beyond "establishing" (a night-shift residential vignette? a transit/commute one?) is an obvious next step once this one feels right.
