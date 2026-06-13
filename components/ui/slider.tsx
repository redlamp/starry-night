import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import type { CSSProperties } from "react";

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
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
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

export { Slider };
