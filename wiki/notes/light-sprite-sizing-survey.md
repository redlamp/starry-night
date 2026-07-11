---
tags:
  - domain/procgen
  - status/open
---

# Light Sprite Sizing Survey

2026-07-10, prompted by user feedback: light sprites keep the same screen size at any camera distance — fine in ortho, wrong in perspective. Full survey of every light-point system.

## The architectural fact that shapes everything

There is only ONE camera, a `PerspectiveCamera`; "ortho" is faked by `ProjectionBlender.tsx` overwriting `projectionMatrix` per frame from `projectionBlend`. The camera transform never changes, so view-space depth (`-mv.z`) is **identical in both modes** — a shader cannot tell perspective from ortho via depth. Only `projectionBlend`/`orthoSize` uniforms can distinguish them, and only Traffic consumes them.

## Per-system mechanisms (5 independent shaders, no shared utility)

| System | `gl_PointSize` | Depth-attenuated? | Ortho-aware? |
|---|---|---|---|
| Streetlights (`Streetlights.tsx:80`) | `clamp(uBaseSize·DPR·LOD, 2, 10)` | **No — 1/d term deliberately removed** (it collapsed lights at city distance, esp. under ortho) | No; camera-world-distance LOD is "projection-agnostic" by design |
| Traffic (`traffic.ts:116`) | `clamp(aSize·DPR·uSizeScale·mix(LOD, orthoZoom, uOrthoT), 1, 16)` | No (LOD only) | **Yes — the only one** (`uOrthoT`, `uOrthoSizeScale`) |
| Flights (`flights.ts:220`) | `min(max(aSize·DPR·3600/d, 4·DPR), 10·DPR)` | Yes, but at 5–12 km corridor range it's **always pinned at the 4px floor** → constant in practice | No |
| Helicopters (`helicopters.ts:151`) | identical copy of Flights | Same floor-pinned behaviour | No |
| Building beacons (`Beacons.tsx:28`) | `clamp(uBaseSize·DPR·180/d, 10, 28)` | Yes — genuinely shrinks between clamps | No |
| Route-debug markers | `PointsMaterial sizeAttenuation:false` | No (debug overlays, fine) | — |

Stars use the same `N/-mv.z` idiom in separate shaders (out of scope). Magic numerators (3600, 300, 180) are hand-tuned, not derived from FOV/viewport — a physically-correct attenuation is `worldRadius · viewportHeight / (2·tan(fov/2)) / depth`.

## Why it looks wrong in perspective

Streetlights and traffic are constant-size by explicit design (the LOD shrink is coarse and world-distance-based); flights/helis have attenuation but live on their minimum-size floor; only beacons partially attenuate. Relevant history: #52 light LOD (2026-06-03) chose camera-world-distance so ortho wouldn't break; c5e188a moved the flights cap off size onto intensity because the 4px floor defeated size-zeroing ([[decision-flights-live-caps]]).

## Fix shape (not yet built)

One shared attenuation snippet for all five shaders: perspective side = true `1/depth` with a FOV/viewport-derived scale (per-light world radius), floors kept so distant lights stay visible; ortho side = current constant/zoom behaviour; blend by `uOrthoT` (the Traffic pattern, generalized). Calibrate the scale so the reference framing matches today's look. Rendering-only — no determinism risk; per-system live feel-testing is the gate. The streetlight trap to avoid repeating: 1/d with no floor collapses everything at city range — the old removal treated the symptom.
