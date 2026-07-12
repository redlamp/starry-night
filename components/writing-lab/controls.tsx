"use client";

import { cn } from "@/lib/utils";
import { HelpHint } from "@/components/ui/tooltip";
import type { Authorship, ReviewStatus } from "@/lib/writing/labStore";
import {
  AUTHOR_HELP,
  AUTHOR_ICON,
  AUTHOR_LABEL,
  AUTHOR_OPTIONS,
  STATUS_DOT_CLASS,
  STATUS_LABEL,
} from "./labHelpers";

// Shared "leading glyph + label" content for the author/status Selects. Both
// the closed trigger (via SelectValue's render fn) and each open option (via
// SelectItem's children) render THIS SAME markup — identical wrapper, gap, and
// glyph size — so the leading dot/icon sits in exactly the same spot whether
// the control is closed or open (user 2026-07-12: the dot drifted between the
// trigger and the option rows). Fixed leading-box width keeps the label's left
// edge aligned across author (icon) and status (dot) alike.

const LEADING = "flex w-4 shrink-0 items-center justify-center";

export function AuthorGlyph({ value, className }: { value: Authorship; className?: string }) {
  const Icon = AUTHOR_ICON[value];
  return (
    <span className={cn(LEADING, className)} aria-hidden>
      <Icon className="size-3.5" />
    </span>
  );
}

export function AuthorContent({ value }: { value: Authorship }) {
  return (
    <span className="flex items-center gap-2">
      <AuthorGlyph value={value} className="text-muted-foreground" />
      {AUTHOR_LABEL[value]}
    </span>
  );
}

export function StatusContent({ value }: { value: ReviewStatus }) {
  return (
    <span className="flex items-center gap-2">
      <span className={LEADING} aria-hidden>
        <span className={cn("size-1.5 rounded-full", STATUS_DOT_CLASS[value])} />
      </span>
      {STATUS_LABEL[value]}
    </span>
  );
}

// "?" legend for the Author column header — spells out what AI / Human /
// AI-edited each mean (the last was the ambiguous one).
export function AuthorLegend() {
  return (
    <HelpHint label="What the author values mean">
      <ul className="flex flex-col gap-1">
        {AUTHOR_OPTIONS.map((opt) => (
          <li key={opt.value} className="flex items-center gap-1.5">
            <AuthorGlyph value={opt.value} />
            <span className="font-medium">{opt.label}</span>
            <span className="text-muted-foreground">— {AUTHOR_HELP[opt.value]}</span>
          </li>
        ))}
      </ul>
    </HelpHint>
  );
}
