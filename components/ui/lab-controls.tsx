"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
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

// Collapsible lab sidebar shell. Wraps the scrollable settings column and adds a
// drawer toggle so the canvas can go full-bleed — essential on mobile, where the
// panel otherwise buries the scene. Controlled (`open`/`onOpenChange`) so a lab
// can also gate sibling chrome (e.g. /tensor's resize handle) on the open state.
// The toggle is a fixed, vertically-centred edge tab that rides the sidebar's
// outer edge open or closed, so it never overlaps the header and is always a
// thumb-sized tap target. Width caps at 88vw so it never eats a whole phone.
export function LabSidebar({
  open,
  onOpenChange,
  width = 340,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width?: number;
  children: ReactNode;
}) {
  const openW = `min(${width}px, 88vw)`;
  return (
    <>
      <aside
        className="shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
        style={{ width: open ? openW : 0 }}
      >
        {/* fixed-width inner so content slides & clips instead of squishing */}
        <div className="h-full" style={{ width: openW }}>
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-4 p-4">{children}</div>
          </ScrollArea>
        </div>
      </aside>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label={open ? "Collapse panel" : "Expand panel"}
        title={open ? "Collapse panel" : "Expand panel"}
        className="fixed top-3 z-50 flex h-9 w-6 items-center justify-center rounded-r-md border border-l-0 border-zinc-700 bg-zinc-900/90 text-lg leading-none text-zinc-300 shadow-md backdrop-blur transition-[left] duration-200 ease-out hover:bg-zinc-800 hover:text-white"
        style={{ left: open ? openW : 0 }}
      >
        <span aria-hidden>{open ? "‹" : "›"}</span>
      </button>
    </>
  );
}

// A separated, uppercase-titled settings section. Opt into `collapsible` to make the header a
// toggle (chevron); pass `storageKey` to remember the open/closed state across sessions.
export function LabSection({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  storageKey,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  storageKey?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // hydrate persisted open state after mount (first render stays default → no prerender mismatch)
  useEffect(() => {
    if (!collapsible || !storageKey) return;
    try {
      const v = window.localStorage.getItem(storageKey);
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate of persisted open state */
      if (v === "0" || v === "1") setOpen(v === "1");
    } catch {
      // default is fine
    }
  }, [collapsible, storageKey]);
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, next ? "1" : "0");
        } catch {
          // best effort
        }
      }
      return next;
    });

  if (!collapsible) {
    return (
      <div className="flex flex-col gap-2.5">
        <Separator className="bg-zinc-800" />
        <h2 className="font-mono text-xs tracking-wider text-zinc-500 uppercase">{title}</h2>
        {children}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <Separator className="bg-zinc-800" />
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center justify-between gap-2 text-left transition-colors hover:text-zinc-300"
      >
        <h2 className="font-mono text-xs tracking-wider text-zinc-500 uppercase">{title}</h2>
        <ChevronDown
          className={cn("size-3.5 text-zinc-500 transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
      </button>
      {open && <div className="flex flex-col gap-2.5">{children}</div>}
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
