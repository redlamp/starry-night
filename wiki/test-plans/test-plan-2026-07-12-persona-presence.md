---
tags:
  - domain/narrative
  - status/draft
---

# Test Plan — Persona Presence & Editorial (2026-07-12)

Two live surfaces on two dev servers (uncommitted work on two branches):

| Section | Server | Branch / tree |
|---|---|---|
| 1–5 Appearance (unit highlights) | **http://localhost:7827** | `feat/persona-units` (main tree) |
| 6 Writing lab | **http://localhost:7828/writing-lab** | `worktree-agent-a50686cb9b45bc7d9` (isolated worktree) |

The unit highlight is a **volumetric cube** in a brighter tone of the building's (district) selection colour, drawn x-ray (shows through nearer buildings), glued to the building and **bay-aligned to the window grid**. Corner units wrap the corner. Only **real tenants** show — households scattered by unit letter, businesses sized by headcount. Regions come from `lib/seed/tenancyLayout.ts` on a fresh seed stream (determinism untouched — personaCheck 17/17). *(1–5 below were the first pass; 7 is the re-test after the 2026-07-12 fixes.)*

## 1 Unit highlight from a building card

1. [ ] Open a building's card (click a building → drill into occupants). Hover a **resident** row → that household's unit lights up on the building as a cube.
2. [ ] Hover a **company** row → that business's unit/floor lights up.
3. [ ] Move between rows → the highlight follows; move off the list → it clears.
4. [ ] Select a resident (from directory/marquee) → their **home** unit lights up (no card hover needed).
5. [x] Confirm the old "big sphere dot" at the commute-arc ends is **gone**.

## 2 Focused-building hover (the inverse)

6. [ ] Focus a building (double-click it, or the Focus button on its card). Sweep the cursor over the facade → the unit **under the pointer** highlights, updating as you move.
7. [x] Hovering the roof/base (not a facade unit) → no highlight.
8. [x] With a foreground building between camera and the focused one, hovering the occluder does **not** highlight through it.

## 3 Volumetric units — depth & corner wrap

9. [x] A highlighted unit reads as a **cube with depth** (extends into the building), not a flat panel on one face.
10. [x] A **corner** unit wraps around the corner (windows on two faces).
11. [x] Unit size/brightness reads well at the focus distance (feedback welcome — may want brighter edges or a size tweak).

## 4 Whole-building enclosure

12. [ ] A single-use building (school, factory/warehouse) highlights as a **closed cube that surrounds the building, including a visible bottom** (not open walls).

## 5 Full-height spread

13. [ ] Focus a **spire / tall office tower** → units highlight across the **full height**, not only the bottom floors.
14. [ ] Focus a **residential tower** → residences spread up the tower; ground-floor shops (in a shop district); penthouse on top of tall core towers.
15. [ ] Filler units (no named tenant) read **dimmer** than featured ones; featured ones (from cards) are the nameable/selectable subset.

## 6 Writing lab (http://localhost:7828/writing-lab)

16. [x] A **Writing Lab** button appears in the control dock (bottom bar) on the main app and opens the lab in a new tab. *(Relocate if you'd prefer it elsewhere.)*
17. [ ] Search by a content **id** (`poolId~ordinal` or `poolId~key`) resolves to that entry; the id shows as a mono badge on rows/results.
18. [x] **Sort** by id / content / author / status / created / updated, both directions.
19. [x] **Checkboxes** + select-all + batch bar: bulk author/status/duplicate/delete.
20. [x] **Duplicate** a row (+1, new id) → **Delete** it (back to baseline).
21. [ ] **Download** metadata JSON and a pool as TS; **Import** them back (merge, round-trips).
22. [ ] Guarded export: editing a line's **wording** ships; a **cut / reorder / added / changed-slot-token** edit is **blocked** with a reason (protects determinism).

## 7 Round 2 — re-test after 2026-07-12 fixes (`:7827`)

23. [x] Units are **bay-aligned** to the window grid (the cube's outward face sits on the windows).
24. [ ] Businesses **sized by headcount** — a big employer fills a full floor (or several); small ones a bay-span.
25. [x] Households **scattered by unit letter → corner** on their real floor (1A and 2B don't stack in a column).
26. [ ] **Click** a highlighted unit → selects that tenant (pushes their resident/company card).
27. [ ] Click works from **any face**, including far-side units (rotate the camera if one is fully occluded).
28. [x] Focused building shows **all its units translucent**; the hovered one brightens.
29. [ ] Highlight colour is a **brighter tone of the building's (district) selection colour**.
30. [ ] Whole-building enclosure's **bottom ring lifts off the road** and wraps the base visibly.
31. [x] Focused building **occludes background hover** — buildings/roads behind it stay dark while focused.
32. [x] **Select through the ceiling** works (no roof/base dead-zone).
33. [x] Only **real tenants** highlight — no filler.

## Follow-ups / to revisit
- **Far-side units:** a fully-occluded unit needs a small camera rotation to click (the raycast picks the nearest along the ray).
- **5.14 residential tower:** need a known seed/spot to verify residential spread + penthouse behaviour.
- **Multi-floor department store** anchor (downtown) still deferred — ground commerce is per-unit storefronts for now.
- **Story-slot provenance capture** — scaffolded `TODO(story-slot-capture)`; the determinism-gated wiring into `personaStory.ts` is pending (mine).
- **Writing lab (agent in progress, `:7828` — changes hot-reload as it works):** the 6 items are being reworked — string ids → short **stable hash** (17), **shadcn** checkboxes/controls, search **X-to-clear**, Draft/Review/Final/Cut summary **under the header**, **sort control above the list**, **always-visible batch bar** (drop "Mark All Reviewed/Final"), **one Import** (auto-detect ts/json) / **one Export** (TS/JSON dropdown), **lucide author icons** + clarify "edited" (= AI draft, human-edited), dropdown **colour-dot alignment**. Re-test 6 after it lands.
- **22 clarified:** editing a line's *wording* ships; structural edits (cut / reorder / add / changed random-draw token) are blocked to protect the seeded draws.
- Nothing merged/pushed — appearance on `feat/persona-units`, lab on its worktree branch.
