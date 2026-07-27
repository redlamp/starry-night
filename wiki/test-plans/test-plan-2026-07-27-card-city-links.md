# Test Plan - 2026-07-27 - Card ↔ City Links

Branch: `feat/card-city-links` (off dev). Taylor's 2026-07-27 pass on the entity
cards: road cards, hover highlighting, occupant order, building click-back.

## 1. Road cards read as a route

Highways carry NO addressed buildings (`assignAddresses` skips that tier), so
their cards used to show a lone "Highway" badge and four zero counts. Now every
road card derives its geometry: `lib/seed/roadGeometry.ts` walks the polyline
against the district field for the districts it runs through, and grids the
road's segments to find every road that crosses it.

- Districts moved BELOW the stats as a vertical list, ordered ALONG the road
  with the km mark where the road enters (same reading direction as Crossings).
  Districts under 120m of road are dropped as corner clips unless they address
  buildings on the road.
- Crossings (highways only) list every crossing road in order along the highway,
  arterial/highway tier badged, with its km mark. Offramps aren't modelled yet;
  these are the points where they'd attach.
- Zero-count stat rows are hidden; Length is new for every road.
- Buildings list adopted the directory's row format (`AddrNum` fixed-width
  number column + street, named buildings as an outline badge on the right).
  `AddrNum` now lives in EntityColumns and the directory imports it — the two
  copies had drifted.

Probe (`scratch/roadCrossProbe.ts`): Highway 9 = 5.95km, 13 districts touched /
227 runs in 0.3ms, 52 crossing roads (16 arterial, 36 minor) in 8ms; Highway 13
= 6.11km, 42 crossings. Both memoised per road. Screenshot-verified.

1. [ ] Highway card: Length + Crossings stats, Districts list in route order,
   Crossings list in route order with km marks
2. [ ] The district km marks increase down the list; the first is 0.00 km
3. [ ] A local street shows its districts too (Edwards Street: Poplar Gardens
   0.00, Summit Glen 0.35) and no km column when there's only one
4. [ ] Building rows read like the directory's (number column aligned, name as
   a badge) — no bare trailing number
5. [ ] Clicking a crossing opens that road's card; clicking a district opens it

## 2. Hover a list row → highlight it in the city

`lib/hooks/useCityHover.ts` is the one rule: a row highlights what CLICKING it
would open. Districts trace their border (existing `hoverDistrictId`), roads
draw their polyline in white above the card's own street (new `hoverRoadId`),
buildings get a white cage (new `hoverBuildingId`, brighter than the selection
cage), and a person/company also lights their unit on the facade (existing
`hoveredTenant`). Every channel clears on unmount AND on any column change — a
click that swaps the card can't strand a highlight.

Wired: street/highway (buildings, crossings, companies, people, districts),
district (streets, landmarks), company (its building, employees, students),
persona (home, work, school, employer, partner, family). Building cards already
had tenant hover.

1. [ ] Highway card: hovering a crossing draws that road white in the city
2. [ ] Street card: hovering a building cages it; hovering a person cages their
   home AND lights their unit
3. [ ] District card: hovering a street draws it; hovering a landmark cages it
4. [ ] Persona card: hovering Home / Work / School / employer / partner /
   relatives highlights the right thing
5. [ ] Clicking a row (which swaps the card) leaves NO highlight behind
6. [ ] Closing the directory clears highlights

## 3. Occupant lists run top floor → bottom

`companiesInBuilding` / `householdsInBuilding` now sort by the unit's
`floorStart` descending (ties keep their original order; unplaced tenants sort
last), so reading down a building card's occupants walks DOWN the building the
highlight is drawing on. Probe (`scratch/occupantOrderProbe.ts`) 3/3 PASS —
units read 5D, 4C, 2B, 1A.

1. [ ] Building card: household units descend (top floor first)
2. [ ] Companies descend too (offices above ground-floor retail)
3. [ ] Hovering down the list moves the highlight down the building

## 4. Building shell click returns to the building

The focused building's walls are transparent to clicks so units are selectable
from any side, which meant clicking a spot with no unit behind it did nothing.
Now the wall click queues a microtask; if no unit claimed the same DOM event
(`lib/scene/unitClick.ts`), the drill truncates back to that building's card.

1. [ ] Looking at a resident, click the building shell (not a unit) → the
   building card is selected again
2. [ ] Clicking a unit still selects the tenant (from any side)
3. [ ] An orbit drag that starts and ends on the shell selects nothing

## Known / Parked

- Crossings are geometric intersections, not offramps — a highway/arterial
  crossing may be a bridge in reality. Modelling ramps is future work.
- Crossings are computed for highways only (the tier where "what does it
  connect to" is the story); the same call would work for any road.
- The float32 district-field classify samples segment MIDPOINTS, so a road that
  clips a district corner for less than a segment can be missed.
