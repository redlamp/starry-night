---
tags:
  - domain/personas
  - domain/city-gen
  - status/open
  - origin/external-research
---

# Industry Taxonomy Survey - Proposal for the Companies Directory

**Date**: 2026-07-18. Prompted by user feedback: "Medical over Hospital... propose
some more general categories that may be better suited to a wider range of
companies. Base on practical research."

## What the sim has today

14 `WorkplaceType` kinds; at the default seed 12 occur: office 3,046 - studio
1,352 - civic 509 - lab 493 - hospital 276 - factory 257 - transit 251 -
warehouse 241 - school 239 - shop 182 - restaurant 171 - retail 164. Offices
additionally carry SUBTYPES (Legal, Finance, Technology... via `affinity:
ProfessionCategory[]`), and personas carry 19 `ProfessionCategory` values -
so finer industry data already exists, it just isn't surfaced as the pill.

Problem: "kind" is a BUILDING vocabulary (what the venue is), not an industry
vocabulary (what the company does). 42% of all businesses land in one
undifferentiated "office" bucket while "hospital" mislabels dental clinics.

## Real-world systems surveyed

- **NAICS** (US census standard): 20 sectors - e.g. Manufacturing; Retail
  Trade; Transportation and Warehousing; Professional, Scientific, and
  Technical Services; Health Care and Social Assistance; Accommodation and
  Food Services; Public Administration. Authoritative but bureaucratic tone
  ("Administrative and Support and Waste Management..."). Source:
  https://www.census.gov/naics/ · https://www.bls.gov/iag/tgs/iag_index_naics.htm
- **GICS** (financial markets): 11 sectors (Health Care, Financials,
  Information Technology, Industrials, Consumer Discretionary...). Too coarse
  and investor-flavored for a city directory.
- **Yelp / Google Business Profile** (consumer local directories): ~20
  human-scale roots - Health & Medical, Professional Services, Financial
  Services, Restaurants, Shopping, Arts & Entertainment, Education, Public
  Services & Government, Local Services. This register fits a city phone book
  best. Source: https://business.yelp.com/resources/articles/yelp-category-list/

Takeaway: consumer directories converge on ~12-20 short, warm, Title Case
categories; statistical systems are too granular and too formal.

## Proposed categories (12)

Derived per business from `(kind, office affinity)` - no regeneration, pure
display mapping; the office bucket splits by its existing subtype affinity.

| Category | Sourced from | Est. count |
|---|---|---|
| Medical | hospital kind | 276 |
| Professional Services | office w/ Legal, Management, Sales, or no affinity | ~1,700 |
| Finance | office w/ Finance affinity | ~500 |
| Technology | office w/ Technology affinity | ~800 |
| Manufacturing | factory | 257 |
| Logistics | warehouse + transit | 492 |
| Retail & Shops | retail + shop | 346 |
| Food & Dining | restaurant | 171 |
| Arts & Media | studio | 1,352 |
| Science | lab | 493 |
| Education | school | 239 |
| Civic | civic | 509 |

(Office splits are estimates - exact counts depend on the subtype weights;
measure before finalizing. `home`/`outdoor` kinds, when they occur, fold into
Professional Services / Local Services.)

Notes:
- Names follow the Yelp/Google register: short, Title Case, no ampersand
  pile-ups beyond two nouns.
- The pill icon/hue system (workplaceIcons.tsx) extends 1:1 - each category
  keeps one icon + one oklch hue.
- Related: the Medical HEADCOUNT tiering proposal (a few true hospitals at
  150-600 staff, the rest clinic-scale) fixes the staff-sort monotony and
  pairs naturally with this relabel.

## Open for user

1. Adopt the 12 above, or trim (merge Finance into Professional Services for 11)?
2. Should "Arts & Media" split (1,352 studios is the second-biggest bucket -
   Media vs Design vs Music could come from studio name templates)?
3. Proceed with the Medical headcount tiering alongside?
