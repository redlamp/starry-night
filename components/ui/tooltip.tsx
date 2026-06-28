"use client";

import type { ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

function TooltipProvider({ delay = 150, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />;
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} className="z-50">
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "bg-foreground text-background w-fit rounded-md px-2 py-1 text-xs text-balance",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

// A compact "?" help affordance: a small round button that reveals `children` in a
// tooltip on hover/focus (a tap focuses it, so it works on touch too). Use it to tuck
// long inline descriptions out of the way, next to a control or group label.
function HelpHint({
  children,
  side = "top",
  label = "More info",
}: {
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  label?: string;
}) {
  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger
          aria-label={label}
          className="text-foreground/40 hover:text-foreground/80 focus-visible:text-foreground/80 inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full border border-current text-[9px] leading-none font-semibold transition-colors"
        >
          ?
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="bg-popover text-foreground border-border max-w-[15rem] border text-[11px] leading-snug font-normal shadow-md"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, HelpHint };
