---
tags:
  - domain/3d
  - status/open
---

# Camera Systems - Timestamped History

**Date:** 2026-06-17 - survey of every camera / camera-control system in the repo's
git history, including current uncommitted work. Companion to
[[camera-controls-feature-matrix]], [[plan-drei-camera-migration]],
[[decision-orbit-spherical-controls]], and the [[camera-lab-test-plan]].

Two controller implementations have existed:

- **`components/scene/CameraControls.tsx`** - the original bespoke, store-driven,
  per-frame controller (orbit + fly + still + projection). Still in the tree but
  now **opt-in / fallback only** (`?controls=legacy`).
- **`components/scene/DreiSceneControls.tsx`** - the drei `<CameraControls>`
  (`camera-controls` lib) bridge that replaced it for orbit. Now the **default**.

## 1. Timeline

### Era A - bespoke store-driven controller (`CameraControls.tsx`)

- **`58964b1` - 2026-05-22** - first camera system. `CameraControls.tsx` + `CameraPanel.tsx`. Slider-only orbit; original model `{ cameraY, startAngleDeg, radius }`. Fly rig (WASD/Space/C/Q/E, sprint), `easeInOutCubic` tweens, `CameraIntent` pose.
- **`4683048` - 2026-05-22** - orbit becomes the default mode.
- **`ca17ce8` - 2026-05-25** - first **interactive** camera: drag-yaw/pitch on canvas, pinch + wheel zoom, azimuth rebased on release so the auto-sweep resumes seamlessly.
- **`d8d7497` / `2c2e41a` (decision) - 2026-05-25** - orbit model replaced with **true spherical coords**: `radius`, `azimuthDeg`, `elevationDeg` (clamped 0-90, never flips). 0.25 deg/px yaw+pitch. Load-bearing for the whole bespoke era. `FocalIndicator.tsx` added.
- **`80ff80a` - 2026-05-25** - explicit Still / Fly / Orbit modes + S/F/G hotkeys.
- **`b0da08e` -> `7ac93dc` - 2026-05-25** - **Focal-Y** idiom: first on Shift+drag, then moved to **RMB** (vertical-only `lookAtY`).
- **`1580aaf` - 2026-05-25** - fly becomes pointer-lock, hold-to-look + wheel-speed.
- **`fdf6c9c` / `9975398` - 2026-05-25** - **projection morph born**: `ProjectionBlender.tsx`, perspective<->ortho via GSAP-tweened blend; pure-perspective matrix rebuilt each frame.
- **`e5c680b` / `aeabad6` - 2026-05-26** - **top-down** view as a tweened, auto-paused orbit state.
- **`b631417` - 2026-05-28** - top-down becomes a **swing-arm tween** with gradual **north-up** roll (`topDownTip`); mode UI -> shadcn Tabs.
- **`a872044` - 2026-05-31** - Fly/Orbit/Top-down tabs; `cameraView.ts` introduced (mode/tween dispatch).
- **`927db3c` / `05ca5db` / `49f60c8` - 2026-05-31** - `p` hotkey toggles projection; smoother morph + eased roll; level-horizon orbit + signed speed slider.
- **`2974029` - 2026-06-07** - **WYSIWYG camera persistence** (`cameraIntent` round-trip). Last substantive change to `CameraControls.tsx` - frozen since.
- *(parallel)* **`a9e5eae` / `00c1b99` - 2026-06-07** - `/intro` studio used a separate drei `<OrbitControls>` turntable - the second control system the migration set out to unify.

### Era B - `/drei-lab` spike (migration prototype)

- **`76f0329` - 2026-06-08** - `plan-drei-camera-migration.md` + `camera-controls-feature-matrix.md`.
- **`953ad20` / `289d42f` / `3d351a2` / `7cd0d0c` - 2026-06-08** - `/drei-lab` spike: orbit-around-target, orbit/fly toggle, shadcn sidebar, north-up top-down.
- **`97b970f` - 2026-06-08** - settled on the **receding-virtual-eye** projection morph (vs a hard camera swap).
- **`eb3b313` -> `c391b51` - 2026-06-08** - fly experiments: drei `FirstPerson`/`FlyControls` rejected -> **custom drag-to-look** (`DragLookFly`), Shift=down/Space=up, `T` top-down+fit, wheel=speed. Conclusions: drop pointer-lock + pinch-to-fly; fly stays custom + desktop-only.

### Era C - drei bridge on `/` (the migration, `DreiSceneControls.tsx`)

- **`6a0fcfd` - 2026-06-08** - the bridge ships behind `?controls=drei`. **Google-Maps input model**: LMB ground-pan, RMB rotate+tilt, wheel/pinch zoom-to-cursor, double-click zoom-in. Touch fully custom (1-finger pan; 2-finger pinch+twist+parallel-drag tilt, dominant-gesture lock). Hand-rolled auto-revolution (6 px drag threshold, 0.4 s resume, 1 s ramp, Space pause).
- **`2941ee7` - 2026-06-13** - **focal-pin / screen-Y pivot system**. LMB-on-pin = cursor-locked relative Focal-Y scrub (`movementY x distance x K`). Adds **Shift+LMB = rotate** (Google/Mapbox one-button convention) and the **screen-focus pivot** (orbit pivot parked at the on-screen focus %, scales with zoom). Plus label renames (compass / elevation / distance; Screen Y 0-100) and the `ScreenYGuide` dimension line.
- **`3934504` - 2026-06-13** - ortho made to feel right in the bridge: radius parked (`orthoMinRadius`), 8 deg elevation floor, `allowUnderview` (`u`), ortho-correct pin-scrub, Distance slider hidden in ortho.
- **`ed2cbf5` - 2026-06-13** - **free-look** chord (LMB+RMB held = look around in place); pin-scrub hardened against it.
- **`59f4b8f` / `47f610b` - 2026-06-13** - **bridge becomes the default for orbit** (hybrid); `?controls=legacy` forces the old controller; fly/still still fall back. Shipped to main as `v2026.06.13`.

### Era D - projection + framing overhaul

- **`feabc60` - 2026-06-14** - default orbit set to the still highway-view framing.
- **`c8ad612` - 2026-06-14** - compass slider wraps 0<->360.
- **`0085704` - 2026-06-14** - boot honours the default projection (ortho).
- **`fda1203` - 2026-06-14** - morph becomes **continuous** with a framing bridge (focal-plane half-height lerps perspK <-> orthoSize); ortho horizon ground-framing (the `applyScreenFocus` low-elevation ground pull).
- **`b9c92a2` - 2026-06-14** - real-eye ground clamp + perspective horizon framing + load snap; default projection settles on **orthographic**.

### Era E - current HEAD (`ae68353` - 2026-06-16)

`feat(camera): orbit input remap, framing controls, full reset, aspect framing`.

- **Input remap**: all of camera-controls' own mouse + touch actions set to `NONE`; every gesture custom. Plain **LMB-drag = press-point-relative "lever-arm" turntable rotate + tilt**; **RMB or Shift+LMB = ground-anchored pan**; **Ctrl/Cmd+LMB or LMB+RMB = free-look**; wheel = zoom-to-cursor.
- **Lever-arm rotate**: `dAz = (vx*dy - vy*dx)/r^2`, where `(vx,vy)` is press-point -> pin. Grab far from the pin -> slow/wide arc; near -> fast/tight. `TURNTABLE_MIN_R = 40 px` floor. Tilt was plain uniform `-2*pi*dy/height`.
- **Full reset**: double-click / double-tap -> `tweenOrbitToHome` (pose + framing + projection morph to default, lands paused).
- **Aspect framing**: `lib/scene/aspectFraming.ts` widens portrait framing (1x landscape -> ~1.5x phone).

### Era F - rotate/tilt feel layer (committed 2026-06-20, authored 2026-06-16)

A speed/feel layer on top of the lever-arm turntable, in `DreiSceneControls` +
`sceneStore` + `CameraPanel`:

- **Decoupled tilt** - store `tiltSpeed` (default 0.5; 1 = the old `2*pi/height` rate). A regulated, slower pitch independent of rotation.
- **Speed taper + per-event cap** - azimuth+tilt tapered by elevation (smoothstep to `rotateLowAngleGain` floor 0.35 below `rotateSlowBelowDeg` 20 deg) and by distance (mild 1/d past `ROT_DIST_REF` 5000, floor 0.35), then hard-capped at `ROT_MAX_STEP` 0.2 rad/event.
- **Tilt-vs-rotate axis gate** - the gesture's recent direction is accumulated (decay 0.9) and azimuth is gated by how horizontal it is (smoothstep 0.4-0.7): vertical drag -> pure tilt, horizontal -> full spin.
- **Low-angle ground-pull toggle** - `groundFraming` (default **off**); the `applyScreenFocus` pull (+ `freezeGroundOnDrag`) only runs when on. Off = Screen Y held exactly where set.

### Era G - `/camera-lab` testbed (committed 2026-06-20)

A standalone grey-box "zoo" (`app/camera-lab`, `components/camera-lab`) to A/B camera
schemes on desktop + mobile without touching the real scene - see [[camera-lab-test-plan]]
for the full spec. Seven labelled methods (App-orbit lever-arm, stock drei, Google Maps,
Drei MapControls, Blender, fixed-rate, FPS fly), live tuning + a persisted survey, a
perspective<->ortho **morph** (receding-eye, tappable label / `P` / switch), a live
**side-view diagram**, an FPS badge, and a shadcn collapsible sidebar. The App-orbit
method is a faithful port of the real lever-arm input (rotate/tilt + axis gate + tapers +
Screen-Y pivot + ground-anchored pan + Focal-Y pin scrub + free-look), used to validate
the feel before the controller refactor. Mechanics the lab proved that should fold back
into `DreiSceneControls` are listed under "Lab internals worth porting" in
[[camera-lab-test-plan]].

## 2. Current state (working tree)

- **Two controllers, hybrid**: `DreiSceneControls` owns **orbit**; legacy `CameraControls.tsx` runs **fly / still** (or all modes under `?controls=legacy`).
- **Modes**: Orbit (drei), Fly (legacy drag-look, desktop), Still (legacy frozen), Top-down (tweened orbit state, north-up, aspect-fit).
- **Projection**: one `PerspectiveCamera`; `ProjectionBlender` fakes ortho via a receding-virtual-eye matrix morph. Default = **orthographic** (`projectionBlend = 1`).
- **Orbit math**: spherical `azimuth = azimuthDeg`, `polar = 90 - elevationDeg`, `distance = radius`, `target = (centerX, lookAtY, centerZ)`. Rotate = lever-arm turntable; tilt uniform + speed-scaled.
- **Focal system**: camera-derived focal point with map-pin + plumbline + ground dot + radius ring. **Screen Y** = on-screen focus % (orbit pivot parks there); **Focal Y** = focal height (cursor-locked pin-scrub on desktop+perspective).

## 3. Control mappings today

### Desktop

| Input | Action |
|---|---|
| LMB-drag (no modifier, off pin) | Rotate + tilt (lever-arm turntable; axis-gated; tilt speed-scaled) |
| LMB on focal pin | Scrub Focal Y (cursor-locked; perspective + pin shown) |
| Shift+LMB / RMB | Pan (ground-anchored) |
| Ctrl+LMB (Win) / Cmd+LMB (mac) / LMB+RMB | Free-look (look around in place) |
| Wheel | Zoom toward the cursor |
| Double-click | Full reset (pose + framing + projection, lands paused) |
| Space | Pause / resume auto-revolution |

### Touch

| Input | Action |
|---|---|
| 1-finger drag | Rotate + tilt (same lever-arm turntable) |
| 2-finger | Pan (midpoint) + pinch zoom (locks pan-vs-pinch past 12 px) |
| 3-finger drag | Free-look |
| Double-tap | Full reset |

## 4. Parallels to known systems

- **Google Maps / Mapbox** (explicit anchor): LMB ground-pan, RMB rotate+tilt (Maps uses Ctrl+LMB), wheel/pinch zoom-to-cursor, double-click zoom-in, 2-finger pinch+twist+tilt. *Note the current HEAD inverts this* (LMB now rotates, RMB pans) - the Maps lineage is historical.
- **Blender / Maya turntable**: spherical orbit around a focal target, elevation clamped 0-90 (never flips), gimbal-guarded. The lever-arm twist (grab far = slower wide arc) is a refinement beyond standard DCC turntables.
- **FPS / UE5 fly**: WASD + hold-drag look, horizon-locked (no roll), wheel = speed. Desktop-only; pinch-to-fly dropped.
- **CAD / engineering ortho**: faked-ortho morph + parked radius + receding-eye model ("ortho == perspective with the eye at infinity"); the Screen-Y dimension-line guide is a deliberate CAD-drawing idiom.
- **Free-look**: LMB+RMB / Ctrl-drag / 3-finger rotates around the camera's own position - the FPS "look around without moving", distinct from orbit-around-target.
