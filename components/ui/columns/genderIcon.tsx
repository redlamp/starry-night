import { Mars, NonBinary, Transgender, Venus } from "lucide-react";
import type { GenderIdentity } from "@/lib/seed/personaData";

// Lucide ships a "gender" icon set (Mars/Venus/Transgender/NonBinary/
// VenusAndMars) — map each identity to the icon that reads clearest at a
// glance rather than a literal per-identity glyph: trans man/woman both use
// the transgender symbol (there's no separate binary-trans icon in the set),
// nonbinary gets its own NonBinary glyph (present in the installed
// lucide-react, so no VenusAndMars fallback needed).
const ICONS: Record<GenderIdentity, typeof Mars> = {
  "cis man": Mars,
  "cis woman": Venus,
  "trans man": Transgender,
  "trans woman": Transgender,
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
