"use client";

import type { ReactNode } from "react";
import {
  Armchair,
  Bike,
  BookOpen,
  BriefcaseBusiness,
  Bus,
  Car,
  Flower2,
  Footprints,
  GraduationCap,
  Heart,
  HeartCrack,
  HeartHandshake,
  Home,
  TrainFront,
  User,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Separator } from "@/components/ui/separator";
import { useSceneStore } from "@/lib/state/sceneStore";
import { flyToBuilding, flyToSpan } from "@/lib/scene/focusBuilding";
import {
  CHINESE_ANIMAL_GLYPHS,
  WESTERN_SIGN_TRAITS,
  WESTERN_ZODIAC,
  MOON_SIGN_TRAITS,
  RISING_SIGN_TRAITS,
  CHINESE_ANIMAL_TRAITS,
  CHINESE_ELEMENT_TRAITS,
  MBTI_DESCRIPTIONS,
  EDUCATION_LABELS,
} from "@/lib/seed/personaData";
import type { EducationTier } from "@/lib/seed/personaData";
import {
  personaFlavor,
  type CommuteMode,
  type Persona,
  type RelationshipStatus,
} from "@/lib/seed/personas";
import { ensureBuildingStories } from "@/lib/seed/personaStory";
import { COMMUTE_COLORS, CONNECTION_COLOR } from "@/components/scene/CommuteArc";
import { useEntityIndexes } from "./entityData";
import { FamilyTree } from "./FamilyTree";
import { GenderIcon } from "./genderIcon";
import { IconTip } from "./EntityColumns";
import {
  PROFESSION_ICONS,
  HOME_ICON_COLOR,
  WORK_ICON_COLOR,
  EDUCATION_ICON_COLOR,
} from "./workplaceIcons";

// Column port of the old PersonaPanel. Ordering is a hard design rule
// (re-cut 2026-07-10): badges → whyAwake → stats → family →
// wasIs/detail/refusal/relation → hook, and the sheet always ENDS on the
// hook, unresolved. Facts lead; the flavour prose gathers below Family.
// Trait badges explain themselves on hover (user 2026-07-08): western sign,
// Chinese sign, MBTI.

const COMMUTE_LABELS: Record<CommuteMode, string> = {
  walk: "Walks",
  cycle: "Cycles",
  transit: "Rides transit",
  drive: "Drives",
  bus: "Rides the school bus",
};

// Mode icons tinted in the ARC colour (user 2026-07-10) — the icon replaces
// the old colour dot, so the card and the skyline arc share one legend.
const COMMUTE_ICONS: Record<CommuteMode, LucideIcon> = {
  walk: Footprints,
  cycle: Bike,
  transit: TrainFront,
  drive: Car,
  bus: Bus,
};

// Relationship-status glyphs (user 2026-07-10) — heart family where it fits,
// a memorial flower for widowed rather than a struck-out heart.
const RELATIONSHIP_ICONS: Record<RelationshipStatus, LucideIcon> = {
  single: User,
  dating: Heart,
  married: HeartHandshake,
  widowed: Flower2,
  divorced: HeartCrack,
};

function professionIconFor(p: Persona): LucideIcon {
  if (p.profession) return PROFESSION_ICONS[p.profession.category] ?? BriefcaseBusiness;
  if (p.workStatus === "student") return BookOpen;
  if (p.workStatus === "retired") return Armchair;
  return BriefcaseBusiness;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatHeight(cm: number): string {
  const totalIn = Math.round(cm / 2.54);
  return `${Math.floor(totalIn / 12)}\u2032${totalIn % 12}\u2033`;
}

// Transit riders split between the rail spine and named bus routes — stable
// per persona (hash of id). Real route mapping is a follow-up issue.
function transitLineFor(personaId: string, indexes: ReturnType<typeof useEntityIndexes>): string {
  let h = 0;
  for (let i = 0; i < personaId.length; i++) h = (h * 31 + personaId.charCodeAt(i)) >>> 0;
  const { transitLine, busLines } = indexes.names.city;
  const options = [`the ${transitLine}`, `the ${transitLine}`, ...busLines];
  return options[h % options.length];
}

// 12-hour clock with exact minutes (user 2026-07-11: "an exact time in the
// ~3 range" — the ~ approximation is gone, e.g. `3:27 PM`).
function formatTime(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

// Chinese-sign badge is glyph-only (user 2026-07-11): element emoji + animal
// glyph, no words. The hover card still names both in prose.
const ELEMENT_EMOJI: Record<string, string> = {
  Wood: "🪵",
  Fire: "🔥",
  Earth: "⛰️",
  Metal: "⚙️",
  Water: "💧",
};

// Sign name → symbol, for the moon/rising signs (stored as names). U+FE0F
// asks for the EMOJI presentation of the zodiac glyph (colored, larger)
// rather than the plain text form (user 2026-07-11).
const SIGN_SYMBOL: Record<string, string> = Object.fromEntries(
  WESTERN_ZODIAC.map((s) => [s.name, s.symbol]),
);
const signEmoji = (name: string) => (SIGN_SYMBOL[name] ?? "") + "️";

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

// One stat-row anatomy for the whole card (user 2026-07-10: "alignment for
// icons/buttons/headers are all messed up"): a FIXED w-5 icon slot leads
// every row — empty when a row has no icon — so labels share one left edge,
// icon buttons occupy exactly the slot (size-5 hit target, size-4 glyph, no
// padding inflation), and values right-align. Body text rides at the app's
// default scale (text-base), not a shrunken variant.
function StatRow({
  icon,
  iconTint,
  iconAction,
  iconLabel,
  label,
  top,
  bottom,
}: {
  icon?: LucideIcon;
  iconTint?: string; // CSS color — commute arc colour, relationship pink
  iconAction?: () => void; // present = the icon is a camera fly-to button
  iconLabel?: string; // tooltip/aria for the button form
  label: string;
  top: ReactNode;
  bottom?: ReactNode;
}) {
  const Icon = icon;
  const glyph = Icon && (
    <Icon
      className="size-4 shrink-0"
      style={iconTint ? { color: iconTint } : undefined}
      aria-hidden
    />
  );
  return (
    <div className="flex flex-col gap-0.5 text-base">
      {/* flex-wrap so the value drops WHOLE to its own right-aligned line when
          it can't share the row with the label (user 2026-07-11) — never a
          mid-phrase wrap beside the label. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-muted-foreground flex shrink-0 items-center gap-2">
          <span className="flex w-5 shrink-0 items-center justify-center">
            {glyph &&
              (iconAction ? (
                <IconTip label={iconLabel ?? label} delay={0}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground size-5 [&_svg]:size-4"
                    onClick={iconAction}
                    aria-label={iconLabel ?? label}
                  >
                    {glyph}
                  </Button>
                </IconTip>
              ) : (
                glyph
              ))}
          </span>
          {label}
        </span>
        {/* [&_button]:text-right — button UA style centers wrapped text,
            which read as centre-aligned values (user 2026-07-10). */}
        <span className="ml-auto max-w-full min-w-0 text-right font-medium break-words [&_button]:text-right">
          {top}
        </span>
      </div>
      {bottom && (
        <span className="min-w-0 pl-7 text-right font-medium break-words [&_button]:text-right">
          {bottom}
        </span>
      )}
    </div>
  );
}

export function PersonaColumn({
  id,
  part,
  hideFamilyTree = false,
}: {
  id: string;
  part: "pinned" | "rest";
  // True when embedded inside the FamilyTree dialog's detail pane — the tree
  // trigger would open a dialog within its own dialog.
  hideFamilyTree?: boolean;
}) {
  const push = useSceneStore((s) => s.pushColumn);
  const masterSeed = useSceneStore((s) => s.masterSeed);
  // Card disclosure state is shared across every card instance (user
  // 2026-07-11) — see sceneStore. Both PersonaColumn parts read it.
  const cardDetailsOpen = useSceneStore((s) => s.cardDetailsOpen);
  const setCardDetailsOpen = useSceneStore((s) => s.setCardDetailsOpen);
  const cardFamilyOpen = useSceneStore((s) => s.cardFamilyOpen);
  const setCardFamilyOpen = useSceneStore((s) => s.setCardFamilyOpen);
  const indexes = useEntityIndexes();
  const persona = indexes.directory.personas.get(id);
  if (!persona) {
    return part === "pinned" ? null : (
      <div className="text-muted-foreground text-sm">Resident not found.</div>
    );
  }

  // Deep tier materializes here, on card open: the building's stories (idempotent,
  // sub-ms for one building) and this persona's flavour draws. Both are pure
  // functions of the seed, so render-phase calls are safe.
  ensureBuildingStories(masterSeed, indexes.directory, persona.homeBuildingId);
  const flavor = personaFlavor(masterSeed, persona);
  const story = persona.story;
  const business = persona.businessId
    ? indexes.directory.businesses.get(persona.businessId)
    : undefined;
  const school = persona.schoolId ? indexes.directory.businesses.get(persona.schoolId) : undefined;
  // A CURRENT student: their school stands in for both Profession and Work —
  // one folded "School" row under Education (user 2026-07-11).
  const isStudent = !!school && !business;
  const homeAddress = indexes.names.addresses.get(persona.homeBuildingId);
  const homeDistrictName = indexes.names.districtNames.get(persona.homeDistrictId);
  const partner = persona.partnerId ? indexes.directory.personas.get(persona.partnerId) : undefined;

  // Home/Work rows are two lines (user 2026-07-10): district beside the
  // label (its own click target → district column), street address on the
  // line below (→ building column).
  const homeAddressLine = [
    homeAddress ? `${homeAddress.number} ${homeAddress.street}` : null,
    persona.unit ? `Unit ${persona.unit}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const workBuildingId = persona.commuteTargetBuildingId;
  const workAddress =
    workBuildingId !== undefined ? indexes.names.addresses.get(workBuildingId) : undefined;
  const workDistrictId =
    workBuildingId !== undefined ? indexes.buildingById.get(workBuildingId)?.districtId : undefined;
  const workDistrictName = workDistrictId
    ? indexes.names.districtNames.get(workDistrictId)
    : undefined;
  const workAddressLine = workAddress ? `${workAddress.number} ${workAddress.street}` : undefined;

  // Camera-only (user 2026-07-10): the row buttons FLY to the building
  // without selecting it — the address text beside them is the click target
  // that pushes the building column.
  const flyTo = (buildingId: number) => {
    const building = indexes.buildingById.get(buildingId);
    if (building) flyToBuilding(building);
  };

  const workPlace = business ?? school;

  // educationDetail is authored as "{subject}, {institution}" (one comma) —
  // split it so each concept gets its own display line.
  const eduComma = persona.educationDetail?.indexOf(", ") ?? -1;
  const eduSubject = persona.educationDetail
    ? eduComma >= 0
      ? persona.educationDetail.slice(0, eduComma)
      : persona.educationDetail
    : undefined;
  const eduInstitution =
    persona.educationDetail && eduComma >= 0
      ? persona.educationDetail.slice(eduComma + 2)
      : undefined;

  // Alma mater (user 2026-07-11, was 2026-07-10): derived, never stored.
  //   Current student → their real school (rendered as the School row, not
  //     here).
  //   Adult, degree tier ≥ 2 → prefer the in-city campus their educationDetail
  //     names; else, if they lived here through ~age 22, the university
  //     (tier ≥ 3) or college (tier 2) by exact name; else fall back to the
  //     nearest-high-school rule only if in city through their teens.
  //   Adult, tier ≤ 1 → the nearest high school (the original pure-distance
  //     rule the enrollment pass uses for kids), if in city through their teens.
  // Campuses are matched by NAME against generation's two campus businesses
  // (indexes.names.city.university / .college); if they don't exist yet the
  // scans find nothing and everything degrades to the high-school fallback.
  // No rng draws here, so no re-roll.
  const campusByName = (name: string | undefined) =>
    name ? [...indexes.directory.businesses.values()].find((b) => b.name === name) : undefined;
  const nearestHighSchool = () => {
    const home = indexes.buildingById.get(persona.homeBuildingId);
    if (!home) return undefined;
    let best = school;
    let bestD = Infinity;
    for (const biz of indexes.directory.businesses.values()) {
      if (biz.schoolTier !== "high") continue;
      const site = indexes.buildingById.get(biz.buildingId);
      if (!site) continue;
      const d = Math.hypot(site.x - home.x, site.z - home.z);
      if (d < bestD) {
        bestD = d;
        best = biz;
      }
    }
    return best;
  };

  let almaMater = school;
  if (!isStudent && !school && persona.age >= 18) {
    // Reverse-lookup the attained tier from the display label.
    let attainedTier: EducationTier | undefined;
    for (let t = 0 as EducationTier; t <= 4; t = (t + 1) as EducationTier) {
      if (EDUCATION_LABELS[t].includes(persona.education)) {
        attainedTier = t;
        break;
      }
    }
    const inCityThroughTeens = persona.bornHere || persona.yearsInCity >= persona.age - 17;
    const inCityThroughCollege = persona.bornHere || persona.yearsInCity >= persona.age - 22;
    if (attainedTier !== undefined && attainedTier >= 2) {
      const matched = campusByName(eduInstitution);
      if (matched) {
        almaMater = matched;
      } else if (inCityThroughCollege) {
        const uni = campusByName(indexes.names.city.university);
        const col = campusByName(indexes.names.city.college);
        almaMater = attainedTier >= 3 ? (uni ?? col) : (col ?? uni);
      } else if (inCityThroughTeens) {
        almaMater = nearestHighSchool();
      }
    } else if (inCityThroughTeens) {
      almaMater = nearestHighSchool();
    }
  }
  // const binding so the value narrows inside the fly-to closures below.
  const alma = almaMater;

  if (part === "pinned") {
    const born = `${MONTHS[persona.birthday.month - 1]} ${persona.birthday.day}, ${persona.birthday.year}`;
    return (
      <>
        {/* Header (user 2026-07-11): epithet, then the details in this exact
          order — gender line, DOB + birth time with age in parens, Height +
          Build side by side, ID. Minor-only fields (height/build) drop out;
          née rides the card title. The whole block is selectable (spans, not
          buttons, so select-none doesn't apply — set it explicitly for
          drag-select). */}
        <div className="flex min-w-0 cursor-text flex-col gap-0.5 select-text">
          {story.epithet && (
            <span className="text-muted-foreground truncate text-base italic">{story.epithet}</span>
          )}
          {/* Two-column fact grid (user 2026-07-11): Gender|Age, DOB|Time,
            Height|T-Shirt, ID|In City. Each cell spreads label left / value
            right (justify-between + nowrap) so no fact ever wraps; the
            gender icon + pronouns are their own label. In City lives HERE,
            not in the Details rows. */}
          {/* 1.25fr/1fr (user 2026-07-11): the left column carries the longer
            values (DOB, ID) — a hair more width keeps them on one line. */}
          <div className="grid grid-cols-[1.25fr_1fr] gap-x-4 gap-y-0.5 text-base">
            <span className="text-muted-foreground inline-flex items-center gap-1.5">
              <GenderIcon identity={persona.genderIdentity} className="size-5 shrink-0" />
              {persona.pronouns}
            </span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Age</span>
              <span>{persona.age}</span>
            </span>
            {/* DOB and Time as two neat fields (user 2026-07-11, round 3) —
              they stay separate seeded numbers rather than a Date object
              (a real Date would drag timezone semantics into the fiction);
              the formatter composes what display needs. */}
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">DOB</span>
              <span className="whitespace-nowrap">{born}</span>
            </span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Time</span>
              <span className="whitespace-nowrap">
                {formatTime(flavor.birthHour, flavor.birthMinute)}
              </span>
            </span>
            {flavor.heightCm && (
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Height</span>
                <span className="whitespace-nowrap">{formatHeight(flavor.heightCm)}</span>
              </span>
            )}
            {flavor.build && (
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">T-Shirt</span>
                <span>{flavor.build}</span>
              </span>
            )}
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">ID</span>
              <span className="font-mono">{flavor.civicId}</span>
            </span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">In City</span>
              <span className="whitespace-nowrap">
                {persona.bornHere ? "Born here" : `${persona.yearsInCity} yrs`}
              </span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Trait badges explain themselves on hover (shadcn hover cards,
            user 2026-07-08) — birthday context on the sun sign, animal +
            element on the Chinese sign, nickname + read on the MBTI type. */}
          {/* Badge anatomy (user 2026-07-11): astrology glyphs at emoji size
            (text-base + emoji presentation), sign names as 2-letter
            abbreviations. Hover cards read at text-base with the big three
            (Sun/Moon/Rising) each carrying their sign emoji. */}
          <HoverCard>
            <HoverCardTrigger
              render={
                <Badge variant="outline" className="cursor-help text-sm">
                  <span className="text-base leading-none">
                    {signEmoji(persona.westernSign.name)}
                  </span>{" "}
                  {persona.westernSign.name.slice(0, 2)}
                </Badge>
              }
            />
            <HoverCardContent className="w-72 text-base">
              {/* The big three each read as emoji-marked headings (☀️/🌙/🌅 +
                sign emoji) with their DETAILS on the line below (user
                2026-07-11) — no trailing "· descriptor" on the heading. */}
              <div className="font-medium">
                <span className="text-lg leading-none">
                  ☀️ {signEmoji(persona.westernSign.name)}
                </span>{" "}
                {persona.westernSign.name} Sun
              </div>
              <div className="text-muted-foreground text-sm">
                {persona.westernSign.element} · {persona.westernSign.modality} · born{" "}
                {persona.birthday.month}/{persona.birthday.day}
              </div>
              <p className="mt-1.5">{WESTERN_SIGN_TRAITS[persona.westernSign.name]}</p>
              <div className="border-border mt-2 border-t pt-2">
                {/* Sub head on its OWN line under each of the big three (user
                  2026-07-11) — never continued off the heading. */}
                <div className="font-medium">
                  <span className="text-base leading-none">🌙 {signEmoji(flavor.moonSign)}</span>{" "}
                  {flavor.moonSign} Moon
                </div>
                <div className="text-muted-foreground text-sm">the inner weather</div>
                <div>{MOON_SIGN_TRAITS[flavor.moonSign]}</div>
                <div className="mt-1.5 font-medium">
                  <span className="text-base leading-none">🌅 {signEmoji(flavor.risingSign)}</span>{" "}
                  {flavor.risingSign} Rising
                </div>
                <div className="text-muted-foreground text-sm">the first impression</div>
                <div>{RISING_SIGN_TRAITS[flavor.risingSign]}</div>
              </div>
            </HoverCardContent>
          </HoverCard>
          <HoverCard>
            <HoverCardTrigger
              render={
                <Badge variant="outline" className="cursor-help text-sm">
                  <span className="text-base leading-none">
                    {ELEMENT_EMOJI[persona.chineseSign.element]}{" "}
                    {CHINESE_ANIMAL_GLYPHS[persona.chineseSign.animal]}
                  </span>
                </Badge>
              }
            />
            <HoverCardContent className="w-72 text-base">
              {/* Layout (user 2026-07-11): header, born year, then two glyph-led
                lines — animal-year description (without renaming the animal)
                and element description. */}
              <div className="font-medium">
                <span className="text-lg leading-none">
                  {CHINESE_ANIMAL_GLYPHS[persona.chineseSign.animal]}
                </span>{" "}
                Year of the {persona.chineseSign.animal}
              </div>
              <div className="text-muted-foreground text-sm">born {persona.birthday.year}</div>
              <p className="mt-1.5">
                <span className="text-base leading-none">
                  {CHINESE_ANIMAL_GLYPHS[persona.chineseSign.animal]}
                </span>{" "}
                {capitalize(CHINESE_ANIMAL_TRAITS[persona.chineseSign.animal])}.
              </p>
              <p className="mt-1">
                <span className="text-base leading-none">
                  {ELEMENT_EMOJI[persona.chineseSign.element]}
                </span>{" "}
                {capitalize(CHINESE_ELEMENT_TRAITS[persona.chineseSign.element])}.
              </p>
            </HoverCardContent>
          </HoverCard>
          <HoverCard>
            <HoverCardTrigger
              render={
                <Badge variant="outline" className="cursor-help text-sm">
                  {flavor.mbtiNickname.replace(/^The /, "")}
                </Badge>
              }
            />
            <HoverCardContent className="w-72 text-base">
              <div className="font-medium">
                {flavor.mbti} · {flavor.mbtiNickname}
              </div>
              <p className="mt-1.5">{MBTI_DESCRIPTIONS[flavor.mbti]}</p>
            </HoverCardContent>
          </HoverCard>
        </div>
      </>
    );
  }

  const commuteRow = persona.commute && workBuildingId !== undefined && (
    <StatRow
      icon={COMMUTE_ICONS[persona.commute.mode]}
      iconTint={COMMUTE_COLORS[persona.commute.mode]}
      iconAction={() => {
        // Frame the whole commute (home + destination) so the arc fits —
        // camera only, no selection change (user 2026-07-10).
        const home = indexes.buildingById.get(persona.homeBuildingId);
        const work = indexes.buildingById.get(workBuildingId);
        if (home && work) flyToSpan(home, work);
      }}
      iconLabel="Show Commute"
      label="Commute"
      top={
        persona.commute.distance >= 1000
          ? `${(persona.commute.distance / 1000).toFixed(1)} km`
          : `${persona.commute.distance} m`
      }
      bottom={
        persona.commute.mode === "transit"
          ? `Rides ${transitLineFor(persona.id, indexes)}`
          : COMMUTE_LABELS[persona.commute.mode]
      }
    />
  );

  return (
    <>
      {/* Row order (user 2026-07-11): Home → Commute → Work (adults only:
          Profession + Work) → Education (students fold their school here as
          a single row; adults get level + alma mater) → Relationship. In City
          moved into the pinned header's fact grid. The whole stack lives
          under a "Details" disclosure. */}
      <Collapsible open={cardDetailsOpen} onOpenChange={setCardDetailsOpen}>
        <CollapsibleTrigger className="text-muted-foreground text-base font-medium">
          Details
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="flex flex-col gap-1.5 pt-1.5">
            <StatRow
              icon={Home}
              iconTint={HOME_ICON_COLOR}
              iconAction={() => flyTo(persona.homeBuildingId)}
              iconLabel="Fly Home"
              label="Home"
              top={
                homeDistrictName && (
                  <button
                    type="button"
                    onClick={() => push({ kind: "district", id: persona.homeDistrictId })}
                    className="hover:underline"
                  >
                    {homeDistrictName}
                  </button>
                )
              }
              bottom={
                homeAddressLine && (
                  <button
                    type="button"
                    onClick={() => push({ kind: "building", id: persona.homeBuildingId })}
                    className="hover:underline"
                  >
                    {homeAddressLine}
                  </button>
                )
              }
            />
            {commuteRow}
            {/* Work — adults only, Profession folded IN (user 2026-07-11):
                one green row, profession-category icon, title on the header
                line, then employer / district / address each on their own
                conceptual line. */}
            {!isStudent && (
              <StatRow
                icon={professionIconFor(persona)}
                iconTint={WORK_ICON_COLOR}
                iconAction={workBuildingId !== undefined ? () => flyTo(workBuildingId) : undefined}
                iconLabel="Fly to Work"
                label="Work"
                top={persona.profession ? persona.profession.title : capitalize(persona.workStatus)}
                bottom={
                  (workPlace || (workDistrictName && workDistrictId) || workAddressLine) && (
                    <span className="flex flex-col items-end gap-0.5">
                      {workPlace && (
                        <button
                          type="button"
                          onClick={() => push({ kind: "company", id: workPlace.id })}
                          className="hover:underline"
                        >
                          {workPlace.name}
                        </button>
                      )}
                      {workDistrictName && workDistrictId && (
                        <button
                          type="button"
                          onClick={() => push({ kind: "district", id: workDistrictId })}
                          className="hover:underline"
                        >
                          {workDistrictName}
                        </button>
                      )}
                      {workAddressLine && workBuildingId !== undefined && (
                        <button
                          type="button"
                          onClick={() => push({ kind: "building", id: workBuildingId })}
                          className="hover:underline"
                        >
                          {workAddressLine}
                        </button>
                      )}
                    </span>
                  )
                }
              />
            )}
            {/* Education. Current students: their school IS their education —
                one row (district on top, address + school name below), fly-to
                lands on the school building (user 2026-07-11). */}
            {isStudent && school ? (
              <StatRow
                icon={GraduationCap}
                iconTint={EDUCATION_ICON_COLOR}
                iconAction={() => {
                  const site = indexes.buildingById.get(school.buildingId);
                  if (site) flyToBuilding(site);
                }}
                iconLabel="Fly to School"
                label="School"
                top={
                  workDistrictName &&
                  workDistrictId && (
                    <button
                      type="button"
                      onClick={() => push({ kind: "district", id: workDistrictId })}
                      className="hover:underline"
                    >
                      {workDistrictName}
                    </button>
                  )
                }
                bottom={
                  <span className="flex flex-col items-end gap-0.5">
                    {workAddressLine && (
                      <button
                        type="button"
                        onClick={() => push({ kind: "building", id: school.buildingId })}
                        className="hover:underline"
                      >
                        {workAddressLine}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => push({ kind: "company", id: school.id })}
                      className="hover:underline"
                    >
                      {school.name}
                    </button>
                  </span>
                }
              />
            ) : (
              <StatRow
                icon={GraduationCap}
                iconTint={EDUCATION_ICON_COLOR}
                iconAction={
                  alma
                    ? () => {
                        const site = indexes.buildingById.get(alma.buildingId);
                        if (site) flyToBuilding(site);
                      }
                    : undefined
                }
                iconLabel="Fly to School"
                label="Education"
                // Conceptual line breaks: level on the header row, then
                // subject, institution, and the linked school each on their
                // own line. When the linked campus IS the institution string,
                // the link replaces the plain text (no duplicate).
                top={persona.education}
                bottom={
                  (eduSubject || eduInstitution || alma) && (
                    <span className="flex flex-col items-end gap-0.5">
                      {eduSubject && <span className="max-w-full truncate">{eduSubject}</span>}
                      {eduInstitution && !(alma && alma.name === eduInstitution) && (
                        <span className="max-w-full truncate">{eduInstitution}</span>
                      )}
                      {alma && (
                        <button
                          type="button"
                          onClick={() => push({ kind: "company", id: alma.id })}
                          className="hover:underline"
                        >
                          {alma.name}
                        </button>
                      )}
                    </span>
                  )
                }
              />
            )}
            {/* Minors don't carry a romantic status (user 2026-07-11) — the
                row is omitted rather than showing "Single" on a child; their
                family role already reads in the Family section. The partner
                guard keeps the row if data ever paired a minor. */}
            {(persona.age >= 18 || partner) && (
              <StatRow
                icon={RELATIONSHIP_ICONS[persona.relationshipStatus]}
                // Hearts read pink (user 2026-07-10 🩷); single/widowed stay muted.
                iconTint={
                  persona.relationshipStatus === "married" ||
                  persona.relationshipStatus === "dating" ||
                  persona.relationshipStatus === "divorced"
                    ? "#f472b6"
                    : undefined
                }
                iconAction={
                  partner
                    ? () => {
                        const home = indexes.buildingById.get(partner.homeBuildingId);
                        if (home) flyToBuilding(home);
                      }
                    : undefined
                }
                iconLabel="Fly to Partner"
                label="Relationship"
                top={capitalize(persona.relationshipStatus)}
                bottom={
                  partner && (
                    <button
                      type="button"
                      onClick={() => push({ kind: "persona", id: partner.id })}
                      className="hover:underline"
                    >
                      {partner.fullName}
                    </button>
                  )
                }
              />
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>

      {(persona.family.length > 0 || persona.offstage.length > 0) && (
        <>
          <Separator />
          <Collapsible open={cardFamilyOpen} onOpenChange={setCardFamilyOpen}>
            {/* The whole header row is the disclosure trigger; the tree
                button rides INSIDE it as a span-rendered Button (the
                directory pin pattern — a real <button> can't nest) so the
                tree icon sits immediately LEFT of the chevron and the
                chevron stays on the far right (user 2026-07-11). The span
                wrapper stops the click from also toggling the disclosure. */}
            <CollapsibleTrigger className="items-center text-base font-medium">
              <span className="flex-1 text-left" style={{ color: CONNECTION_COLOR }}>
                Family
              </span>
              {!hideFamilyTree && (
                <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
                  <FamilyTree personaId={persona.id} indexes={indexes} />
                </span>
              )}
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="flex flex-col gap-0.5 pt-1.5">
                {persona.family.map((link) => {
                  const relative = indexes.directory.personas.get(link.personaId);
                  if (!relative) return null;
                  return (
                    <button
                      key={link.personaId}
                      type="button"
                      onClick={() => push({ kind: "persona", id: link.personaId })}
                      className="hover:bg-foreground/10 -mx-1 flex flex-wrap items-baseline justify-between gap-x-4 rounded px-1 text-left text-base"
                    >
                      <span className="text-muted-foreground shrink-0 capitalize">{link.role}</span>
                      <span className="ml-auto max-w-full min-w-0 text-right break-words">
                        {relative.fullName}
                      </span>
                    </button>
                  );
                })}
                {persona.offstage.map((rel, i) => (
                  <div
                    key={`${rel.role}:${rel.name}:${i}`}
                    className="text-muted-foreground flex flex-wrap items-baseline justify-between gap-x-4 text-base"
                  >
                    <span className="shrink-0 capitalize">{rel.role}</span>
                    <span className="ml-auto max-w-full min-w-0 text-right break-words">
                      {rel.name}, lives elsewhere
                    </span>
                  </div>
                ))}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </>
      )}

      {/* whyAwake moves below Details + Family (user 2026-07-11): facts first,
          then the line that explains the lit window, then the rest of the
          flavour, ending on the hook. */}
      {(story.whyAwake || story.wasIs || story.detail || story.refusal || story.relation) && (
        <Separator />
      )}
      {story.whyAwake && <p className="text-base">{story.whyAwake}</p>}

      {(story.wasIs || story.detail || story.refusal || story.relation) && (
        <div className="flex flex-col gap-1">
          {story.wasIs && <p className="text-base">{story.wasIs}</p>}
          {story.detail && <p className="text-base">{story.detail}</p>}
          {story.refusal && <p className="text-base">{story.refusal}</p>}
          {story.relation && (
            <button
              type="button"
              onClick={() => push({ kind: "persona", id: story.relation!.targetId })}
              className="text-left text-base hover:underline"
            >
              {story.relation.line}
            </button>
          )}
        </div>
      )}

      <Separator />

      <div className="border-l-2 pl-2 text-base italic">{story.hook}</div>
    </>
  );
}
