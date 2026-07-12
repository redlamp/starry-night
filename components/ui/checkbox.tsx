"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// shadcn-style checkbox over @base-ui/react (matches the project's Switch /
// Select wrapping pattern). Supports the indeterminate state base-ui exposes,
// so a "select all" header box can show the partial-selection dash. Icon
// visibility is driven off the Root's data-state attributes (data-checked /
// data-indeterminate) rather than the Indicator's mount timing, so the dash
// reliably wins over the check when indeterminate.
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group peer border-input dark:bg-input/30 data-checked:bg-primary data-checked:text-primary-foreground data-checked:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground data-indeterminate:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckIcon className="hidden size-3.5 group-data-checked:block group-data-indeterminate:hidden" />
      <MinusIcon className="hidden size-3.5 group-data-indeterminate:block" />
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
