import { Mars, NonBinary, Venus } from "lucide-react";
import type { GenderIdentity } from "@/lib/seed/personaData";

// Display rule (user 2026-07-11): men read as Mars and women as Venus
// regardless of cis/trans — the identity DATA is unchanged, but the glyph
// follows lived gender, so the chart doesn't over-signal transness (the
// distinct Transgender symbol made 0.8% read as "a lot"). Nonbinary keeps
// its own glyph.
const ICONS: Record<GenderIdentity, typeof Mars> = {
  "cis man": Mars,
  "cis woman": Venus,
  "trans man": Mars,
  "trans woman": Venus,
  nonbinary: NonBinary,
};

// Icon colour matches the gender-tint palette (familyWeb.genderTintCss):
// GREEN men / ORANGE women / PURPLE other, at full strength so the glyph
// reads on its own (user 2026-07-10).
const ICON_COLOR: Record<GenderIdentity, string> = {
  "cis man": "oklch(0.75 0.15 150)",
  "trans man": "oklch(0.75 0.15 150)",
  "cis woman": "oklch(0.75 0.15 55)",
  "trans woman": "oklch(0.75 0.15 55)",
  nonbinary: "oklch(0.75 0.15 305)",
};

export function GenderIcon({
  identity,
  className,
}: {
  identity: GenderIdentity;
  className?: string;
}) {
  const Icon = ICONS[identity];
  return (
    <Icon
      className={className}
      style={{ color: ICON_COLOR[identity] }}
      aria-hidden={false}
      aria-label={identity}
      role="img"
    />
  );
}
