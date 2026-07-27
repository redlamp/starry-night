# Test Plan - 2026-07-27 - Building Highlight + Unit Alignment

Branch: `feat/touch-flip` tree (will commit as its own group), uncommitted.
Four items from Taylor's 2026-07-27 pass.

## 1. Selection cage alignment

Was: the cage grew the HEIGHT by 8% and lifted the base up to 6m - it read as
taller than the building and floating off the road. Now: 1.08 margin on the
sides only; bottom flush with the ground; small fixed pad (max 2m) above the
roof. Screenshot-verified against a 15-floor tower (top hugs the roof).

1. [ ] Select buildings of several heights: cage top at the roof, bottom on
   the ground, sides just outside the walls

## 2. Unit borders (revised same-session)

Custom edge shader per unit: UNSELECTED units draw dashed lines with
back-facing edges hidden (hidden-line removal - each edge knows its two
adjacent face normals and culls when both face away); SELECTED/hovered units
draw the full outline in solid lines. Dash length 1.4m world units. The
selection highlight box now renders at the same `proud` scale as the picker
boxes, so when both draw one unit the outlines coincide (was: double-ghosted
1.5% apart).

1. [ ] Focus a building: unselected units show dashed, front-only edges;
   hovering one flips it to a solid full outline
2. [ ] Select a tenant (card hover / resident selection): solid outline,
   exactly on the picker's box - no ghost second outline
3. [ ] Hover/click behavior unchanged (borders don't catch the pointer)
4. [ ] Purple arcs meet the unit TOP (the old 4m float is gone)

Style knobs (if the look needs tuning): dash length EDGE_DASH_M, opacity,
color per state in UnitBox.tsx. Line WIDTH is capped at 1px by Windows/ANGLE;
wider needs the Line2 fat-line route (same pattern as district outlines) -
say the word.

## 3. Storefront floor alignment

Was: eligible downtown buildings render floor 0 at 1.7x a normal floor (the
#86 storefront band), but unit boxes and commute-arc anchors divided the
height uniformly - units sat off their visible floors exactly on storefront
buildings. Now: lib/scene/storefront.ts mirrors the shader's eligibility
(downtown, >= 4 floors, not warehouse/spire, same float32 hash roll vs the
live share) and floor-0 stretch; UnitBox + CommuteArc anchors use it. 3,035
eligible buildings at the default seed; helper output spot-checked (10
floors -> ground floor 15.9% of height vs 10% uniform).

1. [ ] On a downtown storefront building: ground-floor units fill the taller
   storefront band; upper units sit on their visible floor lines
2. [ ] Non-storefront buildings unchanged (uniform floors)
3. [ ] Commute arcs land on unit tops on storefront buildings too

## 4. Unit picking + cone button (same session)

- Any-side unit selection: the FOCUSED building's walls no longer claim
  clicks, so the ray continues to the unit boxes inside - the nearest unit's
  handler wins (first-unit-hit). Was: units only clickable on faces proud of
  the facade.
- Cone quick-toggle: a small cone button beside the roof pin flips
  cone-follow without opening a panel - amber while on.

1. [ ] Focus a building, orbit around it: units clickable from every side;
   the unit nearest the camera along the click ray wins
2. [ ] Clicking a unit through the focused building's near wall selects the
   unit (not the building); clicking a DIFFERENT building still selects it
3. [ ] Cone button by the pin toggles follow; state matches the inspect
   panel's toggle; amber when on
4. [ ] Cone mode + orbit drag: the pivot marker at the arcs' centroid is a
   PLAIN pin now (its cone glyph retired - the cone lives on the roof-pin
   button); building pin stays on the building throughout
5. [ ] Cone toggle = a two-zone camera swap (revised same-session): cone icon
   ("Show Connections") frames the arc set; in cone mode it becomes a
   magnifier ("Show Building") that frames the building. Works the same from
   the card's Follow button
6. [ ] Clicking another building carries the pin + cone button to it (pin
   anchors to focused-or-selected; was: both vanished)
7. [ ] Pin sits centred ON the anchor point; the button hangs off its right,
   vertically centred (adding the button no longer shifts the pin)
8. [ ] Residential buildings show arcs too: one thin violet arc per resident
   commuting out (was: only buildings with businesses drew arcs)

## 5. Small items

1. [ ] Inspect mode starts with cone-follow OFF (toggle still works;
   reverses the 07-18 default-on)
2. [ ] Building card: household/family names read as section labels - ALL
   CAPS, one size down, dimmed (residents list)

## Known / Parked

- The float32 hash emulation could disagree with the GPU for a building whose
  roll sits within an ulp of the storefront share - failure mode is today's
  misalignment for that one building, vanishingly rare.
