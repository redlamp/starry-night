---
tags:
  - status/open
---

# Plan: Issue Clear-Out Session (2026-07-04)

**Date:** 2026-07-03 (prepared for the 07-04 morning session) · **Open issues:** 16 · **Target:** ≤ 9 open, plus a ranked queue for what stays.

Reviewed all 16 open issues against current `main` (post camera-v2, post hybrid windows `v2026.07.03`, #54/#82 closed). Four issues describe work that is already shipped or ruled out and just need a live check to close. A second group needs a two-minute decision each, not code. One well-specced small feature is ready to build in the same session. The rest are real arcs to rank, not clear.

> **Overnight prep landed (03/07 late).** Six agents ran overnight — see [[#Overnight prep results]] below. Draft comments for 13 issues are staged in `samples/issue-clearout-2026-07-04/comments/` (one `gh issue comment N --body-file …` each — posting was intentionally deferred to the session), #69 is **already built** on `feat/archetype-hover` (commit `e5bb580`, worktree `C:\workspace\sn-hover`), and verification captures for #79/#68/#69 are in the same samples folder.

## Agenda

| Slot | Time | What |
| --- | --- | --- |
| 1. Verify-and-close sweep | ~30 min | #79, #61, #53, #43 — live check, then close |
| 2. Decision batch | ~20 min | #77, #68, #67, #57 + survey git-hygiene leftovers |
| 3. Build slot | ~90 min | #69 hover-highlight (recommended) or #71 CRT scanlines |
| 4. Rank the arcs | ~10 min | #70, #73+#74, #72, #56, #60 — pick next-up |

## 1. Verify-and-close sweep

**#79 — Top-down fit-to-content framing.** Already implemented — but (overnight correction) the shipped path is `TopDownModel.tsx:25-27/:49-62` via the `t` hotkey, not `cameraView.ts`'s `topDownFraming()`, which is unreached from the UI (housekeeping carry-over: two parallel implementations). Verified overnight with 6 captures (tier 3+6 × two aspects × both projections, store readbacks match the fit maths exactly — `topdown-*.png` in the samples folder). One real-but-benign nuance found: in portrait the `aspectFraming.ts:24` exemption gate misses the model path, so the margin inflates 1.15×→~1.6× (never clips; one-line fix). And it frames the *gen extent*, not the crop — #56's territory. **Check:** one live `t` keypress (the tween itself wasn't exercised). **Then:** close; carry the portrait one-liner + dead-path housekeeping into #56 or fix inline.

**#61 — Frame drops while dragging.** Two of three suspects already resolved: tile-cull recompaction ruled out by profiling (1.33% of frames under drift-orbit, `f0b25ba`), uniform uploads write-gated (`759b94f`). Filed pre-camera-v2; the drag path has since been rewritten. **Check:** live drag on the 3080 Ti, default scene. **Then:** close if smooth; if not, the two remaining scripted tests are in the issue comment (stars → 5k, HUD re-render frequency).

**#53 — Device-adaptive quality.** Both halves shipped: boot device-fit runs unconditionally (`applyDeviceFit`), the runtime ramp exists behind the Performance-panel toggle / `?adaptive`. The 2026-07-02 decision keeps the ramp default-off. What the issue asked for is done; what remains is a *different, narrower* task. **Then:** close; file a follow-up "verify adaptive ramp on-device (Pixel 6 Plus); decide the mobile default" so the phone session doesn't keep a broad issue open.

**#43 — THREE.Clock deprecation.** Upstream-gated: R3F 9.6.1 still uses `THREE.Clock`, v10 is alpha-only (checked 2026-07-02). Dev-console-only, zero product impact, nothing actionable on our side. **Then:** recommend close with a re-open trigger noted ("re-check when R3F 10 stable ships"); keep only if you want an upstream tracker pinned.

## 2. Decision batch (no code, ~5 min each)

- **#77 — intro boot cascade timing.** Exploration issue, needs eyes not analysis. Watch one tier-6 boot together; either tune on the spot or close as "feels right."
- **#68 — floor/column pitch multipliers.** Deliberately parked "until the grid density feels wrong." Gut-check on the current city: if density still reads well, close as parked — the full design (sliders, gen-input pattern, x1 = byte-identical) is preserved in the issue and re-opening is one click.
- **#67 — planes.** Blocked on a scale-approach pick, not effort. Decide between the three options (approach/departure theatre is the natural fit — the airport-corridor framing justifies low altitude for free) or explicitly park. No code tomorrow.
- **#57 — traffic per-segment streams.** Self-labelled "low priority — pure sparkle." Confirm parked; keep open as the crop-invariance ledger entry.
- **Survey leftovers** ([[fable-codebase-survey-2026-07-02]]): the only unworked items are git hygiene — `feature/road-reveal` (15 unmerged commits), delete merged `origin/feat/drei-camera-tuning`, add a CI typecheck/lint/build gate. Decide: do the branch cleanup live (~10 min) and file the CI gate as an issue.

## 3. Build slot — #69 is already built; this becomes a review + visual pass (~30–45 min)

**#69 — hover archetype → highlight buildings in-world** was implemented overnight on `feat/archetype-hover` (commit `e5bb580`, worktree `C:\workspace\sn-hover`). Typecheck, lint, and gate1 pass; CDP stills confirm correct per-archetype selection (office-block and spire hovers flip the right meshes). Tomorrow: review the diff (4 files, +59), run it live, and settle the visual-pass questions — (a) brighten+dim (current: 1.8× lift / 0.7× dim) vs a subtle palette-accent tint, (b) the 150 ms ease trajectory: the single-float encoding passes through the dim value mid-flight on idle→hover, which may read as a tiny dip, (c) live hover feel in the panel. Merge to `fable` on approval.

**Alternative extra build if time remains: #71 — CRT scanline mask.** Overnight status correction: a display-time scanline term already shipped in `73c0172` (slider wired, default 0.6); the staged plan (comments/71.md) is the 2×-native masked pass + pixel grid + default drop to ~0.15. Est. 1–2 h + reference-photo tuning.

## 4. Rank the arcs (keep open, order them)

Current suggested order:

1. **#70 — crop as tile operation + wake-by-light.** Perf + a signature After-Dark moment ("power grid boots up"); the #55 tile tooling it builds on is in place. Natural next headline arc. Overnight finding that raises its value: a crop notch today doesn't just rebuild the render — it flips `useGeneratedCity`'s ready gate and **replays the full intro cascade**. Staged 3-stage plan in comments/70.md (~2–3 days total; the radius-sorted-prefix trick makes crop membership a per-tile slice).
2. **#56 — camera + look follow the crop.** Standalone — overnight correction: #54 closed 2026-07-02 as *superseded* (fog went world-absolute and default-off in `8e79a2f`), not implemented, so there is no fog co-tuning to schedule. Do **after #70 stage 1** so framing tunes against a crop that no longer rebuilds the world. Plan in comments/56.md (`displayedRadius()` helper; several constants moved post-camera-v2; boot hero pose is a design call). Picks up #79's portrait one-liner + dead-path check.
3. **#73 + #74 — Mac GLB optimization + matte molding.** Do together (the issues already say so); the unblock path for #73 is defined (transform-agnostic screen clone → 5× size win). Intro-asset arc.
4. **#72 — studio lighting + light/dark theme toggle.** Intro polish; dark mode mostly exists via the HDR glow chain, the work is stage lighting per mode + transition.
5. **#60 — /build pipeline stepper.** Keep parked: cheapest built on top of a staged-pipeline refactor that hasn't happened.

## Expected outcome

- **Closes:** #79, #61, #53, #43 from slot 1; likely #77 and/or #68 from slot 2 → 16 → ~9–10 open.
- **New (narrow) issues:** adaptive-ramp phone verification (body staged in comments/53-followup-issue.md); CI gate.
- **Shipped:** #69 reviewed, visually approved, merged.
- **Ranked queue** for the remaining arcs, with #70 (or #70+#56) as the next headline.

## Overnight prep results

Six agents ran 2026-07-03 late. Everything below is staged, nothing posted or merged.

**Staged draft comments** — `samples/issue-clearout-2026-07-04/comments/` (gitignored). One file per issue: `79 61 53-close 53-followup-issue 43-close 68 77 57 67 69 70 56 71 72 73 74`. Reviewed for style (plain hyphens, neutral verbs, file:line grounded). Post each approved one with `gh issue comment <n> --body-file samples/issue-clearout-2026-07-04/comments/<n>.md`.

**Built** — #69 on `feat/archetype-hover` (`e5bb580`, worktree `C:\workspace\sn-hover`): store runtime tier + panel pointerenter/leave + per-mesh eased `uHighlight` + `highlightMul()` after the debug tint. typecheck/lint/gate1 pass. Diff reviewed; captures `69-hover-*.png`.

**Verification evidence** — `topdown-*.png` (6 poses, #79), `68-facade-*.png` (3 ranges, #68), plus reusable probe scripts `topdownCaptures.ts` / `starDragSensitivity.ts` in the samples folder.

**New findings for the session (not in any issue yet):**

1. `DEFAULT_STARS.count` 120000 vs `QUALITY_TIERS` high/ultra `starCount` 24000 with a stale "matches" comment (`sceneDefaults.ts:43-47,154`) — one-line reconcile, either direction.
2. Top-down portrait margin inflates 1.15×→~1.6× (`aspectFraming.ts:24` gate misses the model path) — one-line fix, or fold into #56.
3. Two parallel top-down implementations: shipped `TopDownModel.tsx` vs unreached `cameraView.ts` tab path (`setCameraTab`/`enterTopDownMode`) — verify dead, then retire or unify.
4. Crop notch replays the full intro (`useGeneratedCity` keys on scale) — fixed by #70 stage 1; worth knowing before any live crop demo.
5. Measured: pure gen at tier 6 is ~0.8 s (`profileGen.ts`); the 8–10 s boot is worker round-trip + atlas/data-texture builds + instancing upload + shader compile — reframes #77's tuning options.
