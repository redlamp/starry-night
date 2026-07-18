"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

// Trimmed shadcn/ui chart primitive (base-ui stack, no radix): a themed
// ChartContainer that injects each series' colour as a `--color-<key>` CSS
// variable, plus a tooltip that reads those variables. Charts stay theme-aware
// because the colours live in one config and resolve through CSS vars, so the
// same markup reads on the light (:root) and dark (.grey) palettes.

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
  };
};

type ChartContextProps = { config: ChartConfig };

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used within a <ChartContainer />");
  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center overflow-visible text-xs",
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
          "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50",
          "[&_.recharts-layer]:outline-none [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, c]) => c.color);
  if (!colorConfig.length) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${colorConfig
          .map(([key, itemConfig]) => (itemConfig.color ? `  --color-${key}: ${itemConfig.color};` : null))
          .filter(Boolean)
          .join("\n")}\n}`,
      }}
    />
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  hideLabel = false,
  className,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; dataKey?: string; color?: string; payload?: Record<string, unknown> }>;
  label?: React.ReactNode;
  hideLabel?: boolean;
  className?: string;
  labelFormatter?: (label: React.ReactNode) => React.ReactNode;
  formatter?: (value: number, name: string) => React.ReactNode;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;

  return (
    <div
      className={cn(
        "border-border/60 bg-popover text-popover-foreground grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl",
        className,
      )}
    >
      {!hideLabel && label != null && (
        <div className="font-medium">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      <div className="grid gap-1">
        {payload.map((item, i) => {
          const key = item.dataKey ?? item.name ?? `item-${i}`;
          const itemConfig = config[key];
          const name = itemConfig?.label ?? item.name ?? key;
          const value = typeof item.value === "number" ? item.value : 0;
          return (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color ?? `var(--color-${key})` }}
                />
                <span className="text-muted-foreground">{name}</span>
              </span>
              <span className="text-foreground font-medium tabular-nums">
                {formatter ? formatter(value, String(name)) : value.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartStyle, useChart };
