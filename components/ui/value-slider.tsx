"use client";

import type { CSSProperties } from "react";
import { Slider, LoopingSlider } from "@/components/ui/slider";
import {
  NumberField,
  NumberFieldScrubArea,
  NumberFieldGroup,
  NumberFieldDecrement,
  NumberFieldInput,
  NumberFieldIncrement,
} from "@/components/ui/number-field";
import { cn } from "@/lib/utils";

// The panel-wide labelled value row (single source — CameraPanel and
// RoadsPanel used to carry diverging private copies): slider for coarse
// moves, a proper number field with −/+ steppers for precision, and the
// label doubles as a base-ui scrub area — drag it horizontally to nudge.
export function ValueSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  labelClass,
  stepperClass,
  origin,
  indicatorStyle,
  loop = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  // Fires when a slider DRAG is released (base-ui onValueCommitted) — e.g. to end a
  // transient "while adjusting" state precisely on release rather than on a timeout.
  onCommit?: () => void;
  labelClass?: string;
  stepperClass?: string;
  // Fill the slider OUT from `origin` (e.g. 0) and paint it via `indicatorStyle`
  // (e.g. a sign-dependent colour) — see Slider's `origin`/`indicatorStyle`.
  origin?: number;
  indicatorStyle?: CSSProperties;
  // When set, this is a cyclic value (e.g. a compass heading, 360° ≡ 0°): the steppers /
  // label-scrub / arrow keys / typing WRAP modulo [min, max), and the track becomes a
  // LoopingSlider (relative-drag spin that wraps past either edge) instead of base-ui's
  // clamped absolute slider.
  loop?: boolean;
}) {
  const span = max - min;
  const wrap = (v: number) => ((((v - min) % span) + span) % span) + min;
  return (
    <NumberField
      value={value}
      min={loop ? undefined : min}
      max={loop ? undefined : max}
      step={step}
      onValueChange={(v) => {
        if (v !== null) onChange(loop ? wrap(v) : v);
      }}
      className="flex-row items-center gap-2 text-xs"
    >
      <NumberFieldScrubArea>
        <span className={cn("text-foreground/70 block w-14 shrink-0", labelClass)}>{label}</span>
      </NumberFieldScrubArea>
      {loop ? (
        <LoopingSlider
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
          onCommit={onCommit}
          className="flex-1"
          indicatorStyle={indicatorStyle}
        />
      ) : (
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          onValueChange={(v) => onChange(typeof v === "number" ? v : v[0])}
          onValueCommitted={onCommit}
          className="flex-1"
          origin={origin}
          indicatorStyle={indicatorStyle}
        />
      )}
      <NumberFieldGroup
        className={cn("bg-background/60 h-7 shrink-0", stepperClass ?? "w-[6.25rem]")}
      >
        <NumberFieldDecrement />
        <NumberFieldInput className="text-xs" />
        <NumberFieldIncrement />
      </NumberFieldGroup>
    </NumberField>
  );
}

// Dual-thumb variant of the same row: a [min, max] range. Where ValueSlider
// puts its stepper group, this puts two editable number fields (type a value,
// arrow keys, or scroll) — each clamped against the other end of the range.
export function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  labelClass,
  trackStyle,
  indicatorClassName,
}: {
  label: string;
  value: [number, number];
  min: number;
  max: number;
  step: number;
  onChange: (v: [number, number]) => void;
  labelClass?: string;
  trackStyle?: CSSProperties;
  indicatorClassName?: string;
}) {
  return (
    <div className="flex flex-row items-center gap-2 text-xs">
      <span className={cn("text-foreground/70 block w-14 shrink-0", labelClass)}>{label}</span>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(v) => {
          if (Array.isArray(v)) onChange([v[0], v[1]]);
        }}
        className="flex-1"
        trackStyle={trackStyle}
        indicatorClassName={indicatorClassName}
      />
      <div className="flex w-[6.25rem] shrink-0 items-center gap-1">
        <NumberField
          value={value[0]}
          min={min}
          max={value[1]}
          step={step}
          onValueChange={(v) => {
            if (v !== null) onChange([v, value[1]]);
          }}
        >
          <NumberFieldGroup className="bg-background/60 h-7 w-full">
            <NumberFieldInput className="text-xs" />
          </NumberFieldGroup>
        </NumberField>
        <span className="text-foreground/40">–</span>
        <NumberField
          value={value[1]}
          min={value[0]}
          max={max}
          step={step}
          onValueChange={(v) => {
            if (v !== null) onChange([value[0], v]);
          }}
        >
          <NumberFieldGroup className="bg-background/60 h-7 w-full">
            <NumberFieldInput className="text-xs" />
          </NumberFieldGroup>
        </NumberField>
      </div>
    </div>
  );
}
