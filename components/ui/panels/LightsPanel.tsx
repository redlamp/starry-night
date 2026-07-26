"use client";

import { useRef } from "react";
import { Undo2 } from "lucide-react";
import { useSceneStore, DEFAULT_LIGHT_SIZE } from "@/lib/state/sceneStore";
import { Button } from "@/components/ui/button";
import { ValueSlider } from "@/components/ui/value-slider";
import { HelpHint } from "@/components/ui/tooltip";
import { IconTip } from "@/components/ui/columns/EntityColumns";
import { sampleLightCurve } from "@/lib/shaders/lightSize";

// Settings → Lights (#99): live tuning for the shared light-sprite sizing — how the
// point-light families (cars, streetlights, flights, helicopters, beacons) size and dim
// with camera distance. The drop-off is a CSS-style cubic bezier the user can drag.

export function LightsHeaderActions() {
  const setLightSize = useSceneStore((s) => s.setLightSize);
  return (
    <div className="flex items-center gap-1">
      <HelpHint>
        How the city&apos;s point lights (cars, streetlights, aircraft, beacons) size and dim
        with camera distance. Glow scales every light&apos;s bloom; the curve shapes the
        drop-off from close (right) to far (left); Floor/Ceiling scale each family&apos;s
        pixel bounds; Brightness follow makes far lights dim as they shrink. Reset restores
        this section only.
      </HelpHint>
      <IconTip label="Reset Lights">
        <Button
          variant="secondary"
          size="icon-sm"
          className="bg-foreground/10 text-foreground/80 hover:bg-foreground/20"
          aria-label="Reset light settings to defaults"
          onClick={(e) => {
            e.stopPropagation(); // header button — don't toggle the accordion section
            setLightSize({ ...DEFAULT_LIGHT_SIZE, curve: [...DEFAULT_LIGHT_SIZE.curve] });
          }}
        >
          <Undo2 className="size-3.5" />
        </Button>
      </IconTip>
    </div>
  );
}

const CURVE_W = 220;
const CURVE_H = 120;
const PAD = 10;

// Draggable cubic-bezier editor: (0,0) → P1 → P2 → (1,1) in normalized space,
// x = geometric size (far → close), y = displayed size. Rendered from the same
// sampler the shader lookup uses, so the drawn curve IS the applied curve.
function CurveEditor() {
  const curve = useSceneStore((s) => s.lightSize.curve);
  const setLightSize = useSceneStore((s) => s.setLightSize);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIdx = useRef<0 | 1 | null>(null);

  const toPx = (x: number, y: number): [number, number] => [
    PAD + x * (CURVE_W - 2 * PAD),
    CURVE_H - PAD - y * (CURVE_H - 2 * PAD),
  ];
  const fromEvent = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = (e.clientX - r.left - PAD) / (CURVE_W - 2 * PAD);
    const y = (CURVE_H - PAD - (e.clientY - r.top)) / (CURVE_H - 2 * PAD);
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };

  const samples = new Float32Array(33);
  sampleLightCurve(samples, curve);
  let path = "";
  for (let i = 0; i < samples.length; i++) {
    const [px, py] = toPx(i / (samples.length - 1), samples[i]);
    path += `${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)} `;
  }
  const [p1x, p1y] = toPx(curve[0], curve[1]);
  const [p2x, p2y] = toPx(curve[2], curve[3]);
  const [ax, ay] = toPx(0, 0);
  const [bx, by] = toPx(1, 1);

  // Handle picked via data-idx (a curried factory would close over the ref during
  // render, which the React 19 refs-in-render rule rejects).
  const onHandleDown = (e: React.PointerEvent) => {
    const idx = (e.target as SVGElement).dataset.idx === "1" ? 1 : 0;
    dragIdx.current = idx;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragIdx.current === null) return;
    const [x, y] = fromEvent(e);
    const next: [number, number, number, number] = [...curve];
    next[dragIdx.current * 2] = Math.round(x * 100) / 100;
    next[dragIdx.current * 2 + 1] = Math.round(y * 100) / 100;
    setLightSize({ curve: next });
  };
  const onPointerUp = () => {
    dragIdx.current = null;
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-foreground/40 flex items-center gap-1 text-xs tracking-wide uppercase">
        drop-off curve
        <HelpHint>
          Maps geometric size (left = far away, right = close up) to displayed size. Drag
          the two handles. A bowed-up curve keeps far lights bigger for longer (glare
          feel); the straight diagonal is pure geometry.
        </HelpHint>
      </span>
      <svg
        ref={svgRef}
        width={CURVE_W}
        height={CURVE_H}
        className="border-foreground/10 bg-foreground/5 touch-none rounded-md border"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* reference diagonal (pure geometric shrink) */}
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="currentColor" opacity={0.15} strokeDasharray="3 3" />
        {/* control-point stems */}
        <line x1={ax} y1={ay} x2={p1x} y2={p1y} stroke="currentColor" opacity={0.25} />
        <line x1={bx} y1={by} x2={p2x} y2={p2y} stroke="currentColor" opacity={0.25} />
        {/* the applied curve */}
        <path d={path} fill="none" stroke="#fbbf24" strokeWidth={1.8} />
        {/* draggable handles */}
        <circle
          cx={p1x}
          cy={p1y}
          r={6}
          data-idx={0}
          className="cursor-grab fill-amber-300 active:cursor-grabbing"
          onPointerDown={onHandleDown}
        />
        <circle
          cx={p2x}
          cy={p2y}
          r={6}
          data-idx={1}
          className="cursor-grab fill-amber-300 active:cursor-grabbing"
          onPointerDown={onHandleDown}
        />
      </svg>
      <span className="text-foreground/40 flex justify-between font-mono text-[10px]">
        <span>far</span>
        <span>
          {curve.map((v) => v.toFixed(2)).join(", ")}
        </span>
        <span>close</span>
      </span>
    </div>
  );
}

export function LightsSection() {
  const lightSize = useSceneStore((s) => s.lightSize);
  const setLightSize = useSceneStore((s) => s.setLightSize);
  return (
    <>
      <ValueSlider
        label="Glow"
        hint="Global multiplier on every light's glow diameter (cars, streetlights, aircraft, beacons). 1 = the calibrated default look."
        value={lightSize.glowScale}
        min={0.25}
        max={3}
        step={0.05}
        onChange={(glowScale) => setLightSize({ glowScale })}
        format={{ maximumFractionDigits: 2 }}
      />
      <CurveEditor />
      <ValueSlider
        label="Floor"
        hint="Scales each family's minimum pixel size — how big the farthest lights stay. 0 lets them shrink away entirely."
        value={lightSize.minScale}
        min={0}
        max={2}
        step={0.05}
        onChange={(minScale) => setLightSize({ minScale })}
        format={{ maximumFractionDigits: 2 }}
      />
      <ValueSlider
        label="Ceiling"
        hint="Scales each family's maximum pixel size — how big lights may get close up."
        value={lightSize.maxScale}
        min={0.5}
        max={2}
        step={0.05}
        onChange={(maxScale) => setLightSize({ maxScale })}
        format={{ maximumFractionDigits: 2 }}
      />
      <ValueSlider
        label="Bright follow"
        hint="How much brightness follows the size drop-off: 0 = size only (far lights stay full brightness at their floor); 1 = far lights dim in step with their shrink."
        value={lightSize.brightFollow}
        min={0}
        max={1}
        step={0.05}
        onChange={(brightFollow) => setLightSize({ brightFollow })}
        format={{ maximumFractionDigits: 2 }}
      />
    </>
  );
}
