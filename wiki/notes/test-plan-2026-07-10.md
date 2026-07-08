---
tags:
  - domain/procgen
  - status/active
  - type/test-plan
---

# Test Plan — 2026-07-10 Session

Covers everything shipped after the 07-08 morning merge (rounds 5-9: directory rework, family tree v3-v5, schools fixes, helicopter v4). Dev server: the feat/personas worktree (`:7911`). Prior plan's parts 1-5 responses are folded in; parts 6+8 responses landed 07-08 evening. Numbered so responses can reference `section.item`.

## 1. City Directory

1. Open via the top-left book button. Masthead: city name in caps, icon stats under it (hover the icons — tooltips say Residents / Businesses).
2. Marquee: names drift slowly under the masthead; hovering pauses the strip and opens a hover card (epithet, meta, hook); clicking opens that persona's column. Edge fade on both sides.
3. Search: type 2+ letters — results replace the district browse, scroll within their own area (up to 50), search field + filter tabs stay pinned. Building results show aligned address numbers.
4. Filter tabs: "All" is a word, the four kinds are icons with tooltips. Filtering narrows results by kind.
5. Districts: sort select (By Residents / Roads / Businesses / Name); every row shows all three counts un-truncated; single chevron; whole header expands.
6. Address alignment: in district building lists, search results, and a street column's building walk — "9" and "1203" should right-align so street names line up (same typeface, tabular digits).

## 2. District Pins & Borders

1. Hover a district header — its true perimeter traces on the map in the district color, through buildings.
2. Click the pin — highlight sticks, camera glides to a 45° look-down over the district. Pin renders in district color; when pinned it sits on a contrasting near-black/near-white plate.
3. Click the same pin again — unpins. Pin another district — highlight moves. Close the directory — border clears.
4. While a district is pinned, hover other headers — hovered border previews, releases back to the pinned one.

## 3. Family Tree

1. Open from a persona sheet's Family header (network icon). Two surfaces side by side: tree panel + the SAME card the columns dock uses (kind chip, pinned stats, scrolling body).
2. Hourglass reading: both partners' ancestries above (grandparent couples → parent couples), siblings flanking the couple, children/grandchildren below. Union lines between partners; children hang from the union's midpoint; connectors clearly visible.
3. **Consistency**: click the focus's partner — the chart should NOT restructure; identical layout, highlight moves. Couple order is man-left/woman-right, stable seeded order for same-gender couples.
4. Dotted in-laws: descendants' partners sit on the OUTSIDE of the row halves, joined by a dotted line; their shared kids hang from that dotted union. Blood lines stay solid.
5. Entry point: the person you opened from carries a pin glyph; "Back to {name} ⤺" sits right-aligned in the title bar after re-rooting.
6. Stability: re-root across several members — the panels keep the same top Y and the tree panel holds its minimum size (only genuinely big families grow it).
7. "Open Full Card" (expand icon on the card header) closes the dialog and pushes the persona column.

## 4. Schools & Households

1. School card: "AGE" header above the student ages; staff rows with long name+title stack to two lines.
2. Building card: "Age" header above resident ages in household lists.
3. Principals: spot-check several schools/daycares — at most ONE School Principal anywhere (`bun scripts/principalCheck.ts` for the exhaustive check).

## 5. Columns Regressions

1. Card bodies scroll when lists expand past ~60vh (viewport-cap fix — previously clipped silently).
2. Deck / side / collapsed views still cycle; deck tabs tween; wheel over cards scrolls the card, over gaps pans the row.
3. Arcs: commute + connection arcs on persona; employment arcs on buildings/companies; visible at any zoom.
4. Columns dock slides right when the directory opens (now 336px wide).

## 6. Helicopters (v4)

1. Ambient patrols: watch one land — it should stay high until over the pad, descend vertically (slow), orbit, hold; departures rise vertically off the pad before heading out. Fly-throughs skip all of that.
2. Debug panel spawns: consecutive spawns ride DIFFERENT routes (12 slots cycling all 10 ambient routes), not copies of one.
3. Feel check: is 3.5 m/s vertical + 12-22 m lift enough "event", or should landings get a pad-hover pause?

## 7. Regression Sweep

1. Same seed → same city, same people (reload twice, compare a few names). NOTE: vs 07-08 the population is a one-time full re-roll — the multi-household round (#93) rebuilt households (~39.4k residents), and doubling the surname pool re-rolled procedural street/district NAMES too (same geometry, new labels). Expected, once.
2. Multi-household: expand a district — buildings list up to 8 hh; a tower card shows several households with right-aligned units. Companies: spot-check that 0-staff businesses are now rare (3%).
2. `bun scripts/cityGolden.ts` GOLDEN PASS; `bun scripts/personaCheck.ts` 15/15; `bun scripts/heliSplineCheck.ts` PASS.
3. Writing lab (`/writing-lab`) untouched by this batch — loads, edits persist, export works.
4. Perf: directory open + columns + arcs at 6 km tier — watch the FPS gauge for regressions.

## 8. Known / Parked (don't re-report)

- Every building = 1 household (#93, queued — the big one).
- Regional street naming #90, bus-route mapping #91, company registry #92.
- Family tree: adoption/step dashed lines await generator support (#93 territory); dating vs married unions render the same solid line.
- Marquee names are tab-stops in both copies (minor a11y duplication).
- School staff home-proximity not enforced; naming fallback "Apartments 2".
