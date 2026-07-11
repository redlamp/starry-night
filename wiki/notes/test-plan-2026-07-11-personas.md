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

1. [x] Page load: no persona hitch at boot; FPS gauge steady through the intro (idle prewarm starts ~3s after city-ready, ~5ms slices).
2. [x] Open the directory ~15s after load — skeleton should NOT appear (prewarm done). Reload and open at ~2s — skeleton shows briefly, then populates.
3. [x] First building click: card content (stories, traits) instant; no visible stall.
4. [x] Re-roll seed: columns close, city + people regenerate; second re-roll of the same seed is warm.

## 2. District Boundaries

1. [x] Hover a directory district header: outline follows the streets (no 75m stair-steps), hugging arterial centerlines.
2. [x] Show Boundaries toggle (Districts header, and the `boundaries` switch in Settings > Districts — same flag): all districts outlined in legend colors; hovered district fills at 20% alpha; toggle survives closing the directory.
3. [x] Pin a district: pin button sits left of the chevron, pinned state = primary tint plate; in-scene MapPin at the district centroid drawn like the building pin (no circle plate).
4. [x] District hover moving down the list: no dead-gap flicker back to the pinned district; leaving the list reverts to pinned.
5. [x] Settings > Districts hover highlight uses the same traced shapes (smooth fill).

## 3. Resident Card

1. [x] Header: text-only (epithet, colored gender icon + pronouns/age/height/build · née for married name-takers, birthday, mono civic ID like `AB-123456`); all at base type size.
2. [x] Rows aligned: fixed icon slot, labels share a left edge; values right-aligned even when wrapped to two lines.
3. [x] Icons: In City calendar; Profession by industry (nurse → stethoscope, chef → chef hat…); Commute mode icon in its ARC color with distance on the header row; Education graduation cap (blue); Home (green) / Work (gold); Relationship hearts in pink (memorial flower for widowed, plain user for single).
4. [ ] Fly-to buttons: Home/Work/School icons move the camera WITHOUT changing the selected card; Commute icon frames both endpoints so the arc fits; Relationship icon flies to the partner's home. The district and address text links still push columns.
5. [x] Education row links a school: current students their real school; adults an alma mater (nearest high school, when in-city through their teens).
6. [x] Order: whyAwake up top; stats; Family (violet header, matching Employees on company cards); wasIs/detail/refusal/relation below Family; hook last.

## 4. Family Tree (columns chart)

1. [x] Opens in column view (only view — mode buttons hidden); Lineage Colors + Gender Tint on by default.
2. [ ] Cells uniform width (names truncate); the chart NEVER scales — the CARD grows to fit the full-size tree (up to 85vh), oversized generations trim into "+N more" instead of scrolling. NO scrollbar on any tree (verified via Playwright: scrollHeight === clientHeight, both axes, on Amanda); header fixed, footer/controls pinned to the card's BOTTOM even for short trees.
3. [x] Lineage: cell BORDERS carry the line hue (blend where two lines merge); connectors match; couples connect via a visible genogram BRACKET outside the boxes (stubs + marriage bar — married solid, dating dashed; check a dating couple reads clearly). Toggling layers never moves anything.
4. [x] Gender tint: green men / orange women / purple other, clearly visible; icons match the palette and follow lived gender (Mars/Venus for trans men/women; NonBinary keeps its glyph).
5. [x] Selection: white ring OUTSIDE the focused cell; same-window clicks move the highlight only — zero jumping, zero size change.
6. [x] Spacing: partners and true siblings tight (8px); cousin boundaries and couples get wide air (check the Gonzales-kids / Ortiz-kids seam near Joseph); children groups centered under their parents' forks; fork lines centered in the channel, never overlapping cells.
7. [ ] Amanda Gonzales: "+N more in this line…" trim note in the footer; panel usable.
8. [x] Bottom controls: Lineage/Gender toggles left; card show/hide right (panel icon swaps with state).
9. [x] Clicking the scrim (outside the tree/card, including the gap between the two panels) closes the dialog.
10. [x] Resident card details break between CONCEPTS, never mid-phrase: Profession = title / employer lines; Education = level / subject / institution / linked school lines.

## 5. World Fiction

1. [x] Married couples: one partner shows `née {name}` (most married women); dating couples have DIFFERENT surnames and "X & Y household" labels.
2. [x] No related couples anywhere (spot-check trees for partner=sibling shapes; `bun scripts/personaCheck.ts` runs the exhaustive kinship gate — 17 checks).
3. [x] Three-generation presence: grandparent couples common in multigen households; ~13% of residents show a grandparent in their tree.
4. [x] Married daughters connect to their birth families cross-town (weave matches maiden names now).

## 6. Regression Sweep

1. [ ] `bun scripts/personaCheck.ts` 17/17 · `bun scripts/cityGolden.ts` GOLDEN PASS · `bun scripts/districtOutlineCheck.ts` PASS · `bun scripts/principalCheck.ts` PASS. *(All PASS 2026-07-11 pre-plan on fable.)*
2. [ ] Same seed → same city + people across reloads.
3. [ ] Directory search/marquee/columns, commute + employment arcs, writing lab — unchanged behaviors.

## 7. Round 2 — feedback build (same day)

Everything below landed after the morning pass; items 3.4/4.2 from above are superseded here.

1. [ ] Directory build progress: reload, open the directory within ~2s — a primary-colored ring traces the panel border as city details generate, then disappears at 100% (1.*).
2. [ ] Tooltips: dock buttons (Directory/Inspect/Resume), the "?" camera guide, and the Settings > Districts/Density switches all show shadcn tooltips, Title Case action names — no native browser tooltips anywhere.
3. [ ] Settings > Districts row hover now draws the SAME map effect as directory hover: street-traced outline + 20% fill (with Show Boundaries on); District Shells brighten still works when the shells overlay is on (2.5).
4. [ ] Resident card header: name larger (text-lg) with `née X` as secondary text beside it; epithet, then a two-column fact grid (1.25fr/1fr, label left / value right, never wraps): Gender|Age, DOB|Time, Height|T-Shirt, ID|In City. In City lives here now, NOT in the Details rows. Name, dates, and ID text-selectable (3.*, 3.1, 3.6).
5. [x] Badges: `♐ Sag`-style 3-letter western sign; Chinese sign = element emoji + animal emoji only (🔥 🐍); MBTI unchanged text but all three badges one size larger (3.6).
6. [x] Row order: In City → Home → Commute → Work (Profession + Work rows, adults) → Education → Relationship. Current students get ONE blue School row under the Education slot (district / address / school link) and no Profession/Work rows (3.**).
7. [x] Fly-to tooltips appear INSTANTLY on hover (3.4).
8. [x] Alma mater = highest education: degree-holders link **the university/college campus** (two real campuses now exist as buildings — the university and college carry the city's names); HS-only residents keep the nearest high school; campuses enroll the adult students (~66) with commute arcs (3.5).
9. [x] Details + Family are collapsible; collapse state survives switching residents/columns. whyAwake now reads BELOW Details + Family, before the flavour prose (3.6).
10. [x] No stat value ever wraps mid-phrase beside its label — when it can't fit, it drops whole to its own right-aligned line (applies to all card kinds via ColumnStat too).
11. [ ] Family tree = infinite canvas (4.2): drag pans, wheel/pinch zooms (anchored under cursor/fingers), release snaps the nearest generation column flush, double-click re-fits, a drag never selects a person. Small trees still grow the card exactly to fit; big trees open fitted-to-view. No scrollbars anywhere. Per-generation trim is GONE — only the global box cap still writes "+N more" (supersedes 4.2/4.7 above).
12. [x] Open Full Card (tree side panel) uses the square-arrow-out icon and selects that person in the columns (4.10/4.*); the tree's side card is the same card as the inspector (same header/grid/collapsibles).
13. [x] Minors (under 18): NO Relationship row (their family role reads in the Family section instead).
14. [x] Family header: tree icon immediately LEFT of the chevron, chevron far right; clicking the tree icon opens the dialog WITHOUT toggling the Family section; no Base UI console errors.
15. [x] Astrology: badges show emoji-sized sign glyphs + 2-letter abbreviations (`♎️ Li`), larger Chinese emojis; the zodiac hover card marks the big three with ☀️/🌙/🌅 + sign emoji, sub head ("the inner weather" / "the first impression") on its OWN line under each heading, then a per-sign one-liner (new MOON_SIGN_TRAITS / RISING_SIGN_TRAITS pools). Chinese hover card: header → `born {year}` → animal-emoji + year description → element-emoji + element description. Hover cards read at text-base.
16. [ ] Fly-to framing with cards open: Fly Home/Work/School/Partner and Show Commute land the target centered in the space RIGHT of the open cards (verified: pin at the free region's center ±15px); closing the columns clears the framing bias.
17. [x] Birth time is exact (`8:34 AM`, no `~`) — minutes drawn at the flavor stream's tail, so no other trait re-rolled.

## 7b. Round 3 — evening feedback build (supersedes R2 items 1, 3, 4, 11, 16)

1. [ ] Family tree fills the WHOLE panel; header + footer hover over the chart on soft gradient scrims; drag/pinch works everywhere including through the gradients (only the actual controls catch clicks).
2. [x] Zoomed tree text is CRISP once the gesture settles (no rasterized blur — will-change removed).
3. [x] Desktop: plain wheel PANS the tree (shift = horizontal), Ctrl/Cmd+wheel (and trackpad pinch) zooms, double-click refits; touch pinch unchanged.
4. [x] Resident card: ONE Work row (green = money) — profession-category icon + title, then employer/district/address lines; Home is orange (hearth). No separate Profession row.
5. [ ] DOB reads `Oct 19, 1980 · 7:31 PM` on one spanning row (Time cell gone).
6. [x] Married name-takers read `born {Name}` in the header (née retired).
7. [ ] Focus centering: EVERY focus (fly-tos, address links, cone, district pin) centers the target in the space right of directory + cards — measured one frame AFTER the click, so a click that pushes a new card accounts for that card's width. Settings drawer intentionally not counted.
8. [x] Build progress: conic ring around the round City Directory DOCK BUTTON during city-details generation (faint track + primary arc), gone at 100%; the panel-border ring also remains.
9. [x] Settings show/hide buttons have shadcn tooltips ("Show Settings" / "Hide Settings").
10. [ ] District hover (directory or settings list): THICK 3px full-color outline (Line2 fat lines) + ~22% translucent full-color fill, with Show Boundaries ON or OFF. Pinned district keeps the thick outline, no fill.

## 7c. Round 3 follow-ups (final build of the day)

1. [ ] Tree footer "?" shows the nav cheat-sheet (drag/scroll pan, shift sideways, ctrl/cmd+scroll or pinch zoom, double-click reset, click to re-root); double-click reset TWEENS home (~280ms ease-out, any gesture cancels it).
2. [ ] DOB and Time are two separate grid fields again (kept as seeded numbers, not a Date object — timezone semantics don't belong in the fiction).
3. [ ] Long name + maiden combos drop "born" and read `(Park)` so the header line stays comfortable.
4. [ ] Selection-follow: putting ANY card on top (push, back/forward, tree's Open Full Card, family links) glides the camera to it — resident's home, company/building site, street run, district bounds. Cone-follow supersedes; fly-to buttons still cover work/partner/commute.
5. [ ] District hover: thick border ABOVE everything; the fill sits UNDER the buildings (occluded by towers, reads on streets/gaps) at 40% of the border color.

## 8. Known / Parked (don't re-report)

- Rows + Fan tree views built but hidden (behind a constant) while columns gets dialed in.
- 45–54 parenthood dip (54% vs real ~85%) — weave-linkage artifact; kids "exist offstage." Knob identified, left as is.
- Light-sprite sizing in perspective (constant size) — surveyed, fix shape designed, not built ([[light-sprite-sizing-survey]]).
- Option 3 street-loop district boundaries; worker offload; LRU caches; persona output-hash golden — parked ([[persona-gen-performance]]).
- Helicopters §6.1 from the 07-10 plan — still parked.
- Campuses carry 0 staff (professors excluded from the staffing weave on purpose — including them shifted pre-existing K-12 staff counts). Faculty hiring is a follow-up.
- Fly-to inset framing in ORTHO projection is approximate (the focal-offset magnitude uses perspective distance math); the width fit is correct. Tune if ortho fly-tos look off-center.
- `highlightDistrictId` store field is now setter-less (settings hover unified onto `hoverDistrictId`); DistrictShells reads the shared field. Field removal is a cleanup follow-up.
- Rows + Fan tree views: still hidden; they inherit the pan/zoom canvas untested.
- `fable` is ahead of origin (unpushed session run) and ahead of `dev`/`main` — fold on signal.
