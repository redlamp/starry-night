"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// shadcn-style checkbox over @base-ui/react. base-ui sets data-checked /
// data-unchecked / data-indeterminate on the Root, so both the glyph
// visibility (bracket group-data variants on the child icons) AND the box
// fill (bracket data variants on the Root) key off those. Two things matter:
//   1. Use the BRACKET form (`data-[checked]:` / `group-data-[checked]:`) —
//      the non-bracket shorthand doesn't generate here.
//   2. GATE the resting fill on data-[unchecked] (like the project's Switch),
//      so it doesn't override the checked fill when both would otherwise match
//      — that was why a checked box stayed empty even with the glyph showing.
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group peer border-input dark:data-[unchecked]:bg-input/30 data-[checked]:bg-primary data-[checked]:text-primary-foreground data-[checked]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground data-[indeterminate]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckIcon className="hidden size-3.5 group-data-[checked]:block group-data-[indeterminate]:hidden" />
      <MinusIcon className="hidden size-3.5 group-data-[indeterminate]:block" />
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
