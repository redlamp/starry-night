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

export function GenderIcon({
  identity,
  className,
}: {
  identity: GenderIdentity;
  className?: string;
}) {
  const Icon = ICONS[identity];
  return <Icon className={className} aria-hidden={false} aria-label={identity} role="img" />;
}
