"use client";

import {
  BadgeDollarSign,
  BookOpen,
  BriefcaseBusiness,
  ChefHat,
  ClipboardList,
  ConciergeBell,
  Factory,
  FlaskConical,
  GraduationCap,
  Hammer,
  Landmark,
  Laptop,
  Palette,
  Scale,
  Scissors,
  Shield,
  ShoppingBag,
  Stethoscope,
  Truck,
  UserCog,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProfessionCategory, WorkplaceType } from "@/lib/seed/personaData";

// Shared out of PersonaColumn (2026-07-18, #92 feedback): the companies
// registry wants its industry pills colour-coded and iconed the SAME way
// resident details already does, so both live here and import from one
// place instead of drifting apart.

// Row-icon colour coding (re-cut 2026-07-11): work is GREEN (money), home is
// ORANGE (hearth), education keeps the transit blue.
export const HOME_ICON_COLOR = "#f2a24a";
export const WORK_ICON_COLOR = "#3fa87e";
export const EDUCATION_ICON_COLOR = "#6fa8ff";

// Profession-row glyph by industry (user 2026-07-10); statuses cover the
// professionless. Anything unmapped falls back to the generic briefcase.
export const PROFESSION_ICONS: Partial<Record<ProfessionCategory, LucideIcon>> = {
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

// Business.kind (WorkplaceType) -> icon, for the companies registry's
// industry pills (#92 feedback round 2). Businesses don't carry a
// ProfessionCategory directly, so each kind borrows the PROFESSION_ICONS
// glyph for whichever category is that kind's dominant employer in
// lib/seed/personaData.ts's PROFESSIONS table (tallied once, not guessed) —
// e.g. "hospital" workers are overwhelmingly Healthcare, "shop" is Personal
// Care (barbers, stylists, tailors). "school" is special-cased to
// GraduationCap: that's the exact icon the Education/School StatRow already
// renders for the same businesses, so it isn't derived, it's identical.
export const WORKPLACE_KIND_ICON: Record<WorkplaceType, LucideIcon> = {
  office: PROFESSION_ICONS["Office & Admin"]!,
  hospital: PROFESSION_ICONS["Healthcare"]!,
  school: GraduationCap,
  retail: PROFESSION_ICONS["Retail"]!,
  restaurant: PROFESSION_ICONS["Food Service"]!,
  factory: PROFESSION_ICONS["Manufacturing"]!,
  warehouse: PROFESSION_ICONS["Transportation"]!,
  civic: PROFESSION_ICONS["Public Safety"]!,
  home: PROFESSION_ICONS["Arts & Media"]!,
  outdoor: PROFESSION_ICONS["Construction & Trades"]!,
  transit: PROFESSION_ICONS["Transportation"]!,
  studio: PROFESSION_ICONS["Arts & Media"]!,
  lab: PROFESSION_ICONS["Science"]!,
  shop: PROFESSION_ICONS["Personal Care"]!,
};

// Display names for the industry pills (user 2026-07-18: "Medical" over
// "Hospital"). Only Medical diverges from the raw kind for now — a broader
// research-based taxonomy is proposed in wiki/research/industry-taxonomy.md
// and lands as one pass once the category set is picked.
export const WORKPLACE_KIND_LABEL: Record<WorkplaceType, string> = {
  office: "Office",
  hospital: "Medical",
  school: "School",
  retail: "Retail",
  restaurant: "Restaurant",
  factory: "Factory",
  warehouse: "Warehouse",
  civic: "Civic",
  home: "Home",
  outdoor: "Outdoor",
  transit: "Transit",
  studio: "Studio",
  lab: "Lab",
  shop: "Shop",
};

// One hue per industry (user 2026-07-18: "color code the industry pills") at
// a shared oklch lightness/chroma band so every pill carries equal weight on
// both themes. School keeps the Education row's exact blue; resident-details
// rows keep their two-tone system — the per-industry hues live on the pills.
export const WORKPLACE_KIND_COLOR: Record<WorkplaceType, string> = {
  office: "oklch(0.70 0.09 250)", // slate blue
  hospital: "oklch(0.70 0.13 20)", // red cross
  school: EDUCATION_ICON_COLOR,
  retail: "oklch(0.70 0.12 330)", // magenta
  restaurant: "oklch(0.72 0.12 60)", // orange
  factory: "oklch(0.68 0.05 260)", // steel
  warehouse: "oklch(0.69 0.09 80)", // tan
  civic: "oklch(0.68 0.11 290)", // indigo
  home: "oklch(0.71 0.10 130)", // moss
  outdoor: "oklch(0.70 0.12 145)", // green
  transit: "oklch(0.72 0.10 210)", // cyan
  studio: "oklch(0.70 0.12 310)", // purple
  lab: "oklch(0.72 0.10 180)", // teal
  shop: "oklch(0.72 0.11 350)", // pink
};

// The industry pill itself (#92 feedback round 2) — used by both the
// companies registry rows and CompanyColumn's pinned badge so a business
// reads the same way wherever it appears.
export function WorkplaceKindBadge({
  kind,
  label,
  className,
}: {
  kind: WorkplaceType;
  label: string;
  className?: string;
}) {
  const Icon = WORKPLACE_KIND_ICON[kind] ?? BriefcaseBusiness;
  const color = WORKPLACE_KIND_COLOR[kind] ?? WORK_ICON_COLOR;
  return (
    <Badge
      variant="outline"
      style={{ color, borderColor: color }}
      className={cn("shrink-0 capitalize", className)}
    >
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
