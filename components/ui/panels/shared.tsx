"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const RAD2DEG = 180 / Math.PI;

export function fmt(n: number, p = 2) {
  return n.toFixed(p);
}

export function Section({
  value,
  icon: Icon,
  label,
  children,
  hidden,
  action,
}: {
  value: string;
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  hidden?: boolean;
  // Rendered in the header row, left of the chevron — a sibling of the trigger
  // (not nested inside it) so clicking it doesn't toggle the accordion.
  action?: ReactNode;
}) {
  if (hidden) return null;
  return (
    <AccordionItem
      value={value}
      className="border-foreground/10 bg-foreground/[0.04] rounded-lg border not-last:border-b"
    >
      <div className="relative">
        <AccordionTrigger className="text-foreground/85 px-3 py-2.5 text-sm font-medium tracking-wide hover:no-underline">
          <span className="flex items-center gap-2.5">
            <Icon aria-hidden="true" className="text-foreground/70 size-[18px]" />
            <span>{label}</span>
          </span>
        </AccordionTrigger>
        {action && <div className="absolute top-1/2 right-9 -translate-y-1/2">{action}</div>}
      </div>
      <AccordionContent className="px-3 pt-0 pb-3">
        <div className="flex flex-col gap-2.5">{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
}

// Collapsible group: an uppercase header with a chevron toggle. Open
// state is transient (like the archetype filter) — not part of saved configs.
// `action` renders in the header row as a SIBLING of the toggle button (same
// pattern as Section) so clicking it doesn't collapse the group.
export function SubGroup({
  label,
  defaultOpen = false,
  action,
  afterLabel,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  action?: ReactNode;
  // Rendered immediately AFTER the title text (e.g. a "?" HelpHint riding the label),
  // as opposed to `action`, which sits at the right edge before the chevron.
  afterLabel?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="mt-1 flex items-center gap-1.5 border-t border-white/10 pt-2">
        <div className="flex flex-1 items-center gap-1">
          {children != null ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-foreground/55 hover:text-foreground/80 flex items-center text-[11px] font-medium tracking-wide uppercase transition-colors"
            >
              {label}
            </button>
          ) : (
            <span className="text-foreground/55 flex items-center text-[11px] font-medium tracking-wide uppercase">
              {label}
            </span>
          )}
          {afterLabel}
        </div>
        {action}
        {/* Chevron toggles the body; only shown when there IS a body. Some groups are
            just a header + action (e.g. an overlay switch + "?"), so no chevron. The
            label button is the accessible / tabbable control. */}
        {children != null && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setOpen((o) => !o)}
            className="text-foreground/55 hover:text-foreground/80 transition-colors"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
          </button>
        )}
      </div>
      {open && children != null && <div className="flex flex-col gap-2.5">{children}</div>}
    </>
  );
}

export function ModeSelect<T extends string>({
  value,
  modes,
  onChange,
  label = "mode",
}: {
  value: T;
  modes: readonly T[];
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-foreground/70 w-14 shrink-0">{label}</span>
      <Select value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger
          size="sm"
          className="bg-background/50 text-foreground hover:bg-background/60 w-full"
        >
          <SelectValue placeholder="mode" />
        </SelectTrigger>
        <SelectContent>
          {modes.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ProgressRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-foreground/70 grid grid-cols-[5rem_1fr] gap-1 font-mono text-xs">
      <div>{label}</div>
      <div className="tabular-nums">{fmt(value, 2)}</div>
    </div>
  );
}
