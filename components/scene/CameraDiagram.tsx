"use client";

import { cn } from "@/lib/utils";

// Live side-view (elevation) schematic of the camera rig: an abstracted cross-section in the
// vertical plane that contains the camera and the focal point. It shows how the three things the
// orbit controls juggle actually relate —
//   • the CAMERA, up and to the left, at its real height above ground;
//   • its VIEW (a converging cone in perspective, a parallel slab in ortho) drawn to the focal plane;
//   • the ELEVATION ANGLE between the camera's horizon and its view axis;
//   • the FOCAL POINT (orbit pivot) at its Focal-Y height, with a plumb line to the ground;
//   • the GROUND, and the camera's clearance above it (the clamp that stops the eye going under).
// It is a read-only mirror of the live pose — watch it while you drag to see why a grazing, far-out
// view turns a small drag into a big move, or how ortho keeps rays parallel.
//
// Shared by the camera lab (CameraLab → LabHud) and the real app (CameraSideView overlay, behind the
// Orbit → "side-view diagram" toggle). The container position is a `className` so each host can place
// it (the app stacks it above the seed bar); omit it for the lab's default bottom-left corner.

const DEG = Math.PI / 180;
const W = 248;
const H = 150;
const PAD = 20;

export type CamReadout = {
  elev: number; // degrees above the horizon
  dist: number; // camera → focal (world units)
  focalY: number; // focal-point height above ground
  camY: number; // camera eye height above ground
  parallel: boolean; // true = (mostly) orthographic — drives the label
  frustumHh: number; // world half-height of the view at the focal plane
  blend: number; // 0 = perspective, 1 = orthographic (the live morph amount)
  // Low-angle framing + tilt-throttle gauges (the app provides these; the lab omits them → no gauges).
  screenY?: number; // current eased pivot, fraction up from the bottom
  screenYBase?: number; // the "normal" Screen-Y endpoint
  screenYLow?: number; // the low-angle Screen-Y endpoint
  tilt?: number; // current rotate/tilt speed multiplier, 0..1
  frameBelow?: number; // elevation (deg) below which the framing eases in
  tiltBelow?: number; // elevation (deg) below which the tilt throttle eases in
};

type P = { h: number; y: number }; // side-plane world coords: h = horizontal from focal, y = up

export function CameraDiagram({
  data,
  mode,
  show,
  onToggleProjection,
  className,
}: {
  data: CamReadout;
  mode: string;
  show: boolean;
  // when provided, the projection label becomes a tap target that flips persp ↔ ortho (the
  // mobile-friendly equivalent of the P key); omitted when the method is perspective-locked
  onToggleProjection?: () => void;
  // container position / stacking; defaults to the bottom-left corner (the lab's placement)
  className?: string;
}) {
  if (!show) return null;

  const body =
    mode === "fly" ? (
      <div className="flex h-[150px] items-center justify-center px-4 text-center text-[10px] leading-snug text-zinc-500">
        fly mode — free camera, no focal pivot.
        <br />
        Switch to an orbit method to see the geometry.
      </div>
    ) : (
      <Diagram data={data} />
    );

  return (
    <div
      className={cn(
        "pointer-events-none absolute w-[248px] overflow-hidden rounded-lg border border-zinc-700/70 bg-black/55 backdrop-blur",
        className ?? "bottom-3 left-3 z-10",
      )}
    >
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-1">
        <span className="font-mono text-[10px] tracking-wider text-zinc-400 uppercase">side view</span>
        {onToggleProjection ? (
          <button
            type="button"
            onClick={onToggleProjection}
            title="Tap to toggle projection (P)"
            className="pointer-events-auto -my-1 rounded px-1.5 py-1 font-mono text-[10px] text-teal-300 underline decoration-dotted underline-offset-2 hover:bg-white/5 hover:text-teal-200 active:bg-white/10"
          >
            {data.parallel ? "orthographic" : "perspective"}
          </button>
        ) : (
          <span className="font-mono text-[10px] text-teal-300">
            {data.parallel ? "orthographic" : "perspective"}
          </span>
        )}
      </div>
      {body}
      {mode !== "fly" && data.screenY != null && <FramingGauges data={data} />}
    </div>
  );
}

// Live gauges for the low-angle framing system (current system, pre-unification): where Screen Y
// currently sits between its low ↔ norm endpoints (eases in below frameBelow°), and the rotate/tilt
// speed throttle (eases in below tiltBelow°). Drag the camera low and watch them move.
function FramingGauges({ data }: { data: CamReadout }) {
  const base = data.screenYBase ?? 0.37;
  const low = data.screenYLow ?? 0.18;
  const cur = data.screenY ?? base;
  const lo = Math.min(low, base);
  const hi = Math.max(low, base);
  const t = hi > lo ? Math.max(0, Math.min(1, (cur - lo) / (hi - lo))) : 1;
  const tiltPct = Math.round((data.tilt ?? 1) * 100);
  return (
    <div className="space-y-1 border-t border-zinc-700/60 px-2.5 pt-1.5 pb-2 font-mono text-[9px]">
      <div className="flex items-center gap-1.5">
        <span className="w-9 shrink-0 text-zinc-500">Scr Y</span>
        <span className="w-7 shrink-0 text-right text-zinc-600 tabular-nums">{lo.toFixed(2)}</span>
        <div className="relative h-1 flex-1 rounded-full bg-zinc-700/70">
          <span
            className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-teal-300"
            style={{ left: `calc(${t * 100}% - 4px)` }}
          />
        </div>
        <span className="w-7 shrink-0 text-zinc-600 tabular-nums">{hi.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-9 shrink-0 text-zinc-500">Tilt</span>
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-zinc-700/70">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-amber-400"
            style={{ width: `${tiltPct}%` }}
          />
        </div>
        <span className="w-9 shrink-0 text-right text-amber-300 tabular-nums">{tiltPct}%</span>
      </div>
      <div className="text-[8px] text-zinc-600">
        framing eases &lt;{data.frameBelow ?? 12}° · tilt slows &lt;{data.tiltBelow ?? 20}°
      </div>
    </div>
  );
}

function Diagram({ data }: { data: CamReadout }) {
  // Geometry in the side plane. Negative elevation (looking UP) is allowed; only the ±90
  // singularities are clamped off for drawing.
  const eG = Math.max(-85, Math.min(85, data.elev)) * DEG;
  const dist = Math.max(1, data.dist);
  const focalY = data.focalY;
  const Hh = Math.max(1, data.frustumHh);

  // True view direction in the side plane (h = right, y = up): (cos, −sin). elev > 0 → down-right
  // (looking down); elev < 0 → up-right (looking up). The CONE follows THIS axis — not the
  // camera→focal segment — so it always tilts with the elevation angle, even when the focal offset
  // (below) leaves the eye and the focal at nearly the same height.
  const vh = Math.cos(eG);
  const vy = -Math.sin(eG);

  // Camera glyph at its REAL eye height (data.camY ≥ 0 by the ground clamp), up-left of the focal.
  const camHoriz = dist * vh;
  const C: P = { h: -camHoriz, y: data.camY };

  // The focal offset (Screen-Y parking + low-angle ground pull) physically shifts the eye off the bare
  // orbit point, so the focal/pivot does NOT sit on the view-axis centre — it's parked off it by that
  // offset (this is literally what Screen-Y does). Recover the offset from the readout
  // (offsetY = camY − focalY − dist·sin elev) and place the axis centre at the focal plane accordingly.
  // Decoupling these is what lets the cone tilt up while the eye stays above ground in ortho: there the
  // orbit radius is a large fixed park value, so the bare orbit point plunges far below ground at a
  // slight look-up while the real eye (lifted by the offset) stays at/above it.
  const offsetY = data.camY - focalY - dist * Math.sin(eG);
  const Ac: P = { h: 0, y: focalY + offsetY }; // view-axis centre at the focal plane (= C + dist·v)
  const F: P = { h: 0, y: focalY }; // focal point (orbit pivot) — offsetY off the axis centre
  const Fg: P = { h: 0, y: 0 }; // focal's ground point

  // perp to the view axis (points up-right), for the frustum half-height at the focal plane
  const px = Math.sin(eG);
  const py = Math.cos(eG);
  const top: P = { h: Ac.h + px * Hh, y: Ac.y + py * Hh };
  const bot: P = { h: Ac.h - px * Hh, y: Ac.y - py * Hh };
  // Back-plane half-width morphs with the projection blend: 0 at the camera point (perspective
  // cone) → Hh at full width (orthographic parallel slab), so the drawn frustum tweens with the view.
  const bw = Hh * Math.max(0, Math.min(1, data.blend));
  const Cbt: P = { h: C.h + px * bw, y: C.y + py * bw };
  const Cbb: P = { h: C.h - px * bw, y: C.y - py * bw };
  // The auto-fit, however, always uses the FULL ortho-slab corners — so the diagram holds one
  // constant scale across the morph (the ortho "square" size), and the perspective cone just draws
  // smaller inside that same frame instead of the whole figure zooming as the back-width collapses.
  const CbtFull: P = { h: C.h + px * Hh, y: C.y + py * Hh };
  const CbbFull: P = { h: C.h - px * Hh, y: C.y - py * Hh };

  // Natural projection of the view axis past the focal plane — continue the REAL ray (eye → axis
  // centre → beyond) and key the colour on where the camera aims: elev ≥ 0 → it meets the ground
  // (soil-brown); elev < 0 → its far field is the sky (sky-blue). Cropped at the panel edge.
  const down = data.elev >= 0;
  const axisColor = down ? "#b5835a" /* soil */ : "#7dd3fc"; /* sky */
  const REACH = Math.max(camHoriz, dist); // ~one focal-plane span past the centre; cropped at the edge
  const sinE = Math.sin(eG);
  let ext: P;
  if (down && data.camY > 0 && sinE > 1e-3) {
    // axis: C + t·v; ground (y = 0) at t = camY / sin(elev). Past the focal plane for a normal
    // down-look, so the dashed segment runs from the axis centre to the ground hit.
    const tg = data.camY / sinE;
    ext = { h: C.h + tg * vh, y: 0 };
  } else {
    // looking up (or near-level): extend along the axis past the focal plane (rises for a look-up)
    ext = { h: Ac.h + REACH * vh, y: Ac.y + REACH * vy };
  }

  // auto-fit all points (plus the ground) into the SVG, uniform scale, centred. Uses the FULL
  // slab corners (not the morphing bw ones) so the scale is identical in perspective and ortho.
  // Fit the camera + frustum + focal only — NOT the projection (it may run off-screen, which is fine:
  // it's cropped at the panel edge).
  const pts = [C, F, Fg, top, bot, CbtFull, CbbFull];
  let minH = Infinity;
  let maxH = -Infinity;
  let minY = 0; // always include the ground line
  let maxY = -Infinity;
  for (const p of pts) {
    minH = Math.min(minH, p.h);
    maxH = Math.max(maxH, p.h);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const spanH = Math.max(1, maxH - minH);
  const spanY = Math.max(1, maxY - minY);
  // Extra right padding (beyond PAD) so the right-edge sky/ground labels clear the figure + the fY label.
  const padR = 48;
  const sc = Math.min((W - PAD - padR) / spanH, (H - 2 * PAD) / spanY);
  const offX = PAD + ((W - PAD - padR) - spanH * sc) / 2;
  const offY = PAD + ((H - 2 * PAD) - spanY * sc) / 2;
  const X = (h: number) => offX + (h - minH) * sc;
  const Y = (y: number) => H - offY - (y - minY) * sc;
  const sx = (p: P) => X(p.h);
  const sy = (p: P) => Y(p.y);

  const groundYpx = Y(0);
  const clearance = C.y; // the camera glyph's drawn height above ground (self-consistent w/ the figure)
  const tight = clearance < Math.max(20, 0.04 * dist); // near the ground clamp
  const camColor = tight ? "#f59e0b" : "#34e0c8";

  // elevation arc at the camera, from the horizon (screen +x) down to the view axis
  const aR = 18;
  const cx = X(C.h);
  const cy = Y(C.y);
  const arcSweep = data.elev >= 0 ? 1 : 0; // sweep down for a look-down angle, up for a look-up angle
  const arc = `M ${cx + aR} ${cy} A ${aR} ${aR} 0 0 ${arcSweep} ${cx + aR * Math.cos(eG)} ${cy + aR * Math.sin(eG)}`;
  const amid = eG / 2;
  const aLabel = { x: cx + (aR + 11) * Math.cos(amid), y: cy + (aR + 11) * Math.sin(amid) };

  // One quad that degenerates to the perspective triangle at blend 0 (Cbt == Cbb == C).
  const frustum = `M ${sx(Cbt)} ${sy(Cbt)} L ${sx(top)} ${sy(top)} L ${sx(bot)} ${sy(bot)} L ${sx(Cbb)} ${sy(Cbb)} Z`;

  const mid = (a: P, b: P) => ({ x: (sx(a) + sx(b)) / 2, y: (sy(a) + sy(b)) / 2 });
  const dMid = mid(C, Ac);
  const camToGroundMidY = (cy + groundYpx) / 2;

  return (
    <svg width={W} height={H} className="block">
      {/* soil band + ground line — the ground is shown brown. The horizon label reads "ground" or
          "sky" (what the focal sits in) in the matching colour, floated at the focal's height. */}
      <rect x={0} y={groundYpx} width={W} height={H - groundYpx} fill="#241810" opacity={0.8} />
      <line x1={0} y1={groundYpx} x2={W} y2={groundYpx} stroke="#b5835a" strokeWidth={1.5} />
      {/* "sky" above + "ground" below the ground line; the focal's target (where the view lands) is
          highlighted (full opacity + bold), the other dimmed. */}
      <text
        x={W - 5}
        y={groundYpx - 4}
        textAnchor="end"
        className="font-mono"
        fontSize={8}
        fill="#7dd3fc"
        opacity={down ? 0.3 : 1}
        fontWeight={down ? 400 : 700}
      >
        sky
      </text>
      <text
        x={W - 5}
        y={Math.min(H - 3, groundYpx + 11)}
        textAnchor="end"
        className="font-mono"
        fontSize={8}
        fill="#b5835a"
        opacity={down ? 1 : 0.3}
        fontWeight={down ? 700 : 400}
      >
        ground
      </text>

      {/* view frustum: cone (perspective) or parallel slab (ortho) */}
      <path d={frustum} fill="#22d3ee" fillOpacity={0.08} stroke="#22d3ee" strokeOpacity={0.45} strokeWidth={1} />

      {/* view axis: camera → view-centre (solid, neutral) + the projection PAST it (dashed) in the
          TARGET colour — soil-brown if it heads to the ground, sky-blue if it rises into the sky. The
          focal/pivot is drawn separately below; it sits off this centre line by the Screen-Y offset. */}
      <line x1={sx(C)} y1={sy(C)} x2={sx(Ac)} y2={sy(Ac)} stroke="#cbd5e1" strokeWidth={1.4} strokeOpacity={0.8} />
      <line x1={sx(Ac)} y1={sy(Ac)} x2={sx(ext)} y2={sy(ext)} stroke={axisColor} strokeWidth={1.4} strokeDasharray="3 3" strokeOpacity={0.95} />

      {/* horizon reference at the camera + elevation arc */}
      <line x1={cx} y1={cy} x2={cx + aR + 14} y2={cy} stroke="#a1a1aa" strokeWidth={1} strokeDasharray="2 3" strokeOpacity={0.7} />
      <path d={arc} fill="none" stroke="#fbbf24" strokeWidth={1.4} />
      <text x={aLabel.x} y={aLabel.y + 3} className="fill-amber-300 font-mono" fontSize={9}>
        {data.elev.toFixed(0)}°
      </text>

      {/* camera clearance above ground (the clamp keeps this ≥ 0) */}
      <line x1={cx} y1={cy} x2={cx} y2={groundYpx} stroke={camColor} strokeWidth={1} strokeDasharray="2 2" strokeOpacity={0.7} />
      <text x={cx - 4} y={camToGroundMidY} textAnchor="end" className="font-mono" fontSize={8} fill={camColor}>
        {Math.round(clearance)}
      </text>

      {/* focal plumb to ground + focal-Y label */}
      <line x1={sx(F)} y1={sy(F)} x2={sx(Fg)} y2={sy(Fg)} stroke="#7dd3fc" strokeWidth={1} strokeDasharray="2 2" strokeOpacity={0.6} />
      <circle cx={sx(Fg)} cy={sy(Fg)} r={2} fill="#7dd3fc" />
      {Math.abs(focalY) > 6 && (
        <text
          x={sx(F) - 6}
          y={(sy(F) + sy(Fg)) / 2}
          textAnchor="end"
          className="fill-sky-300 font-mono"
          fontSize={8}
        >
          fY {Math.round(focalY)}
        </text>
      )}

      {/* distance label along the view axis */}
      <text x={dMid.x} y={dMid.y - 4} textAnchor="middle" className="fill-zinc-300 font-mono" fontSize={8}>
        d {Math.round(dist)}
      </text>

      {/* focal pin */}
      <circle cx={sx(F)} cy={sy(F)} r={3.5} fill="#34e0c8" stroke="#0a0f17" strokeWidth={1} />

      {/* camera glyph */}
      <circle cx={cx} cy={cy} r={4.5} fill={camColor} stroke="#0a0f17" strokeWidth={1} />
      <text x={cx} y={cy - 8} textAnchor="middle" className="font-mono" fontSize={8} fill={camColor}>
        cam
      </text>
    </svg>
  );
}
