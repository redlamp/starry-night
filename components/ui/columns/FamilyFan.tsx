"use client";

import type { ReactNode } from "react";
import type { Persona } from "@/lib/seed/personas";
import { GenderIcon } from "./genderIcon";
import { genderTintCss, hueCss, type FamilyFanData, type FanSlot } from "./familyWeb";

// Fan view (user 2026-07-10: "can help with larger families") — a bow-tie
// double fan around the focus. TOP semicircle = ancestors: ring 1 two 90°
// parent wedges (older left by the couple age rule), ring 2 four 45°
// grandparent wedges subdividing each parent's span; missing ancestors are
// dimmed empty wedges so the ring geometry never changes. BOTTOM semicircle
// = descendants: ring 1 the focus's children in equal wedges (oldest left),
// ring 2 each child's own children subdividing their parent's wedge — no
// cap, thin wedges are the point. Blood-lineage only: partners/married-ins
// don't appear (the web views keep the full social picture; the fixed note
// below names the partner). Pure SVG polar math — no measure pass, no DOM
// reads. Clicking a wedge re-roots on that person (fast lineage traversal);
// re-rooting redraws around the new center, which is the expected motion
// for a fan. Layers change colors only, never geometry: Lineage Colors →
// wedge borders in the person's hue with a translucent hue fill; Gender
// Tint → the fill leans to the gender tint while the lineage hue stays on
// the border (both on = lineage border + gender fill).

const DISC_R = 56; // center disc radius
const RING = 72; // ring thickness
const R1 = DISC_R + RING; // 128 — outer edge of ring 1
const R2 = R1 + RING; // 200 — outer edge of ring 2
const PAD = 8;
const C = R2 + PAD; // center coordinate
const SIZE = C * 2; // ≈416px square

// Math-convention polar point (0° = east, counter-clockwise), y flipped for
// screen space: the top semicircle is 0–180°, the bottom 180–360°.
function pt(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C - r * Math.sin(a)];
}

// Donut-segment path between math angles a1 < a2 (outer arc out, inner arc
// back). Increasing math angle is counter-clockwise on screen → sweep 0
// outbound, 1 back.
function donut(a1: number, a2: number, rIn: number, rOut: number): string {
  const [x1, y1] = pt(rOut, a1);
  const [x2, y2] = pt(rOut, a2);
  const [x3, y3] = pt(rIn, a2);
  const [x4, y4] = pt(rIn, a1);
  const large = a2 - a1 > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${large} 0 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${large} 1 ${x4} ${y4} Z`;
}

export function FanChart({
  fan,
  lineage,
  tint,
  onSelect,
}: {
  fan: FamilyFanData;
  lineage: boolean;
  tint: boolean;
  onSelect: (id: string) => void;
}) {
  // Fill/stroke per layer state. Chosen split (both layers on): the FILL
  // leans gender (the tint's own alpha), the BORDER carries the lineage
  // hue — so both signals survive together, mirroring the box view where
  // the tint is the background and the stripe/connector carry lineage.
  const fillFor = (p: Persona, hue?: number): { fill: string; opacity: number } => {
    if (tint) return { fill: genderTintCss(p.genderIdentity), opacity: 1 };
    if (lineage && hue !== undefined) return { fill: hueCss(hue, 0.3), opacity: 1 };
    return { fill: "var(--muted)", opacity: 0.6 };
  };
  const strokeFor = (hue?: number) =>
    lineage && hue !== undefined ? hueCss(hue) : "var(--border)";

  // Horizontal label at the wedge centroid, truncated to the arc length at
  // mid radius; below ~18° (or when fewer than 4 chars fit) it drops to an
  // initial — the <title> tooltip and aria-label carry the full name. Text
  // never goes below 12px (text-xs floor, user 2026-07-10).
  const wedgeLabel = (p: Persona, a1: number, a2: number, rIn: number, rOut: number) => {
    const midR = (rIn + rOut) / 2;
    const [x, y] = pt(midR, (a1 + a2) / 2);
    const widthDeg = a2 - a1;
    const chord = (midR * widthDeg * Math.PI) / 180;
    const maxChars = Math.floor(chord / 7);
    const tiny = widthDeg < 18 || maxChars < 4;
    const name = tiny
      ? `${p.givenName[0] ?? "?"}.`
      : p.givenName.length > maxChars
        ? `${p.givenName.slice(0, Math.max(2, maxChars - 1))}…`
        : p.givenName;
    const showAge = !tiny && widthDeg >= 24;
    return (
      <text
        x={x}
        y={showAge ? y - 2 : y + 4}
        textAnchor="middle"
        fontSize={12}
        className="pointer-events-none select-none"
      >
        <tspan x={x} fill="var(--popover-foreground)">
          {name}
        </tspan>
        {showAge && (
          <tspan x={x} dy={13} fill="var(--muted-foreground)">
            {p.age}
          </tspan>
        )}
      </text>
    );
  };

  const wedge = (
    s: FanSlot | null,
    a1: number,
    a2: number,
    rIn: number,
    rOut: number,
    key: string,
  ): ReactNode => {
    const d = donut(a1, a2, rIn, rOut);
    if (!s) {
      // Missing ancestor: dimmed empty wedge keeps the ring geometry stable.
      return (
        <path
          key={key}
          d={d}
          fill="var(--muted)"
          fillOpacity={0.35}
          stroke="var(--border)"
          strokeWidth={1}
          aria-hidden
        />
      );
    }
    const p = s.persona;
    const { fill, opacity } = fillFor(p, s.hue);
    return (
      <g
        key={key}
        role="button"
        tabIndex={0}
        aria-label={`${p.givenName} ${p.familyName}, ${p.age}`}
        className="cursor-pointer outline-none focus-visible:opacity-75"
        onClick={() => onSelect(p.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(p.id);
          }
        }}
      >
        <title>{`${p.givenName} ${p.familyName} (${p.age})`}</title>
        <path
          d={d}
          fill={fill}
          fillOpacity={opacity}
          stroke={strokeFor(s.hue)}
          strokeWidth={1.5}
          className="transition-opacity hover:opacity-80"
        />
        {wedgeLabel(p, a1, a2, rIn, rOut)}
      </g>
    );
  };

  const wedges: ReactNode[] = [];
  // Ancestors (top, math angles 0–180): parent wedges [90,180] left /
  // [0,90] right; each parent's grandparents subdivide their span, older on
  // the screen-left half.
  wedges.push(wedge(fan.parents[0], 90, 180, DISC_R, R1, "p0"));
  wedges.push(wedge(fan.parents[1], 0, 90, DISC_R, R1, "p1"));
  const gpSpans: Array<[number, number]> = [
    [135, 180],
    [90, 135],
    [45, 90],
    [0, 45],
  ];
  fan.grandparents.forEach((g, i) =>
    wedges.push(wedge(g, gpSpans[i][0], gpSpans[i][1], R1, R2, `g${i}`)),
  );
  // Descendants (bottom, math angles 180–360): equal wedges oldest-left
  // (left = 180°, the west edge); grandchildren subdivide their parent's
  // span equally.
  if (fan.children.length === 0) {
    wedges.push(wedge(null, 180, 360, DISC_R, R1, "c-empty"));
  } else {
    const step = 180 / fan.children.length;
    fan.children.forEach((c, i) => {
      const a1 = 180 + i * step;
      wedges.push(wedge(c, a1, a1 + step, DISC_R, R1, `c${i}`));
      const kids = fan.grandchildren[i] ?? [];
      if (kids.length > 0) {
        const sub = step / kids.length;
        kids.forEach((k, j) =>
          wedges.push(wedge(k, a1 + j * sub, a1 + (j + 1) * sub, R1, R2, `c${i}k${j}`)),
        );
      }
    });
  }

  const focusP = fan.focus.persona;
  const disc = fillFor(focusP, fan.focus.hue);

  return (
    // Same chart region as the web views: fills the flex-1 slot between the
    // header and the fixed-height footer/controls rows; the fan centers in
    // it and the fixed-height partner note sits underneath.
    <div className="relative flex w-max min-w-full flex-1 flex-col items-center justify-center gap-2 p-3">
      <div className="relative">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="group">
          {wedges}
          <circle
            cx={C}
            cy={C}
            r={DISC_R}
            fill={disc.fill}
            fillOpacity={disc.opacity}
            stroke={strokeFor(fan.focus.hue)}
            strokeWidth={2}
          />
        </svg>
        {/* Center disc content as an HTML overlay (lucide icons don't nest
            in plain SVG); clicking it re-roots on the focus (a no-op that
            keeps the "every person is clickable" rule uniform). */}
        <button
          type="button"
          onClick={() => onSelect(focusP.id)}
          aria-label={`${focusP.givenName} ${focusP.familyName}, ${focusP.age}`}
          className="absolute top-1/2 left-1/2 flex size-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-xs"
        >
          <span className="max-w-[6rem] truncate font-medium">{focusP.givenName}</span>
          <span className="max-w-[6rem] truncate font-medium">{focusP.familyName}</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <GenderIcon identity={focusP.genderIdentity} className="size-4" />
            {focusP.age}
          </span>
        </button>
      </div>
      {/* Fixed-height note: the fan is blood-only, so name the partner here
          (constant height whether present or not — no chart shift). */}
      <div className="text-muted-foreground h-5 shrink-0 text-xs">
        {fan.partnerName ? `Partner: ${fan.partnerName}` : ""}
      </div>
    </div>
  );
}
