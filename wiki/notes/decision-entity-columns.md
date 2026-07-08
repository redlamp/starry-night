---
tags:
  - domain/procgen
  - domain/narrative
  - status/adopted
---

# Decision: Entity Columns (Miller-Columns Drill)

2026-07-08, `feat/personas`. Unifies the building/company/persona/street/district detail surfaces into one progressive-disclosure system, per user direction ("columns view of macOS" + interconnection + CSS-3D collapse).

## Shape

- **Selection path in Zustand** (`columnPath: EntityRef[]` + `columnCursor`): a typed drill like [district, building, company, persona, persona]. Back/Forward move the cursor WITHOUT truncating (forward history survives until a new push branches). `syncColumnSelection` derives `selectedBuildingId`/`selectedPersonaId` from the visible slice through the existing setters, so the #87 outline/pin/focus and the arc overlays kept their semantics for free.
- **Three display states** (header cycle button): `side` — flat macOS columns, headers aligned top-left, every column interactive (capture-phase jump + the click's own push = true Miller branching); `deck` — CSS-3D stack, earlier columns recede as tilted brightness-dimmed slivers (`rotateY` up to 26°, −15rem overlap, click to jump); `collapsed` — top card only, "· N behind" in the header.
- **Column bodies** (`components/ui/columns/`): District (stats, streets, landmarks), Street (buildings/companies/people on it), Building (stats + sift line + occupants split Companies/Residents), Company (staff; schools also list students), Persona (the old sheet, still ending on the hook; astrology/MBTI badges explain themselves on hover via `WESTERN_SIGN_TRAITS`/`CHINESE_*_TRAITS`/`MBTI_DESCRIPTIONS`).
- **Data spine**: `useEntityIndexes()` (`columns/entityData.ts`) — one memoised bundle of cross-indexes (streets↔buildings↔companies↔people, district rollups) over the module-cached generators.
- **Scene tie-ins**: street CLICK opens a street column (press/release-distance idiom; a hovered building wins via `pickInstance`); a topmost street column draws its polyline x-ray (`StreetHighlight`); a topmost persona draws the thick mode-coloured commute arc PLUS thin violet connection arcs to partner/family/relation homes (`CommuteArc`).
- Replaced (deleted): `BuildingInfoPanel.tsx`, `PersonaPanel.tsx`. DirectoryPanel entries now push columns.

## Schools (same session)

Real school Businesses in real buildings — an elementary per home district, middles per ~3 districts, highs per ~5 — created before the employment weave so teachers hire in via kind matching. Kids 5–17 enroll at the nearest school of their age tier (pure distance, same-district elementaries by construction; 100% enrollment at the default seed, ~90% walk / 10% school-bus). New commute mode `bus` (school-bus yellow arc). Company column lists students; persona sheets show "Student · {School}" and the bus commute.

## Verified

Typecheck/lint clean; personaCheck 15/15 + schools spot-check; captures `samples/personas/columns-drill.png` (deck) and `columns-side.png` (side-by-side). Live interaction feel = user gate.
