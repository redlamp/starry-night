---
tags:
  - domain/city-gen
  - domain/procgen
  - status/adopted
---

# Decision: Minor-Tier Traffic Follows Multi-Road Journeys

**Date**: 2026-09-05
**Status**: adopted

## Context

`lib/seed/traffic.ts` (#57) gives highway/arterial cars a single macro-segment loop, and gives minor-tier (rural/suburban street) cars a "journey" that traverses one road's FULL original polyline on a shared clock, then recycles from the start. Owner (2026-09-05): *"lights sticking to road segments... starts to look odd in rural sections with little to no buildings but streets with different names and a car going from one end to the next, then looping over and doing that segment and direction again."* Rural roads are exactly where a single-road journey is most legible as a loop — few buildings to distract, and the recycle snaps back to the same visible stretch.

The generator has no intersection/node model. Tensor-field streamlines (`lib/seed/tensorStreets.ts`) just stop tracing when they get too close to a same-family neighbour, or (subdivisions) explicitly snap a spline tip onto the nearest existing road within a generous radius (`AnchorIndex`, up to ~80m). So "does road A connect to road B" isn't recorded anywhere; it has to be reconstructed from geometry.

## Options considered

1. **Full routed simulation** (real intersection graph, right-of-way, traffic lights). Correct destination for the traffic-lights idea, but far more machinery than "stop looping the same stretch" needs — a new intersection/lane-topology model, not a car-placement tweak.
2. **Longer single roads** (bias car placement toward longer original polylines, or stitch a road's OWN geometry into a bigger loop). Doesn't address the actual complaint: a rural cul-de-sac or short spine is still ONE named street, however long, and the car still snaps back to its own start.
3. **Graph-walk journeys** (chosen): build a lightweight proximity graph over minor-road endpoints, and have a journey walk it — continue onto a connected road at the far end, straightest-turn-first, for a seeded few roads, before recycling. No new intersection concept, no lane/right-of-way logic; just extends "journey" from one road's polyline to a concatenation of several.

## Choice

- **Connectivity**: `lib/seed/roadGraph.ts` snaps each minor road's two endpoints into a shared "node" with any OTHER road whose polyline passes within `JOURNEY_LINK_EPSILON` (45m) — NOT the "few metres" originally guessed. Measured against three seeds first: nearest-other-road distance for a minor endpoint has median 0m but only ~60% sit within 4m; the generator's own snap tolerances (subdivision branch/loop snapping, street separation tests) run 50-80m. 45m stays under the same-family street separation floor (`ST_DTEST` = 54m in `tensorStreets.ts`) so it can't misconnect two parallel, non-touching streets, while actually catching most real touches.
- **Algorithm**: minor-tier only (arterial/highway untouched, byte-identical — verified with `tierMul.minor=0` checksums against the pre-change code). Per granted road, per concurrent car: seed `K` = 3..6 roads. Start on the road (full length, chosen direction). At its far end, look up roads touching that node; exclude the one just arrived from (never an immediate U-turn); score each remaining candidate by heading similarity (dot product of unit tangents) and take the straightest. Repeat until `K` roads or no candidate (dead end). Concatenate the whole walk into ONE polyline (reversing a road when traversed end-to-start) and feed it into the EXISTING macro-segment chunker + shared-clock + visibility-window machinery — the shader (`lib/shaders/traffic.ts`) is untouched.
- **Leg cap**: a continuation hop lands at a road-endpoint touch, so "continue onto it" naturally means driving to ITS far end — fine for a short subdivision loop/cul, but the tensor-field global-grid streets run past 1km. Uncapped, this pushed mean journey length past 2.5-3.8km and drove 2 of 3 spot-check seeds to the 9000-instance hard cap (`MAX_CARS`), which would have silently truncated journeys mid-route. `JOURNEY_LEG_CAP_M` (200m) caps a CONTINUATION leg's distance — the journey just ends there rather than hopping again from an arbitrary mid-road point (there's no real junction to reason about at a cut). The STARTING road is exempt, same as before #57.
- **Counts**: grant/concurrent decisions are unchanged, still per the STARTING road's own population-busyness budget — continuations aren't separately gated (a car already moving doesn't need fresh permission). Spot-checked 12+ seeds post-cap: max 8271 of 9000 instances (old code's worst case was ~8706), so "close to today's" holds without any journey being cut short by the cap.
- **Verification**: `scripts/trafficJourneyCheck.ts` builds traffic for three seeds twice and asserts every attribute buffer is byte-identical, then prints journeys / mean roads per journey / mean journey length / dead-end (length-1) count. Typical run: ~90-200 journeys per seed, mean ~1.9-2.4 roads, ~35-40% terminate at 1 road (a genuine dead end in the proximity graph).

## Why

Graph-walk journeys are the smallest change that removes the specific artifact (same segment, same direction, forever) without inventing a full road-network model the traffic-lights idea will eventually need anyway. Restricting continuations to minor-tier roads keeps one `TierCfg` (speed/lane geometry) valid for an entire journey — mixing in an arterial mid-trip would need per-leg speed changes the shared-clock model doesn't have room for.

## For the traffic-lights idea

`roadGraph.ts`'s endpoint-touch nodes are a real (if approximate) intersection set — a future traffic-lights pass could hang phase/cycle state off the same `RoadEndpointTouches` nodes rather than re-deriving connectivity from scratch. It only knows about MINOR roads today; extending it to arterials/highways would need the same distance-calibration exercise (their own separation floors differ) before picking an epsilon.

## Consequences

- `lib/seed/traffic.ts`: `buildTrafficSegments` now also returns `minorRoads`/`minorRoadIds` (index-parallel to `city.streets`); `TrafficData` gained `journeyStats` (debug/check-script only, not rendered).
- `TrafficDensityOverlay`/`buildTrafficDensity` unchanged — same per-road macro-segment model, independent of the journey rework.
- New file `lib/seed/roadGraph.ts` (arc-length polyline utilities + the proximity graph) and `scripts/trafficJourneyCheck.ts`.
- No shader change. No gen-input change — `gate1`/`cityGolden` pass unmodified (traffic isn't in either gate; confirmed by running both).
