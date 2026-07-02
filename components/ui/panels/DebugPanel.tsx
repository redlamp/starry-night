"use client";

import { Fragment, useState, useEffect } from "react";
import { useSceneStore, RENDER_GROUPS, type RenderGroup, type RenderMode } from "@/lib/state/sceneStore";
import { CITY_SHAPES, type CityShapeSetting } from "@/lib/seed/cityShape";
import { CITY_TIER_ORDER } from "@/lib/seed/topology";
import { TIER_LABELS, tierKm } from "@/components/ui/cityTiers";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ValueSlider } from "@/components/ui/value-slider";
import { HelpHint } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StreetlightControls } from "@/components/ui/RoadsPanel";
import { readTileCull, TILE_LAYERS } from "@/lib/scene/tileCullDebug";
import { SubGroup, ModeSelect } from "./shared";

const CITY_SHAPE_MODES = ["auto", ...CITY_SHAPES] as const;
const RENDER_GROUP_LABELS: Record<RenderGroup, string> = {
  buildings: "Buildings",
  roads: "Roads",
  ground: "Ground",
  sky: "Sky + Stars",
  moon: "Moon",
};

function RenderModeTabs({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-foreground/40 text-xs tracking-wide uppercase">{label}</span>
      <Tabs value={value} onValueChange={(v) => v && onChange(v)}>
        <TabsList className="w-full">
          <TabsTrigger value="rendered">Rendered</TabsTrigger>
          <TabsTrigger value="wireframe">Wireframe</TabsTrigger>
          <TabsTrigger value="hidden">Hidden</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

// Live #55 counters from the cull consumers — polled, not subscribed: the
// values mutate per frame in a module singleton (tileCullDebug) and a 500 ms
// tick is plenty for a readout.
function TileCullReadout() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return (
    <div className="text-foreground/70 grid grid-cols-[5.5rem_1fr] gap-1 font-mono text-xs">
      {TILE_LAYERS.map((layer) => {
        const st = readTileCull(layer);
        return (
          <Fragment key={layer}>
            <div>{layer}</div>
            <div className="tabular-nums">
              {st.culling ? `${st.tilesVisible}/${st.tilesTotal}` : `${st.tilesTotal} (off)`} tiles
              {" · "}
              {fmt(st.itemsDrawn)}/{fmt(st.itemsTotal)}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// Streetlights — expandable group (user 2026-06-08), enable switch on header.
export function StreetlightsGroup() {
  const enabled = useSceneStore((s) => s.streetlights.enabled);
  const setStreetlights = useSceneStore((s) => s.setStreetlights);
  return (
    <SubGroup
      label="Streetlights"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={(v) => setStreetlights({ enabled: v })}
          title="Streetlight glow layer on / off"
        />
      }
    >
      <StreetlightControls />
    </SubGroup>
  );
}

// Traffic — expandable group (user 2026-06-08), enable switch on header.
export function TrafficGroup() {
  const traffic = useSceneStore((s) => s.traffic);
  const setTraffic = useSceneStore((s) => s.setTraffic);
  // Debug overlay (#78): colour the roads by their EXPECTED traffic density
  // (population heat ramp, cool→warm). Mirrors the population-heat toggle.
  const showTrafficDensity = useSceneStore((s) => s.cityPlanning.showTrafficDensity);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);
  return (
    <SubGroup
      label="Traffic"
      action={
        <Switch
          checked={traffic.enabled}
          onCheckedChange={(v) => setTraffic({ enabled: v })}
          title="Car head/tail-light layer on / off"
        />
      }
    >
      <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
        <span className="text-foreground/70" title="Colour roads by expected traffic density">
          density debug
        </span>
        <Switch
          checked={showTrafficDensity}
          onCheckedChange={(v) => setCityPlanning({ showTrafficDensity: v })}
          title="Colour roads by expected traffic density (cool = quiet, warm = busy)"
          aria-label="Toggle traffic-density debug overlay"
        />
      </label>
      <ValueSlider
        label="density"
        value={traffic.density}
        min={0.1}
        max={8}
        step={0.1}
        onChange={(density) => setTraffic({ density })}
      />
      <div className="text-foreground/55 pt-1 text-[11px]">per-tier ×</div>
      <ValueSlider
        label="highway"
        value={traffic.highway}
        min={0}
        max={4}
        step={0.1}
        onChange={(highway) => setTraffic({ highway })}
      />
      <ValueSlider
        label="arterial"
        value={traffic.arterial}
        min={0}
        max={4}
        step={0.1}
        onChange={(arterial) => setTraffic({ arterial })}
      />
      <ValueSlider
        label="streets"
        value={traffic.minor}
        min={0}
        max={4}
        step={0.1}
        onChange={(minor) => setTraffic({ minor })}
      />
      {/* Global car-light size (street cars are the smallest tier; raise to enlarge all). */}
      <ValueSlider
        label="light size"
        value={traffic.lightSize}
        min={0.3}
        max={3}
        step={0.05}
        onChange={(lightSize) => setTraffic({ lightSize })}
      />
    </SubGroup>
  );
}

// Debug View (#39): building tint (Slice A) + per-group render mode (Slice B).
export function DebugSection() {
  const renderModes = useSceneStore((s) => s.debug.renderModes);
  const showTensorField = useSceneStore((s) => s.debug.showTensorField);
  const tileOverlay = useSceneStore((s) => s.debug.tileOverlay);
  const tileFreeze = useSceneStore((s) => s.debug.tileFreeze);
  const setRenderMode = useSceneStore((s) => s.setRenderMode);
  const setAllRenderModes = useSceneStore((s) => s.setAllRenderModes);
  const setShowTensorField = useSceneStore((s) => s.setShowTensorField);
  const setTileOverlay = useSceneStore((s) => s.setTileOverlay);
  const setTileFreeze = useSceneStore((s) => s.setTileFreeze);
  const showPinPlane = useSceneStore((s) => s.debug.showPinPlane);
  const setShowPinPlane = useSceneStore((s) => s.setShowPinPlane);
  const cityShape = useSceneStore((s) => s.cityShape);
  const setCityShape = useSceneStore((s) => s.setCityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const setCityShapeScale = useSceneStore((s) => s.setCityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const setCitySize = useSceneStore((s) => s.setCitySize);
  const cropLock = useSceneStore((s) => s.cropLock);
  const setCropLock = useSceneStore((s) => s.setCropLock);
  const sizeKm = tierKm(citySize);
  const tierIdx = CITY_TIER_ORDER.indexOf(citySize);
  // Tier drag preview (#58): regenerating mid-drag would re-roll the city on
  // every notch, so the slider previews (label updates live) and the store —
  // and therefore generation — only updates on RELEASE (onValueCommitted).
  const [dragTierIdx, setDragTierIdx] = useState<number | null>(null);
  const shownTier = CITY_TIER_ORDER[dragTierIdx ?? tierIdx];
  // Deviation drag preview (#51) — same regen-on-release pattern.
  const fieldDeviation = useSceneStore((s) => s.fieldDeviation);
  const setFieldDeviation = useSceneStore((s) => s.setFieldDeviation);
  const [dragDeviation, setDragDeviation] = useState<number | null>(null);
  // "all" tab reflects a shared mode, or sits blank when groups differ.
  const allMode = RENDER_GROUPS.every((g) => renderModes[g] === renderModes.buildings)
    ? renderModes.buildings
    : "";
  return (
    <>
      <SubGroup label="City shape">
        <ModeSelect
          value={cityShape}
          modes={CITY_SHAPE_MODES}
          onChange={(v) => setCityShape(v as CityShapeSetting)}
        />
        {/* #58 size tier — notched: each notch generates a DIFFERENT city for the
          same seed (a bigger canvas re-rolls the layout, it doesn't grow it). */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-foreground/70 w-16 shrink-0">size</span>
          <Slider
            min={0}
            max={CITY_TIER_ORDER.length - 1}
            step={1}
            value={dragTierIdx ?? tierIdx}
            onValueChange={(v) => setDragTierIdx(typeof v === "number" ? v : v[0])}
            onValueCommitted={(v) => {
              setDragTierIdx(null);
              setCitySize(CITY_TIER_ORDER[typeof v === "number" ? v : v[0]]);
            }}
            className="flex-1"
          />
          <span className="text-foreground w-32 shrink-0 text-right font-mono tabular-nums">
            {TIER_LABELS[shownTier]} ({tierKm(shownTier)} km)
          </span>
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
          <span className="text-foreground/70">lock crop to city size</span>
          <Switch checked={cropLock} onCheckedChange={setCropLock} />
        </label>
        {!cropLock ? (
          <ValueSlider
            label="crop km"
            value={Math.round(cityShapeScale * sizeKm * 10) / 10}
            min={1}
            max={sizeKm}
            step={0.5}
            onChange={(km) => setCityShapeScale(Math.min(1, km / sizeKm))}
          />
        ) : null}
        <HelpHint>
          Size sets the generated extent (re-rolls the layout; bigger = slower to generate). Crop
          reveals/hides the already-generated city — grow = reveal, never a re-roll. auto = each
          seed picks its shape; square = full field.
        </HelpHint>
        {/* #51 deviation — scales each seed's rolled field deformation. Regen on
          RELEASE only (same drag-preview rationale as the size tier). */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-foreground/70 w-16 shrink-0">deviation</span>
          <Slider
            min={0.25}
            max={2}
            step={0.05}
            value={dragDeviation ?? fieldDeviation}
            onValueChange={(v) => setDragDeviation(typeof v === "number" ? v : v[0])}
            onValueCommitted={(v) => {
              setDragDeviation(null);
              setFieldDeviation(typeof v === "number" ? v : v[0]);
            }}
            className="flex-1"
          />
          <span className="text-foreground w-24 shrink-0 text-right font-mono tabular-nums">
            ×{(dragDeviation ?? fieldDeviation).toFixed(2)}
          </span>
        </div>
        <HelpHint>
          Deviation scales how hard the street field bends (re-rolls on release). ×1 = the
          seed&apos;s own character; lower = calmer grids, higher = stronger warps/shears.
        </HelpHint>
      </SubGroup>

      <SubGroup
        label="Render modes"
        action={
          <HelpHint>
            Wireframe applies to mesh geometry; it&apos;s a no-op for Sky + Stars.
          </HelpHint>
        }
      >
        <RenderModeTabs
          label="all"
          value={allMode}
          onChange={(v) => setAllRenderModes(v as RenderMode)}
        />
        {RENDER_GROUPS.map((g) => (
          <RenderModeTabs
            key={g}
            label={RENDER_GROUP_LABELS[g]}
            value={renderModes[g]}
            onChange={(v) => setRenderMode(g, v as RenderMode)}
          />
        ))}
      </SubGroup>

      {/* Header switch = the overlay toggle itself (Windows-lights pattern) —
          flippable without expanding the group. */}
      <SubGroup
        label="Tensor field"
        action={
          <>
            <HelpHint>
              The major-eigenvector field the roads follow — ticks colored by grain angle.
            </HelpHint>
            <Switch
              checked={showTensorField}
              onCheckedChange={setShowTensorField}
              title="Show the grain direction overlay"
            />
          </>
        }
      />

      {/* #55 tile culling — visualize the per-tile materialisation machinery. */}
      <SubGroup
        label="Tile culling"
        action={
          <>
            <HelpHint>
              Tiles are the 500 m cells buildings / streetlights / traffic materialise in — green =
              in the cull frustum, red = evicted. Freeze pins the frustum to the current pose so you
              can orbit out and watch eviction (unfrozen, an evicted tile is offscreen by
              definition). The culling switch itself lives in Roads → Distance LOD.
            </HelpHint>
            <Switch
              checked={tileOverlay}
              onCheckedChange={setTileOverlay}
              title="Show the tile grid overlay (green = materialised, red = evicted)"
            />
          </>
        }
      >
        <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
          <span className="text-foreground/70">freeze cull frustum</span>
          <Switch checked={tileFreeze} onCheckedChange={setTileFreeze} />
        </label>
        <TileCullReadout />
      </SubGroup>

      {/* Pin-plane framing aid (2026-06-14, throwaway): the plane through the focal
          pin with the ortho view outlined on it — dial perspective fov/distance to
          match the outline. */}
      <SubGroup
        label="Pin plane"
        action={
          <>
            <HelpHint>
              On the plane through the focal pin (perpendicular to the view), two footprints: the
              orthographic view in <span className="text-sky-300">sky-blue</span> and the
              perspective view in <span className="text-amber-700">soil-brown</span>. Both honour
              Screen Y. Adjust FOV / distance until the brown rect lands on the blue one —
              that&apos;s matched framing.
            </HelpHint>
            <Switch
              checked={showPinPlane}
              onCheckedChange={setShowPinPlane}
              title="Show the focal-pin plane + ortho view outline"
            />
          </>
        }
      />
    </>
  );
}
