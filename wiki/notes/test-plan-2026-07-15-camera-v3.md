---
tags:
  - domain/camera
  - status/draft
---

# Test Plan — Starry Night Cam v3 (2026-07-15)

One live surface: **http://localhost:7827** on `feat/camera-v3` (main tree, uncommitted).
Cam v3 is the **default camera** on a fresh profile; an existing browser profile keeps its
persisted pick, so first select **Starry Night Cam v3** in Settings → Camera. Everything v2
does should still work identically (v3 is a fork); Sections 1–5 cover the new behaviours,
Section 6 is the jarring/conventions checklist. Design rationale:
[[decision-camera-v3-continuous-modes]].

## 1 Top-down as a continuous flight (T)

1. [x] From the hero view, press **T** → the camera glides overhead to a whole-city plan
   view. No model swap: the Settings camera dropdown still reads "Starry Night Cam v3".
2. [x] While overhead: RMB/Shift-drag pans, wheel zooms toward the cursor, WASD glides —
   all controls stay live (the old Top-Down model was fixed).
3. [x] Press **T** again (without touching anything) → returns to the exact pose you left,
   smooth flight both ways.
4. [x] Enter top-down, pan + zoom around up there (stay overhead), press **T** → still
   returns to the original pre-top-down pose (pan/zoom don't count as "leaving").
5. [x] Enter top-down, **LMB-drag to tilt** the view well off vertical, press **T** → the
   camera re-squares BACK to overhead (it does not return). Press **T** once more → now it
   returns to the original pose.
6. [x] The tilt threshold is 65° elevation — tilt just a little (a few degrees) and T
   should still count as "in top-down" and return. Does the boundary feel right?
7. [x] T round-trip in **ortho** (press P first): the plan view fits the city, the return
   restores the prior ortho zoom without a size pop.
8. [x] R (reset) while in top-down → flies home and clears the banked top-down pose (a
   following T is a fresh entry).

## 2 Idle drift

9. [x] Settings → Orbit → Idle Drift: **auto drift** toggle (default on, in the group
   header since round 2) and **Delay** slider (default 30 s since round 2) are there and
   persist across reload.
10. [x] Leave the camera alone for the delay → it eases into a slow fly-around: view
    revolves, focus wanders across the city, height bobs gently. The takeoff should be
    seamless (no snap) from wherever the camera rests.
11. [x] Touch anything — drag, wheel, WASD, T — the drift stops INSTANTLY and the camera
    is exactly where the drift left it (no snap-back), timer re-armed.
12. [x] Set the delay slider to 2 s → drift kicks in visibly sooner; set 60 s → later.
13. [x] Toggle **auto drift** off → never drifts, however long you wait.
14. [x] With a building card / drill open (or a building selected), the camera does NOT
    drift away while you read (drift is suppressed until you close the cards).
15. [x] Drift with the Idle Drift feel knobs (Wander / Wander spd / Elev bob / Revolve s)
    — they retune the flight live (shared with the Drift camera model's sliders).
16. [x] Drift in ortho: still reads as a calm revolve/wander (no clipping, no rooftop
    dive).

## 3 Inspect / cone-view framing

17. [x] Select a resident with a visible commute (home ≠ work), press the **cone** button
    → the camera settles at an angle where the commute arc presents broadside
    (perpendicular to the view), rotating the SHORT way (never more than a quarter turn).
18. [x] A persona with several arcs (partner/family across town) → the settled angle is a
    sensible compromise (the long arcs dominate the average).
19. [x] A building/company card with employment arcs → same broadside behaviour for the
    fan of arcs.
20. [x] In cone view, **LMB-drag orbits around the arcs' centre point**, and a **pin with
    a cone glyph above it** appears at that point for the duration of the drag (gone on
    release). All arcs stay in view through the orbit.
21. [x] **RMB pan while in cone view** moves the camera but the NEXT LMB-orbit still
    revolves around the SAME pinned centre (the pivot doesn't follow the pan). — This is
    the "we'll want to test that" item: does keeping the pin put feel right, or should a
    big pan re-centre the pivot?
22. [x] Plain focus (double-click a building in inspect mode) still does NOT rotate the
    view (the no-revolve rule holds when no arcs are involved).

## 4 Touch (first pass — needs a real device)

Synthetic checks pass; **feel is unverified** — this section is the real gate.

23. [x] 1-finger drag: orbit + tilt around the touched point. Does 1-finger-rotate feel
    right, or does muscle memory demand 1-finger-pan (Google Maps convention)? ← key call
24. [x] 2-finger drag: the city pans with the midpoint (ground glued to fingers).
25. [x] Pinch: zooms toward the pinch centre, both projections.
26. [x] Two fingers → lift one: the remaining finger continues as orbit without a jump.
27. [x] Double-tap: zooms in toward the tap (except in inspect mode, where double-tap is
    building-focus).
28. [x] T / drift behaviours on mobile: tap the screen once to cancel a drift; does that
    feel discoverable?
29. [x] No browser gestures leak through (no pull-to-refresh / page zoom while on the
    canvas).

## 5 Regression sweep (v2 parity)

30. [x] LMB orbit + pin, RMB/Shift move, Ctrl/⌘ free-look, wheel zoom-to-cursor,
    double-click zoom, WASD/QE, R reset — all identical to v2.
31. [x] Focus/fly-to from directory cards: obstruction-aware framing, 45° look-down, no
    long-way revolve (absent a cone request).
32. [x] Projection toggle (P) mid-top-down, mid-drift, mid-focus — no fights, no pops.
33. [x] Switch to Cam v2 in Settings → everything behaves as before (v2 untouched);
    switch back to v3.
34. [x] Old Top-Down model from the dropdown still works (and T from OTHER models still
    swaps models as before).

## 6 Jarring / against-convention watchlist

Behaviours that may surprise users — each is a deliberate v1-pass choice; flag any that
grate so the follow-up pass can address them:

1. [x] **v3 top-down is NOT north-up.** It keeps your current compass heading through the
   dive (continuity of the flight); the old Top-Down model rolls to north-up like a real
   map. People who use top-down as "the map" may expect north-up + a compass affordance.
   → **#95** filed (user 2026-07-15): Google-Maps-style compass rose while parked in
   top-down; later pass.
2. [x] **T's meaning changes with tilt.** After a manual tilt-away, T re-squares instead of
   returning — a modal hotkey. The banked pose surviving for the NEXT press is invisible
   until discovered. If confusing: an on-screen hint ("T returns to top-down") or a
   two-key split (T = top-down, Shift+T = return) are options.
3. [x] **Top-down always frames the WHOLE city.** Entering from a tight street-level view
   zooms way out (matches the old model's fit) — you can lose your sense of place; only
   the return leg brings you back. An alternative is diving over the CURRENT focal point
   at a nearer height.
4. [ ] **The camera moves by itself** (idle drift, on by default). Screensaver-appropriate,
   but it can startle during passive viewing — and any drift means a shared `?cam=` pose
   is no longer what the sender framed. Suppressed while cards are open; NOT suppressed
   during plain watching. The toggle exists; is on-by-default right? → resolved
   2026-07-15 (round 6): **auto-drift is OFF by default**; the Orbit header transport or
   the Idle Drift switch turns it on.
5. [ ] **Space / the Orbit play-pause button do not govern v3's drift** — they control the
   old auto-revolution and the Drift model. Two "ambient motion" systems with different
   transports now coexist. Candidate cleanup: make Space cancel/pause the idle drift too.
   → resolved: round 6 (2026-07-15) bound the Orbit header **play/pause to v3's
   auto-drift** (one transport, whatever the model); round 7 (2026-07-16) bound
   **Space** to the same state — OFF → enable + take off immediately (bypasses the
   idle delay), ON → disable, camera holds. Space in the Drift MODEL still means
   pause-revolution, as before.
6. [x] **1-finger touch = rotate** (v1's mapping) vs the dominant maps convention of
   1-finger = pan (Google Maps/Earth, Apple Maps). Deliberate — rotate is the richer
   gesture for a 3D scene — but it inverts phone muscle memory. Section 4.23 decides.
7. [ ] **Cone-view rotation on focus.** Focus glides historically never rotate; the
   arc-perpendicular swing (up to 90°) is new motion the user didn't ask for with the
   click. It's capped at a quarter turn, but watch for disorientation on repeat cones.
8. [ ] **RMB pan doesn't move the cone pivot** — orbit after a big pan revolves around a
   point that may now be off-centre (or off-screen). Spec said keep it pinned + test.
9. [x] **Double-tap zoom is suppressed in inspect mode** (double-tap = focus there), so the
   same gesture does different things by mode.
10. [ ] **Tilting from overhead can pass "level" into a low upward vantage** (elevation
    readout goes negative) with the Min-tilt default 0 — the same v2 math, but it's much
    easier to hit from a straight-down start. If it reads wrong, clamp harder near the
    pole or raise the default floor.
11. [x] **Persisted-settings inertia:** existing users keep `snv2` (their persisted pick) and
    won't see v3 until they select it; fresh visitors get v3. Two cohorts, one build.

## Round 2 fixes (2026-07-15, responding to the Section 1–2 notes)

All landed and headless-verified; re-check live at leisure:

1. [x] **1.1 long-way rotation entering top-down** — the dive/return now flies decomposed
   `moveTo`/`rotateTo`/`dollyTo` with the azimuth held (dive) or unwrapped to the nearest
   winding (return), instead of `setLookAt`'s numeric theta tween. Verified: after 1.5
   accumulated orbit turns, the dive holds azimuth exactly (242° throughout) and the
   return lands back at the banked pose.
2. [x] **2.9** — idle delay default is now **30 s**.
3. [x] **2.13** — the auto-drift switch moved into the Idle Drift group header (right side);
   the "?" rides directly right of the title.
4. [x] **2.14** — leaving an inspection (cards closed / selection cleared) now **re-arms the
   idle timer**: the countdown starts fresh from the close instead of firing instantly
   after a long read. Verified with a 2 s delay: drift resumed only 2 s after clearing.
5. [ ] **2.15** — the wander clock and revolve azimuth are now integrated (`+= rate·dt`)
   rather than closed-form (`rate·t`), so dragging **Speed** (or Revolve s) mid-drift
   changes pace only — no position jump. Verified: continuous positions across a 1→3
   speed change.
6. [x] **2.*** — "Default Orbit" + "side-view diagram" moved to the bottom of the Orbit
   section; labels tightened: Orbit / Zoom / Move / Delay / Speed.
7. [x] **2.**** — confirmed correct: Cam v3 reads none of the shared framing fields
   (Screen Y, low-angle ground pull — nor Tilt speed / Low-angle speed / Slow below °,
   which are the same Map/Drift-only family). All five are now hidden while v3 is
   active; they still show for Map/Drift.

## Round 3 fixes (2026-07-15, responding to the Section 3 + 5 notes)

1. [x] **3.17 cone centre / commute out of frame** — a persona's frame is now centred on the
   **commute midpoint** (home↔work midline) instead of the point-mass centroid (a cluster
   of nearby family homes was dragging the centre off the commute and pushing the far end
   out). Both commute endpoints are ALWAYS inside the frame (the 1800 m radius cap that
   was clipping cross-town commutes is lifted to cover the span); connections still frame
   by percentile so one far relative doesn't zoom everything out. The orbit pivot/pin
   moves with it. Re-check with OH-630592.
2. [x] **3.21 pan hitting the outer bounds** — the limit was the EYE's pan ring: 2× the city
   ground radius, a constant — a zoomed-out cone view starts with the eye near that ring,
   so it pinned while the focal kept sliding (and the eye↔focal distance change is also
   the RMB "zoom" of 5.30). The ring now grows with the camera's current horizontal
   offset (`groundR + |eye−focal|`), so the eye never pins before the focal reaches the
   city rim. No setting needed — it scales with zoom automatically.
3. [x] **5.30 wheel zoom** — base wheel rate ×1.6, and each perspective notch now eases
   through camera-controls damping instead of landing instantly (smoothed, chains
   fluidly under fast scrolls). The Zoom slider still multiplies on top.
4. [x] **5.31 fly-to speed** — focus glide smoothTime 0.18 → 0.45 (settles in ~1.5 s); the
   ortho zoom ramp lengthened to match (0.6 → 1.2 s).
5. [x] **5.32 projection breathing** — found for the top-down case: the P toggle slides the
   dolly toward the target mode's remembered distance, and the old #84 guard only
   recognised the Top-Down MODEL — v3's in-model top-down (and an in-flight drift)
   weren't covered, so the framing bridge breathed against the sliding radius. v3 now
   signals a radius hold during both (verified: radius pinned through a full morph parked
   overhead). If you still catch a breathe outside those two states, note when — the
   remaining suspect is a morph during a focus glide.
6. [x] **"Default Orbit" removed**; "side-view diagram" relabelled **"Diagram"**. The diagram
   itself derives from the live `orbit`/`cameraLive` pose v3 writes, so it already tracks
   the new behaviours (top-down flight, drift, focus); the Map-only Screen-Y/tilt gauges
   don't render for v3. Give it an eyeball with drift + T live (it's hidden in capture
   mode, so this one needs your eyes).
7. [x] **Idle drift re-anchored to the city** — wander default 0.45 → 0.8. *(The round-3
   "wander around the centre" implementation caused the round-4 takeoff lerp and was
   reshaped again in rounds 4–5: the centre is now a BOUND, not an anchor — see Round 5.)*

## Round 4 fixes (2026-07-15, drift takeoff + clipping)

1. [x] **Big lerp at drift engage** — round 3's "wander around the city centre" was
   implemented as a blend toward the absolute wander position, which glided the focal up
   to kilometres at takeoff. The drift is now **velocity-shaped**: every rate (revolve,
   wander, bob, breathe) starts at ZERO at the current pose and builds to full speed
   over a 10 s ramp; the focal rides the wander's *velocity* from wherever it starts.
   Verified profile: first 2 s ≈ standstill (+0.1° az, +2 m focal), full speed by
   ~10 s, no jump at any sample. *(Round 4 also had a gentle pull toward the centre
   path; round 5 removed it — the centre is a bound, not an attractor.)*
2. [x] **Drift clipping through buildings** — the drifting eye now cruises above a
   **520 m altitude floor** (worst-case skyline across seeds ≈ 480 m: spire 220 × height
   jitter 1.22 × outlier 1.5 × silhouette multiplier), raised smoothly on the same ramp
   by lifting the elevation band's floor. At typical drift radii that is still a
   near-horizon 10–13° look; verified the eye climbing 160 → ~630 m and holding. Zoomed
   far out the floor is a few degrees; zoomed in tight it pitches the view down harder
   (up to the 55° band cap) — flag if that reads wrong at close range.

## Round 5 fixes (2026-07-15, tap zoom + wander bound)

1. [x] **4.27 double-tap zoom snap** — the tap/click zoom-in is now a real glide in BOTH
   projections: perspective brackets the transition in a slower smoothTime; ortho hands
   the size change to a 0.7 s eased ramp instead of the instant `setOrthoSize` (verified:
   613 → 368 over ~750 ms, smooth curve, exact 0.6×). Also de-duped: the browser
   SYNTHESIZES a `dblclick` from a double-tap, which was firing the zoom a second time on
   top of the touch handler's — the pair read as a snap. Mouse double-click gets the same
   glide.
2. [x] **Wander bound, not centre focus** — clarified intent: the drift never seeks the
   city centre; the centre only BOUNDS the roam (a disc of wanderRadius × city extent —
   the camera can't wander off the city). Round 4's gentle pull toward the centre path is
   removed; the focal rides the wander velocity freely inside the bound. Engaging outside
   the disc (e.g. parked at the rim) widens the bound to the start distance so there's no
   clamp jump. Verified: standstill takeoff, free roam, ~600 m cruise hold.

## Known / Parked

- Twist-rotate (2-finger) and 3-finger free-look on touch: deferred from the first pass.
- Touch pan is rigid in perspective (no "snow-globe" eye-backout past the city rim —
  desktop RMB keeps it).
- The EntityColumns arc-bearing math is exercised live only via a real drill (headless
  verification drove `focusRequest.viewAzimuthDeg` directly and confirmed the camera
  half: settles at the requested azimuth, 45° look-down, shortest arc).
- Capture mode (`?capture=1`) parks `cameraMode: "still"`; v3 doesn't drive there. CDP
  tests must `setCameraMode("orbit")` first (see the decision note).
