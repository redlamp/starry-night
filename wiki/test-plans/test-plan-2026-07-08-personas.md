---
tags:
  - domain/procgen
  - status/open
  - type/test-plan
---

# Test Plan — Persona System Review (2026-07-08)

Human review pass for the overnight + morning work, now merged to `dev` (b5d7e34). Ordered as one natural walkthrough. **⚖ = feel judgment only you can make** (automation can't); each has its tuning knob listed. Automated gates already green on the merged result: typecheck, lint, `personaCheck` (15/15: determinism, reciprocal links, no template-slot leaks), `heliSplineCheck`, `cityGolden` (city geometry byte-identical).

**Setup**: `bun dev` in the main tree → http://localhost:7827 (or the still-running worktree server :7911 — same code now). Default seed `starry-night` = Havenwood.

## 1. First contact — building drill

- [x] Press `I` (inspect), click any mid-rise. Columns open top-left: [District, Building]. Headers aligned; long names wrap on the title row, never crop.
- [x] Building card: address + district link, stats, **Occupants** split into Companies / Residents, a sift line when the building has a story pattern ("Half this building works nights…").
- [x] Click a resident → persona column. Check the sheet order ends on the hook (italic, left-barred). Read 5–10 sheets: **⚖ the fanfic test** — do any make you invent a story? (If sheets feel samey, pools grow in `/writing-lab`.)
- [x] Hover the three trait badges → shadcn hover cards (sun sign incl. birthday, Chinese animal + element + year, MBTI nickname + read).
- [x] Click Partner / family rows / the relation line → new persona columns push right. Back/Forward walk the trail; forward history survives until you branch.

## 2. Column views

- [x] Cycle the view button: **Side by Side** (flat, all interactive — clicking in an *earlier* column should branch the path from there), **3D Deck**, **Collapsed** ("· N behind").
- [x] **⚖ Deck feel**: tilt direction/strength (knob: `EntityColumns.tsx` `rotateY(${Math.min(26, 11 + depth * 4)}` + `perspective(1200px)`), tab sliver height (`maxHeight: "14rem"`), the 200 ms expand/collapse height tween. No clipping top/bottom; slivers fade out, never shear mid-line.
- [x] Long drill (6+ columns): horizontal scrollbar appears **above** the row; **⚖ mouse-wheel pans the row horizontally while hovering** — does it fight page scroll anywhere?
- [x] Width caps against the settings drawer: open settings, resize it — the column row should reflow live.
- [x] Esc closes the stack; click empty ground closes it; reroll seed closes it.

## 3. Arcs & the cone

- [x] Select an employed persona: thick commute arc home→work, color = mode (teal walk / green cycle / blue transit / amber drive / **yellow school bus** — find a kid). Commute row matches the color dot; transit names the line ("Rides the Crosstown Line").
- [x] Thin violet arcs to partner/family/relation homes.
- [x] Open a company (via a building's Companies list): violet **employment arcs** fan from the workplace to every staff home. A school shows its catchment.
- [x] Cone button: single click = frames everything the card touches, **filling the frame** (not the 33% rule). **⚖ Is the p85-radius framing right** when one employee lives across town? (knobs: `showLocations` in `EntityColumns.tsx` — percentile 0.85, cap 1800.)
- [x] Cone lit = **follow mode**: hop persona→persona and the camera re-frames each time. **⚖ Glide cadence** — too eager on fast hops? (Debounce is an easy add.)
- [x] Double-click a building (or the Focus pin): 45° look-down settle, building ≈ a third of display height. **⚖ Angle + size feel** (knobs: `StarryNightV2Model.tsx` `Math.PI / 4`, `FOCUS_HEIGHT_FRACTION = 0.33`).

## 4. Streets & districts

- [x] In inspect, hover a road: name chip + x-ray highlight + building count. **⚖ Hover feel** (10 Hz eval; chip follows the ground point).
- [x] *Click* a road: street column (tier, districts crossed, buildings in address order, companies, people). Confirm a click near a building does NOT steal the stack (building wins), and a street click with a stack open *joins* the drill rather than replacing it.
- [x] Street column topmost = whole polyline highlighted in scene.
- [x] District column: stats, streets list (expandable "+N more"), landmarks. Read a dozen names across 2–3 seed rerolls: **⚖ do districts/streets/buildings/businesses read like a real city?** Watch for the naming-fallback tell ("The Chestnut Apartments 2").

## 5. City Directory (settings drawer)

- [x] Settings → City Directory: stats line, Resident of the Night (seeded; Next steps deterministically), name search over ~20k residents, district → building browse tree. Clicks land in the columns system.

## 6. Schools & world coherence spot-checks

- [x] Find a kid (any family household): "Student · {school}" row, walk or bus commute, arc lands on the school. Elementary should be same-district (short arc).
- [x] Open the school's company card: staff + students lists, students expandable.
- [ ] **⚖ Judgment calls parked for you**: a daycare employing 3 "School Principals" (no role caps — fix is cheap); school staff living far from their school (home-proximity preference is an option); domain-word repetition ("the one with the ferns" + a ferns hook on one sheet = intended Grinblat effect — does it read as charming or mechanical?).

## 7. Writing lab — /writing-lab

- [ ] Sidebar: groups collapsed by default, color dots per group, expand/collapse-all + locate toolbar, pool filter, progress bars. **⚖ Drag the sidebar divider** and the Author/Status column edges (synthetic tests can't verify drag feel).
- [ ] Edit a line (Enter saves): author flips AI→Edited, Modified dot + Revert appears. Set statuses; Cut strikes the row. Bulk buttons advance a pool. Reload the page — everything persisted.
- [ ] Global search ("ferry") → result jumps to pool + flash-highlights the row.
- [ ] "How It Works" dialog reads correctly; theme toggle switches light/gray/dark (and matches the main app's setting — they share storage).
- [ ] Export: Copy Pool as TS → paste somewhere and eyeball it's a valid array with cuts dropped.
- [ ] **⚖ The real test: triage one pool end-to-end** (suggest Hooks · Generic, 10 entries) — is the review loop pleasant enough that you'd finish all 947?

## 8. Helicopters (#89 v3)

- [x] Settings → Debug → Heli Routes: smooth curved tours, no polygonal corners at stops, tight pad orbits. **⚖ Watch one helicopter fly a full leg**: banking read, climb-out/descend arc between rooftops (knobs: `SPLINE_SAMPLES_PER_HOP`, `CLIMB_*` in `helicopters.ts`).

## 9. Regressions (my changes touched shared surfaces)

- [ ] Settings drawer still resizes + scrolls correctly (scroll-area fix moved every scrollbar inside its panel — check the drawer + directory tree scrollbars).
- [ ] Old inspect flows: double-click focus, pin, district outline, hover pick — unchanged.
- [ ] Reroll seed several times: no console errors, columns close, city + personas regenerate coherently.
- [ ] `?capture=1` still hides HUD (capture pipeline untouched).
- [ ] Perf: first building click after load pays the one-time directory build (~0.5 s worst case) — acceptable? (Worker offload is the queued fix.)

## Filing results

Small tweaks (knob turns): tell me the number that felt wrong. Content verdicts: mark lines in `/writing-lab` (that's its job). Anything structural → new issue with the `city-gen` label.
