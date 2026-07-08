"use client";

import { Briefcase, Home } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Separator } from "@/components/ui/separator";
import { useSceneStore } from "@/lib/state/sceneStore";
import { focusBuilding } from "@/lib/scene/focusBuilding";
import {
  CHINESE_ANIMAL_GLYPHS,
  WESTERN_SIGN_TRAITS,
  CHINESE_ANIMAL_TRAITS,
  CHINESE_ELEMENT_TRAITS,
  MBTI_DESCRIPTIONS,
} from "@/lib/seed/personaData";
import type { CommuteMode } from "@/lib/seed/personas";
import { COMMUTE_COLORS } from "@/components/scene/CommuteArc";
import { useEntityIndexes } from "./entityData";
import { FamilyTree } from "./FamilyTree";
import { ColumnStat, IconTip } from "./EntityColumns";

// Column port of the old PersonaPanel. Ordering is a hard design rule: badges
// → wasIs → whyAwake → stats → family → detail/refusal/relation → hook, and
// the sheet always ENDS on the hook, unresolved. Trait badges explain
// themselves on hover (user 2026-07-08): western sign, Chinese sign, MBTI.

const COMMUTE_LABELS: Record<CommuteMode, string> = {
  walk: "Walks",
  cycle: "Cycles",
  transit: "Rides transit",
  drive: "Drives",
  bus: "Rides the school bus",
};

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
  const indexes = useEntityIndexes();
  const persona = indexes.directory.personas.get(id);
  if (!persona) {
    return part === "pinned" ? null : (
      <div className="text-sm text-muted-foreground">Resident not found.</div>
    );
  }

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

  // District names take internal non-breaking spaces so a wrapping address
  // never splits "Grove Glen" mid-name — the district drops to its own line
  // as a unit instead (user 2026-07-08).
  const homeText = [
    homeAddress ? `${homeAddress.number} ${homeAddress.street}` : null,
    persona.unit ? `Unit ${persona.unit}` : null,
    homeDistrictName?.replace(/ /g, " "),
  ]
    .filter(Boolean)
    .join(" · ");

  const goTo = (buildingId: number) => {
    const building = indexes.buildingById.get(buildingId);
    if (building) focusBuilding(building);
    push({ kind: "building", id: buildingId });
  };

  // Rows whose text can outgrow a shared line stack to two lines instead
  // (label above, value below) — the threshold is roughly what fits beside a
  // label at the card's width.
  const STACK_AT = 26;
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
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          {story.epithet && (
            <span className="truncate text-sm italic text-muted-foreground">{story.epithet}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {[
              persona.pronouns,
              String(persona.age),
              persona.heightCm ? formatHeight(persona.heightCm) : null,
              persona.build,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="text-xs text-muted-foreground">
            b. {MONTHS[persona.birthday.month - 1]} {persona.birthday.day},{" "}
            {persona.birthday.year} · ~{formatHour(persona.birthHour)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconTip label="Go Home">
            <Button
              variant="secondary"
              size="icon-sm"
              onClick={() => goTo(persona.homeBuildingId)}
              aria-label="Go to home building"
            >
              <Home />
            </Button>
          </IconTip>
          {persona.commuteTargetBuildingId !== undefined && (
            <IconTip label={school && !business ? "Go to School" : "Go to Work"}>
              <Button
                variant="secondary"
                size="icon-sm"
                onClick={() => goTo(persona.commuteTargetBuildingId!)}
                aria-label={school && !business ? "Go to school building" : "Go to workplace"}
              >
                <Briefcase />
              </Button>
            </IconTip>
          )}
        </div>
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
                <span className="font-medium text-foreground">{persona.moonSign} Moon</span> · the
                inner weather
              </div>
              <div className="mt-0.5">
                <span className="font-medium text-foreground">{persona.risingSign} Rising</span> ·
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
                {persona.mbtiNickname.replace(/^The /, "")}
              </Badge>
            }
          />
          <HoverCardContent>
            <div className="font-medium">
              {persona.mbti} · {persona.mbtiNickname}
            </div>
            <p className="mt-1.5">{MBTI_DESCRIPTIONS[persona.mbti]}</p>
          </HoverCardContent>
        </HoverCard>
      </div>

    </>
    );
  }

  return (
    <>
      {story.wasIs && <p className="text-sm">{story.wasIs}</p>}
      {story.whyAwake && <p className="text-sm">{story.whyAwake}</p>}

      <Separator />

      <div className="flex flex-col gap-1">
        <ColumnStat
          label={school && !business ? "School" : "Profession"}
          stack={professionValue.length > STACK_AT}
          value={
            workPlace ? (
              <button
                type="button"
                onClick={() => push({ kind: "company", id: workPlace.id })}
                className="text-right hover:underline"
              >
                {professionValue}
              </button>
            ) : (
              professionValue
            )
          }
        />
        {persona.commute && (
          <ColumnStat
            label="Commute"
            stack={
              (persona.commute.mode === "transit"
                ? `Rides the ${indexes.names.city.transitLine}`
                : COMMUTE_LABELS[persona.commute.mode]
              ).length +
                8 >
              STACK_AT
            }
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: COMMUTE_COLORS[persona.commute.mode] }}
                  aria-hidden
                />
                {persona.commute.mode === "transit"
                  ? `Rides ${transitLineFor(persona.id, indexes)}`
                  : COMMUTE_LABELS[persona.commute.mode]}{" "}
                ·{" "}
                {persona.commute.distance >= 1000
                  ? `${(persona.commute.distance / 1000).toFixed(1)} km`
                  : `${persona.commute.distance} m`}
              </span>
            }
          />
        )}
        <ColumnStat
          label="Education"
          stack={(persona.educationDetail ?? persona.education).length > STACK_AT}
          value={persona.educationDetail ?? persona.education}
        />
        <ColumnStat
          label="Home"
          stack={homeText.length > STACK_AT}
          value={
            <button
              type="button"
              onClick={() => push({ kind: "building", id: persona.homeBuildingId })}
              className="text-right hover:underline"
            >
              {homeText}
            </button>
          }
        />
        <ColumnStat
          label="In City"
          value={persona.bornHere ? "Born here" : `${persona.yearsInCity} years`}
        />
        <ColumnStat
          label="Status"
          stack={
            persona.relationshipStatus.length + (partner ? partner.fullName.length + 3 : 0) >
            STACK_AT
          }
          value={
            <>
              {capitalize(persona.relationshipStatus)}
              {partner && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => push({ kind: "persona", id: partner.id })}
                    className="hover:underline"
                  >
                    {partner.fullName}
                  </button>
                </>
              )}
            </>
          }
        />
      </div>

      {(persona.family.length > 0 || persona.offstage.length > 0) && (
        <>
          <Separator />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Family</div>
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
                  className="-mx-1 flex items-baseline justify-between gap-4 rounded px-1 text-left text-sm hover:bg-foreground/10"
                >
                  <span className="capitalize text-muted-foreground">{link.role}</span>
                  <span>{relative.fullName}</span>
                </button>
              );
            })}
            {persona.offstage.map((rel, i) => (
              <div
                key={`${rel.role}:${rel.name}:${i}`}
                className="flex items-baseline justify-between gap-4 text-sm text-muted-foreground"
              >
                <span className="capitalize">{rel.role}</span>
                <span>{rel.name}, lives elsewhere</span>
              </div>
            ))}
          </div>
        </>
      )}

      {(story.detail || story.refusal || story.relation) && (
        <div className="flex flex-col gap-1">
          {story.detail && <p className="text-sm">{story.detail}</p>}
          {story.refusal && <p className="text-sm">{story.refusal}</p>}
          {story.relation && (
            <button
              type="button"
              onClick={() => push({ kind: "persona", id: story.relation!.targetId })}
              className="text-left text-sm hover:underline"
            >
              {story.relation.line}
            </button>
          )}
        </div>
      )}

      <Separator />

      <div className="border-l-2 pl-2 text-sm italic">{story.hook}</div>
    </>
  );
}
