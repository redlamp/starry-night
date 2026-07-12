"use client";

import { CircleHelp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogBackdrop,
  DialogPopup,
  DialogContent,
  DialogClose,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GROUP_ACCENTS } from "./labHelpers";

// The writing lab's how-to, opened from the header (user 2026-07-08). Short
// sections, workflow-ordered: review → edit → find → ship. Composed with the
// full dialog kit (Portal > Backdrop + Popup > Content) — Content alone
// renders inline.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="text-sm text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">
        {children}
      </div>
    </section>
  );
}

export function Tutorial() {
  return (
    <Dialog>
      {/* Fixed bottom-right corner button (user 2026-07-12), out of the header.
          Floating pill — border + shadow + blur so it reads as a corner
          affordance, matching the main app's "?" ControlsGuide idiom. */}
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label="How to use the writing lab"
            className="bg-popover/80 fixed right-4 bottom-4 z-40 gap-1.5 rounded-full shadow-lg backdrop-blur-md"
          >
            <CircleHelp className="size-4" />
            How It Works
          </Button>
        }
      />
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup>
          <DialogContent className="max-h-[85vh] w-full max-w-lg gap-3 overflow-hidden border-border bg-popover p-5 text-popover-foreground">
            <DialogClose aria-label="Close tutorial">
              <X className="size-4" />
            </DialogClose>
            <DialogTitle className="text-sm font-medium text-foreground">
              How the Writing Lab Works
            </DialogTitle>
            <ScrollArea className="min-h-0 max-h-[70vh] overflow-hidden">
              <div className="flex flex-col gap-4 pb-2 pr-3">
                <Section title="What This Is">
                  Every line of generated text in the city — story templates, names, professions,
                  street and business name pools, trait readings — in one reviewable place. The
                  colored dots mark the five content groups:{" "}
                  {Object.entries(GROUP_ACCENTS).map(([group, color], i) => (
                    <span key={group} className="whitespace-nowrap">
                      {i > 0 && " · "}
                      <span
                        className="inline-block size-2 rounded-full align-baseline"
                        style={{ background: color }}
                        aria-hidden
                      />{" "}
                      {group}
                    </span>
                  ))}
                  .
                </Section>
                <Section title="Reviewing">
                  Every entry starts as <b>AI · Draft</b>. Read a line, then set its status:{" "}
                  <b>Review</b> (read, undecided), <b>Final</b> (ship it), or <b>Cut</b> (reject —
                  the line stays visible, struck through, and is dropped from exports). The bulk
                  buttons advance a whole pool at once; sidebar progress bars track the fraction
                  finalized.
                </Section>
                <Section title="Editing">
                  Click any content cell to edit. <b>Enter</b> saves, <b>Escape</b> cancels.
                  Editing an AI line flips its author to <b>Edited</b> automatically;{" "}
                  <b>Revert</b> restores the original. Template lines use slots like {"{given}"}{" "}
                  or {"{lore:place}"} — the pool header lists what&apos;s available. House style:
                  concrete nouns, no emotion words, no &quot;because&quot;, never resolve the
                  hook.
                </Section>
                <Section title="Finding Content">
                  The sidebar input filters pools by name; the header search scans entry{" "}
                  <b>text</b> across every pool — click a result to jump to it. The status and
                  author dropdowns in the header filter the table.
                </Section>
                <Section title="Shipping Edits">
                  Edits and statuses live in this browser (localStorage), not in the app. To
                  ship: select a pool, <b>Copy Pool as TS</b>, and paste the array over the
                  source constant shown in the pool header (cut entries are already dropped).{" "}
                  <b>Copy All Metadata JSON</b> exports the full editorial state for backup or
                  handoff.
                </Section>
                <Section title="Layout">
                  Drag the divider on the pools column and the edges of the Author/Status
                  headers to resize. Groups collapse; the toolbar under the pool filter expands
                  or collapses everything and locates the selected pool. All of it is remembered
                  per browser.
                </Section>
              </div>
            </ScrollArea>
          </DialogContent>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
