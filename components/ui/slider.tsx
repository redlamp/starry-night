import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/lib/utils";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  origin,
  trackStyle,
  indicatorStyle,
  indicatorClassName,
  ...props
}: SliderPrimitive.Root.Props & {
  // Optional track paint (e.g. a hue-spectrum gradient) + indicator override
  // (e.g. a translucent wash so the gradient stays visible inside the range).
  trackStyle?: CSSProperties;
  indicatorStyle?: CSSProperties;
  indicatorClassName?: string;
  // Fill anchor: when set, the fill spans origin↔value (a signed slider that fills
  // OUT from a point, e.g. 0) instead of the default min→value. Horizontal sliders only.
  origin?: number;
}) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max];

  // Origin-anchored fill (single-value horizontal sliders): paint from the origin to the
  // value rather than from the track's start, so a signed value reads as "out from 0".
  const useOrigin = origin != null && typeof value === "number" && max > min;
  const toPct = (v: number) => ((Math.min(Math.max(v, min), max) - min) / (max - min)) * 100;
  const originPct = useOrigin ? toPct(origin) : 0;
  const valuePct = useOrigin ? toPct(value as number) : 0;

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full cursor-pointer touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          style={trackStyle}
          className="bg-muted relative grow overflow-hidden rounded-full select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          {useOrigin ? (
            <div
              data-slot="slider-range"
              className={cn("pointer-events-none absolute select-none", indicatorClassName)}
              style={{
                top: 0,
                bottom: 0,
                left: `${Math.min(originPct, valuePct)}%`,
                width: `${Math.abs(valuePct - originPct)}%`,
                ...indicatorStyle,
              }}
            />
          ) : (
            <SliderPrimitive.Indicator
              data-slot="slider-range"
              style={indicatorStyle}
              className={cn(
                "bg-primary select-none data-horizontal:h-full data-vertical:w-full",
                indicatorClassName,
              )}
            />
          )}
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="border-ring ring-ring/50 relative block size-3 shrink-0 rounded-full border bg-white transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

// A looping variant for cyclic values (e.g. a compass heading, 360° ≡ 0°). A linear
// base-ui Slider maps the pointer's ABSOLUTE position to a clamped range, so it can't
// spin past its ends. This one drives off RELATIVE pointer deltas with pointer capture:
// press the track to jump there, then drag to rotate continuously — the drag keeps
// going past the track's edges (capture follows the pointer across the window) and the
// thumb wraps around. Keyboard / both-direction nudging stays on the NumberField steppers.
function LoopingSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  className,
  onChange,
  onCommit,
  indicatorStyle,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  onChange: (v: number) => void;
  onCommit?: () => void;
  indicatorStyle?: CSSProperties;
}) {
  const span = max - min || 1;
  const wrap = (v: number) => ((((v - min) % span) + span) % span) + min;
  const trackRef = useRef<HTMLDivElement>(null);
  // live drag state: last clientX, °/px sensitivity, and the unrounded accumulator
  const drag = useRef<{ lastX: number; perPx: number; live: number } | null>(null);

  const pct = ((wrap(value) - min) / span) * 100;
  const emit = (live: number) => onChange(wrap(min + Math.round((live - min) / step) * step));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const w = rect.width || 1;
    const live = wrap(min + ((e.clientX - rect.left) / w) * span); // jump to the press point
    drag.current = { lastX: e.clientX, perPx: span / w, live };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    emit(live);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.live = wrap(d.live + (e.clientX - d.lastX) * d.perPx); // relative — keeps spinning past the edges
    d.lastX = e.clientX;
    emit(d.live);
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already gone */
    }
    onCommit?.();
  };

  return (
    <div
      data-slot="slider"
      className={cn(
        "relative flex h-3 w-full cursor-pointer touch-none items-center select-none",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        ref={trackRef}
        data-slot="slider-track"
        className="bg-muted relative h-1 w-full grow overflow-hidden rounded-full"
      >
        <div
          data-slot="slider-range"
          className="bg-primary pointer-events-none absolute inset-y-0 left-0"
          style={{ width: `${pct}%`, ...indicatorStyle }}
        />
      </div>
      <div
        data-slot="slider-thumb"
        className="border-ring pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-white"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

export { Slider, LoopingSlider };
