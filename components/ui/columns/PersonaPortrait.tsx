import type { Persona } from "@/lib/seed/personas";

// Portrait slot on the resident card. This is the STUB (user 2026-09-05): a
// pictogram silhouette on a family-keyed tile, so every profile has a
// portrait-shaped thing in the same place before the generative face system
// (#100) exists. Three figures - man, woman, child - read at a glance the
// way restroom pictograms do; nonbinary adults get the neutral figure. When
// the real portraits land they replace the body of this component only:
// callers keep the same contract (persona in, square tile out). Display-only,
// nothing here feeds generation; the hash is FNV-1a (no transcendentals) so
// the tile color is stable across engines.

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// Hue keyed on the family name so households and kin share a tile color -
// a cheap first hint of the heritability the real portraits will carry.
function familyHue(familyName: string): number {
  return fnv1a(familyName) % 360;
}

type Figure = "man" | "woman" | "neutral" | "child";

// Lived gender picks the adult figure (same rule as GenderIcon: trans men
// read as men, trans women as women). Under 18 is the child figure.
function figureFor(p: Pick<Persona, "age" | "genderIdentity">): Figure {
  if (p.age < 18) return "child";
  switch (p.genderIdentity) {
    case "cis man":
    case "trans man":
      return "man";
    case "cis woman":
    case "trans woman":
      return "woman";
    default:
      return "neutral";
  }
}

// 64×64 silhouettes. Head + shoulders; the woman adds a hair mass behind the
// head, the child is the same figure at a smaller scale, lower in the frame.
const FIGURES: Record<Figure, string> = {
  man: "M32 12a10 10 0 1 1 0 20a10 10 0 1 1 0-20ZM6 64c0-17 12-25 26-25s26 8 26 25Z",
  woman:
    "M32 8c11 0 17 9 17 20v13H15V28c0-11 6-20 17-20ZM32 12a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0-19ZM9 64c0-16 11-24 23-24s23 8 23 24Z",
  neutral: "M32 12a10 10 0 1 1 0 20a10 10 0 1 1 0-20ZM9 64c0-16 10-24 23-24s23 8 23 24Z",
  child: "M32 24a8 8 0 1 1 0 16a8 8 0 1 1 0-16ZM14 64c0-12 8-19 18-19s18 7 18 19Z",
};

export function PersonaPortrait({
  persona,
  size = 56,
  className,
}: {
  persona: Pick<Persona, "givenName" | "familyName" | "age" | "genderIdentity">;
  size?: number;
  className?: string;
}) {
  const hue = familyHue(persona.familyName);
  const figure = figureFor(persona);
  return (
    <div
      role="img"
      aria-label={`${persona.givenName} ${persona.familyName}`}
      data-portrait="stub"
      data-figure={figure}
      className={["flex shrink-0 items-end justify-center overflow-hidden rounded-md", className]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: size,
        height: size,
        background: `oklch(0.32 0.06 ${hue})`,
        boxShadow: `inset 0 0 0 1px oklch(0.5 0.08 ${hue} / 0.6)`,
      }}
    >
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <path d={FIGURES[figure]} fill={`oklch(0.86 0.07 ${hue})`} />
      </svg>
    </div>
  );
}
