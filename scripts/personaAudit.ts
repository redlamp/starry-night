// Expressive-range audit for the persona story layer (the "oatmeal gate",
// after Kate Compton): counts how often each rendered line recurs citywide so
// thin template pools show up as data instead of vibes. Run after any pool
// edit: bun scripts/personaAudit.ts [seed]

import { buildPersonaDirectory } from "../lib/seed/personas";

const seed = process.argv[2] ?? "starry-night";
const dir = buildPersonaDirectory(seed);

type Tally = Map<string, number>;
const bump = (t: Tally, k: string | undefined) => {
  if (k) t.set(k, (t.get(k) ?? 0) + 1);
};

const hooks: Tally = new Map();
const details: Tally = new Map();
const awakes: Tally = new Map();
const epithets: Tally = new Map();
const domains: Tally = new Map();
let withDomainLines = 0;
let crossBuildingFamilies = 0;

for (const p of dir.personas.values()) {
  bump(hooks, p.story.hook);
  bump(details, p.story.detail);
  bump(awakes, p.story.whyAwake);
  bump(epithets, p.story.epithet);
  bump(domains, p.domain);
  const domainOnSheet =
    (p.story.detail?.includes(p.domain) ?? false) || p.story.hook.includes(p.domain);
  if (domainOnSheet) withDomainLines++;
  for (const l of p.family) {
    if (l.role === "parent") {
      const q = dir.personas.get(l.personaId);
      if (q && q.homeBuildingId !== p.homeBuildingId) crossBuildingFamilies++;
    }
  }
}

function report(name: string, t: Tally, population: number) {
  const counts = [...t.values()].sort((a, b) => b - a);
  const distinct = t.size;
  const top = [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`\n== ${name} ==`);
  console.log(
    `  distinct rendered lines: ${distinct} · coverage: ${counts.reduce((a, b) => a + b, 0)}/${population}` +
      ` · max repeat: ${counts[0] ?? 0}`,
  );
  for (const [line, n] of top) {
    console.log(`  ${String(n).padStart(6)}×  ${line.length > 90 ? line.slice(0, 87) + "..." : line}`);
  }
}

const n = dir.personas.size;
console.log(`personas: ${n} · city: ${dir.names.city.name} · seed: ${seed}`);
console.log(`personas whose sheet repeats their domain word: ${withDomainLines}`);
console.log(`cross-building parent links: ${crossBuildingFamilies}`);
report("hooks", hooks, n);
report("details", details, n);
report("whyAwake", awakes, n);
report("epithets", epithets, n);
console.log(`\ndomain words in use: ${domains.size}/${32}`);
