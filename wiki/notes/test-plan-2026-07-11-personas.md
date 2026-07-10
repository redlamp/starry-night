---
tags:
  - domain/procgen
  - status/active
  - type/test-plan
---

# Test Plan — 2026-07-11 Session

Covers everything landed on `fable` since the 07-10 plan's batch: the persona-perf round, round 11, district boundaries, the resident-card rework, the family-tree column chart, and the world-fiction fixes. **One server now: `bun dev` in the main tree → http://localhost:7827 (branch `fable`).** Reference results as `section.item`; check boxes track what's tested.

Reference residents: **Joseph Ortiz (9)** (rich three-generation tree), **Amanda Gonzales (39)** (giant web, exercises the 60-box trim). NOTE: the no-incest fix re-wove family/dating links once — exact names/links may have shifted from yesterday's screenshots.

## 1. Perf & Staged Generation

1. [ ] Page load: no persona hitch at boot; FPS gauge steady through the intro (idle prewarm starts ~3s after city-ready, ~5ms slices).
2. [ ] Open the directory ~15s after load — skeleton should NOT appear (prewarm done). Reload and open at ~2s — skeleton shows briefly, then populates.
3. [ ] First building click: card content (stories, traits) instant; no visible stall.
4. [ ] Re-roll seed: columns close, city + people regenerate; second re-roll of the same seed is warm.

## 2. District Boundaries

1. [ ] Hover a directory district header: outline follows the streets (no 75m stair-steps), hugging arterial centerlines.
2. [ ] Show Boundaries toggle (Districts header, and the `boundaries` switch in Settings > Districts — same flag): all districts outlined in legend colors; hovered district fills at 20% alpha; toggle survives closing the directory.
3. [ ] Pin a district: pin button sits left of the chevron, pinned state = primary tint plate; in-scene MapPin at the district centroid drawn like the building pin (no circle plate).
4. [ ] District hover moving down the list: no dead-gap flicker back to the pinned district; leaving the list reverts to pinned.
5. [ ] Settings > Districts hover highlight uses the same traced shapes (smooth fill).

## 3. Resident Card

1. [ ] Header: text-only (epithet, colored gender icon + pronouns/age/height/build · née for married name-takers, birthday, mono civic ID like `AB-123456`); all at base type size.
2. [ ] Rows aligned: fixed icon slot, labels share a left edge; values right-aligned even when wrapped to two lines.
3. [ ] Icons: In City calendar; Profession by industry (nurse → stethoscope, chef → chef hat…); Commute mode icon in its ARC color with distance on the header row; Education graduation cap (blue); Home (green) / Work (gold); Relationship hearts in pink (memorial flower for widowed, plain user for single).
4. [ ] Fly-to buttons: Home/Work/School icons move the camera WITHOUT changing the selected card; Commute icon frames both endpoints so the arc fits; Relationship icon flies to the partner's home. The district and address text links still push columns.
5. [ ] Education row links a school: current students their real school; adults an alma mater (nearest high school, when in-city through their teens).
6. [ ] Order: whyAwake up top; stats; Family (violet header, matching Employees on company cards); wasIs/detail/refusal/relation below Family; hook last.

## 4. Family Tree (columns chart)

1. [ ] Opens in column view (only view — mode buttons hidden); Lineage Colors + Gender Tint on by default.
2. [ ] Cells uniform width (names truncate); three generation-columns fit without horizontal scroll; tall charts scale down to fit (floor ~0.65) before scrolling; header/footers stay fixed — only the chart scrolls.
3. [ ] Lineage: cell BORDERS carry the line hue (blend where two lines merge); connectors match; married unions solid, dating dashed. Toggling layers never moves anything.
4. [ ] Gender tint: green men / orange women / purple other, clearly visible; icons match the palette.
5. [ ] Selection: white ring OUTSIDE the focused cell; same-window clicks move the highlight only — zero jumping, zero size change.
6. [ ] Spacing: partners and true siblings tight (8px); cousin boundaries and couples get wide air (check the Gonzales-kids / Ortiz-kids seam near Joseph); children groups centered under their parents' forks; fork lines centered in the channel, never overlapping cells.
7. [ ] Amanda Gonzales: "+N more in this line…" trim note in the footer; panel usable.
8. [ ] Bottom controls: Lineage/Gender toggles left; card show/hide right (panel icon swaps with state).

## 5. World Fiction

1. [ ] Married couples: one partner shows `née {name}` (most married women); dating couples have DIFFERENT surnames and "X & Y household" labels.
2. [ ] No related couples anywhere (spot-check trees for partner=sibling shapes; `bun scripts/personaCheck.ts` runs the exhaustive kinship gate — 17 checks).
3. [ ] Three-generation presence: grandparent couples common in multigen households; ~13% of residents show a grandparent in their tree.
4. [ ] Married daughters connect to their birth families cross-town (weave matches maiden names now).

## 6. Regression Sweep

1. [ ] `bun scripts/personaCheck.ts` 17/17 · `bun scripts/cityGolden.ts` GOLDEN PASS · `bun scripts/districtOutlineCheck.ts` PASS · `bun scripts/principalCheck.ts` PASS. *(All PASS 2026-07-11 pre-plan on fable.)*
2. [ ] Same seed → same city + people across reloads.
3. [ ] Directory search/marquee/columns, commute + employment arcs, writing lab — unchanged behaviors.

## 7. Known / Parked (don't re-report)

- Rows + Fan tree views built but hidden (behind a constant) while columns gets dialed in.
- 45–54 parenthood dip (54% vs real ~85%) — weave-linkage artifact; kids "exist offstage." Knob identified, left as is.
- Light-sprite sizing in perspective (constant size) — surveyed, fix shape designed, not built ([[light-sprite-sizing-survey]]).
- Option 3 street-loop district boundaries; worker offload; LRU caches; persona output-hash golden — parked ([[persona-gen-performance]]).
- Helicopters §6.1 from the 07-10 plan — still parked.
- `fable` is ahead of origin (unpushed session run) and ahead of `dev`/`main` — fold on signal.
