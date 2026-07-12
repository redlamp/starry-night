// Provenance: given a resident (Persona), which content-registry entries
// built their sheet — and, run the other way, given a content entry, which
// residents drew it. Groundwork for "click a resident, see (and jump to) the
// lines that made them" and "click a line, see who has it" — read-only value
// lookups against the SAME source tables lib/writing/contentRegistry.ts
// registers, so a lookup here always agrees with what the writing lab shows.
//
// Determinism-neutral by construction: everything below is a REVERSE lookup
// against already-generated persona fields (no rng() calls, nothing fed back
// into generation). Safe to import from anywhere, including generation-
// adjacent code, without touching the draw path.
//
// What's implemented here: family name / maiden name (LAST_NAMES), given name
// (routed to nameCohorts.ts's decade tables — see Finding A below, NOT the
// registry's flat first-name pools), profession (PROFESSIONS, by title), and
// the three trait readings (western sign / Chinese animal / MBTI — keyed
// registry pools). What's deliberately NOT implemented yet: story-slot
// provenance (hook / whyAwake / detail / refusal / relation / domain) — see
// the TODO below.

import { CONTENT_IDS, CONTENT_ID_WIDTH } from "@/lib/writing/contentIds";
import { contentHashId, ordinalPositionKey, keyedPositionKey } from "@/lib/writing/contentHash";
import {
  LAST_NAMES,
  PROFESSIONS,
  WESTERN_SIGN_TRAITS,
  CHINESE_ANIMAL_TRAITS,
  MBTI_DESCRIPTIONS,
} from "@/lib/seed/personaData";
import { MASCULINE_BY_DECADE, FEMININE_BY_DECADE } from "@/lib/seed/nameCohorts";
import type { Persona, PersonaId } from "@/lib/seed/personas";

// --- References ---------------------------------------------------------------

// A reference to one entry in the content registry: enough to look it up
// (poolId + entryId) and jump to it in the writing lab, plus the resolved
// text so a caller doesn't need a second lookup just to display it.
export type SlotRef = {
  poolId: string;
  entryId: string;
  text: string;
};

// Given names are NOT a SlotRef: they don't come from a registered
// writing-lab pool (see Finding A below). Kept as its own shape so it can't
// be mistaken for a registry-resolvable reference — a caller that tries to
// route this into "jump to entry in the writing lab" should fail to compile,
// not fail at runtime against a poolId that doesn't exist.
export type NameCohortRef = {
  kind: "nameCohort";
  table: "m" | "f";
  decade: string; // "1980" — MASCULINE_BY_DECADE / FEMININE_BY_DECADE key
  name: string;
  weight: number;
};

function idFor(poolId: string, index: number): string {
  return CONTENT_IDS[poolId]?.[index] ?? contentHashId(ordinalPositionKey(poolId, index), CONTENT_ID_WIDTH);
}

function slotRefForArrayValue(
  poolId: string,
  pool: readonly string[],
  value: string,
): SlotRef | undefined {
  const index = pool.indexOf(value);
  if (index === -1) return undefined;
  return { poolId, entryId: idFor(poolId, index), text: value };
}

// Keyed pools (traits.western / traits.chinese / traits.mbti): contentRegistry
// .ts flattens the WHOLE Record into one pool's entries via
// Object.entries(...), so an entry's array index is just enumeration order,
// not a durable identity — scripts/genContentIds.ts keys these pools' ids by
// dictionary key instead (`${poolId}~${key}`, e.g. "traits.western~Aries").
// Mirror that here via CONTENT_IDS (the committed source of truth) rather
// than re-deriving the `${poolId}~${key}` formula independently, so the two
// can't drift if that scheme ever changes.
function keyedSlotRef(
  poolId: string,
  record: Record<string, string>,
  key: string,
): SlotRef | undefined {
  if (!(key in record)) return undefined;
  const index = Object.keys(record).indexOf(key);
  const entryId =
    CONTENT_IDS[poolId]?.[index] ?? contentHashId(keyedPositionKey(poolId, key), CONTENT_ID_WIDTH);
  return { poolId, entryId, text: `${key}: ${record[key]}` };
}

// --- Value-lookup accessors ---------------------------------------------------

export function familyNameProvenance(
  p: Pick<Persona, "familyName" | "maidenName">,
): { familyName?: SlotRef; maidenName?: SlotRef } {
  return {
    familyName: slotRefForArrayValue("names.last", LAST_NAMES, p.familyName),
    maidenName: p.maidenName ? slotRefForArrayValue("names.last", LAST_NAMES, p.maidenName) : undefined,
  };
}

export function professionProvenance(title: string | undefined): SlotRef | undefined {
  if (!title) return undefined;
  const index = PROFESSIONS.findIndex((p) => p.title === title);
  if (index === -1) return undefined;
  // contentRegistry.ts's "names.professions" pool is PROFESSIONS.map(p =>
  // p.title) — index-aligned with PROFESSIONS by construction.
  return { poolId: "names.professions", entryId: idFor("names.professions", index), text: title };
}

export function westernTraitProvenance(signName: string): SlotRef | undefined {
  return keyedSlotRef("traits.western", WESTERN_SIGN_TRAITS, signName);
}

export function chineseTraitProvenance(animal: string): SlotRef | undefined {
  return keyedSlotRef("traits.chinese", CHINESE_ANIMAL_TRAITS, animal);
}

export function mbtiTraitProvenance(mbtiType: string): SlotRef | undefined {
  return keyedSlotRef("traits.mbti", MBTI_DESCRIPTIONS, mbtiType);
}

// Finding A (2026-07-12 provenance audit): resident GIVEN names are drawn
// from nameCohorts.ts's decade-cohort tables (firstNameForBirthYear, over
// MASCULINE_BY_DECADE / FEMININE_BY_DECADE) — NOT the flat
// MASCULINE_FIRST_NAMES / FEMININE_FIRST_NAMES pools contentRegistry.ts
// exposes as "First Names · Masculine/Feminine". Those flat pools feed only
// OFFSTAGE relatives (personas.ts's offstage-relative draw, and
// personaStory.ts's kinFor() fallback) and the business-name {G} slot — never
// a resident's own given name. contentRegistry.ts's source notes for those
// two pools are annotated to say so; this function is the corrected route.
//
// nameCohorts.ts's ~450 rows (9 decades x ~25 names x 2 genders) aren't a
// registered writing-lab pool — it's sourced SSA demographic data, not
// hand-authored fiction content, and whether it SHOULD become an editable
// pool is a product call left to the orchestrator. Hence NameCohortRef
// instead of SlotRef (see its own comment).
//
// `pool` is the presentation ("m"/"f") the persona's given name actually drew
// from. Cis/trans residents map to it 1:1 (personas.ts's spec.presentation);
// nonbinary residents draw from EITHER table via a coin flip personas.ts
// makes at generation time and doesn't retain on the Persona object — pass
// `undefined` for those and this searches both tables for a match.
export function givenNameProvenance(
  birthYear: number,
  name: string,
  pool?: "m" | "f",
): NameCohortRef | undefined {
  const clamped = Math.min(2019, Math.max(1930, birthYear));
  const decadeKey = String(Math.floor(clamped / 10) * 10); // mirrors nameCohorts.ts's own (private) clamp/decade math — pure, no rng
  const candidates: Array<"m" | "f"> = pool ? [pool] : ["m", "f"];
  for (const p of candidates) {
    const table = p === "m" ? MASCULINE_BY_DECADE : FEMININE_BY_DECADE;
    const entries = table[decadeKey] ?? table["1930"];
    const entry = entries.find((e) => e.name === name);
    if (entry) return { kind: "nameCohort", table: p, decade: decadeKey, name: entry.name, weight: entry.weight };
  }
  return undefined;
}

// --- Story-slot provenance (deferred) -----------------------------------------
//
// personaStory.ts's weave (weavePersonaStory / weavePersonaRelation) picks a
// template per field (hook, whyAwake, detail, refusal, relation line, domain
// word) and immediately interpolates it via fill() — the picked template
// string is gone the moment it's filled; only the RESULT rides on
// PersonaStory. Tracing "which registry entry gave resident X their hook"
// needs the weave itself to forward-capture { poolId, entryId } per field AT
// PICK TIME, before fill() consumes it. That instrumentation touches
// personaStory.ts's rng()/pick() call sites, which is explicitly out of
// bounds for this pass (the orchestrator is doing it directly, to keep the
// two changes independently reviewable and personaCheck.ts's determinism
// fingerprint byte-identical throughout this one).
//
// TODO(story-slot-capture, owner: orchestrator): once personaStory.ts forward
// -captures { poolId, entryId } per StorySlotKind during the weave (candidate
// shape: a parallel `Map<PersonaId, StorySlotProvenance>` built alongside
// weaveStateFor's per-directory state, or a field riding along on
// PersonaStory itself), wire it into storyProvenance() below in place of the
// `forwardMap` parameter. Until then this returns undefined for every field —
// treat an absent `story` as "not captured yet", never as "this resident's
// sheet has no story content."
export type StorySlotKind = "hook" | "whyAwake" | "detail" | "refusal" | "relation" | "domain";

export type StorySlotProvenance = Partial<Record<StorySlotKind, SlotRef>>;

export type StoryForwardMap = Map<PersonaId, StorySlotProvenance>;

// Scaffolding only — safe no-op today. Call with an empty Map (or leave
// forwardMap undefined) and every persona's story provenance reads as "not
// yet captured" rather than throwing.
export function storyProvenance(
  personaId: PersonaId,
  forwardMap: StoryForwardMap | undefined,
): StorySlotProvenance | undefined {
  return forwardMap?.get(personaId);
}

// --- Assembled per-persona provenance ------------------------------------------

export type PersonaProvenance = {
  personaId: PersonaId;
  familyName?: SlotRef;
  maidenName?: SlotRef;
  givenName?: NameCohortRef;
  profession?: SlotRef;
  westernTrait?: SlotRef;
  chineseTrait?: SlotRef;
  mbtiTrait?: SlotRef;
  // undefined until the weave forward-captures it — see the TODO above.
  story?: StorySlotProvenance;
};

// Assembles the determinism-neutral parts (pure value lookups — no rng, no
// dependency on the weave's forward-capture). Story-slot provenance is
// layered in separately via storyProvenance()/a StoryForwardMap, passed in
// explicitly rather than this module reaching into personaStory.ts's
// internals to get it.
//
// Trait names (westernSignName / chineseAnimal / mbtiType) are passed in
// rather than derived here: westernSign/chineseSign live on Persona directly,
// but MBTI is deep-tier flavour from personaFlavor() (a separate, per-persona
// -stream call) — this function stays a pure assembler and leaves calling
// personaFlavor() to the caller, who likely already has the result on hand.
export function buildPersonaProvenance(
  p: Pick<Persona, "id" | "familyName" | "maidenName" | "birthday" | "genderIdentity" | "givenName"> & {
    profession?: { title: string };
  },
  westernSignName: string,
  chineseAnimal: string,
  mbtiType: string | undefined,
  storySlots?: StorySlotProvenance,
): PersonaProvenance {
  // Cis/trans residents map 1:1 to the pool their given name actually drew
  // from (personas.ts's spec.presentation); nonbinary residents' pool choice
  // isn't retained on Persona (see givenNameProvenance's own comment), so
  // leave it undefined and let that function search both tables.
  const namePool: "m" | "f" | undefined =
    p.genderIdentity === "cis man" || p.genderIdentity === "trans man"
      ? "m"
      : p.genderIdentity === "cis woman" || p.genderIdentity === "trans woman"
        ? "f"
        : undefined;

  return {
    personaId: p.id,
    ...familyNameProvenance(p),
    givenName: givenNameProvenance(p.birthday.year, p.givenName, namePool),
    profession: professionProvenance(p.profession?.title),
    westernTrait: westernTraitProvenance(westernSignName),
    chineseTrait: chineseTraitProvenance(chineseAnimal),
    mbtiTrait: mbtiType ? mbtiTraitProvenance(mbtiType) : undefined,
    story: storySlots,
  };
}

// --- Inverse index -------------------------------------------------------------

// entryId -> personas who drew it. The mirror image of PersonaProvenance
// ("what did this resident draw") — lets the writing lab answer "who has
// this line" starting from an entry instead of a resident.
export type InverseProvenance = Map<string, Set<PersonaId>>;

// Scaffolding: builds the inverse index from whatever buildPersonaProvenance
// (+ storyProvenance, once wired) currently returns per persona.
// `provenanceFor` is a callback rather than a pre-built
// Map<PersonaId,PersonaProvenance> so this can scale to the ~39k-persona
// directory without forcing every persona's provenance to be materialized
// up front — consistent with the rest of the persona layer's lazy-build
// philosophy (ensureBuildingStories et al. in lib/seed/personaStory.ts).
// Until story-slot capture lands (see the TODO above), this still runs and
// still indexes the value-lookup fields (family name, profession, traits) —
// it just has no story-slot entries to add yet.
export function buildInverseProvenance(
  personaIds: Iterable<PersonaId>,
  provenanceFor: (id: PersonaId) => PersonaProvenance | undefined,
): InverseProvenance {
  const inverse: InverseProvenance = new Map();
  const add = (ref: SlotRef | undefined, personaId: PersonaId) => {
    if (!ref) return;
    const set = inverse.get(ref.entryId) ?? new Set<PersonaId>();
    set.add(personaId);
    inverse.set(ref.entryId, set);
  };

  for (const id of personaIds) {
    const prov = provenanceFor(id);
    if (!prov) continue;
    add(prov.familyName, id);
    add(prov.maidenName, id);
    add(prov.profession, id);
    add(prov.westernTrait, id);
    add(prov.chineseTrait, id);
    add(prov.mbtiTrait, id);
    if (prov.story) {
      for (const ref of Object.values(prov.story)) add(ref, id);
    }
  }
  return inverse;
}
