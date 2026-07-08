---
tags:
  - domain/procgen
  - status/adopted
  - origin/external-research
---

# Family Tree Chart Conventions

Research brief behind the FamilyTree v3 hourglass chart (2026-07-08, user asked for "a more traditional family tree chart" with layout consistency when re-rooting between partners). Gathered by a Sonnet research agent; conclusions adopted in `components/ui/columns/FamilyTree.tsx`.

## 1. Chart types

| Type | Shows | Typical use |
|---|---|---|
| **Pedigree chart** | One person's direct ancestors only | Lineage research |
| **Fan chart** | Pedigree data arranged radially | Compact ancestor display |
| **Descendant chart** | All descendants of a root across all spouses | Founder's "family empire" |
| **Hourglass chart** | Root person/couple centered, **ancestors up, descendants down, siblings beside** | The match for our dialog |
| **Genogram** | Tree skeleton + relationship quality/household/clinical annotations | Therapy, social work — the most standardized line vocabulary |

**Adopted**: hourglass structure, genogram line vocabulary.

## 2. Couple layout conventions

- **Union line**: horizontal line between partners; children hang from a vertical drop at its **midpoint**, fanning out via a horizontal sibling bar. *(Adopted verbatim — `coupleAnchor` + `connect` in FamilyChart.)*
- **Left/right**: historical rule is **male left, female right** — explicitly a layout fallback (GenoPro: "in case of ambiguity"), not semantics. *(Adopted for different-gender couples.)*
- Separation = one slash across the union line, divorce = two; dashed union = unmarried/cohabiting. *(Not yet drawn — dating couples currently get the same solid line; candidate refinement.)*

## 3. Same-sex and nonbinary couples

Square=male, circle=female, diamond=nonbinary in genograms; the union line itself carries the relationship. When male-left/female-right doesn't apply, tools fall back to birth order, alphabetical, or entry order — **no industry standard**. The real requirement is one arbitrary-but-stable tiebreaker. *(Adopted: stable persona-id order — seed-deterministic, never click order.)*

## 4. Remarriage / blended families

- Multiple partners → multiple union lines, ordered chronologically outward (GenoPro).
- **Children hang only from their own parents' union line** — this is how half-siblings read. *(Adopted: shared children from the union midpoint; a partner's prior-relationship children hang from that partner's own box.)*
- Children ordered **oldest → youngest, left → right**. *(Adopted.)*

## 5. Adoption / step / foster

Solid vertical = biological, dashed = adopted, dotted = foster; step-parent links dashed. *(Not yet in the generator's data model — noted for the multi-household work, #93 territory.)*

## 6. Stability when re-rooting

No major tool (Gramps, GenoPro, Ancestry, FamilySearch) guarantees stable layout across re-rooting; Gramps re-derives per active person, GenoPro's AutoArrange warns about complex trees. **Adopted principle**: derive couple order and sibling order deterministically from seed/ids so re-centering on the other partner renders the identical chart with only the highlight moved.

## Sources

- [Family tree chart types — Family Tree Magazine](https://familytreemagazine.com/resources/family-tree-chart-types/)
- [Pedigree views — FamilySearch](https://www.familysearch.org/en/help/helpcenter/article/what-are-the-different-pedigree-views-in-family-tree)
- [Genogram symbols — Creately](https://creately.com/guides/genogram-symbols/)
- [Genogram rules — Creately](https://creately.com/guides/genogram-rules/)
- [Rules to build genograms — GenoPro](https://genopro.com/genogram/rules/)
- [AutoArrange — GenoPro Help](https://genopro.com/help/autoarrange/)
- [Hourglass graph discussion — Gramps Discourse](https://gramps.discourse.group/t/hourglass-graph-including-siblings-of-ancestors-and-descendants/2256)
