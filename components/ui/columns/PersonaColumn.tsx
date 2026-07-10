"use client";

import type { ReactNode } from "react";
import {
  Armchair,
  BadgeDollarSign,
  Bike,
  BookOpen,
  Briefcase,
  BriefcaseBusiness,
  Bus,
  CalendarDays,
  Car,
  ChefHat,
  ClipboardList,
  ConciergeBell,
  Factory,
  FlaskConical,
  Flower2,
  Footprints,
  GraduationCap,
  Hammer,
  Heart,
  HeartCrack,
  HeartHandshake,
  Home,
  Landmark,
  Laptop,
  Palette,
  Scale,
  Scissors,
  Shield,
  ShoppingBag,
  Stethoscope,
  TrainFront,
  Truck,
  User,
  UserCog,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Separator } from "@/components/ui/separator";
import { useSceneStore } from "@/lib/state/sceneStore";
import { flyToBuilding, flyToSpan } from "@/lib/scene/focusBuilding";
import {
  CHINESE_ANIMAL_GLYPHS,
  WESTERN_SIGN_TRAITS,
  CHINESE_ANIMAL_TRAITS,
  CHINESE_ELEMENT_TRAITS,
  MBTI_DESCRIPTIONS,
} from "@/lib/seed/personaData";
import type { ProfessionCategory } from "@/lib/seed/personaData";
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

// Profession-row glyph by industry (user 2026-07-10); statuses cover the
// professionless. Anything unmapped falls back to the generic briefcase.
const PROFESSION_ICONS: Partial<Record<ProfessionCategory, LucideIcon>> = {
  Healthcare: Stethoscope,
  "Food Service": ChefHat,
  Technology: Laptop,
  Finance: Landmark,
  Legal: Scale,
  "Office & Admin": ClipboardList,
  Management: UserCog,
  Sales: BadgeDollarSign,
  Science: FlaskConical,
  "Construction & Trades": Hammer,
  Manufacturing: Factory,
  Agriculture: Wheat,
  Transportation: Truck,
  "Arts & Media": Palette,
  Retail: ShoppingBag,
  "Personal Care": Scissors,
  Hospitality: ConciergeBell,
  Education: BookOpen,
  "Public Safety": Shield,
};

function professionIconFor(p: Persona): LucideIcon {
  if (p.profession) return PROFESSION_ICONS[p.profession.category] ?? BriefcaseBusiness;
  if (p.workStatus === "student") return BookOpen;
  if (p.workStatus === "retired") return Armchair;
  return BriefcaseBusiness;
}

// Row-icon colour coding (user 2026-07-10): home rides the residential
// district green, work the downtown gold, education the transit blue —
// colours the map legend already taught.
const HOME_ICON_COLOR = "#3fa87e";
const WORK_ICON_COLOR = "#f2b134";
const EDUCATION_ICON_COLOR = "#6fa8ff";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

function formatHour(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} a.m.` : `${hour - 12} p.m.`;
}

const ELEMENT_COLORS: Record<string, string> = {
  Wood: "#3fa87e",
  Fire: "#e86f5a",
  Earth: "#c9a35a",
  Metal: "#a8b0bd",
  Water: "#6fa8ff",
};

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
    <Icon className="size-4 shrink-0" style={iconTint ? { color: iconTint } : undefined} aria-hidden />
  );
  return (
    <div className="flex flex-col gap-0.5 text-base">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 shrink-0 items-center gap-2 text-muted-foreground">
          <span className="flex w-5 shrink-0 items-center justify-center">
            {glyph &&
              (iconAction ? (
                <IconTip label={iconLabel ?? label}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5 text-muted-foreground hover:text-foreground [&_svg]:size-4"
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
        <span className="min-w-0 break-words text-right font-medium [&_button]:text-right">
          {top}
        </span>
      </div>
      {bottom && (
        <span className="min-w-0 break-words pl-7 text-right font-medium [&_button]:text-right">
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
  const indexes = useEntityIndexes();
  const persona = indexes.directory.personas.get(id);
  if (!persona) {
    return part === "pinned" ? null : (
      <div className="text-sm text-muted-foreground">Resident not found.</div>
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
  const homeAddress = indexes.names.addresses.get(persona.homeBuildingId);
  const homeDistrictName = indexes.names.districtNames.get(persona.homeDistrictId);
  const partner = persona.partnerId
    ? indexes.directory.personas.get(persona.partnerId)
    : undefined;

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
    workBuildingId !== undefined
      ? indexes.buildingById.get(workBuildingId)?.districtId
      : undefined;
  const workDistrictName = workDistrictId
    ? indexes.names.districtNames.get(workDistrictId)
    : undefined;
  const workAddressLine = workAddress
    ? `${workAddress.number} ${workAddress.street}`
    : undefined;

  // Camera-only (user 2026-07-10): the row buttons FLY to the building
  // without selecting it — the address text beside them is the click target
  // that pushes the building column.
  const flyTo = (buildingId: number) => {
    const building = indexes.buildingById.get(buildingId);
    if (building) flyToBuilding(building);
  };

  // Alma mater (user 2026-07-10): derived, never stored — an adult who was in
  // the city through their teens "attended" the nearest high school by the
  // SAME pure-distance rule the enrollment pass uses for current kids. No rng
  // draws, so no re-roll; the nearest-to-current-home approximation is the
  // fiction's price for retroactive alumni. Current students link their real
  // school instead.
  let almaMater = school;
  if (
    !almaMater &&
    persona.age >= 18 &&
    (persona.bornHere || persona.yearsInCity >= persona.age - 17)
  ) {
    const home = indexes.buildingById.get(persona.homeBuildingId);
    if (home) {
      let bestD = Infinity;
      for (const biz of indexes.directory.businesses.values()) {
        if (biz.schoolTier !== "high") continue;
        const site = indexes.buildingById.get(biz.buildingId);
        if (!site) continue;
        const d = Math.hypot(site.x - home.x, site.z - home.z);
        if (d < bestD) {
          bestD = d;
          almaMater = biz;
        }
      }
    }
  }

  const workPlace = business ?? school;
  const professionValue = persona.profession
    ? workPlace
      ? `${persona.profession.title} · ${workPlace.name}`
      : persona.profession.title
    : school
      ? `Student · ${school.name}`
      : capitalize(persona.workStatus);


  if (part === "pinned") {
    return (
    <>
      {/* Header is text-only (user 2026-07-10): the Go Home / Go to Work
          buttons live on the Home/Work rows below, and the meta lines sit at
          text-sm — the header earns its space with information, not chrome. */}
      <div className="flex min-w-0 flex-col">
        {story.epithet && (
          <span className="truncate text-base italic text-muted-foreground">{story.epithet}</span>
        )}
        <span className="inline-flex items-center gap-1.5 text-base text-muted-foreground">
          <GenderIcon identity={persona.genderIdentity} className="size-5 shrink-0" />
          {[
            persona.pronouns,
            String(persona.age),
            flavor.heightCm ? formatHeight(flavor.heightCm) : null,
            flavor.build,
            persona.maidenName ? `née ${persona.maidenName}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="text-base text-muted-foreground">
          b. {MONTHS[persona.birthday.month - 1]} {persona.birthday.day},{" "}
          {persona.birthday.year} · ~{formatHour(flavor.birthHour)}
        </span>
        {/* Fictional-format civic ID (user 2026-07-10) — records-office
            flavour, deliberately unlike any real document's grouping. */}
        <span className="font-mono text-base text-muted-foreground">ID {flavor.civicId}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Trait badges explain themselves on hover (shadcn hover cards,
            user 2026-07-08) — birthday context on the sun sign, animal +
            element on the Chinese sign, nickname + read on the MBTI type. */}
        <HoverCard>
          <HoverCardTrigger
            render={
              <Badge variant="outline" className="cursor-help">
                {persona.westernSign.symbol} {persona.westernSign.name}
              </Badge>
            }
          />
          <HoverCardContent>
            <div className="font-medium">
              {persona.westernSign.symbol} {persona.westernSign.name} Sun
            </div>
            <div className="text-xs text-muted-foreground">
              {persona.westernSign.element} · {persona.westernSign.modality} · born{" "}
              {persona.birthday.month}/{persona.birthday.day}
            </div>
            <p className="mt-1.5">{WESTERN_SIGN_TRAITS[persona.westernSign.name]}</p>
            <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">{flavor.moonSign} Moon</span> · the
                inner weather
              </div>
              <div className="mt-0.5">
                <span className="font-medium text-foreground">{flavor.risingSign} Rising</span> ·
                the first impression
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
        <HoverCard>
          <HoverCardTrigger
            render={
              <Badge variant="outline" className="cursor-help">
                {CHINESE_ANIMAL_GLYPHS[persona.chineseSign.animal]} {persona.chineseSign.element}{" "}
                {persona.chineseSign.animal}
              </Badge>
            }
          />
          <HoverCardContent>
            <div className="font-medium">
              {CHINESE_ANIMAL_GLYPHS[persona.chineseSign.animal]} Year of the{" "}
              {persona.chineseSign.animal}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: ELEMENT_COLORS[persona.chineseSign.element] }}
                aria-hidden
              />
              {persona.chineseSign.element} — {CHINESE_ELEMENT_TRAITS[persona.chineseSign.element]}
            </div>
            <div className="text-xs text-muted-foreground">born {persona.birthday.year}</div>
            <p className="mt-1.5">
              The {persona.chineseSign.animal}: {CHINESE_ANIMAL_TRAITS[persona.chineseSign.animal]}.
            </p>
          </HoverCardContent>
        </HoverCard>
        <HoverCard>
          <HoverCardTrigger
            render={
              <Badge variant="outline" className="cursor-help">
                {flavor.mbtiNickname.replace(/^The /, "")}
              </Badge>
            }
          />
          <HoverCardContent>
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

  return (
    <>
      {/* whyAwake stays up top — it's the line that explains the lit window.
          The rest of the flavour (wasIs, detail, refusal, relation) reads
          below the Family section (user 2026-07-10: facts first). */}
      {story.whyAwake && <p className="text-base">{story.whyAwake}</p>}

      <Separator />

      <div className="flex flex-col gap-1.5">
        {/* Tenure leads the section (user 2026-07-10). */}
        <StatRow
          icon={CalendarDays}
          label="In City"
          top={persona.bornHere ? "Born here" : `${persona.yearsInCity} years`}
        />
        <StatRow
          icon={professionIconFor(persona)}
          label={school && !business ? "School" : "Profession"}
          top={
            workPlace ? (
              <button
                type="button"
                onClick={() => push({ kind: "company", id: workPlace.id })}
                className="hover:underline"
              >
                {professionValue}
              </button>
            ) : (
              professionValue
            )
          }
        />
        {persona.commute && workBuildingId !== undefined && (
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
        )}
        <StatRow
          icon={GraduationCap}
          iconTint={EDUCATION_ICON_COLOR}
          iconAction={
            almaMater
              ? () => {
                  const site = indexes.buildingById.get(almaMater.buildingId);
                  if (site) flyToBuilding(site);
                }
              : undefined
          }
          iconLabel="Fly to School"
          label="Education"
          top={persona.educationDetail ?? persona.education}
          bottom={
            almaMater && (
              <button
                type="button"
                onClick={() => push({ kind: "company", id: almaMater.id })}
                className="hover:underline"
              >
                {almaMater.name}
              </button>
            )
          }
        />
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
        {workBuildingId !== undefined && (
          <StatRow
            icon={Briefcase}
            iconTint={WORK_ICON_COLOR}
            iconAction={() => flyTo(workBuildingId)}
            iconLabel={school && !business ? "Fly to School" : "Fly to Work"}
            label={school && !business ? "School" : "Work"}
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
              workAddressLine && (
                <button
                  type="button"
                  onClick={() => push({ kind: "building", id: workBuildingId })}
                  className="hover:underline"
                >
                  {workAddressLine}
                </button>
              )
            }
          />
        )}
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
      </div>

      {(persona.family.length > 0 || persona.offstage.length > 0) && (
        <>
          <Separator />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <div className="text-base font-medium" style={{ color: CONNECTION_COLOR }}>
                Family
              </div>
              {!hideFamilyTree && <FamilyTree personaId={persona.id} indexes={indexes} />}
            </div>
            {persona.family.map((link) => {
              const relative = indexes.directory.personas.get(link.personaId);
              if (!relative) return null;
              return (
                <button
                  key={link.personaId}
                  type="button"
                  onClick={() => push({ kind: "persona", id: link.personaId })}
                  className="-mx-1 flex items-baseline justify-between gap-4 rounded px-1 text-left text-base hover:bg-foreground/10"
                >
                  <span className="capitalize text-muted-foreground">{link.role}</span>
                  <span>{relative.fullName}</span>
                </button>
              );
            })}
            {persona.offstage.map((rel, i) => (
              <div
                key={`${rel.role}:${rel.name}:${i}`}
                className="flex items-baseline justify-between gap-4 text-base text-muted-foreground"
              >
                <span className="capitalize">{rel.role}</span>
                <span>{rel.name}, lives elsewhere</span>
              </div>
            ))}
          </div>
        </>
      )}

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
