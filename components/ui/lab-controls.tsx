"use client";

import { useState, type ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  NumberField,
  NumberFieldScrubArea,
  NumberFieldGroup,
  NumberFieldDecrement,
  NumberFieldInput,
  NumberFieldIncrement,
} from "@/components/ui/number-field";

// Shared sidebar primitives for the lab pages (/tensor, /plan): a separated,
// uppercase-titled settings section and the slider + number-field stepper row.

export function LabSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <Separator className="bg-zinc-800" />
      <h2 className="font-mono text-xs tracking-wider text-zinc-500 uppercase">{title}</h2>
      {children}
    </div>
  );
}

// Slider + number-field stepper, both bound to the same committed value. The
// slider keeps a local drag preview — heavy recomputes fire on release only
// (same pattern as the city-size tier slider); the stepper (and scrubbing the
// label) commits directly, for dialling exact values.
//
// Layouts: default is one row [label | slider | stepper | trailing]; `stacked`
// puts the slider on its own full-width row below [label | stepper | trailing].
export function LabSlider({
  label,
  min,
  max,
  step,
  value,
  onCommit,
  stacked = false,
  trailing,
}: {
  label: ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  onCommit: (v: number) => void;
  stacked?: boolean;
  trailing?: ReactNode;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const commit = (v: number) => onCommit(Math.min(max, Math.max(min, v)));
  const labelEl = (
    <NumberFieldScrubArea className={stacked ? "min-w-0 flex-1" : "w-20 shrink-0"}>
      <span className="flex items-center gap-1.5 text-xs text-zinc-400">{label}</span>
    </NumberFieldScrubArea>
  );
  const stepperEl = (
    <NumberFieldGroup className="w-24 shrink-0">
      <NumberFieldDecrement />
      <NumberFieldInput className="font-mono text-xs" />
      <NumberFieldIncrement />
    </NumberFieldGroup>
  );
  const sliderEl = (
    <Slider
      min={min}
      max={max}
      step={step}
      value={shown}
      onValueChange={(v) => setDrag(typeof v === "number" ? v : v[0])}
      onValueCommitted={(v) => {
        setDrag(null);
        commit(typeof v === "number" ? v : v[0]);
      }}
      className={stacked ? "w-full" : "flex-1"}
    />
  );
  return (
    <NumberField
      value={shown}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => {
        if (v !== null && v !== shown) {
          setDrag(null);
          commit(v);
        }
      }}
      className={stacked ? "w-full gap-2" : "w-full"}
    >
      {stacked ? (
        <>
          <div className="flex w-full items-center gap-2">
            {labelEl}
            {stepperEl}
            {trailing}
          </div>
          {sliderEl}
        </>
      ) : (
        <div className="flex w-full items-center gap-2">
          {labelEl}
          {sliderEl}
          {stepperEl}
          {trailing}
        </div>
      )}
    </NumberField>
  );
}
