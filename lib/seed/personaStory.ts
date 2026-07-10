import { seededRng } from "./rng";
import type { Persona, PersonaId, PersonaDirectory } from "./personas";
import type { CityNames } from "./naming";
import type { ProfessionCategory } from "./personaData";

// Story layer: turns a persona's dry facts into the four or five lines a
// player actually remembers. Design rules (from the procgen-character research
// — see wiki/research/procgen-character-design-games.md):
//
//   1. Authored shapes, procedural casting — every sentence here is
//      hand-written with typed slots; the generator only picks and fills.
//   2. Voice comes FROM the data: template pools are scoped to a persona's
//      life cluster (night nurse ≠ payroll clerk); no global grab-bag.
//   3. State the fact, withhold the feeling: no emotion words, no "because",
//      no inner-state adjectives. The player supplies the pathos.
//   4. One-sided relations: A's sheet mentions B; B's sheet doesn't know.
//   5. Shared lore nouns: a small per-city pool of named places/events/bands
//      that many sheets touch, so two clicked strangers imply one world.
//   6. The hook is always last and never resolved.

// --- Types --------------------------------------------------------------------

export type LoreKind = "place" | "event" | "band" | "scandal" | "past-business";

export type CityLoreEntry = { id: string; name: string; kind: LoreKind; year?: number };

export type StoryRelation = { verb: string; targetId: PersonaId; line: string };

export type PersonaStory = {
  epithet?: string; // "the night baker" — lowercase, the neighbor's name for them
  wasIs?: string; // two-beat past/present with a gap in the middle
  whyAwake?: string; // anchors the sheet to the lit window the player clicked
  detail?: string; // one vivid possession/habit
  refusal?: string; // one thing they won't do, unexplained
  hook: string; // the unresolved line — always present, always last
  relation?: StoryRelation;
  loreRefs: string[]; // lore ids this sheet touches
};

export type ShiftKind = "day" | "evening" | "night" | "early" | "irregular" | "none";

// --- City lore ------------------------------------------------------------------

const LORE_BAND_SUFFIX = ["Wives", "Brothers", "Radio", "Arms", "Sisters", "Committee", "Regulars"];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function buildCityLore(masterSeed: string, names: CityNames): CityLoreEntry[] {
  const rng = seededRng(`${masterSeed}::personas::lore`);
  const streets = [...names.streetNames.values()];
  const streetBase = () => {
    const s = streets.length > 0 ? pick(rng, streets) : "Harbor Street";
    return s.split(" ").slice(0, -1).join(" ") || s;
  };
  const surname = () => pick(rng, ["Marsden", "Calder", "Okafor", "Vance", "Ruiz", "Whitlock", "Ferris", "Nakata"]);
  const yy = () => 1998 + Math.floor(rng() * 27);

  const lore: CityLoreEntry[] = [];
  const add = (kind: LoreKind, name: string, year?: number) =>
    lore.push({ id: `lore:${lore.length}`, name, kind, year });

  add("place", `the old ${streetBase()} cannery`);
  add("place", `the ${streetBase()} overpass`);
  add("place", `the all-night laundromat on ${streetBase()}`);
  add("place", "the 4 a.m. ferry");
  add("place", `the ${streetBase()} reservoir`);
  const blackout = yy();
  add("event", `the blackout of '${String(blackout).slice(2)}`, blackout);
  const flood = yy();
  add("event", `the flood of '${String(flood).slice(2)}`, flood);
  add("event", `the ${streetBase()} fire`, yy());
  add("event", "the summer the cicadas came early");
  add("band", `The ${surname()} ${pick(rng, LORE_BAND_SUFFIX)}`);
  add("band", `The ${streetBase()} ${pick(rng, LORE_BAND_SUFFIX)}`);
  add("scandal", `the ${surname()} embezzlement`, yy());
  add("scandal", "the parking-meter scandal", yy());
  add("past-business", `${pick(rng, ["Gino's", "Marta's", "The Blue Door", "Kelly's"])}, before it closed`);
  add("past-business", "the diner that used to be the bank");
  return lore;
}

// --- Clusters --------------------------------------------------------------------

// A persona's "life cluster" owns its template pools. Derived, never stored.
export type StoryCluster =
  | "kid"
  | "teen"
  | "student"
  | "retired"
  | "between-jobs"
  | "homemaker"
  | "healthcare"
  | "food"
  | "office"
  | "trades"
  | "arts"
  | "retail"
  | "education"
  | "transit"
  | "safety"
  | "generic";

const CATEGORY_CLUSTER: Partial<Record<ProfessionCategory, StoryCluster>> = {
  Healthcare: "healthcare",
  "Food Service": "food",
  Technology: "office",
  Finance: "office",
  Legal: "office",
  "Office & Admin": "office",
  Management: "office",
  Sales: "office",
  Science: "office",
  "Construction & Trades": "trades",
  Manufacturing: "trades",
  Agriculture: "trades",
  Transportation: "transit",
  "Arts & Media": "arts",
  Retail: "retail",
  "Personal Care": "retail",
  Hospitality: "retail",
  Education: "education",
  "Public Safety": "safety",
};

export function clusterFor(p: Persona): StoryCluster {
  if (p.age < 13) return "kid";
  if (p.age < 18) return "teen";
  if (p.workStatus === "student") return "student";
  if (p.workStatus === "retired") return "retired";
  if (p.workStatus === "between jobs") return "between-jobs";
  if (p.workStatus === "homemaker") return "homemaker";
  return (p.profession && CATEGORY_CLUSTER[p.profession.category]) || "generic";
}

// --- Schedules ---------------------------------------------------------------------

const NIGHT_TITLES = new Set([
  "Registered Nurse", "Licensed Practical Nurse", "Certified Nursing Assistant",
  "Paramedic", "Security Guard", "Emergency Dispatcher", "Police Officer",
  "Firefighter", "Correctional Officer", "Warehouse Worker", "Forklift Operator",
  "Machine Operator", "Production Worker", "Janitor", "Custodian",
  "Hotel Front Desk Clerk", "Casino Dealer", "Truck Driver",
]);
const EARLY_TITLES = new Set([
  "Baker", "Barista", "Farmworker", "Farmer", "Rancher", "Mail Carrier",
  "Grocery Clerk", "Fast Food Worker", "Bus Driver",
]);
const EVENING_TITLES = new Set([
  "Server", "Bartender", "Line Cook", "Cook", "Chef", "Dishwasher", "Host",
  "Musician", "Actor", "Restaurant Manager",
]);
const IRREGULAR_TITLES = new Set([
  "Rideshare Driver", "Taxi Driver", "Delivery Driver", "Courier", "Writer",
  "Photographer", "Flight Attendant", "Airline Pilot", "Substitute Teacher",
]);

export function shiftFor(p: Persona, rng: () => number): ShiftKind {
  if (p.age < 18 || p.workStatus === "retired" || p.workStatus === "homemaker") return "none";
  if (p.workStatus === "student") return rng() < 0.5 ? "irregular" : "day";
  const title = p.profession?.title ?? "";
  if (NIGHT_TITLES.has(title)) return rng() < 0.55 ? "night" : "day";
  if (EARLY_TITLES.has(title)) return rng() < 0.7 ? "early" : "day";
  if (EVENING_TITLES.has(title)) return rng() < 0.8 ? "evening" : "day";
  if (IRREGULAR_TITLES.has(title)) return "irregular";
  return rng() < 0.06 ? "night" : "day";
}

// --- Template pools -----------------------------------------------------------------
// Slot grammar: {given} {family} {kin} {kinrole} {street} {district} {city}
// {paper} {transit} {biz} {his} {he} {N} {lore:place} {lore:event} {lore:band}
// {lore:scandal} {lore:past} — filled by fill() below. Author rules: concrete
// nouns, no emotion words, no "because", never resolve.

export const HOOKS_GENERIC = [
  "Mails a letter to {kin} on the first of every month. Nothing has come back yet.",
  "Keeps a shoebox of photographs from {lore:event} in the hall closet, face down.",
  "There is a second toothbrush in the cup. There has been for two years.",
  "The lease renewal has sat on the counter, unsigned, for nine days.",
  "Someone keys the same word into the lobby directory every Friday. {given} knows who.",
  "Has {kin}'s number written on the back of the electric bill. The phone stays in the drawer.",
  "Bought two tickets for the 4 a.m. ferry. Both unused, both kept.",
  "The box from the old apartment is still taped shut. It is labeled DO NOT.",
  "Won a bet about {lore:scandal} and never collected.",
  "Keeps a key that fits no door in the building.",
];

export const HOOKS_OUTSIZED = [
  "Is building a boat in the living room. The living room is on the {N}th floor.",
  "Has won the lottery twice. Small amounts. Told no one either time.",
  "The crows started following {given} home in March. {given} has started leaving earlier.",
  "Owns a police scanner, a jeweler's loupe, and a growing map of the {district} storm drains.",
  "Answers a payphone on {street} every Sunday at nine. It has never been wrong.",
];

export const HOOKS_BY_CLUSTER: Record<StoryCluster, string[]> = {
  kid: [
    "Has named every pigeon on the sill. One is missing.",
    "Is digging to somewhere under the hedge. The maps live in a cereal box.",
    "Trades homework answers for playground rumors. Keeps a ledger.",
    "Saw something in the reservoir on the class trip. The drawing is under the bed.",
    "Left a note in the library book before returning it. Checks weekly whether the book is out.",
    "Has a shoebox labeled EVIDENCE. Its contents change every week.",
    "Is teaching the dog next door a trick its owners don't know about.",
    "Knows a shortcut between {street} and school that no adult has ever used.",
    "Waves at the {transit} every night at the same minute. Once, someone waved back.",
    "Keeps losing tooth number eight's payment under the pillow. Suspects an inside job.",
  ],
  teen: [
    "The acceptance letter from the other school is still sealed.",
    "Practices a band's set list alone; the band does not exist yet.",
    "Knows which window on {street} blinks its lights back. Hasn't told anyone.",
    "Keeps bus fare to {kin}'s city in a sock. Counts it Sundays.",
    "Has 4,000 photographs of the same intersection at night. Number 4,001 tonight.",
    "Wrote a letter to {paper} under {his} mother's name. It ran.",
    "Is two badges from finishing a scouting program that was discontinued years ago.",
    "The driving permit sits unused. The bike knows every street by now.",
    "Someone at school knows what happened at {lore:place}. Sits two rows back.",
    "Sells homework help for favors, not money. The ledger of favors is getting heavy.",
  ],
  student: [
    "The thesis is on hold. The reason is in the third drawer down.",
    "Audits a class {his} dead {kinrole} used to teach. Sits in the back row.",
    "The acceptance letter from the other school is still sealed.",
    "Has read one page of {lore:past}'s old menu like a text, over and over.",
  ],
  retired: [
    "The toolbox is oiled monthly. The phone stays quiet.",
    "Walks to {lore:place} every morning and back before the buses run. Never inside.",
    "Keeps {his} old license in the sock drawer, current, renewed on time.",
    "Writes letters to {paper} under a different name. Two have run.",
    "Still has the retirement card. Everyone signed it but one.",
  ],
  "between-jobs": [
    "The alarm is still set for the old shift.",
    "The suit hangs pressed by the door. The interviews stopped calling in April.",
    "Has walked to {biz} three times and never gone in.",
    "The severance ran out in March. The rent has cleared every month since.",
  ],
  homemaker: [
    "Runs the building's unofficial lost-and-found from a shoebox in the hall.",
    "Knows every delivery driver's name and which apartment lies about being home.",
    "The grocery list is in two handwritings. One hasn't changed in years.",
  ],
  healthcare: [
    "Knows the exact number of steps between the bus stop and the ward. Counts anyway.",
    "Keeps a patient's paper crane on the windowsill. Never learned the name.",
    "Has called in sick once in nine years. That date is circled on no calendar.",
    "The scrubs go straight in the wash; one pocket is always emptied in the dark.",
  ],
  food: [
    "Keeps the restaurant's last menu taped inside a kitchen cabinet.",
    "Refuses to plate the special at home. Makes it perfectly, once a year.",
    "There's a name in the reservation book from {lore:event}. It rebooks every year. It never shows.",
    "Feeds someone at the back door at close. Has never asked where they sleep.",
  ],
  office: [
    "Has a resignation letter saved as draft nine.",
    "The desk plant is plastic. The watering can is not.",
    "Knows which floor's lights stay on all night and has started keeping notes.",
    "Two monitors at home: one for work, one that only shows tide charts.",
    "Expenses the same lunch every Thursday with someone whose name appears nowhere else.",
  ],
  trades: [
    "Built the shelving in half the shops on {street}. Never sent {kin} an invoice.",
    "Keeps the first dollar the business made and the writ that nearly ended it, same frame.",
    "Can hear which machine is wrong from the parking lot. Hasn't told the foreman which.",
    "There is a beam in {lore:place} with two sets of initials in the concrete.",
  ],
  arts: [
    "The good guitar hangs on the wall. The pawn ticket for the other one is in a drawer.",
    "Played bass in {lore:band}. They opened for someone famous once. Ask which.",
    "Paints the same window from memory. It is not a window in this city.",
    "Has a finished manuscript and a list of eleven agents, ten crossed out.",
  ],
  retail: [
    "Can tell the regulars by the door chime. One hasn't come in since March.",
    "Keeps a layaway ticket from {lore:past} in the register. Paid in full, never collected.",
    "Knows what everyone on {street} buys at 2 a.m. and has never said a word.",
    "The tip jar has a foreign coin that keeps coming back.",
  ],
  education: [
    "Keeps every class photo. One face is circled in pencil.",
    "A student from {N} years ago sends postcards with no return address. They're in date order.",
    "Grades harder in October. The reason is in the 2019 yearbook.",
    "Still has the confiscated note. It was never about what everyone assumed.",
  ],
  transit: [
    "Knows the last passenger on the last run by first name. Has never seen them in daylight.",
    "Keeps a lost-property umbrella that no one will ever claim. Checks the tag anyway.",
    "Has driven every street in {city} except one.",
    "The route sheet says twelve stops. {given} makes thirteen.",
  ],
  safety: [
    "Kept one page from a case file everyone else closed.",
    "Knows what actually started the {lore:event}. The report says otherwise.",
    "Walks past {lore:place} on the way home. It is not on the way home.",
    "The medal is in a drawer with the batteries and the takeout menus.",
  ],
  generic: [
    "Keeps a train ticket dated next month, destination smudged.",
    "The calendar has one date crossed out so hard the paper tore.",
    "Waters the plants of an apartment that has been empty since spring.",
  ],
};

export const DETAILS: Array<{ line: string; epithet?: string }> = [
  { line: "Feeds the crows on the fire escape at six sharp.", epithet: "the one who feeds the crows" },
  { line: "Has a telescope aimed at nothing in particular.", epithet: "the one with the telescope" },
  { line: "Grows tomatoes under a shop light in the hall closet.", epithet: "the tomato one" },
  { line: "Tapes every fortune-cookie fortune to the fridge, verbatim.", epithet: "the fortune keeper" },
  { line: "Salts the whole block's sidewalk before anyone wakes.", epithet: "the sidewalk salter" },
  { line: "Owns eleven copies of the same paperback, from eleven cities." },
  { line: "Practices signatures on junk mail." },
  { line: "Keeps a go-bag by the door, packed for two." },
  { line: "Whistles the same four notes on the stairs. Nobody knows the fifth." },
  { line: "Irons the newspaper flat before reading it. {his} {kinrole} did too." },
  { line: "Leaves the hallway light on for the cat. There is no cat.", epithet: "the hall-light one" },
  { line: "Collects keys from flea markets. Labels each with where it will not open." },
];

// --- Domain words -------------------------------------------------------------
// Grinblat (Caves of Qud): one archetypal noun per figure, referenced by many
// templates, and a coherent personality emerges from pure repetition. Every
// persona gets a domain; when both their detail AND their hook draw from the
// domain pools, the sheet reads like one person instead of two dice rolls.
// All entries are plural/mass nouns so the templates below stay grammatical.

export const DOMAIN_WORDS = [
  "crows", "radios", "tide charts", "orchids", "stray cats", "old maps",
  "knots", "postcards", "clocks", "matchbooks", "crosswords", "old westerns",
  "thunderstorms", "model trains", "bees", "typewriters", "constellations",
  "soup recipes", "locks", "brass buttons", "moths", "pigeons", "umbrellas",
  "polaroids", "marbles", "candle stubs", "spare keys", "ferns",
  "jigsaw puzzles", "fountain pens", "chess problems", "bus transfers",
];

export const DOMAIN_DETAILS = [
  "The windowsill is given over entirely to {domain}.",
  "There is a notebook about {domain}. It is the ninth notebook.",
  "Can talk about {domain} for exactly as long as you will stand there.",
  "The good shelf is for {domain}. Guests get the other shelf.",
  "Keeps a small museum of {domain} in the hall closet. Curated. Labeled.",
  "Trades in {domain} at the flea market. Not for the money.",
  "Draws {domain} on napkins, receipts, the backs of envelopes.",
  "Photographs {domain} with the phone held sideways, every time.",
];

export const DOMAIN_HOOKS = [
  "Sold the {domain} collection in the spring. Started a new one by July.",
  "Someone leaves {domain} outside the door now and then. {given} has stopped asking who.",
  "Is one item short of the complete set of {domain}. Knows exactly where it is.",
  "Mailed the best of the {domain} to {kin} without a note.",
  "The insurance form has a line for {domain}. The number written there is not a joke.",
  "Two people in this city collect {domain}. They have never spoken.",
];

export const REFUSALS = [
  "Hasn't taken the elevator since the spring.",
  "Won't cook fish in the apartment.",
  "Crosses the street to avoid the old office.",
  "Won't say the landlord's name out loud.",
  "Never opens the door on the first knock.",
  "Won't ride the {transit} after the thing with the umbrella.",
  "Will not keep a photograph on the fridge. Frames only.",
  "Won't work Sundays. Any money, any weather.",
  "Never orders the special. Anywhere.",
  "Won't walk past {lore:place} after dark.",
];

// Two-beat wasIs: a past clause with a built-in gap against the present job.
// The present half is composed from the persona's actual profession.
export const WAS_CLAUSES = [
  "Studied cello performance",
  "Had a tryout with a farm team",
  "Ran a food truck with {his} {kinrole}",
  "Taught high-school chemistry for a decade",
  "Was three credits short of a philosophy degree",
  "Toured two summers with {lore:band}",
  "Grew up on a dairy farm",
  "Flew crop dusters out west",
  "Wrote obituaries for {paper}",
  "Held a state record for the 800 metres",
  "Apprenticed with a clockmaker",
  "Dealt cards on a riverboat",
];

export const WHY_AWAKE: Record<ShiftKind, string[]> = {
  night: [
    "Third double this week. The kettle has been on twice since midnight.",
    "Gets home at four and won't sleep before the birds start.",
    "Works the desk nobody visits until something goes wrong. Tonight it hasn't, yet.",
    "The shift ended at eleven. The hands are still going through the motions of it.",
  ],
  early: [
    "The ovens come on at three. {given} stopped fighting it years ago.",
    "The shift starts before the buses run. The walk is rehearsed in the kitchen first.",
    "Asleep by eight, up at half past two. This is the quiet hour in between.",
  ],
  evening: [
    "Just off shift. The apartment is still at restaurant volume.",
    "Counting the drawer twice, at home, from memory.",
    "The last table left at eleven. The replay of it is still running.",
  ],
  day: [
    "Should be asleep. The upstairs neighbor is pacing again.",
    "Fell asleep on the couch at nine. Wide awake now, and the kitchen knows it.",
    "The blue light is a movie {given} has seen eleven times.",
    "Woke at three to check a lock that was locked.",
    "Tomorrow's clothes are laid out. The lamp stays on anyway.",
    "There is a list on the counter with one item left. It has been one item for a week.",
    "The tea went cold an hour ago. The chair still fits.",
    "Every window on {street} is dark except this one and one other. {given} has noticed the other.",
    "The phone is face-down on the far side of the room. The lamp is a compromise.",
    "Started a letter at ten. The wastebasket has four openings; the page has one line.",
    "The dishwasher runs at 2 a.m. for the cheap power. Somebody has to hear it finish.",
    "One more chapter became four. The bookmark surrendered around one.",
    "The dog needed out. Now the two of them are watching {street} like it owes them something.",
    "Payday math, done twice, still says the same thing. The lamp stays on for a third try.",
  ],
  irregular: [
    "The app pings. The car keys are already in hand.",
    "Works when the work comes. Tonight it came at one.",
    "The calendar says nothing until Thursday. The lamp disagrees.",
  ],
  none: [
    "Sleeps four hours a night and calls it enough.",
    "The radio plays till sunrise, tuned low, tuned elsewhere.",
    "Keeps the same hours as the streetlights, out of habit older than the building.",
    "The crossword is done. The lamp is for the second read of the obituaries.",
    "Bakes at midnight for people who won't be told.",
    "Watches the harbor lights change shift. Knows their order by heart.",
  ],
};

// One-sided relation lines. {T} = target's full name, {Tfirst} = given name.
export const RELATION_TEMPLATES: Array<{ verb: string; context: "neighbor" | "coworker" | "street"; line: string }> = [
  { verb: "waves to", context: "neighbor", line: "Waves to {T} at the mailboxes. Neither has ever said a name." },
  { verb: "owes", context: "neighbor", line: "Owes {T} three hundred dollars and takes the stairs now." },
  { verb: "watches", context: "street", line: "Has watched {T}'s window go dark at the same minute for a year." },
  { verb: "used to date", context: "street", line: "Used to date {T}. They split the same street and never the same hour." },
  { verb: "envies", context: "neighbor", line: "Envies {T}, who practices with the window open, like it costs nothing." },
  { verb: "blames", context: "neighbor", line: "Blames {T} for the thing with the water heater. The super knows the truth." },
  { verb: "found", context: "neighbor", line: "Learned {T}'s name from a misdelivered package. Still has the package." },
  { verb: "covers for", context: "coworker", line: "Covers {Tfirst}'s shifts without being asked. {Tfirst} has noticed and said nothing." },
  { verb: "learned from", context: "coworker", line: "Everything useful, {given} learned watching {Tfirst} work. {Tfirst} thinks they've barely met." },
  { verb: "remembers", context: "street", line: "Remembers {T} from {lore:event}. {T} was facing the other way." },
  { verb: "nods to", context: "street", line: "Nods to {T} at the corner most mornings. Neither has broken first." },
  { verb: "borrowed from", context: "street", line: "Still has {T}'s ladder. Third winter now." },
  { verb: "outbid", context: "street", line: "Outbid {T} for the apartment years ago. The elevator rides are efficient." },
  { verb: "recognizes", context: "street", line: "Knows {T}'s dog by name and {T} not at all." },
  { verb: "waits with", context: "street", line: "Waits at the same stop as {T}. They have perfected standing apart." },
];

// The one legend per city — an outsized, fully-authored resident.
export const LEGEND = {
  epithet: "the one the crows follow",
  hook: "The crows started following {given} home in March. {given} has started leaving earlier.",
  detail: "Keeps a numbered notebook per crow. Number nine is blank.",
};

// --- Fill ------------------------------------------------------------------------

type FillCtx = {
  p: Persona;
  names: CityNames;
  lore: CityLoreEntry[];
  rng: () => number;
  street: string;
  district: string;
  bizName?: string;
  used: string[]; // lore ids consumed by this sheet
};

function possessive(p: Persona): string {
  return p.pronouns === "he/him" ? "his" : p.pronouns === "she/her" ? "her" : "their";
}
function subject(p: Persona): string {
  return p.pronouns === "he/him" ? "he" : p.pronouns === "she/her" ? "she" : "they";
}

function loreOf(ctx: FillCtx, kind: LoreKind): CityLoreEntry {
  const pool = ctx.lore.filter((l) => l.kind === kind);
  const entry = pool[Math.floor(ctx.rng() * pool.length)];
  ctx.used.push(entry.id);
  return entry;
}

function kinFor(ctx: FillCtx): { name: string; role: string } {
  const off = ctx.p.offstage[0];
  if (off) return { name: off.name, role: off.role };
  const roles = ["mother", "father", "brother", "sister", "grandmother", "uncle"];
  return {
    name: pick(ctx.rng, ["Ruth", "Frank", "Elena", "Walter", "June", "Sal", "Dot", "Reyes"]),
    role: pick(ctx.rng, roles),
  };
}

function fill(template: string, ctx: FillCtx): string {
  const kin = template.includes("{kin") ? kinFor(ctx) : null;
  return template
    .replace(/\{given\}/g, ctx.p.givenName)
    .replace(/\{family\}/g, ctx.p.familyName)
    .replace(/\{domain\}/g, ctx.p.domain || "postcards")
    .replace(/\{kinrole\}/g, kin?.role ?? "uncle")
    .replace(/\{kin\}/g, kin?.name ?? "Ruth")
    .replace(/\{street\}/g, ctx.street)
    .replace(/\{district\}/g, ctx.district)
    .replace(/\{city\}/g, ctx.names.city.name)
    .replace(/\{paper\}/g, ctx.names.city.newspaper)
    .replace(/\{transit\}/g, ctx.names.city.transitLine)
    .replace(/\{biz\}/g, ctx.bizName ?? "the shop on the corner")
    .replace(/\{his\}/g, possessive(ctx.p))
    .replace(/\{he\}/g, subject(ctx.p))
    .replace(/\{N\}/g, String(2 + Math.floor(ctx.rng() * 11)))
    .replace(/\{lore:place\}/g, () => loreOf(ctx, "place").name)
    .replace(/\{lore:event\}/g, () => loreOf(ctx, "event").name)
    .replace(/\{lore:band\}/g, () => loreOf(ctx, "band").name)
    .replace(/\{lore:scandal\}/g, () => loreOf(ctx, "scandal").name)
    .replace(/\{lore:past\}/g, () => loreOf(ctx, "past-business").name);
}

// --- Weave -----------------------------------------------------------------------

// Lazy story weave (2026-07-10). The old weaveStories() walked all ~39k
// personas eagerly at directory-build time — the single heaviest slice of the
// cold build. Every de-dupe set below is household- or building-scoped and
// every persona draws from its own `::story::<id>` stream, so the weave
// decomposes exactly by building: ensureBuildingStories() produces
// byte-identical output to the old eager pass, one building at a time, the
// first time a card, sift, or hover asks. (The relations pass was re-keyed
// from one global stream to `::relations::<id>` per persona so it decomposes
// too — a one-time relations re-roll.)
type WeaveState = {
  lore: CityLoreEntry[];
  legendId: PersonaId | null;
  // Per-household de-dupe of hook + whyAwake templates (a couple sharing the
  // same 3 a.m. line reads as a copy-paste bug), and per-building de-dupe of
  // epithets (two "fortune keepers" on one block breaks the nickname fiction).
  usedByHousehold: Map<string, Set<string>>;
  usedAwakeByHousehold: Map<string, Set<string>>;
  usedEpithetsByBuilding: Map<number, Set<string>>;
  usedDomainsByBuilding: Map<number, Set<string>>;
  // Street index for the relations pass's "across the street" pool.
  byStreet: Map<string, Persona[]>;
  woven: Set<number>; // buildingIds whose residents have stories
};

// Keyed by directory instance: a re-rolled/re-tiered directory is a new
// object, so its weave state starts fresh and the old one is collectable.
const weaveStates = new WeakMap<PersonaDirectory, WeaveState>();

function weaveStateFor(masterSeed: string, dir: PersonaDirectory): WeaveState {
  let st = weaveStates.get(dir);
  if (st) return st;
  const lore = buildCityLore(masterSeed, dir.names);
  dir.lore = lore;

  // Deterministic legend pick: chosen by a dedicated stream over the full
  // adult walk so it doesn't shift with pool edits — and doesn't depend on
  // which building happens to be woven first.
  const legendRng = seededRng(`${masterSeed}::personas::legend`);
  const adults = [...dir.personas.values()].filter((p) => p.age >= 25 && p.age <= 75);
  const legendId = adults.length > 0 ? adults[Math.floor(legendRng() * adults.length)].id : null;

  const byStreet = new Map<string, Persona[]>();
  for (const p of dir.personas.values()) {
    const street = dir.names.addresses.get(p.homeBuildingId)?.street;
    if (!street) continue;
    const list = byStreet.get(street) ?? [];
    list.push(p);
    byStreet.set(street, list);
  }

  st = {
    lore,
    legendId,
    usedByHousehold: new Map(),
    usedAwakeByHousehold: new Map(),
    usedEpithetsByBuilding: new Map(),
    usedDomainsByBuilding: new Map(),
    byStreet,
    woven: new Set(),
  };
  weaveStates.set(dir, st);
  return st;
}

// Materialize schedule + story (+ one-sided relation) for every resident of
// one building. Idempotent; a building is a few dozen personas at most, so a
// cold call is sub-millisecond — cheap enough to run synchronously from a
// card render.
export function ensureBuildingStories(
  masterSeed: string,
  dir: PersonaDirectory,
  buildingId: number,
): void {
  const st = weaveStateFor(masterSeed, dir);
  if (st.woven.has(buildingId)) return;
  st.woven.add(buildingId);
  const households = dir.byHomeBuilding.get(buildingId);
  if (!households) return;
  for (const hh of households) {
    for (const pid of hh.memberIds) {
      const p = dir.personas.get(pid);
      if (!p) continue;
      weavePersonaStory(masterSeed, dir, st, p);
      weavePersonaRelation(masterSeed, dir, st, p);
    }
  }
}

// Whole-city weave for consumers that genuinely read everything (writing lab,
// audit scripts). Same output as calling ensureBuildingStories per building.
export function ensureAllStories(masterSeed: string, dir: PersonaDirectory): void {
  for (const buildingId of dir.byHomeBuilding.keys()) {
    ensureBuildingStories(masterSeed, dir, buildingId);
  }
}

function weavePersonaStory(
  masterSeed: string,
  dir: PersonaDirectory,
  st: WeaveState,
  p: Persona,
): void {
  {
    const rng = seededRng(`${masterSeed}::personas::story::${p.id}`);
    p.schedule = { shift: shiftFor(p, rng) };

    // Domain word — deduped within the building (two crow-keepers on one
    // block reads as a bug; one per building keeps the coincidence citywide,
    // where it belongs — see DOMAIN_HOOKS' "two people in this city").
    const buildingDomains = st.usedDomainsByBuilding.get(p.homeBuildingId) ?? new Set<string>();
    st.usedDomainsByBuilding.set(p.homeBuildingId, buildingDomains);
    let domain = pick(rng, DOMAIN_WORDS);
    if (buildingDomains.has(domain)) domain = pick(rng, DOMAIN_WORDS);
    buildingDomains.add(domain);
    p.domain = domain;

    const address = dir.names.addresses.get(p.homeBuildingId);
    const street = address ? address.street.split(" ").slice(0, -1).join(" ") || address.street : "Harbor";
    const district = dir.names.districtNames.get(p.homeDistrictId) ?? "the neighborhood";
    const bizName = p.businessId ? dir.businesses.get(p.businessId)?.name : undefined;
    const ctx: FillCtx = { p, names: dir.names, lore: st.lore, rng, street, district, bizName, used: [] };

    const cluster = clusterFor(p);
    const isKid = cluster === "kid" || cluster === "teen";

    // Hook — legend > outsized (10%) > cluster pool (70%) > generic.
    const hhKey = `${p.homeBuildingId}:${p.householdIndex}`;
    const usedHooks = st.usedByHousehold.get(hhKey) ?? new Set<string>();
    st.usedByHousehold.set(hhKey, usedHooks);
    let hookTemplate: string;
    let epithetOverride: string | undefined;
    let detailOverride: string | undefined;
    if (p.id === st.legendId) {
      hookTemplate = LEGEND.hook;
      epithetOverride = LEGEND.epithet;
      detailOverride = LEGEND.detail;
      p.domain = "crows"; // the legend's whole sheet is corvid
    } else {
      // Hook source mix: outsized 10% (adults), cluster 55%, domain 15%
      // (adults), generic remainder. The domain slice is what makes a sheet
      // whose detail also drew from the domain pools read as one obsession.
      const roll = rng();
      const pool =
        !isKid && roll < 0.1
          ? HOOKS_OUTSIZED
          : roll < 0.65
            ? HOOKS_BY_CLUSTER[cluster]
            : !isKid && roll < 0.8
              ? DOMAIN_HOOKS
              : HOOKS_GENERIC;
      hookTemplate = pick(rng, pool);
      for (let i = 0; i < 4 && usedHooks.has(hookTemplate); i++) {
        hookTemplate = pick(rng, rng() < 0.5 ? pool : HOOKS_GENERIC);
      }
    }
    usedHooks.add(hookTemplate);
    const hook = fill(hookTemplate, ctx);

    // Detail + epithet come as a pair so the neighbor's name for them matches
    // what's on the sheet. ~55% of adults, ~30% of kids.
    const buildingEpithets = st.usedEpithetsByBuilding.get(p.homeBuildingId) ?? new Set<string>();
    st.usedEpithetsByBuilding.set(p.homeBuildingId, buildingEpithets);
    let detail: string | undefined;
    let epithet: string | undefined = epithetOverride;
    if (detailOverride) {
      detail = fill(detailOverride, ctx);
    } else if (rng() < (isKid ? 0.3 : 0.55)) {
      // ~45% of details come from the persona's domain pool (kids always use
      // the generic pool — a five-year-old curating brass buttons is a stretch).
      if (!isKid && rng() < 0.45) {
        detail = fill(pick(rng, DOMAIN_DETAILS), ctx);
        const domainEpithet = `the one with the ${p.domain}`;
        if (!epithet && rng() < 0.4 && !buildingEpithets.has(domainEpithet)) {
          epithet = domainEpithet;
        }
      } else {
        const d = pick(rng, DETAILS);
        detail = fill(d.line, ctx);
        if (!epithet && d.epithet && rng() < 0.7 && !buildingEpithets.has(d.epithet)) {
          epithet = d.epithet;
        }
      }
    }
    // Schedule-derived epithets when the detail didn't supply one.
    if (!epithet && !isKid && rng() < 0.3) {
      const t = p.profession?.title.toLowerCase();
      if (p.schedule.shift === "early" && t) epithet = `the morning ${t.split(" ").pop()}`;
      else if (p.schedule.shift === "night" && t) epithet = `the night ${t.split(" ").pop()}`;
      else if (p.bornHere && p.age > 60) epithet = "the one who remembers the block";
      if (epithet && buildingEpithets.has(epithet)) epithet = undefined;
    }
    if (epithet) buildingEpithets.add(epithet);

    // Refusal — sparse (~30% adults). Never for kids.
    const refusal = !isKid && rng() < 0.3 ? fill(pick(rng, REFUSALS), ctx) : undefined;

    // wasIs — adults with a profession, preferring dissonance (~40%).
    let wasIs: string | undefined;
    if (!isKid && p.profession && p.workStatus !== "student" && rng() < 0.4) {
      const was = fill(pick(rng, WAS_CLAUSES), ctx);
      const now =
        p.workStatus === "retired"
          ? `Retired now; the ${p.profession.title.toLowerCase()} years are the ones that stuck`
          : p.workStatus === "between jobs"
            ? `The ${p.profession.title.toLowerCase()} work dried up in the spring`
            : `Now ${/^[aeiou]/i.test(p.profession.title) ? "an" : "a"} ${p.profession.title.toLowerCase()}${bizName ? ` at ${bizName}` : ""}`;
      wasIs = `${was}. ${now}.`;
    }

    // whyAwake — everyone gets one; it's the line that explains the lit window.
    const usedAwake = st.usedAwakeByHousehold.get(hhKey) ?? new Set<string>();
    st.usedAwakeByHousehold.set(hhKey, usedAwake);
    let awakeTemplate = pick(rng, WHY_AWAKE[p.schedule.shift]);
    for (let i = 0; i < 4 && usedAwake.has(awakeTemplate); i++) {
      awakeTemplate = pick(rng, WHY_AWAKE[p.schedule.shift]);
    }
    usedAwake.add(awakeTemplate);
    const whyAwake = fill(awakeTemplate, ctx);

    p.story = { epithet, wasIs, whyAwake, detail, refusal, hook, loreRefs: ctx.used };
  }
}

// One-sided relation edge (~30% of 16+). Re-keyed 2026-07-10 from one global
// call-count-coupled stream to `::relations::<id>` per persona so the weave
// decomposes by building. Targets need only eager-tier facts (names, address,
// workplace) — their own stories don't have to exist yet.
function weavePersonaRelation(
  masterSeed: string,
  dir: PersonaDirectory,
  st: WeaveState,
  p: Persona,
): void {
  if (p.age < 16) return;
  const rng = seededRng(`${masterSeed}::personas::relations::${p.id}`);
  if (rng() < 0.7) return; // ~30% of adults get an edge
  // Candidate pools by context.
  const neighbors = (dir.byHomeBuilding.get(p.homeBuildingId) ?? [])
    .filter((h) => h.index !== p.householdIndex)
    .flatMap((h) => h.memberIds)
    .map((id) => dir.personas.get(id)!)
    .filter((q) => q.age >= 16);
  const coworkers = p.businessId
    ? (dir.businesses.get(p.businessId)?.employeeIds ?? [])
        .filter((id) => id !== p.id)
        .map((id) => dir.personas.get(id)!)
    : [];
  const streetmates = (st.byStreet.get(dir.names.addresses.get(p.homeBuildingId)?.street ?? "") ?? []).filter(
    (q) => q.id !== p.id && q.homeBuildingId !== p.homeBuildingId && q.age >= 16,
  );
  const optionPools: Array<{ context: "neighbor" | "coworker" | "street"; pool: Persona[] }> = [
    { context: "neighbor", pool: neighbors },
    { context: "coworker", pool: coworkers },
    { context: "street", pool: streetmates },
  ];
  const options = optionPools.filter((o) => o.pool.length > 0);
  if (options.length === 0) return;
  const opt = pick(rng, options);
  const target = pick(rng, opt.pool);
  const templates = RELATION_TEMPLATES.filter((t) => t.context === opt.context);
  const t = pick(rng, templates);
  // "used to date" needs both parties plausibly single-ish and adult.
  if (t.verb === "used to date" && (p.age < 22 || target.age < 22 || Math.abs(p.age - target.age) > 15)) return;
  const address = dir.names.addresses.get(p.homeBuildingId);
  const street = address ? address.street.split(" ").slice(0, -1).join(" ") : "Harbor";
  const district = dir.names.districtNames.get(p.homeDistrictId) ?? "the neighborhood";
  const ctx: FillCtx = {
    p, names: dir.names, lore: st.lore, rng, street, district,
    bizName: p.businessId ? dir.businesses.get(p.businessId)?.name : undefined,
    used: [],
  };
  const line = fill(
    t.line.replace(/\{T\}/g, target.fullName).replace(/\{Tfirst\}/g, target.givenName),
    ctx,
  );
  p.story.relation = { verb: t.verb, targetId: target.id, line };
  if (ctx.used.length > 0) p.story.loreRefs.push(...ctx.used);
}

// --- Building sift -----------------------------------------------------------------

// Curation pass (Ryan's "story sifting"): scan a building's residents for the
// single most interesting pattern and return one line the occupants panel can
// lead with. Deterministic; self-materializes the building's stories first
// (it reads shifts and relations), so callers don't have to.
export function siftBuilding(
  masterSeed: string,
  dir: PersonaDirectory,
  buildingId: number,
): string | undefined {
  ensureBuildingStories(masterSeed, dir, buildingId);
  const households = dir.byHomeBuilding.get(buildingId);
  if (!households || households.length === 0) return undefined;
  const residents = households.flatMap((h) => h.memberIds).map((id) => dir.personas.get(id)!);

  // A dating pair split across households in the same building.
  for (const p of residents) {
    if (p.relationshipStatus !== "dating" || !p.partnerId) continue;
    const q = dir.personas.get(p.partnerId);
    if (q && q.homeBuildingId === buildingId && q.householdIndex !== p.householdIndex) {
      return "Two residents here are seeing each other. The floors between them don't know yet.";
    }
  }
  // Two unrelated households sharing a surname.
  if (households.length >= 2) {
    const seen = new Map<string, number>();
    for (const h of households) {
      for (const surname of new Set(h.memberIds.map((id) => dir.personas.get(id)!.familyName))) {
        const prev = seen.get(surname);
        if (prev !== undefined && prev !== h.index) {
          return `Two households here share the name ${surname}. Neither mentions the other.`;
        }
        seen.set(surname, h.index);
      }
    }
  }
  // A building that works nights.
  const nightOwls = residents.filter((p) => p.schedule.shift === "night" || p.schedule.shift === "early");
  if (nightOwls.length >= 2) {
    return "Half this building works nights. The lit windows trade places around four.";
  }
  // A grudge with a floor number.
  const grudge = residents.find(
    (p) =>
      p.story.relation &&
      ["owes", "blames", "envies"].includes(p.story.relation.verb) &&
      dir.personas.get(p.story.relation.targetId)?.homeBuildingId === buildingId,
  );
  if (grudge) return "At least one grudge in this building has a floor number.";
  // An old guard.
  const oldGuard = residents.filter((p) => p.bornHere && p.age >= 60);
  if (oldGuard.length >= 2) return "Most of this building remembers the block before the towers.";
  // Gentler fallbacks so most buildings say SOMETHING (user 2026-07-08: the
  // sift line rarely appeared).
  const kids = residents.filter((p) => p.age < 13).length;
  if (kids >= 3) return `${kids} kids under thirteen live here. The stairwell knows all of them.`;
  const newcomers = residents.filter((p) => !p.bornHere && p.yearsInCity <= 3).length;
  if (newcomers >= 2) return "Half the mailbox labels here are still the previous tenants'.";
  const singles = residents.filter((p) => p.relationshipStatus === "single" && p.age >= 25);
  if (singles.length >= 3) return "Three residents here cook for one. The hallway smells argue about it.";
  const elders = residents.filter((p) => p.age >= 70).length;
  if (elders >= 1 && kids >= 1) return "The oldest and youngest residents here are sixty years apart and keep the same hours.";
  if (residents.length >= 4) return "The walls here are thin enough that everyone knows everyone's schedule.";
  if (residents.length >= 1) return "Quiet building. The kind where the lights say more than the neighbors do.";
  return undefined;
}
