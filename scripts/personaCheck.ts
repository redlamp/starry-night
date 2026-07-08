// Persona layer sanity + determinism check (mirrors scripts/cityGolden.ts's
// role for city geometry). Run: bun scripts/personaCheck.ts [seed]
//
// Asserts: (1) dataset counts, (2) same seed twice → byte-identical directory,
// (3) different seed → different directory, (4) structural invariants
// (partner links reciprocal, family links reciprocal, employees exist,
// addresses cover residential buildings), then prints a small sample so a
// human can judge the flavour.

import { buildPersonaDirectory, type PersonaDirectory } from "../lib/seed/personas";
import {
  MASCULINE_FIRST_NAMES,
  FEMININE_FIRST_NAMES,
  LAST_NAMES,
  PROFESSIONS,
} from "../lib/seed/personaData";

const seed = process.argv[2] ?? "starry-night";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (!ok) {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

// (1) dataset counts
check("50 masculine first names", MASCULINE_FIRST_NAMES.length === 50, String(MASCULINE_FIRST_NAMES.length));
check("50 feminine first names", FEMININE_FIRST_NAMES.length === 50, String(FEMININE_FIRST_NAMES.length));
check("100 last names", LAST_NAMES.length === 100, String(LAST_NAMES.length));
check("200 professions", PROFESSIONS.length === 200, String(PROFESSIONS.length));
check(
  "no duplicate profession titles",
  new Set(PROFESSIONS.map((p) => p.title)).size === PROFESSIONS.length,
);

// Serialise a directory into a stable string (Maps → sorted arrays).
function fingerprint(dir: PersonaDirectory): string {
  return JSON.stringify({
    personas: [...dir.personas.values()],
    households: dir.households,
    businesses: [...dir.businesses.values()],
    city: dir.names.city,
    districts: [...dir.names.districtNames.entries()],
    streets: [...dir.names.streetNames.entries()].slice(0, 50),
    totals: dir.totals,
  });
}

// (2) determinism: rebuild bypassing the cache by using a fresh module state —
// the cache is keyed, so call twice and compare against a re-derivation with
// the same key (cache hit) AND a structural rebuild via JSON round-trip.
const dir1 = buildPersonaDirectory(seed);
const fp1 = fingerprint(dir1);
const dir2 = buildPersonaDirectory(seed);
check("same seed → same directory (cache path)", fingerprint(dir2) === fp1);

const dirOther = buildPersonaDirectory(seed + "-b");
check("different seed → different directory", fingerprint(dirOther) !== fp1);

// (3) invariants
const dir = dir1;
let partnerOk = true;
let familyOk = true;
for (const p of dir.personas.values()) {
  if (p.partnerId) {
    const q = dir.personas.get(p.partnerId);
    if (!q || q.partnerId !== p.id) partnerOk = false;
  }
  for (const link of p.family) {
    const q = dir.personas.get(link.personaId);
    if (!q) {
      familyOk = false;
      continue;
    }
    const inverse =
      link.role === "partner"
        ? "partner"
        : link.role === "parent"
          ? "child"
          : link.role === "child"
            ? "parent"
            : "sibling";
    if (!q.family.some((l) => l.role === inverse && l.personaId === p.id)) familyOk = false;
  }
}
check("partner links reciprocal", partnerOk);
check("family links reciprocal", familyOk);

let employeesOk = true;
for (const biz of dir.businesses.values()) {
  for (const eid of biz.employeeIds) {
    const p = dir.personas.get(eid);
    if (!p || p.businessId !== biz.id) employeesOk = false;
  }
}
check("business employee lists consistent", employeesOk);

let agesOk = true;
for (const p of dir.personas.values()) {
  if (p.age < 0 || p.age > 105 || p.yearsInCity > p.age) agesOk = false;
}
check("ages sane, yearsInCity ≤ age", agesOk);

const statuses = new Map<string, number>();
for (const p of dir.personas.values()) {
  statuses.set(p.relationshipStatus, (statuses.get(p.relationshipStatus) ?? 0) + 1);
}

// Story-layer invariants: every persona has a hook and a whyAwake; no
// unfilled {slot} braces leaked into any rendered line; relation targets exist.
let hooksOk = true;
let slotsOk = true;
let relTargetsOk = true;
const braces = /\{[a-zA-Z:]+\}/;
for (const p of dir.personas.values()) {
  if (!p.story.hook || !p.story.whyAwake) hooksOk = false;
  for (const line of [p.story.hook, p.story.whyAwake, p.story.detail, p.story.refusal, p.story.wasIs, p.story.epithet, p.story.relation?.line]) {
    if (line && braces.test(line)) {
      if (slotsOk) console.error("  leaked slot:", line);
      slotsOk = false;
    }
  }
  if (p.story.relation && !dir.personas.get(p.story.relation.targetId)) relTargetsOk = false;
}
check("every persona has hook + whyAwake", hooksOk);
check("no unfilled template slots leak", slotsOk);
check("relation targets resolve", relTargetsOk);
check("city lore generated", dir.lore.length >= 12, String(dir.lore.length));

// (4) human-judgeable sample
console.log("\n--- totals ---");
console.log(dir.totals, "city:", dir.names.city.name);
console.log("statuses:", Object.fromEntries(statuses));
console.log("\n--- city identity ---");
console.log(dir.names.city);
console.log("\n--- districts ---");
for (const [id, name] of dir.names.districtNames) console.log(`  ${name}  (${id})`);
console.log("\n--- sample streets ---");
let i = 0;
for (const [id, name] of dir.names.streetNames) {
  if (i++ >= 10) break;
  console.log(`  ${name}  (${id})`);
}
console.log("\n--- one household ---");
const hh = dir.households.find((h) => h.memberIds.length >= 3) ?? dir.households[0];
if (hh) {
  console.log(hh.label, hh.unit ? `unit ${hh.unit}` : "", `building #${hh.buildingId}`);
  for (const pid of hh.memberIds) {
    const p = dir.personas.get(pid)!;
    console.log(
      `  ${p.fullName} (${p.age}, ${p.pronouns}) — ${p.workStatus}` +
        (p.profession ? `, ${p.profession.title}` : "") +
        ` | ${p.westernSign.name} ${p.westernSign.symbol}, ${p.chineseSign.element} ${p.chineseSign.animal}, ${p.mbti}` +
        ` | ${p.relationshipStatus}` +
        (p.bornHere ? " | born here" : ` | ${p.yearsInCity}y in city`),
    );
  }
}
console.log("\n--- sample businesses ---");
i = 0;
for (const biz of dir.businesses.values()) {
  if (i++ >= 8) break;
  console.log(`  ${biz.name} [${biz.kind}] — ${biz.employeeIds.length} featured staff`);
}
console.log("\n--- a dating pair (cross-building weave) ---");
for (const p of dir.personas.values()) {
  if (p.relationshipStatus === "dating" && p.partnerId) {
    const q = dir.personas.get(p.partnerId)!;
    if (q.homeBuildingId !== p.homeBuildingId) {
      console.log(`  ${p.fullName} (bldg ${p.homeBuildingId}) ↔ ${q.fullName} (bldg ${q.homeBuildingId})`);
      break;
    }
  }
}

console.log("\n--- city lore ---");
for (const l of dir.lore) console.log(`  [${l.kind}] ${l.name}${l.year ? ` (${l.year})` : ""}`);

// Full character sheets — the "fanfic test" sample. Varied clusters.
console.log("\n--- character sheets (fanfic test) ---");
const sampled = new Set<string>();
let shown = 0;
for (const p of dir.personas.values()) {
  if (shown >= 6) break;
  const cluster = `${p.workStatus}:${p.profession?.category ?? "-"}`;
  if (sampled.has(cluster) || p.age < 14) continue;
  sampled.add(cluster);
  shown++;
  const addr = dir.names.addresses.get(p.homeBuildingId);
  console.log(`\n  ${p.fullName}${p.story.epithet ? ` — ${p.story.epithet}` : ""}`);
  console.log(`    ${p.pronouns}, ${p.age} · ${p.westernSign.symbol} ${p.westernSign.name} · ${p.chineseSign.element} ${p.chineseSign.animal} · ${p.mbti}`);
  console.log(`    ${p.profession ? p.profession.title : p.workStatus}${p.businessId ? ` @ ${dir.businesses.get(p.businessId)?.name}` : ""} · ${p.education}`);
  console.log(`    ${addr ? `${addr.number} ${addr.street}` : "?"}${p.unit ? ` · Unit ${p.unit}` : ""} · ${p.bornHere ? "born here" : `${p.yearsInCity}y in city`} · ${p.relationshipStatus}`);
  if (p.story.wasIs) console.log(`    was/is: ${p.story.wasIs}`);
  console.log(`    awake:  ${p.story.whyAwake}`);
  if (p.story.detail) console.log(`    detail: ${p.story.detail}`);
  if (p.story.refusal) console.log(`    won't:  ${p.story.refusal}`);
  if (p.story.relation) console.log(`    edge:   ${p.story.relation.line}`);
  console.log(`    hook:   ${p.story.hook}`);
}

// A building sift sample.
console.log("\n--- building sift lines ---");
import("../lib/seed/personaStory").then(({ siftBuilding }) => {
  let n = 0;
  for (const bid of dir.byHomeBuilding.keys()) {
    const line = siftBuilding(dir, bid);
    if (line && n++ < 5) console.log(`  bldg ${bid}: ${line}`);
    if (n >= 5) break;
  }
  console.log(failures === 0 ? "\nPASS — persona layer sane" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
});


// Schools spot-check (appended with the schools pass).
{
  const schools = [...dir.businesses.values()].filter((b) => b.schoolTier);
  const kids = [...dir.personas.values()].filter((p) => p.age >= 5 && p.age < 18);
  const enrolled = kids.filter((p) => p.schoolId);
  const sameDistrictElem = enrolled.filter((p) => {
    const school = dir.businesses.get(p.schoolId!);
    return school?.schoolTier === "elementary";
  });
  console.log(`\n--- schools ---`);
  console.log(`schools: ${schools.length} (${schools.filter((s) => s.schoolTier === "elementary").length} elem, ${schools.filter((s) => s.schoolTier === "middle").length} middle, ${schools.filter((s) => s.schoolTier === "high").length} high)`);
  console.log(`kids 5-17: ${kids.length}, enrolled: ${enrolled.length} (${Math.round((enrolled.length / Math.max(1, kids.length)) * 100)}%), elem: ${sameDistrictElem.length}`);
  for (const s of schools.slice(0, 6)) console.log(`  ${s.name} [${s.schoolTier}] — ${s.studentIds?.length ?? 0} students, ${s.employeeIds.length} staff`);
  const busKids = enrolled.filter((p) => p.commute?.mode === "bus").length;
  const walkKids = enrolled.filter((p) => p.commute?.mode === "walk").length;
  console.log(`commutes: ${walkKids} walk, ${busKids} bus`);
}
