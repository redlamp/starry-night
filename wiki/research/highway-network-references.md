---
tags:
  - domain/3d
  - domain/visual-language
  - status/verified
  - scope/m3-plus
  - origin/external-research
---

# Highway Network References

Engineering grounding for **#13** (highway network + interchanges) — the freeway
half of the old "real road shapes" issue, parked behind **#14** (city scale)
because freeways only earn their place as a cross-town backbone at metro scale.
All numbers trace to primary sources (FHWA, AASHTO Green Book, NCHRP/TRB,
Caltrans HDM, TxDOT, VTRC); see the source table. Values given in source
imperial **and** project metres (1 unit = 1 m, see [[decision-1-unit-equals-1-meter]]).

> Scope note: most type/footprint guidance below is for freeway-to-**arterial**
> (service) interchanges. Freeway-to-**freeway** (system) interchanges — stacks,
> full cloverleaves — are larger and only described qualitatively by the surviving
> sources (see Open Questions).

## TL;DR — what makes a freeway read as real

1. **Strict hierarchy + zero lot frontage.** Freeways sit atop a functional
   classification and have *no* direct land access — no driveways, no at-grade lot
   frontage. They join the network *only* through grade-separated interchanges.
   This is the single most load-bearing rule.
2. **Tiered access cadence.** Interchanges every ~1 mi (urban) — not continuous,
   not random. Each service interchange is a ~1.5 km longitudinal *module*.
3. **Radius separates freeway from arterial.** Curve radius scales with V², so a
   70 mph freeway sweeps ~3× wider than a 40 mph arterial. Tight loops vs sweeping
   connectors are the visual giveaway at a junction.
4. **Tiered night lighting.** Continuous mainline lighting near the core, fully-lit
   major interchanges, key-points-only minor ones — plus tall multi-head high-mast
   clusters at interchange cores vs a regular cadence of single poles elsewhere.
5. **Paired ribbons.** Divided carriageways read as two parallel light rows with a
   median gap; minor streets read as a single row.

## 1. Network topology & hierarchy

- **Functional classification** (top→bottom): Interstate > other freeways/expressways
  > other principal arterials > minor arterials > collectors > locals. Only the
  *other principal arterial* tier serves abutting lots directly; the two freeway
  tiers serve none. *(FHWA fc02, 3-0)*
- **Controlled access.** Freeways connect to the rest of the network exclusively via
  grade-separated interchanges. **Generator rule: a highway polyline never spawns lot
  frontage and only touches arterials at an interchange node.** *(FHWA fc02, 3-0)*
- **Arterial backbone spacing** (the grid freeways plug into), scales with distance
  from core:
  - Principal arterials: **<1 mi (~800 m) at CBD core → 5+ mi (~8000 m) at fringe**.
  - Minor arterials: **⅛–½ mi (~200–800 m) core → 2–3 mi (~3200–4800 m) fringe**,
    normally ≤1 mi in fully built areas. *(FHWA fc02, 3-0)*
- **Radial routes belong to the highway tier**, not the street grid — confirmed by
  [[map-layout-references]] (Houston/Columbus). The topology already carries
  ring-radial highways; the bug was promoting them to street-level spokes.

## 2. Interchange spacing & footprint

- **Access cadence:** minimum **~1 mi (1600 m) urban**, 2–3 mi rural, measured
  crossroad-centreline to crossroad-centreline. (AASHTO Interstate-System policy =
  1 mi / 3 mi; Green Book rule-of-thumb = 1 mi / 2 mi — treat ~1 mi urban as the
  robust minimum, larger rural as a tunable range.) *(NCHRP 687 + Caltrans HDM 501.3, 3-0)*
- **Service-interchange footprint:** ~4,300–5,300 ft (**~1.3–1.6 km**) longitudinal,
  five segments: ~1,000 ft crossroad→entrance gore · 400–800 ft gore→merge tip ·
  **1,600–2,000 ft merge→diverge** (the controlling on/off spacing) · 300–500 ft
  diverge→exit gore · ~1,000 ft exit gore→crossroad. **Treat as one placeable
  ~1.5 km module** that fits inside the ~1 mi (5,280 ft) cadence. *(NCHRP 687, 2-1 —
  numbers verbatim, exact span approximate.)*

> At our **City tier (~3 km across, half-extent 1500 m, see [[plan-city-scale-tiers]])**
> only ~1–2 interchange spacings fit edge-to-edge. This is exactly why #13 is parked
> behind #14: freeways need Metro scale to host a believable interchange cadence.

## 3. Interchange type selection

Keyed primarily to **traffic volume + right-of-way** (a deliberate, source-grounded
simplification of AASHTO's true multifactor reality).

**Freeway ↔ arterial (service):** *(TxDOT TSP 11.2.1 + VTRC 99-R15, 3-0 vocab/breakpoints)*
| Type | Choose when |
|---|---|
| Diamond | < 1,500 vph entering; tight ROW, low cost |
| SPUI | 1,500–5,500 vph; heavy arterial left-turns; ~same ROW as compact diamond, costlier structure |
| Partial cloverleaf (parclo A/AB/B) | ~1,500–2,500 vph; moderate ROW |
| Full cloverleaf | abundant ROW, low-moderate ramp volumes |
| DDI / roundabout interchange | limited ROW, moderate traffic |

**Freeway ↔ freeway (system):** *(VTRC 99-R15 + Caltrans HDM, 3-0)*
- **Directional / stack** — highest capacity, *very high* ROW; justified essentially
  only for freeway-to-freeway. Place where two high-tier freeways cross.
- **Full cloverleaf (+ collector-distributor roads, Caltrans F-4)** — the *minimum*
  acceptable freeway-to-freeway form, most economical when turning volumes are low.
  Reserve for lower-volume system crossings.

## 4. Ramp & alignment geometry

- **Merge taper:** desirable **50:1 to 70:1** (Design-Speed:1) for entrance gores.
  **Exit/diverge uses a 2–5° angle, NOT the ratio.** *(TxDOT RDM 15.7.7, 3-0)*
- **Busy entrance accel ribbon:** ≥ **1,200 ft (~366 m)** + taper where ramp-freeway
  volume nears 4,600 vph. (Prefer this volume-anchored figure over a speed-table
  lookup — see refuted items.) *(AASHTO GB 7th / TxDOT, 2-1)*
- **Successive ramp spacing:** min **270 ft (~82 m)** between end-of-taper of one
  on-ramp and the theoretical gore of the next (entry-entry / exit-entry), measured
  "between like points." *(2004 AASHTO GB Exhibit 10-68 via NCHRP 687, 3-0)*
- **Curve radius** `Rmin = V² / [127 (e + f)]` (metric, V km/h) — **radius ∝ V²**.
  *(FHWA-HRT-17-098, 3-0)*
  - Interchange **loops: 150–200 ft (~46–61 m)** arcs (~25 mph).
  - Direct **connectors: min 850 ft (~260 m), desirable 1,150 ft (~350 m)**.
  - Freeway mainline curves sweep several × wider than arterials. *(Caltrans HDM 502.3, 3-0)*
- **Clothoid/spiral transitions + superelevation are real but safely flattened to
  circular arcs** for a low-poly top-down night view.

## 5. Night-view cues (the part that actually shows)

- **Tiered lighting (AASHTO warrants):** Continuous Freeway Lighting (CFL) near the
  core, Complete Interchange Lighting (CIL) at major junctions, Partial Interchange
  Lighting (PIL = gore + outer curve only) at minor ones. **Do not light everything
  uniformly.** CFL warranted where ≥3 successive interchanges average ≤1.5 mi spacing
  in urban surroundings. *(FHWA Lighting Handbook §4, 3-0)*
- **Pole-form contrast:** interchange cores = a few tall **multi-head high-mast
  clusters (~30 m)** spaced far apart; ramps/arterials/streets = a regular cadence of
  **single-head conventional poles (~10–15 m)**. *(FHWA Lighting Handbook §7, 3-0)*
- **Paired-ribbon layout by width:** 1-sided (1–3 lanes) → single row · staggered
  (3–6) · opposite (5+ lanes) → two rows · median lighting where median is wide.
  Wide divided carriageways = two parallel rows + median gap; narrow streets = one
  row. *(FHWA Lighting Handbook §7, 3-0)*
- **Headlight/taillight flow** already implemented (`Traffic.tsx`); on controlled-
  access lanes it should read as clean paired white/red ribbons (the divided-
  carriageway look), reinforcing the freeway vs street distinction.

## Safe stylized simplifications

- Reduce interchange type-selection to **ROW + volume** (drop topography/land-use).
- Treat the **service interchange as one ~1.5 km placeable module**.
- Draw entrance gores at a **50:1–70:1** taper; exits at a small angle.
- **Flatten clothoids/superelevation to circular arcs**; ignore vertical grade.
- "Cobra-head" ≈ davit/mast-arm/truss pole class for our purposes.

## Do NOT hardcode (refuted in verification)

- ❌ A fixed interchange **footprint-size ranking** (SPUI<diamond<parclo<…<directional)
  — refuted 0-3. No consistent ordering.
- ❌ "**Diamond = least land / default**" — refuted 1-2.
- ❌ Detailed **accel/decel length-vs-design-speed tables** (accel ~120–2,100 ft,
  decel ~150–1,060 ft) — refuted 1-2; use the volume-anchored ~1,200 ft accel figure.
- ❌ Rural spacing "**2–6 mi**" phrasing — refuted 0-3 in favour of 2–3 mi.

## Open questions (research did not settle)

1. **Metro freeway COUNT + parallel-freeway spacing** for a city of population N, and
   radial-vs-beltway topology rules — the key input for *how many* freeways to
   generate. (Confirmed arterial + interchange spacing, but not freeway count.)
2. **Planar footprint (m) per freeway-freeway system interchange** (stack, full
   cloverleaf, trumpet) as a bounding box for placement.
3. **Pole spacing cadence** (luminaire-to-luminaire, as a multiple of mount height)
   to set the night light-dot rhythm.
4. **Median + cross-section widths (m)** so the paired ribbons sit a believable gap
   apart at metro scale.

→ A focused follow-up pass on (1) and (2) is the natural prerequisite before coding
#13; (3)/(4) are tuning details resolvable during implementation.

## Sources (primary unless noted)

| Source | Angle |
|---|---|
| [FHWA Functional Classification fc02](https://www.fhwa.dot.gov/planning/processes/statewide/related/functional_classification/fc02.cfm) | hierarchy, access, arterial spacing |
| [NCHRP Report 687](https://cmfclearinghouse.fhwa.dot.gov/studydocs/nchrp_rpt_687.pdf) | interchange spacing + 5-segment footprint |
| [Caltrans HDM Ch.500](https://dot.ca.gov/-/media/dot-media/programs/design/documents/chp0500-032020.pdf) | spacing, loop/connector radii, type selection |
| [TxDOT TSP Ch.11.2.1](https://www.txdot.gov/manuals/des/tsp/chapter-11-interchange-analysis/11-2-interchange-configuration-evaluation--ice----/11-2-1-types-of-interchanges.html) | interchange type vocabulary + ROW/volume |
| [VTRC 99-R15](https://vtrc.virginia.gov/media/vtrc/vtrc-pdf/vtrc-pdf/99-r15.pdf) | type selection, volume breakpoints |
| [TxDOT RDM 15.7.7](https://www.txdot.gov/manuals/des/rdw/chapter-15-grade-separations-and-interchanges-/15-7-ramps---direct-connectors-/15-7-7-ramp-terminal-design.html) | taper, accel length, ramp-pair spacing |
| [FHWA-HRT-17-098](https://www.fhwa.dot.gov/publications/research/safety/17098/004.cfm) | min curve radius formula |
| [FHWA Lighting Handbook §4](https://highways.dot.gov/safety/other/visibility/fhwa-lighting-handbook-august-2012/4-analysis-lighting-needs) · [§7](https://highways.dot.gov/safety/other/visibility/fhwa-lighting-handbook-august-2012/7-lighting-application) | CFL/CIL/PIL warrants, pole forms, paired ribbons |
| [Chen et al. — tensor-field street modeling (SIGGRAPH '08)](https://www.sci.utah.edu/~chengu/street_sig08/street_sig08.pdf) | procedural method (already our arterial model) |

## Cross-links

- [[map-layout-references]] — radial=freeway, ring-road scale (#14) · [[city-planning-references]]
- [[plan-city-scale-tiers]] — why #13 waits on Metro scale · [[decision-tensor-field-roads]]
- [[decision-1-unit-equals-1-meter]] — the metre conversions above
