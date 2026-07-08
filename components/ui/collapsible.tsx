"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// shadcn-style wrapper over base-ui's Collapsible, mirroring accordion.tsx's
// conventions (same panel-height CSS var + animate-in/out utility pattern),
// since a single-panel disclosure is just an accordion with one item.

function Collapsible({ className, ...props }: CollapsiblePrimitive.Root.Props) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

// Renders its own chevron pair after `children`, mirroring accordion.tsx's
// AccordionTrigger — callers just supply the label/summary content.
function CollapsibleTrigger({ className, children, ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "group/collapsible-trigger focus-visible:border-ring focus-visible:ring-ring/50 **:data-[slot=collapsible-trigger-icon]:text-muted-foreground relative flex w-full items-start gap-2 rounded-md border border-transparent text-left outline-none transition-all focus-visible:ring-3 **:data-[slot=collapsible-trigger-icon]:mt-0.5 **:data-[slot=collapsible-trigger-icon]:ml-auto **:data-[slot=collapsible-trigger-icon]:size-3.5 **:data-[slot=collapsible-trigger-icon]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        data-slot="collapsible-trigger-icon"
        className="pointer-events-none group-aria-expanded/collapsible-trigger:hidden"
      />
      <ChevronUpIcon
        data-slot="collapsible-trigger-icon"
        className="pointer-events-none hidden group-aria-expanded/collapsible-trigger:inline"
      />
    </CollapsiblePrimitive.Trigger>
  );
}

function CollapsiblePanel({ className, children, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      className="data-open:animate-collapsible-down data-closed:animate-collapsible-up overflow-hidden text-sm"
      {...props}
    >
      <div
        className={cn(
          "h-(--collapsible-panel-height) data-ending-style:h-0 data-starting-style:h-0",
          className,
        )}
      >
        {children}
      </div>
    </CollapsiblePrimitive.Panel>
  );
}

export { Collapsible, CollapsibleTrigger, CollapsiblePanel };
