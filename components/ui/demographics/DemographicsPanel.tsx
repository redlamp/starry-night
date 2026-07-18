"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { useSceneStore } from "@/lib/state/sceneStore";
import { usePersonaDirectoryDeferred } from "@/lib/hooks/usePersonaDirectory";
import { generateCity } from "@/lib/seed/cityGen";
import { FloatingPanel } from "@/components/ui/FloatingPanel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  aggregateDemographics,
  cityPopulationByDistrict,
  type DemographicsData,
  type Scope,
} from "@/components/ui/demographics/aggregate";
import { approxCount } from "@/lib/utils";

// Demographics report (#97, phase 1): a floating census-style data profile over
// the persona directory. One lazy aggregation pass feeds a population pyramid,
// work-status / commute / household charts, and a header stat row. A scope
// toggle scales the listed sample up to the whole-city population estimate; a
// district Select filters every chart.

// Theme-safe categorical palette — mid-lightness saturated hues that read on
// both the light (:root) and dark (.grey) popover backgrounds. Fed to charts as
// `--color-<key>` CSS variables via ChartContainer.
const C = {
  men: "oklch(0.62 0.13 250)",
  women: "oklch(0.65 0.16 15)",
  nonbinary: "oklch(0.68 0.13 155)",
  bar: "oklch(0.64 0.12 235)",
};

function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1000) return `${(n / 1000).toFixed(a % 1000 === 0 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

export function DemographicsPanel() {
  const open = useSceneStore((s) => s.demographicsOpen);
  const setOpen = useSceneStore((s) => s.setDemographicsOpen);
  if (!open) return null;
  return <DemographicsReport onClose={() => setOpen(false)} />;
}

function DemographicsReport({ onClose }: { onClose: () => void }) {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const directory = usePersonaDirectoryDeferred(true);

  const [scope, setScope] = useState<Scope>("full");
  const [districtId, setDistrictId] = useState<string>("all");

  // City geometry bundle: building lookup, whole-city population estimate, and
  // the district filter options. Cheap once the directory build is warm.
  const geo = useMemo(() => {
    void citySize;
    void citySketch;
    if (!directory) return null;
    const { buildings } = generateCity(masterSeed, cityShape, cityShapeScale);
    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    const cityPop = cityPopulationByDistrict(buildings);
    const seen = new Set<string>();
    const districts: Array<{ id: string; label: string }> = [];
    for (const p of directory.personas.values()) {
      if (seen.has(p.homeDistrictId)) continue;
      seen.add(p.homeDistrictId);
      districts.push({
        id: p.homeDistrictId,
        label: directory.names.districtNames.get(p.homeDistrictId) ?? p.homeDistrictId,
      });
    }
    districts.sort((a, b) => a.label.localeCompare(b.label));
    return { buildingById, cityPop, districts };
  }, [directory, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  // The one aggregation pass — memoised on the filter + scope so dragging the
  // window or re-rendering never recomputes it.
  const data = useMemo<DemographicsData | null>(() => {
    if (!directory || !geo) return null;
    return aggregateDemographics(directory, geo.buildingById, geo.cityPop, districtId, scope);
  }, [directory, geo, districtId, scope]);

  const approx = scope === "full";

  return (
    <FloatingPanel title="Demographics" onClose={onClose} defaultWidth={400} defaultHeight={620}>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Pinned controls: header stats + scope + district. */}
        <div className="flex shrink-0 flex-col gap-2.5 border-b border-border/60 p-3 tabular-nums">
          {!data ? (
            <Skeleton className="h-12 w-full" />
          ) : (
            <div className="grid grid-cols-4 gap-2 text-center">
              {/* approxCount, not approxMagnitude: identical strings to the
                  directory masthead (user 2026-07-18: the two disagreed). */}
              <Stat label="Population" value={approxCount(data.header.population)} />
              <Stat label="Listed" value={data.header.listed.toLocaleString()} />
              <Stat label="Households" value={approxCount(data.header.households)} />
              <Stat label="Jobs" value={approxCount(data.header.jobs)} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)} className="flex-1">
              <TabsList className="h-8 w-full">
                <TabsTrigger value="full" className="text-xs">
                  Full City
                </TabsTrigger>
                <TabsTrigger value="listed" className="text-xs">
                  Listed
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={districtId} onValueChange={(v) => setDistrictId(v ?? "all")}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue>
                  {(v: string) =>
                    v === "all"
                      ? "All Districts"
                      : (geo?.districts.find((d) => d.id === v)?.label ?? "District")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Districts</SelectItem>
                {geo?.districts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 p-3 pr-4">
            {!data ? (
              <>
                <Skeleton className="h-56 w-full" />
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-40 w-full" />
              </>
            ) : (
              <>
                <Section
                  title="Population by Age & Gender"
                  hint={approx ? "Estimated, whole city" : "Listed residents"}
                >
                  <AgePyramid data={data} approx={approx} />
                </Section>
                <Section title="Work Status">
                  <CategoryBars
                    rows={data.workStatus}
                    layout="vertical"
                    approx={approx}
                    height={210}
                    catWidth={104}
                  />
                </Section>
                <Section title="Commute Mode">
                  <CategoryBars rows={data.commuteMode} approx={approx} height={190} />
                </Section>
                <Section title="Commute Distance">
                  <CategoryBars rows={data.commuteDistance} approx={approx} height={170} />
                </Section>
                <Section title="Households by Size">
                  <CategoryBars rows={data.households} approx={approx} height={170} />
                </Section>
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </FloatingPanel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-semibold">{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const PYRAMID_CONFIG: ChartConfig = {
  menNeg: { label: "Men", color: C.men },
  women: { label: "Women", color: C.women },
  nonbinary: { label: "Nonbinary", color: C.nonbinary },
};

// Custom tooltip for the pyramid: the nonbinary bar is drawn as two half-bars
// straddling the axis (see AgePyramid), so the stock per-series rows would
// list it twice at half value. Read the row once and present the three real
// counts, left-to-right in visual order.
function PyramidTooltip({
  active,
  payload,
  label,
  approx,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { men: number; women: number; nonbinary: number } }>;
  label?: React.ReactNode;
  approx: boolean;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const fmt = (v: number) => `${approx ? "~" : ""}${Math.round(v).toLocaleString()}`;
  const entries: Array<[string, string, number]> = [
    ["Men", C.men, row.men],
    ["Nonbinary", C.nonbinary, row.nonbinary],
    ["Women", C.women, row.women],
  ];
  return (
    <div className="border-border/60 bg-popover text-popover-foreground grid min-w-[8rem] gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">Age {label}</div>
      <div className="grid gap-1">
        {entries.map(([name, color, value]) => (
          <div key={name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
              <span className="text-muted-foreground">{name}</span>
            </span>
            <span className="text-foreground font-medium tabular-nums">{fmt(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgePyramid({ data, approx }: { data: DemographicsData; approx: boolean }) {
  // Men extend left (negative), women right, and nonbinary straddles the axis
  // as two same-colour half-bars so it reads as centred BETWEEN men and women
  // (user 2026-07-18). Stack order from the axis outward: nb-half, then the
  // gendered bar. Oldest band on top → reverse the youngest-first bins.
  const rows = data.agePyramid
    .map((a) => ({
      band: a.band,
      men: a.men,
      women: a.women,
      nonbinary: a.nonbinary,
      menNeg: -a.men,
      nbL: -(a.nonbinary / 2),
      nbR: a.nonbinary / 2,
    }))
    .reverse();
  return (
    <ChartContainer config={PYRAMID_CONFIG} className="aspect-auto h-[280px] w-full">
      <BarChart data={rows} layout="vertical" stackOffset="sign" margin={{ left: 4, right: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickFormatter={(v) => compact(Math.abs(v))} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="band" width={34} tickLine={false} axisLine={false} />
        {/* isAnimationActive=false everywhere: bar-morph tweens read as cells
            jumping between rows on filter/scope changes, and the animated
            tooltip lags the cursor (user 2026-07-18). */}
        <ChartTooltip isAnimationActive={false} content={<PyramidTooltip approx={approx} />} />
        <Bar dataKey="nbL" stackId="a" fill="var(--color-nonbinary)" isAnimationActive={false} />
        <Bar dataKey="menNeg" stackId="a" fill="var(--color-menNeg)" radius={2} isAnimationActive={false} />
        <Bar dataKey="nbR" stackId="a" fill="var(--color-nonbinary)" isAnimationActive={false} />
        <Bar dataKey="women" stackId="a" fill="var(--color-women)" radius={2} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

const BAR_CONFIG: ChartConfig = { count: { label: "Residents", color: C.bar } };

function CategoryBars({
  rows,
  layout = "horizontal",
  approx,
  height,
  catWidth = 0,
}: {
  rows: Array<{ label: string; count: number }>;
  layout?: "horizontal" | "vertical";
  approx: boolean;
  height: number;
  catWidth?: number;
}) {
  const fmtVal = (v: number) => `${approx ? "~" : ""}${v.toLocaleString()}`;
  return (
    <ChartContainer config={BAR_CONFIG} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={rows} layout={layout} margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
        {layout === "vertical" ? (
          <>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={compact} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="label"
              width={catWidth}
              tickLine={false}
              axisLine={false}
            />
          </>
        ) : (
          <>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis type="number" tickFormatter={compact} tickLine={false} axisLine={false} width={36} />
          </>
        )}
        <ChartTooltip isAnimationActive={false} content={<ChartTooltipContent formatter={fmtVal} />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={3} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
