// The writing lab's index of every authored content pool in the generation
// system — story templates, name pools, naming templates — flattened into a
// uniform shape the /writing-lab tables can render and edit. Read-only over
// the source modules: edits live in labStore (localStorage) and ship by
// exporting and pasting back into the source arrays.

import {
  MASCULINE_FIRST_NAMES,
  FEMININE_FIRST_NAMES,
  LAST_NAMES,
  PROFESSIONS,
  WESTERN_SIGN_TRAITS,
  CHINESE_ANIMAL_TRAITS,
  MBTI_DESCRIPTIONS,
} from "@/lib/seed/personaData";
import {
  HOOKS_GENERIC,
  HOOKS_OUTSIZED,
  HOOKS_BY_CLUSTER,
  DETAILS,
  REFUSALS,
  WAS_CLAUSES,
  WHY_AWAKE,
  RELATION_TEMPLATES,
  DOMAIN_WORDS,
  DOMAIN_DETAILS,
  DOMAIN_HOOKS,
} from "@/lib/seed/personaStory";
import {
  CITY_PREFIXES,
  CITY_SUFFIXES,
  CITY_FIRST_WORDS,
  CITY_SECOND_WORDS,
  TREE_NAMES,
  NATURE_NAMES,
  BIRD_NAMES,
  ARTERIAL_SUFFIXES,
  MINOR_SUFFIXES,
  DISTRICT_TEMPLATES,
  BUILDING_TEMPLATES,
  PAPER_NAMES,
} from "@/lib/seed/naming";
import { BUSINESS_TEMPLATES, OFFICE_SUBTYPES, HOSPITAL_SUBTYPES } from "@/lib/seed/personas";
import { CONTENT_IDS } from "@/lib/writing/contentIds";

export type ContentPool = {
  id: string; // stable: "story.hooks.kid"
  group: string; // tab grouping: "Story", "Names", "Places", "Businesses", "Traits"
  label: string;
  // template pools carry the slot grammar; word pools are plain strings.
  kind: "template" | "word";
  slots?: string; // human note about available slots
  entries: string[];
  // Stable per-entry ids, index-aligned with `entries` — entryIds[i] names
  // entries[i]. Committed by scripts/genContentIds.ts into contentIds.ts;
  // survives text edits (id ties to the sidecar's own history, not to the
  // entry's current text or, for ordinary pools, anything content-derived).
  entryIds: string[];
  // where the pool lives, for the export-back-to-source workflow
  source: string;
};

const SLOT_NOTE =
  "{given} {family} {kin} {kinrole} {street} {district} {city} {paper} {transit} {biz} {his} {he} {domain} {N} {lore:place} {lore:event} {lore:band} {lore:scandal} {lore:past}";

export function buildContentRegistry(): ContentPool[] {
  const pools: ContentPool[] = [];
  const add = (
    id: string,
    group: string,
    label: string,
    kind: ContentPool["kind"],
    entries: string[],
    source: string,
    slots?: string,
  ) => {
    // Defensive fallback for a pool the sidecar hasn't seen yet (freshly added
    // pool, script not re-run): mint the same plain ordinal id
    // scripts/genContentIds.ts would on its next run, in memory only — this
    // never writes back to contentIds.ts, so it can't drift from what the
    // script would actually commit.
    const committed = CONTENT_IDS[id] ?? [];
    const entryIds = entries.map((_, i) => committed[i] ?? `${id}~${i}`);
    pools.push({ id, group, label, kind, entries, entryIds, source, slots });
  };

  // --- Story templates ---
  add("story.hooks.generic", "Story", "Hooks · Generic", "template", [...HOOKS_GENERIC], "lib/seed/personaStory.ts · HOOKS_GENERIC", SLOT_NOTE);
  add("story.hooks.outsized", "Story", "Hooks · Outsized", "template", [...HOOKS_OUTSIZED], "lib/seed/personaStory.ts · HOOKS_OUTSIZED", SLOT_NOTE);
  for (const [cluster, hooks] of Object.entries(HOOKS_BY_CLUSTER)) {
    // Namespaced under "cluster." — HOOKS_BY_CLUSTER has a "generic" key that
    // would otherwise collide with the standalone "story.hooks.generic" id
    // above (id collision silently merges two distinct pools in the writing
    // lab: last-write-wins on stats, and pool lookup always resolves to
    // whichever pool was added first).
    add(`story.hooks.cluster.${cluster}`, "Story", `Hooks · ${cluster}`, "template", [...hooks], `lib/seed/personaStory.ts · HOOKS_BY_CLUSTER.${cluster}`, SLOT_NOTE);
  }
  add("story.hooks.domain", "Story", "Hooks · Domain", "template", [...DOMAIN_HOOKS], "lib/seed/personaStory.ts · DOMAIN_HOOKS", SLOT_NOTE);
  add("story.details", "Story", "Details", "template", DETAILS.map((d) => d.line), "lib/seed/personaStory.ts · DETAILS (epithets ride along in source)", SLOT_NOTE);
  add("story.details.domain", "Story", "Details · Domain", "template", [...DOMAIN_DETAILS], "lib/seed/personaStory.ts · DOMAIN_DETAILS", SLOT_NOTE);
  add("story.refusals", "Story", "Refusals", "template", [...REFUSALS], "lib/seed/personaStory.ts · REFUSALS", SLOT_NOTE);
  add("story.was", "Story", "Was-clauses", "template", [...WAS_CLAUSES], "lib/seed/personaStory.ts · WAS_CLAUSES", SLOT_NOTE);
  for (const [shift, lines] of Object.entries(WHY_AWAKE)) {
    add(`story.awake.${shift}`, "Story", `Why Awake · ${shift}`, "template", [...lines], `lib/seed/personaStory.ts · WHY_AWAKE.${shift}`, SLOT_NOTE);
  }
  add("story.relations", "Story", "Relation Lines", "template", RELATION_TEMPLATES.map((r) => r.line), "lib/seed/personaStory.ts · RELATION_TEMPLATES ({T}/{Tfirst} = target)", SLOT_NOTE + " {T} {Tfirst}");
  add("story.domains", "Story", "Domain Words", "word", [...DOMAIN_WORDS], "lib/seed/personaStory.ts · DOMAIN_WORDS");

  // --- Names ---
  // NOT resident given names (2026-07 provenance audit, Finding A): residents
  // draw given names from the decade-cohort tables in lib/seed/nameCohorts.ts
  // (MASCULINE_BY_DECADE / FEMININE_BY_DECADE), so a birth-year-appropriate
  // Barbara or Madison comes out instead of a flat 50/50 pool. These two flat
  // pools feed only OFFSTAGE relatives (the unseen mother/uncle/etc. named on
  // a persona's sheet) and the business-name {G} slot — editing "Robert" here
  // never changes what a resident is called. nameCohorts.ts's ~450 rows of
  // sourced SSA data aren't (yet) a registered pool here; see
  // lib/writing/provenance.ts for the reverse lookup.
  add("names.first.masc", "Names", "First Names · Masculine", "word", [...MASCULINE_FIRST_NAMES], "lib/seed/personaData.ts · MASCULINE_FIRST_NAMES (offstage relatives + business {G} slot only — NOT resident given names; see lib/seed/nameCohorts.ts)");
  add("names.first.fem", "Names", "First Names · Feminine", "word", [...FEMININE_FIRST_NAMES], "lib/seed/personaData.ts · FEMININE_FIRST_NAMES (offstage relatives + business {G} slot only — NOT resident given names; see lib/seed/nameCohorts.ts)");
  add("names.last", "Names", "Last Names", "word", [...LAST_NAMES], "lib/seed/personaData.ts · LAST_NAMES");
  add("names.professions", "Names", "Professions", "word", PROFESSIONS.map((p) => p.title), "lib/seed/personaData.ts · PROFESSIONS (title only; category/tier/workplace in source)");

  // --- Places ---
  add("places.city.prefix", "Places", "City Name · Prefixes", "word", [...CITY_PREFIXES], "lib/seed/naming.ts · CITY_PREFIXES");
  add("places.city.suffix", "Places", "City Name · Suffixes", "word", [...CITY_SUFFIXES], "lib/seed/naming.ts · CITY_SUFFIXES");
  add("places.city.first", "Places", "City Name · First Words", "word", [...CITY_FIRST_WORDS], "lib/seed/naming.ts · CITY_FIRST_WORDS");
  add("places.city.second", "Places", "City Name · Second Words", "word", [...CITY_SECOND_WORDS], "lib/seed/naming.ts · CITY_SECOND_WORDS");
  add("places.trees", "Places", "Street Pool · Trees", "word", [...TREE_NAMES], "lib/seed/naming.ts · TREE_NAMES");
  add("places.nature", "Places", "Street Pool · Nature", "word", [...NATURE_NAMES], "lib/seed/naming.ts · NATURE_NAMES");
  add("places.birds", "Places", "Street Pool · Birds", "word", [...BIRD_NAMES], "lib/seed/naming.ts · BIRD_NAMES");
  add("places.suffix.arterial", "Places", "Street Suffixes · Arterial", "word", [...ARTERIAL_SUFFIXES], "lib/seed/naming.ts · ARTERIAL_SUFFIXES");
  add("places.suffix.minor", "Places", "Street Suffixes · Minor", "word", [...MINOR_SUFFIXES], "lib/seed/naming.ts · MINOR_SUFFIXES");
  add("places.paper", "Places", "Newspaper Names", "word", [...PAPER_NAMES], "lib/seed/naming.ts · PAPER_NAMES");
  for (const [character, templates] of Object.entries(DISTRICT_TEMPLATES)) {
    add(`places.district.${character}`, "Places", `District Names · ${character}`, "template", [...templates], `lib/seed/naming.ts · DISTRICT_TEMPLATES.${character}`, "{F} founder surname · {T} tree/nature");
  }
  for (const [archetype, templates] of Object.entries(BUILDING_TEMPLATES)) {
    add(`places.building.${archetype}`, "Places", `Building Names · ${archetype}`, "template", [...templates], `lib/seed/naming.ts · BUILDING_TEMPLATES.${archetype}`, "{F}/{F2} founder · {T} tree/nature · {B} bird · {N} number");
  }

  // --- Businesses ---
  for (const [kind, templates] of Object.entries(BUSINESS_TEMPLATES)) {
    add(`biz.${kind}`, "Businesses", `Business Names · ${kind}`, "template", [...templates], `lib/seed/personas.ts · BUSINESS_TEMPLATES.${kind}`, "{F}/{F2} surname · {G} given name · {S} street base · {C} city · {P} craft · {N} number");
  }
  OFFICE_SUBTYPES.forEach((sub, i) => {
    add(`biz.office.sub${i}`, "Businesses", `Office Subtype ${i + 1}${sub.affinity ? ` (${sub.affinity.join("/")})` : " (open)"}`, "template", [...sub.templates], `lib/seed/personas.ts · OFFICE_SUBTYPES[${i}]`, "{F}/{F2} {S} {T} {C}");
  });
  HOSPITAL_SUBTYPES.forEach((sub, i) => {
    add(`biz.hospital.sub${i}`, "Businesses", `Hospital Subtype ${i + 1}${sub.titleAffinity ? ` (${sub.titleAffinity.join("/")})` : " (open)"}`, "template", [...sub.templates], `lib/seed/personas.ts · HOSPITAL_SUBTYPES[${i}]`, "{F} {S} {C}");
  });

  // --- Traits ---
  add("traits.western", "Traits", "Western Sign Readings", "template", Object.entries(WESTERN_SIGN_TRAITS).map(([k, v]) => `${k}: ${v}`), "lib/seed/personaData.ts · WESTERN_SIGN_TRAITS (edit after the colon)");
  add("traits.chinese", "Traits", "Chinese Animal Readings", "template", Object.entries(CHINESE_ANIMAL_TRAITS).map(([k, v]) => `${k}: ${v}`), "lib/seed/personaData.ts · CHINESE_ANIMAL_TRAITS (edit after the colon)");
  add("traits.mbti", "Traits", "MBTI Readings", "template", Object.entries(MBTI_DESCRIPTIONS).map(([k, v]) => `${k}: ${v}`), "lib/seed/personaData.ts · MBTI_DESCRIPTIONS (edit after the colon)");

  return pools;
}
