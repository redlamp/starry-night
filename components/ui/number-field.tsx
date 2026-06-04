import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

function NumberField({ className, ...props }: NumberFieldPrimitive.Root.Props) {
  return (
    <NumberFieldPrimitive.Root
      data-slot="number-field"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

// Drag horizontally on whatever this wraps (usually the label) to scrub the value.
function NumberFieldScrubArea({ className, ...props }: NumberFieldPrimitive.ScrubArea.Props) {
  return (
    <NumberFieldPrimitive.ScrubArea
      data-slot="number-field-scrub-area"
      className={cn("cursor-ew-resize select-none", className)}
      {...props}
    />
  );
}

function NumberFieldGroup({ className, ...props }: NumberFieldPrimitive.Group.Props) {
  return (
    <NumberFieldPrimitive.Group
      data-slot="number-field-group"
      className={cn(
        "border-input flex h-8 w-full items-stretch overflow-hidden rounded-md border shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

function NumberFieldDecrement({ className, ...props }: NumberFieldPrimitive.Decrement.Props) {
  return (
    <NumberFieldPrimitive.Decrement
      data-slot="number-field-decrement"
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground border-input flex w-7 shrink-0 cursor-pointer items-center justify-center border-r bg-transparent select-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <Minus className="size-3" />
    </NumberFieldPrimitive.Decrement>
  );
}

function NumberFieldInput({ className, ...props }: NumberFieldPrimitive.Input.Props) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn(
        "text-foreground w-full min-w-0 grow bg-transparent text-center text-sm tabular-nums focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

function NumberFieldIncrement({ className, ...props }: NumberFieldPrimitive.Increment.Props) {
  return (
    <NumberFieldPrimitive.Increment
      data-slot="number-field-increment"
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground border-input flex w-7 shrink-0 cursor-pointer items-center justify-center border-l bg-transparent select-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <Plus className="size-3" />
    </NumberFieldPrimitive.Increment>
  );
}

export {
  NumberField,
  NumberFieldScrubArea,
  NumberFieldGroup,
  NumberFieldDecrement,
  NumberFieldInput,
  NumberFieldIncrement,
};
