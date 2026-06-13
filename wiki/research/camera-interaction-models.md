---
tags: [research, camera, controls, drei]
created: 2026-06-13
---

# Camera interaction models — research & comparison

Research to evaluate two questions on the drei `<CameraControls>` orbit bridge:
1. Could **LMB-drag the pin to set Focal Y** replace the LMB+RMB free-look chord?
2. What models are we missing vs. Google Maps / RTS / ortho games / CAD tools / drei defaults?

## ⚑ Decisions & status (2026-06-13)

1. **Is "Focal Y" the right model?** → **Option A chosen** (Taylor, "go ahead"): keep Focal-Y as
   direct manipulation. *(Option B was: reframe "looking up" as a bounded tilt, Focal Y to a
   slider-only advanced control. Not taken.)*
2. **Pin-drag-to-set-Focal-Y?** → ✅ **Built** as a **cursor-locked relative scrub** (the
   resolved-blocker design below): positional drag was impossible (the pin can't both stay at the
   screen-focus % and follow the cursor). Implemented in `DreiSceneControls.tsx` (LMB on pin →
   `cursor:none` + pointer-capture + `movementY` → Focal Y, re-aim, restore on release). Lighter
   path first (no Pointer Lock overlay); switch to Pointer Lock if the bounded range hits screen
   edges. Perspective + indicator-on only; ortho/touch keep the slider. **Needs interactive test.**
3. **Remove the LMB+RMB free-look chord?** → ✅ **KEEP** (2026-06-13). The pin-scrub is validated
   and liked, but free-look isn't fully redundant: it's the only gesture that rotates the camera
   **in place** (look around from where you stand) — RMB *orbits* a pivot, pin-scrub only moves
   Focal Y, LMB pans. As an optional power chord that doesn't interfere with the primary gestures,
   undiscoverability is acceptable (it's a bonus path). Hardened the pin-scrub to bail if a second
   button joins, so scrub + free-look can't both re-aim.
4. **Clamp upward pitch deliberately (stars framing)?** → still open.

**Also shipped this session (additive, independent of the fork):**
- ✅ **Shift+LMB-drag = rotate/tilt** — modifier fallback for trackpad / one-button (Google/Mapbox convention). Needs interactive test.
- ✅ **Issue #80** — focal markers always-mounted + visibility-toggled (kills origin-flash flicker). Needs interactive test.
- 🔜 Candidate, not yet done: a reset / frame-view key (DCC `F`, games `Backspace`/`R`). Low risk but holding for your nod on the keybind.

Sourced from map-app docs (Google, Mapbox, Cesium, deck.gl, ArcGIS), game control refs (SC2, Cities:Skylines, Total War, Anno, AoE, CoH), DCC/CAD tools (Blender, Maya, SketchUp, Fusion, Unity, Unreal, Figma), and the camera-controls / drei / three.js APIs. Full source list at the bottom.

## Our current model (for reference)

| Gesture | Action |
|---|---|
| LMB-drag | grab-the-ground pan (custom, ground-anchored, clamped to disc) |
| RMB-drag | rotate (L/R) + tilt (U/D) around the pin |
| LMB+RMB | free-look in place (mode B): look around, Focal Y follows pitch |
| wheel | zoom to cursor (default) or to pin (`z` toggle) |
| dbl-click | zoom in, recentre on click |
| 1-finger | pan · 2-finger | pinch-zoom + twist-rotate + parallel-drag tilt |
| `i` focal indicator · `z` zoom mode · Space pause |

Pivot = the pin, parked at a screen-focus % via camera-controls `focalOffset`; camera aims at the pin; Focal Y is the pin's height (tilt-aim). Ground envelope couples Focal Y + elevation + radius.

## Comparison matrix

| Model | Pan | Rotate | Tilt | Zoom anchor | Orbit pivot | Look up? | Chords? |
|---|---|---|---|---|---|---|---|
| Google Maps/Earth | LMB-drag | RMB / Ctrl+drag | Ctrl/Shift+drag | **cursor** | ground centre point | clamped (~67–85°) | no (modifiers) |
| Mapbox GL | LMB-drag | RMB-drag | RMB-drag (same handler) | **cursor** (default) | screen-centre ground | maxPitch 85° | no |
| Cesium | LMB (2D) | LMB-orbit (3D) | MMB / Ctrl+drag | **cursor** (since 1.11) | picked terrain point | collision-clamped | no |
| RTS (SC2, Factorio, Civ) | edge/WASD/drag | mostly **none** | **fixed** | n/a | ground target | no | no |
| Builder-orbit (C:S, Anno, CoH) | grab-drag / WASD | MMB or Q/E | MMB-drag; **auto w/ zoom** | (cursor assumed) | ground look-at | clamped down | CoH/AoE use Alt+drag |
| DCC (Blender/Maya/Unreal) | Shift+MMB / Alt+MMB | MMB or **Alt+LMB** | (part of orbit) | cursor (opt-in) | **frame-selected target** | free | yes (Alt+button) |
| drei OrbitControls (default) | RMB | **LMB** | (part of orbit) | off by default | target | free | LMB/RMB split |
| drei MapControls | **LMB** | RMB | (part of orbit) | off by default | target, ground-plane pan | free | LMB/RMB split |
| **starry-night (ours)** | **LMB** | RMB | RMB | cursor (custom) | pin @ screen-focus % | yes (Focal Y / free-look) | LMB+RMB free-look |

Takeaways: our pan/zoom/pivot choices are squarely in the mainstream (map-like LMB pan, cursor zoom, fixed-ground pivot). The two places we diverge from *everyone*: (a) we use a **2-button chord** (LMB+RMB), which the field avoids; (b) we expose **Focal Y / looking up** as a first-class thing, which only DCC tools allow and which no map/builder does.

## Idea 1: drag the pin to set Focal Y

### Precedent
- **No map or game** uses a draggable handle to set a *camera* value. Map camera height is a by-product of zoom; game camera positions are set by being-there + a bookmark key (SC2 Ctrl+F5). The drag-a-handle idiom in those genres is reserved for *world content* (roads, waypoints, unit facing).
- The real precedent is the **3D-editor transform gizmo** (Blender/Maya/Unity/Unreal/three.js `TransformControls`): drag a single-axis (Y) handle to set a value. So pin-drag-Y is a DCC idiom grafted onto a map-like camera. That's coherent, but it is novel, not a convention users already know.

### The crux: coexisting with LMB-pan
A draggable pin on LMB collides with LMB-pan. Every 3D tool resolves this the same way:
> **On pointer-down, hit-test the handle first. If hit, claim the drag and disable the camera control for its duration (`controls.enabled = false`); else fall through to the camera. Re-enable on pointer-up.**

In our stack: r3f already raycasts front-to-back, so a hit on the pin mesh naturally beats a canvas-background drag. `e.stopPropagation()` + `setPointerCapture` on the pin, and flip `controls.enabled`. **Caveat (verified):** drei auto-disables default controls only for `<TransformControls>`. `<PivotControls>` and `<DragControls>` do **not** auto-disable `<CameraControls>` (drei #2408) — we must wire `controls.enabled` ourselves in `onDragStart`/`onDragEnd`. We already gate our custom pan on `panning.current`, so we'd add: pin-hit on pointer-down sets a `draggingPin` flag that both suppresses pan and freezes the orbit.

The cleaner alternative the tools point to: **put the camera gesture on a modifier/other button so bare-LMB is free for the handle** (Maya Alt+LMB orbit). We don't want to give up LMB-pan, so we'd take the hit-test-priority route instead.

### The drag math (don't use screen-Y pixels)
Canonical single-axis drag = **closest point on the Y axis-line to the mouse ray**, or intersect a camera-facing vertical plane through the pin and take `.y`. This stays correct as the camera orbits and as perspective foreshortens. It's the vertical-plane twin of our existing `groundHit` (which intersects the horizontal y=0 plane) — same machinery, plane normal swapped to face the camera. Store the grab offset at pointer-down so the pin doesn't jump; clamp to `[0, maxY]`; optional snap.

### Does it let us drop LMB+RMB free-look?
**Mostly yes, and that's a good simplification.** Free-look (mode B) was built to raise Focal Y by looking up. Pin-drag sets Focal Y directly and the camera re-aims at the pin, so it reproduces free-look's *Focal-Y outcome* more directly. What pin-drag does NOT reproduce is free-look's **in-place yaw** (look left/right without orbiting). But RMB already yaws (orbits the pin), so the only unique thing free-look adds is "rotate around the camera instead of around the pin" — an FPS gesture that a slow ambient orbit camera arguably doesn't need. The genre research backs this: builder/RTS cameras are orbit-around-ground-target rigs, and 2-button chords draw complaints (CoH/AoE Alt-rotate). **Removing LMB+RMB and adding pin-drag-Y is a net reduction in surface area with no real capability lost.**

### Mobile (the user's own worry — it's the weak point)
- No hover on touch, so the pin can't telegraph "draggable" the way a desktop hover-highlight does.
- One-finger-drag is already pan, so a draggable pin competes with the primary gesture. Resolutions other tools use: **tap-to-select then drag**, a **larger padded hit target** (≥44 px), or a **dedicated drag handle** offset from the pin.
- Pragmatic answer: keep **Focal Y on a slider for mobile** (already exists) and treat pin-drag as a desktop enhancement. The slider is the mobile-safe path; pin-drag is the desktop "direct manipulation" sugar. This also means we don't *depend* on solving the mobile drag to ship the desktop win.

### Pin-drag vs the screen-focus invariant — must be a cursor-locked scrub (2026-06-13)

Taylor's catch: our model parks the pin at the screen-focus % (37%) via `focalOffset`/
`applyScreenFocus` every frame. Standard direct manipulation keeps the grabbed point under
the cursor. **Those cannot both hold** — to raise Focal Y by dragging, the pin would have to
follow the cursor *up the screen*, leaving 37%; to stay at 37% it can't track the cursor. So
positional pin-drag is incompatible with the screen-focus model.

**Resolution: hide/lock the cursor and read relative `movementY` to scrub Focal Y** — turn
"drag a position" into "scrub a value." The pin stays at 37% (`applyScreenFocus` already does
this), the camera re-aims at the rising pin (the existing `focalYOnly` `setLookAt` path), and
the world tilts. No under-the-cursor expectation to violate. We already own all the camera
machinery; we'd add: pointerdown-on-pin → lock cursor + freeze camera controls → `movementY`
× sensitivity → ΔFocal Y (clamped to the ground envelope) → release → unlock.

Verified this is a standard, well-precedented pattern with a purpose-built web primitive:
- **Pointer Lock API** is built for "adjusting entries" / swiping "without leaving the play
  area": while locked, `clientX/Y` stay constant and `movementX/Y` give **unbounded deltas**
  (no screen-edge limit); on release the **cursor is restored to where lock began** (= drag
  start, no teleport); `unadjustedMovement:true` bypasses OS acceleration. Caveat: browsers
  flash a brief "press Esc" notice on lock (worst first time) — mild friction for a frequent
  micro-interaction, worth feeling out.
- **Lighter alt:** `cursor:none` + `setPointerCapture` + read `movementY` (no full lock). No
  overlay, but the physical cursor still moves → can hit the screen edge (movementY→0) and
  won't auto-restore. Fine for a *bounded* Focal-Y range; Pointer Lock wins for unbounded +
  restore.
- **Done elsewhere:** Adobe "scrubby sliders" (Photoshop/AE/Illustrator — Alt = 0.1× fine,
  Shift = 10× coarse, cursor hidden); Logic Pro EQ keeps the mouse fixed while dragging
  sliders "especially at screen boundaries"; Blender number fields (drag-scrub, Ctrl snap /
  Shift precision, cursor wrap); Unreal/Unity numeric fields; JUCE desktop-audio sliders;
  FPS mouselook is the canonical case.

Implications: the pin becomes a **3D scrubby-slider thumb** at 37%. Because positional
feedback vanishes once the cursor hides, **discoverability + a live readout are required**
(hover-highlight, `ns-resize` cursor, a Focal-Y value label while scrubbing; the tilting
world is the spatial cue). Consider adopting the Alt/Shift fine/coarse multipliers. Mobile
has no Pointer Lock, so the conflict has no escape there → Focal Y stays a slider on touch.
**This removes the main blocker to pin-drag and strengthens Option A**, though the fork is
still Taylor's call.

### Verdict
Worth doing on desktop. It's a recognised DCC idiom, it simplifies us off the 2-button chord,
and we already have the guide line (plumbline) and the raycast machinery. Implement it as a
**cursor-locked relative scrub** (see above), not a positional drag; gate the camera-freeze
carefully (drei won't do it for us with `<CameraControls>`); keep the slider as the
mobile/portable control.

## Angles we're missing (challenges to current design)

1. **No modifier fallback for rotate.** RMB-only rotate locks out trackpad / one-button / many laptop users. Every map app offers a modifier twin (Ctrl/Shift+LMB-drag = rotate). **Recommend adding Shift+LMB-drag = rotate/tilt.** Low cost, real accessibility + discoverability win.
2. **Question whether Focal Y needs to be first-class at all.** No map or builder exposes "look-at height" to users; tilt is either coupled to zoom or a plain drag, and the aim point is a *ground* point. Our pin-with-height is novel and is the single most confusing part of the model (it caused the "this is a mess" spiral). The *Starry Night* homage does justify a deliberate "tilt up toward the stars" affordance — but that may be better as a **bounded tilt gesture** (RMB-drag-up past horizontal, clamped) than as a user-managed Focal-Y value. Worth a hard look before investing more in the pin.
3. **Pitch is unclamped upward; everyone else clamps it.** Looking past the horizon into void is a bug in every other product. For us it can be a feature (stars), but it should be *deliberate and bounded* (clamp to a max upward pitch that frames the sky nicely), not an open-ended side effect of Focal Y.
4. **No "frame / reset view" affordance.** DCC tools have F (frame selected); games have Backspace/R (reset). We have dbl-click-zoom but no "return to a good default framing" for a lost user. A reset key or button is cheap insurance.
5. **Zoom-pitch coupling exists in most builders** (auto-flatten on zoom-out). We don't couple. This is a defensible *choice* (manual control), not a gap — but if onboarding shows users struggle to get a good angle, coupling-as-default-with-override is the proven pattern (C:S2 added decoupled keys after complaints about forced coupling).

## vs drei / three.js defaults

- **drei `<CameraControls>` / camera-controls default is OrbitControls-like: LMB orbit, RMB pan, wheel dolly — NOT map-like.** We deliberately remapped to LMB-pan / RMB-rotate (the MapControls feel). That divergence is correct for a cityscape and matches Google/Mapbox muscle memory; we are *better* than the drei default for this use case, not fighting it.
- **`dollyToCursor` / `zoomToCursor` are off by default** in every option; cursor-anchored zoom is opt-in. We roll our own (needed for ortho-correctness) — justified.
- **Popular r3f demos ship stock `<OrbitControls>`** (chorded LMB-orbit). So most three.js projects are *less* map-like than us. Our scheme is more considered than the ecosystem norm.
- **For the pin handle:** `<DragControls axisLock="y" dragLimits={[undefined,[min,max],undefined]}>` is the most direct drei primitive; `onDrag` reports `(local, deltaLocal, world, deltaWorld)` matrices. But neither it nor `<PivotControls>` auto-disables `<CameraControls>` (drei #2408) — manual `controls.enabled` wiring required. A raw raycast-on-vertical-plane pin (what we'd build) gives full control and reuses our `groundHit`-style code.

## Recommendation (priority order)

1. **Add Shift+LMB-drag = rotate/tilt** (modifier fallback). Cheap, fixes a real accessibility gap, improves discoverability. Do this regardless of the pin decision.
2. **Decide the Focal-Y question before building pin-drag.** Either commit to Focal-Y-as-direct-manipulation (then build pin-drag + drop LMB+RMB), or reframe "looking up" as a bounded tilt gesture and demote Focal Y to a slider-only advanced control. The pin-drag work only pays off under the first choice.
3. **If keeping the pin:** build pin-drag-Y (ray-to-axis math, manual camera-freeze, keep the slider for mobile), and **remove LMB+RMB free-look** — pin-drag + RMB-orbit cover its use cases with less surface.
4. **Clamp upward pitch deliberately** (stars framing) and **add a reset-view key/button**.

## Sources

Maps: Mapbox [gestures](https://docs.mapbox.com/mapbox-gl-js/guides/user-interactions/gestures/) · [handlers](https://docs.mapbox.com/mapbox-gl-js/api/handlers/) · [maxPitch PR#8834](https://github.com/mapbox/mapbox-gl-js/pull/8834); Cesium [ScreenSpaceCameraController](https://cesium.com/learn/ion-sdk/ref-doc/ScreenSpaceCameraController.html) · [cursor-zoom 1.11 thread](https://community.cesium.com/t/2898); deck.gl [Controller](https://deck.gl/docs/api-reference/core/controller); Google [Earth controls](https://support.google.com/earth/answer/148186) · [Maps tilt/rotate](https://developers.google.com/maps/documentation/javascript/webgl/tilt-rotation) · [altitude modes](https://developers.google.com/maps/architecture/3d-understand-altitude-modes); ArcGIS [navigate scene](https://doc.arcgis.com/en/arcgis-online/get-started/navigate-scene.htm).
Games: [Total War K&M](https://academy.totalwar.com/campaign-keyboard-and-mouse-controls/) · [viewport wiki](https://wiki.totalwar.com/w/TWWAKT_Navigating_the_Viewport); [Cities:Skylines controls](https://skylines.paradoxwikis.com/Controls) · [auto-tilt complaint](https://steamcommunity.com/app/255710/discussions/0/1637549649093314900/) · [C:S2 keybinds](https://www.shacknews.com/article/137454/); [SC2 hotkeys](https://liquipedia.net/starcraft2/Hotkeys); [AoE IV controls](https://frondtech.com/age-of-empires-4-controls-and-key-bindings/) · [unbind Alt-rotate](https://forums.ageofempires.com/t/177565); [Anno 1800](https://www.gamepressure.com/anno-1800/controls/zeb4fb); [CoH3 rotate](https://www.gamespew.com/2023/02/how-to-pan-camera-in-company-of-heroes-3/).
DCC/CAD: [Blender navigation](https://docs.blender.org/manual/en/latest/editors/3dview/navigate/navigation.html); [Maya navigate](https://help.autodesk.com/view/MAYAUL/2024/ENU/?guid=GUID-3DAAB0F6-A4E8-4C1A-B4E5-E9912EE09558); [Fusion pan/zoom/orbit](https://www.autodesk.com/products/fusion-360/blog/quick-tip-pan-zoom-orbit-preferences/); [Unity scene nav](https://docs.unity3d.com/Manual/SceneViewNavigation.html); [Unreal viewport controls](https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-controls-in-unreal-engine); [Figma zoom/view](https://help.figma.com/hc/en-us/articles/360041065034); [3ds Max gizmos (Projection vs Intersection)](https://help.autodesk.com/cloudhelp/2023/ENU/3DSMax-Basics/files/GUID-D97C423B-1AD4-46EA-892B-3A807823892C.htm).
API: [camera-controls README](https://github.com/yomotsu/camera-controls) · [#239 dollyToCursor](https://github.com/yomotsu/camera-controls/issues/239); [three OrbitControls](https://threejs.org/docs/pages/OrbitControls.html) · [MapControls](https://threejs.org/docs/pages/MapControls.html); drei [CameraControls](https://github.com/pmndrs/drei/blob/master/docs/controls/camera-controls.mdx) · [DragControls](https://drei.docs.pmnd.rs/gizmos/drag-controls) · [PivotControls](https://drei.docs.pmnd.rs/gizmos/pivot-controls) · [TransformControls auto-disable](https://drei.docs.pmnd.rs/gizmos/transform-controls) · [#2408 Pivot vs CameraControls](https://github.com/pmndrs/drei/issues/2408); [r3f events / pointer capture](https://r3f.docs.pmnd.rs/api/events).
Cursor-lock / value scrubbing: [W3C Pointer Lock 2.0](https://www.w3.org/TR/pointerlock-2/) · [MDN Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API) · [w3cub Pointer Lock](https://docs.w3cub.com/dom/pointer_lock_api.html) · [Adobe scrubby sliders (Nack)](https://blogs.adobe.com/jnack/2009/02/scrubby_sliders_more.html) · [JUCE keep-cursor-fixed-while-dragging](https://forum.juce.com/t/how-to-stop-moving-mouse-cursor-when-slider-dragging/47731) · [Blender number fields](https://docs.blender.org/manual/en/latest/interface/controls/buttons/fields.html).
