"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  useSceneStore,
  DEFAULT_INTENT,
  DEFAULT_PROJECTION,
  type Vec3,
  type QualityTier,
  QUALITY_TIERS,
  RENDER_GROUPS,
  type RenderGroup,
  type RenderMode,
  type BuildingTintMode,
} from "@/lib/state/sceneStore";
import { randomSeed } from "@/lib/seed/rng";
import { ARCHETYPE_ORDER, type Archetype } from "@/lib/seed/cityGen";
import { CITY_SHAPES, type CityShapeSetting } from "@/lib/seed/cityShape";
import { CITY_TIER_ORDER } from "@/lib/seed/topology";
import { TIER_LABELS, tierKm } from "@/components/ui/cityTiers";
import { cn, isTypingTarget } from "@/lib/utils";
import {
  Box,
  Bug,
  Building,
  Building2,
  Camera,
  Check,
  ChevronDown,
  CloudFog,
  Contrast,
  Copy,
  Crosshair,
  Gauge,
  Home,
  Hotel,
  Info,
  LayoutGrid,
  Map as MapIcon,
  MapPin,
  Moon,
  MoonStar,
  MousePointer2,
  Orbit as OrbitIcon,
  Pause,
  Play,
  Pointer,
  RadioTower,
  Rotate3d,
  RotateCcw,
  Route,
  RulerDimensionLine,
  Save,
  ScanSearch,
  Search,
  Settings,
  Sparkles,
  Stars,
  Sun,
  Telescope,
  TowerControl,
  Undo2,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RangeSlider, ValueSlider } from "@/components/ui/value-slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DistrictsSection,
  DensitySection,
  DistrictShellsAction,
  PopulationHeatAction,
} from "@/components/ui/DistrictsPanel";
import {
  RoadHighlightTiers,
  StreetlightControls,
  LodControls,
  CityDetailsSection,
  RoadHighlightAction,
} from "@/components/ui/RoadsPanel";
import { readTileCull, TILE_LAYERS } from "@/lib/scene/tileCullDebug";
import {
  setCameraTab,
  currentCameraTab,
  tweenOrbitToDefault,
  tweenOrbitTowards,
  tweenProjectionTo,
  type CameraTab,
} from "@/lib/scene/cameraView";

function copyConfigToClipboard() {
  const s = useSceneStore.getState();
  const snippet = JSON.stringify(s.copyableConfig(), null, 2);
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(snippet);
  }
}

const THEME_KEY = "starry-night.theme";
type Theme = "light" | "grey" | "dark";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "grey" || v === "dark") return v;
  } catch {
    // localStorage may be unavailable
  }
  return "dark";
}

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("light", "grey", "dark");
    html.classList.add(theme);
  }, [theme]);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(THEME_KEY, t);
    } catch {
      // ignore
    }
  };
  return [theme, setTheme];
}

const THEME_OPTIONS: Array<{ value: Theme; icon: LucideIcon; label: string }> = [
  { value: "light", icon: Sun, label: "Light" },
  // Internal value stays "grey" (html class + CSS variants key on it); only
  // the visible label is American English.
  { value: "grey", icon: Contrast, label: "Gray" },
  { value: "dark", icon: MoonStar, label: "Dark" },
];

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const [mounted, setMounted] = useState(false);
  // Hydration guard: server renders the unselected state, then we mark mounted
  // after hydration so the active-theme highlight only appears client-side. The
  // one-time post-mount setState is the intended SSR pattern here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  return (
    <div
      className="border-foreground/10 bg-foreground/5 inline-flex items-center rounded-md border p-0.5"
      suppressHydrationWarning
    >
      {THEME_OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          title={`${label} theme`}
          aria-label={`${label} theme`}
          suppressHydrationWarning
          className={cn(
            "flex size-7 items-center justify-center rounded transition-colors",
            mounted && theme === value
              ? "bg-foreground/15 text-foreground"
              : "text-foreground/55 hover:bg-foreground/10 hover:text-foreground",
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

const RAD2DEG = 180 / Math.PI;

function fmt(n: number, p = 2) {
  return n.toFixed(p);
}

// Settings search. Each accordion section carries hidden keywords so a query can
// surface a control filed under a non-obvious section label — e.g. the tensor
// field toggle lives under "Debug View", not "Roads". Matching is AND-over-tokens
// against label + value + keywords; matching sections auto-expand while searching.
// Order mirrors the accordion's render order (user 2026-06-07).
const SETTINGS_SECTIONS: { value: string; label: string; keywords: string }[] = [
  {
    value: "intro",
    label: "Intro",
    keywords: "wake reveal duration streetlight stars speed animation startup",
  },
  {
    value: "pose",
    label: "Camera",
    keywords:
      "position rotation fov projection orthographic perspective look at orient pose lens live readout telemetry default free",
  },
  {
    value: "orbit",
    label: "Orbit",
    keywords: "elevation azimuth compass radius distance spin speed pause center focal auto rotate",
  },
  {
    value: "roads",
    label: "Roads",
    keywords:
      "highways arterials streets traffic cars headlights taillights planning tier ribbons network highlight",
  },
  {
    value: "window-profiles",
    label: "Buildings",
    keywords:
      "windows lit ratio width range min max size flicker brightness emissive profiles glow building facade wall color colour saturation lightness hue masonry glass debug tint population district landuse archetype depth height wash",
  },
  {
    value: "population",
    label: "Population",
    keywords:
      "districts shells borders outline color region zones density heat map heatmap people residents traffic coupling estimate profile centres centers spread shoulder satellites gradient",
  },
  {
    value: "city-details",
    label: "City Details",
    keywords:
      "shape circle square scale size buildings count footprint seed reroll random refresh regenerate",
  },
  {
    value: "stars",
    label: "Stars",
    keywords: "starfield twinkle sparkle color temperature density sky",
  },
  { value: "moon", label: "Moon", keywords: "phase distance halo glow" },
  {
    value: "fog",
    label: "Atmosphere",
    keywords: "fog haze ground near far density amount color exp2 distance depth atmosphere",
  },
  {
    value: "debug",
    label: "Debug View",
    keywords:
      "render modes wireframe hidden tensor field flow visualization overlay ground tile culling cull frustum freeze grid materialise city shape size tier deviation",
  },
  {
    value: "perf",
    label: "Performance",
    keywords:
      "fps frame rate draw calls monitor gpu aa msaa samples smoothing jaggies moire anti-aliasing dpr resolution pixel ratio quality tier lod level of detail distance culling tiles attenuation wash",
  },
];

function matchSection(query: string, s: (typeof SETTINGS_SECTIONS)[number]): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = `${s.label} ${s.value} ${s.keywords}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

const PANEL_WIDTH_KEY = "starry-night.panelWidth";
const DEFAULT_PANEL_WIDTH = 416; // px — the old fixed w-[26rem]

function clampPanelWidth(w: number): number {
  const viewportCap = typeof window !== "undefined" ? window.innerWidth - 64 : 720;
  return Math.round(Math.min(Math.max(w, 300), Math.min(720, viewportCap)));
}

function readStoredPanelWidth(): number {
  if (typeof window === "undefined") return DEFAULT_PANEL_WIDTH;
  try {
    const v = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(v) && v > 0) return clampPanelWidth(v);
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_PANEL_WIDTH;
}

function persistPanelWidth(w: number) {
  try {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(w));
  } catch {
    // ignore
  }
}

export function CameraPanel() {
  const {
    cameraMode,
    cameraLive,
    orbit,
    resetCamera,
    saveCurrentAsDefault,
    revertToSaved,
    hasSavedConfig,
  } = useSceneStore();
  const orbitRestoreSet = useSceneStore((s) => s.orbitRestore !== null);
  const showPinPlane = useSceneStore((s) => s.debug.showPinPlane);

  const [hidden, setHidden] = useState(true);
  const [savedExists, setSavedExists] = useState(() => hasSavedConfig());
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<string[]>([]);
  const captureMode = useSceneStore((s) => s.captureMode);
  // Panel never renders during SSR (starts hidden), so reading localStorage in
  // the initializer can't cause a hydration mismatch.
  const [panelWidth, setPanelWidth] = useState<number>(readStoredPanelWidth);

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setPanelWidth(clampPanelWidth(window.innerWidth - e.clientX));
  };
  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setPanelWidth((w) => {
      persistPanelWidth(w);
      return w;
    });
  };
  const onResizeReset = () => {
    setPanelWidth(DEFAULT_PANEL_WIDTH);
    persistPanelWidth(DEFAULT_PANEL_WIDTH);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return; // don't toggle the panel while typing in search
      if (e.key === "h" || e.key === "H") setHidden((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (captureMode) return null;

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        className="bg-popover/70 text-foreground/85 border-foreground/10 active:bg-foreground/5 pointer-events-auto fixed top-3 right-3 z-30 flex size-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-md"
        title="Show settings (H)"
        aria-label="Show settings"
      >
        <Settings className="size-5" />
      </button>
    );
  }

  const flying = cameraMode === "fly";
  const modeTab = currentCameraTab(cameraMode, orbitRestoreSet);
  const livePos = cameraLive.position;
  const liveRotDeg: Vec3 = [
    cameraLive.rotation[0] * RAD2DEG,
    cameraLive.rotation[1] * RAD2DEG,
    cameraLive.rotation[2] * RAD2DEG,
  ];

  const searching = query.trim().length > 0;
  const matchedValues = SETTINGS_SECTIONS.filter((s) => matchSection(query, s)).map((s) => s.value);
  const shownSections = searching ? new Set(matchedValues) : null;
  const openValues = searching ? matchedValues : openSections;
  const show = (value: string) => !shownSections || shownSections.has(value);

  return (
    <div
      className="border-foreground/10 bg-popover/70 text-foreground pointer-events-auto fixed top-0 right-0 bottom-0 z-20 flex h-dvh max-h-dvh max-w-full flex-col border-l shadow-2xl backdrop-blur-md"
      style={{ width: panelWidth }}
    >
      {/* Grab the left edge to resize; double-click resets to the default width. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize settings panel"
        title="Drag to resize · double-click to reset"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={onResizeReset}
        className="hover:bg-foreground/20 active:bg-primary/50 absolute inset-y-0 -left-1 z-30 w-2 cursor-ew-resize touch-none transition-colors"
      />
      {/* Sticky header */}
      <div className="border-border flex shrink-0 flex-col gap-2.5 border-b px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-base font-semibold tracking-wide">
            <Settings aria-hidden="true" className="text-foreground/80 size-[18px]" />
            Settings
          </span>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setHidden(true)}
              title="Hide (H)"
              aria-label="Hide settings"
              className="text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
            >
              ×
            </Button>
          </div>
        </div>
        <Tabs value={modeTab} onValueChange={(v) => setCameraTab(v as CameraTab)}>
          <TabsList className="w-full">
            <TabsTrigger
              value="fly"
              className="data-[state=active]:bg-orange-500 data-[state=active]:text-black"
            >
              Fly <span className="text-[10px] opacity-70">(F)</span>
            </TabsTrigger>
            <TabsTrigger
              value="orbit"
              className="data-[state=active]:bg-purple-500 data-[state=active]:text-black"
            >
              Orbit <span className="text-[10px] opacity-70">(G)</span>
            </TabsTrigger>
            <TabsTrigger
              value="top-down"
              className="data-[state=active]:bg-sky-400 data-[state=active]:text-black"
            >
              Top-down <span className="text-[10px] opacity-70">(T)</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-foreground/40 pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="h-9 pr-7 pl-8"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-foreground/50 hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 text-base leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Scrollable middle */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-3">
          <Accordion
            multiple
            value={openValues}
            onValueChange={(v) => {
              if (!searching) setOpenSections(v as string[]);
            }}
            className="flex flex-col gap-1.5"
          >
            {/* Section order is the user's reading order (2026-06-07): Intro,
                Camera, Orbit, Roads, Buildings, Population, City Details*,
                Stars, Moon, Atmosphere, Debug, Performance. (*unlisted — kept
                with the city group.) */}
            <Section
              value="intro"
              icon={Sparkles}
              label="Intro"
              hidden={!show("intro")}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  title="Replay both wake-up sequences from progress = 0"
                  className="bg-foreground/10 text-foreground/80 hover:bg-foreground/20 h-6 px-2 text-xs"
                  onClick={() => useSceneStore.getState().playAllIntros()}
                >
                  <RotateCcw className="size-3.5" />
                  replay
                </Button>
              }
            >
              <IntroSection />
            </Section>

            <Section
              value="pose"
              icon={Camera}
              label="Camera"
              hidden={!show("pose")}
              action={<CameraHeaderActions />}
            >
              <PoseSection flying={flying} />
              {/* Live readout — lives with the camera controls (user 2026-06-07). */}
              <div className="border-foreground/10 border-t pt-2">
                <TooltipProvider>
                  <div className="text-foreground/70 grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-x-2 gap-y-1 font-mono text-xs">
                    {/* header row: x / y / z over the value columns */}
                    <div />
                    <div className="text-foreground/40 text-right text-[10px] uppercase">x</div>
                    <div className="text-foreground/40 text-right text-[10px] uppercase">y</div>
                    <div className="text-foreground/40 text-right text-[10px] uppercase">z</div>

                    <Tooltip>
                      <TooltipTrigger render={<Camera className="size-3.5" />} />
                      <TooltipContent>camera position</TooltipContent>
                    </Tooltip>
                    <div className="text-right tabular-nums">{fmt(livePos[0])}</div>
                    <div className="text-right tabular-nums">{fmt(livePos[1])}</div>
                    <div className="text-right tabular-nums">{fmt(livePos[2])}</div>

                    <Tooltip>
                      <TooltipTrigger render={<MapPin className="size-3.5" />} />
                      <TooltipContent>focal point</TooltipContent>
                    </Tooltip>
                    <div className="text-right tabular-nums">{fmt(orbit.centerX)}</div>
                    <div className="text-right tabular-nums">{fmt(orbit.lookAtY)}</div>
                    <div className="text-right tabular-nums">{fmt(orbit.centerZ)}</div>

                    <Tooltip>
                      <TooltipTrigger render={<Rotate3d className="size-3.5" />} />
                      <TooltipContent>rotation (degrees)</TooltipContent>
                    </Tooltip>
                    <div className="text-right tabular-nums">{fmt(liveRotDeg[0], 1)}</div>
                    <div className="text-right tabular-nums">{fmt(liveRotDeg[1], 1)}</div>
                    <div className="text-right tabular-nums">{fmt(liveRotDeg[2], 1)}</div>

                    <div className="text-foreground/40 text-[10px] uppercase">fov</div>
                    <div className="text-right tabular-nums">{fmt(cameraLive.fov)}</div>
                    <Tooltip>
                      <TooltipTrigger
                        render={<RulerDimensionLine className="size-3.5 justify-self-end" />}
                      />
                      <TooltipContent>distance camera → focal</TooltipContent>
                    </Tooltip>
                    <div className="text-right tabular-nums">{fmt(orbit.radius)}</div>
                  </div>
                </TooltipProvider>
              </div>
              {showPinPlane && <PinPlaneReadout />}
            </Section>

            <Section
              value="orbit"
              icon={OrbitIcon}
              label="Orbit"
              hidden={!show("orbit")}
              action={<OrbitHeaderActions />}
            >
              <OrbitSection />
            </Section>

            {/* Roads (user 2026-06-08): each block is its own expandable
                sub-group — Highlight (tri-switch on header), Streetlights,
                Traffic — all collapsed by default. (Distance LOD moved to
                Performance → Level of Detail, user 2026-06-13.) */}
            <Section value="roads" icon={Route} label="Roads" hidden={!show("roads")}>
              <SubGroup label="Highlight" action={<RoadHighlightAction />}>
                <RoadHighlightTiers />
              </SubGroup>
              <StreetlightsGroup />
              <TrafficGroup />
            </Section>

            <Section
              value="window-profiles"
              icon={Building2}
              label="Buildings"
              hidden={!show("window-profiles")}
            >
              <BuildingsSection />
            </Section>

            {/* Population (user 2026-06-07): the old Districts panel, expanded —
                density layer (heat map + traffic coupling) above districts as
                collapsible sub-groups; shells switch on the Districts header. */}
            <Section
              value="population"
              icon={MapIcon}
              label="Population"
              hidden={!show("population")}
            >
              <SubGroup label="Density" action={<PopulationHeatAction />}>
                <DensitySection />
              </SubGroup>
              <SubGroup label="Districts" action={<DistrictShellsAction />}>
                <DistrictsSection />
              </SubGroup>
            </Section>

            <Section
              value="city-details"
              icon={Info}
              label="City Details"
              hidden={!show("city-details")}
            >
              <SeedRow />
              <CityDetailsSection />
            </Section>

            <Section value="stars" icon={Stars} label="Stars" hidden={!show("stars")}>
              <StarsSection />
            </Section>

            <Section value="moon" icon={Moon} label="Moon" hidden={!show("moon")}>
              <MoonSection />
            </Section>

            <Section
              value="fog"
              icon={CloudFog}
              label="Atmosphere"
              hidden={!show("fog")}
              action={<AtmosphereToggle />}
            >
              <FogSection />
            </Section>

            <Section value="debug" icon={Bug} label="Debug View" hidden={!show("debug")}>
              <DebugSection />
            </Section>

            <Section
              value="perf"
              icon={Gauge}
              label="Performance"
              hidden={!show("perf")}
              action={<PerfDisplayToggle />}
            >
              <PerfReadout />
              {/* Adaptive + AA / DPR / LOD / Stats as collapsible SubGroups
                  (parity with the other panels; user 2026-06-13). */}
              <AdaptiveGroup />
              <AntiAliasingSection />
              <ResolutionSection />
              <LevelOfDetailSection />
              <StatsGroup />
            </Section>
          </Accordion>
          {searching && matchedValues.length === 0 && (
            <p className="text-foreground/50 px-1 py-6 text-center text-sm">
              No settings match “{query.trim()}”.
            </p>
          )}
        </div>
      </ScrollArea>

      {/* Sticky footer */}
      <div className="border-foreground/10 flex shrink-0 items-center justify-between gap-2 border-t px-4 pt-3 pb-3">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            onClick={() => resetCamera()}
            title="Reset every setting to its built-in default"
            className="text-rose-400 hover:bg-rose-400/10 hover:text-rose-300"
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
          {savedExists && (
            <Button
              variant="ghost"
              onClick={() => revertToSaved()}
              title="Restore the last config you Saved"
              className="text-amber-400 hover:bg-amber-400/10 hover:text-amber-300"
            >
              <Undo2 className="size-4" />
              Revert
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <CopyButton />
          <Button
            onClick={() => {
              saveCurrentAsDefault();
              setSavedExists(true);
            }}
            title="Snapshot every current setting as the new Reset target"
            className="bg-emerald-400 text-black hover:bg-emerald-400/90"
          >
            <Save className="size-4" />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({
  value,
  icon: Icon,
  label,
  children,
  hidden,
  action,
}: {
  value: string;
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  hidden?: boolean;
  // Rendered in the header row, left of the chevron — a sibling of the trigger
  // (not nested inside it) so clicking it doesn't toggle the accordion.
  action?: ReactNode;
}) {
  if (hidden) return null;
  return (
    <AccordionItem
      value={value}
      className="border-foreground/10 bg-foreground/[0.04] rounded-lg border not-last:border-b"
    >
      <div className="relative">
        <AccordionTrigger className="text-foreground/85 px-3 py-2.5 text-sm font-medium tracking-wide hover:no-underline">
          <span className="flex items-center gap-2.5">
            <Icon aria-hidden="true" className="text-foreground/70 size-[18px]" />
            <span>{label}</span>
          </span>
        </AccordionTrigger>
        {action && <div className="absolute top-1/2 right-9 -translate-y-1/2">{action}</div>}
      </div>
      <AccordionContent className="px-3 pt-0 pb-3">
        <div className="flex flex-col gap-2.5">{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
}

// The manual position / orient-by / lookAt / rotation intent inputs were
// removed 2026-06-07 (user): `locked = flying || orbiting` is true in every
// camera mode that exists, so they were permanently disabled — pre-orbit-rig
// plumbing. The live readout below the section covers the read side; the
// store API (setCameraIntent) is unchanged for scripts + camera internals.
function PoseSection({ flying }: { flying: boolean }) {
  return (
    <>
      <ProjectionRow />
      <FovOrSizeSlider />
      {flying ? <FlySpeedSlider /> : null}
    </>
  );
}

function OrbitSection() {
  const orbit = useSceneStore((s) => s.orbit);
  const setOrbit = useSceneStore((s) => s.setOrbit);
  const pivot = useSceneStore((s) => s.orbitPivotFromBottom);
  const setPivot = useSceneStore((s) => s.setOrbitPivotFromBottom);
  const setFocalAdjust = useSceneStore((s) => s.setFocalAdjust);
  // Show the focal pin (and, for Screen Y, the guide line) WHILE a slider is being adjusted,
  // then revert on release: a slider drag ends precisely via onCommit (base-ui's
  // onValueCommitted); the timeout is only a fallback for non-drag inputs (stepper / typing /
  // label-scrub) that don't emit a commit. Prior pin state is preserved because focalAdjust is
  // separate from the showFocalIndicator toggle.
  const focalAdjustTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFocalAdjust = useCallback(
    (which: "focalY" | "screenY") => {
      setFocalAdjust(which);
      if (focalAdjustTimeout.current) clearTimeout(focalAdjustTimeout.current);
      focalAdjustTimeout.current = setTimeout(() => setFocalAdjust(""), 1000);
    },
    [setFocalAdjust],
  );
  const endFocalAdjust = useCallback(() => {
    if (focalAdjustTimeout.current) clearTimeout(focalAdjustTimeout.current);
    setFocalAdjust("");
  }, [setFocalAdjust]);
  useEffect(
    () => () => {
      if (focalAdjustTimeout.current) clearTimeout(focalAdjustTimeout.current);
      setFocalAdjust("");
    },
    [setFocalAdjust],
  );
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => tweenOrbitToDefault()}
        title="Tween the orbit back to its default framing"
        className="self-start bg-purple-500/20 text-purple-200 hover:bg-purple-500/30"
      >
        Default Orbit
      </Button>
      <ValueSlider
        label="Speed °/s"
        value={orbit.periodSec !== 0 ? Number((360 / orbit.periodSec).toFixed(1)) : 0}
        min={-60}
        max={60}
        step={0.1}
        onChange={(dps) => setOrbit({ periodSec: dps !== 0 ? 360 / dps : 0 })}
        stepperClass="w-32"
      />
      {/* Shown in ortho too: the radius doesn't drive ortho zoom (orthoSize does), but it
          still moves the camera along the view axis — useful while debugging the camera. */}
      <ValueSlider
        label="Distance"
        value={orbit.radius}
        min={1}
        max={5000}
        step={5}
        onChange={(radius) => setOrbit({ radius })}
        stepperClass="w-32"
      />
      <ValueSlider
        label="Elevation"
        value={orbit.elevationDeg}
        min={0.01}
        max={90}
        step={0.5}
        onChange={(elevationDeg) => setOrbit({ elevationDeg })}
        stepperClass="w-32"
      />
      <ValueSlider
        label="Compass"
        value={orbit.azimuthDeg}
        min={0}
        max={360}
        step={1}
        loop
        onChange={(azimuthDeg) => setOrbit({ azimuthDeg })}
        stepperClass="w-32"
      />
      <ValueSlider
        label="Focal Y"
        value={orbit.lookAtY}
        min={-1000}
        max={1000}
        step={1}
        onChange={(lookAtY) => {
          setOrbit({ lookAtY });
          showFocalAdjust("focalY");
        }}
        onCommit={endFocalAdjust}
        stepperClass="w-32"
        origin={0}
        // fill out from 0; match the focal pin — sky-blue above ground, soil-brown below
        // (COLOR_ABOVE / COLOR_BELOW in DreiSceneControls).
        indicatorStyle={{ background: orbit.lookAtY >= 0 ? "#7dd3fc" : "#b5835a" }}
      />
      <ValueSlider
        label="Screen Y"
        // Screen Y is top-down: 0 = top of screen, 100 = bottom. The store holds
        // orbitPivotFromBottom (fraction UP from the bottom), so invert at the display layer.
        value={Math.round((1 - pivot) * 100)}
        min={0}
        max={100}
        step={1}
        onChange={(pct) => {
          setPivot(1 - pct / 100);
          showFocalAdjust("screenY");
        }}
        onCommit={endFocalAdjust}
        stepperClass="w-32"
      />
    </>
  );
}

function StarsSection() {
  const stars = useSceneStore((s) => s.stars);
  const setStars = useSceneStore((s) => s.setStars);
  return (
    <>
      <ValueSlider
        label="size"
        value={stars.factor}
        min={0.5}
        max={60}
        step={0.5}
        onChange={(factor) => setStars({ factor })}
      />
      <ValueSlider
        label="radius"
        value={stars.radius}
        min={500}
        max={30000}
        step={100}
        onChange={(radius) => setStars({ radius })}
      />
      <ValueSlider
        label="depth"
        value={stars.depth}
        min={50}
        max={8000}
        step={50}
        onChange={(depth) => setStars({ depth })}
      />
      <ValueSlider
        label="count"
        value={stars.count}
        min={100}
        max={30000}
        step={100}
        onChange={(count) => setStars({ count })}
      />
      {/* #26 meteors: toggle + min/max seconds between streaks. Each fired
          streak rolls the next gap uniformly inside this range. */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground/70 w-14 shrink-0">meteors</span>
        <Switch
          checked={stars.meteorsEnabled}
          onCheckedChange={(meteorsEnabled) => setStars({ meteorsEnabled })}
          aria-label="Enable meteors"
        />
        <Slider
          min={0.01}
          max={180}
          step={0.01}
          value={[stars.shootingMin, stars.shootingMax]}
          onValueChange={(v) => {
            const [shootingMin, shootingMax] = v as number[];
            setStars({ shootingMin, shootingMax });
          }}
          className="flex-1"
        />
        <input
          type="number"
          step={1}
          value={stars.shootingMin}
          onChange={(e) => {
            const v = Math.max(0.01, parseFloat(e.target.value) || 0.01);
            setStars({ shootingMin: Math.min(v, stars.shootingMax) });
          }}
          aria-label="Min seconds between meteors"
          className="border-foreground/15 bg-background/60 text-foreground w-13 rounded border px-1.5 py-0.5 tabular-nums"
        />
        <input
          type="number"
          step={1}
          value={stars.shootingMax}
          onChange={(e) => {
            const v = Math.max(0.01, parseFloat(e.target.value) || 0.01);
            setStars({ shootingMax: Math.max(v, stars.shootingMin) });
          }}
          aria-label="Max seconds between meteors"
          className="border-foreground/15 bg-background/60 text-foreground w-13 rounded border px-1.5 py-0.5 tabular-nums"
        />
      </div>
    </>
  );
}

// AA and LOD are split into separate collapsible SubGroups (user 2026-06-13), to
// match the Streetlights / Traffic / Distance-LOD groups. AA = hardware MSAA on
// the header (off by default; reloads the canvas) + the window-shader edge slider.
function AntiAliasingSection() {
  const antialias = useSceneStore((s) => s.antialias);
  const setAntialias = useSceneStore((s) => s.setAntialias);
  const wa = useSceneStore((s) => s.windowAA);
  const setWindowAA = useSceneStore((s) => s.setWindowAA);
  return (
    <SubGroup
      label="Anti-Aliasing (AA)"
      action={
        <Switch
          checked={antialias}
          onCheckedChange={(v) => setAntialias(v)}
          title="Hardware MSAA. Off = faster (fill-rate scales with it × DPR²). Reloads the view when toggled."
        />
      }
    >
      <div className="text-foreground/40 text-[10px]">MSAA (header) reloads the view; edge AA is live.</div>
      <ValueSlider
        label="edge AA"
        value={wa.edge}
        min={0.25}
        max={3}
        step={0.05}
        onChange={(edge) => setWindowAA({ edge })}
      />
    </SubGroup>
  );
}

// Render resolution (device-pixel-ratio) cap. Live — no reload. Cost ∝ DPR², so
// this is the biggest fill-rate lever on HiDPI screens. Auto = the tier's range.
function ResolutionSection() {
  const dprCap = useSceneStore((s) => s.dprCap);
  const setDprCap = useSceneStore((s) => s.setDprCap);
  const opts = ["auto", "1", "1.25", "1.5", "2"] as const;
  const labelOf = (v: string) => (v === "auto" ? "Auto (tier)" : `${v}×`);
  return (
    <SubGroup label="Resolution (DPR)">
      <div className="flex items-center gap-2 text-xs">
        <span
          className="text-foreground/70 w-14 shrink-0"
          title="Render pixel ratio. Lower = much faster (cost scales with DPR²). Applies instantly."
        >
          dpr
        </span>
        <Select
          value={dprCap == null ? "auto" : String(dprCap)}
          onValueChange={(v) => setDprCap(v === "auto" ? null : Number(v))}
        >
          <SelectTrigger
            size="sm"
            className="bg-background/50 text-foreground hover:bg-background/60 w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opts.map((v) => (
              <SelectItem key={v} value={v}>
                {labelOf(v)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SubGroup>
  );
}

// Level of Detail (LOD) — all LOD in one place (user 2026-06-13): the painted-
// window distance-wash (header toggle: off = full per-cell detail to the horizon)
// + the distance attenuation / per-tile culling consolidated from the Roads panel
// (its own enable, since it's a separate mechanism).
function LevelOfDetailSection() {
  const wa = useSceneStore((s) => s.windowAA);
  const setWindowAA = useSceneStore((s) => s.setWindowAA);
  const distEnabled = useSceneStore((s) => s.lod.enabled);
  const setLod = useSceneStore((s) => s.setLod);
  return (
    <SubGroup
      label="Level of Detail (LOD)"
      action={
        <Switch
          checked={wa.lodEnabled}
          onCheckedChange={(v) => setWindowAA({ lodEnabled: v })}
          title="Window distance-wash LOD. Off = full per-cell window detail everywhere (crisper far field, slightly more fragment cost)."
        />
      }
    >
      <div className="text-foreground/40 text-[10px]">Window distance-wash (header toggle)</div>
      <ValueSlider
        label="LOD near"
        value={wa.lodNear}
        min={0}
        max={1}
        step={0.01}
        onChange={(lodNear) => setWindowAA({ lodNear })}
      />
      <ValueSlider
        label="LOD range"
        value={wa.lodRange}
        min={0.05}
        max={1}
        step={0.01}
        onChange={(lodRange) => setWindowAA({ lodRange })}
      />
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs">
        <span className="text-foreground/70" title="Distance attenuation + per-tile culling on / off">
          distance culling
        </span>
        <Switch checked={distEnabled} onCheckedChange={(v) => setLod({ enabled: v })} />
      </div>
      <LodControls />
    </SubGroup>
  );
}

function BuildingsSection() {
  const lights = useSceneStore((s) => s.windowLights);
  const setWindowLights = useSceneStore((s) => s.setWindowLights);
  return (
    <>
      <SubGroup
        label="Windows"
        action={
          <Switch
            checked={lights}
            onCheckedChange={setWindowLights}
            title="All window lights on / off (darken the city to debug facades)"
          />
        }
      >
        <WindowsSection />
      </SubGroup>
      <SubGroup label="Facade">
        <FacadeSection />
      </SubGroup>
      {/* Debug tint (moved from Debug View, user 2026-06-08): header switch
          gates the wash, dropdown picks the category. */}
      <BuildingTintGroup />
    </>
  );
}

// Building debug tint — washes the massing by a category (population, district,
// landuse…). The header switch is the on/off (the retired "off" mode); the
// dropdown remembers the category while off.
function BuildingTintGroup() {
  const tint = useSceneStore((s) => s.debug.buildingTint);
  const setBuildingTint = useSceneStore((s) => s.setBuildingTint);
  return (
    <SubGroup
      label="Debug tint"
      action={
        <Switch
          checked={tint.enabled}
          onCheckedChange={(enabled) => setBuildingTint({ enabled })}
          title="Wash the buildings by the selected category"
        />
      }
    >
      <ModeSelect
        value={tint.mode}
        modes={TINT_MODES}
        onChange={(v) => setBuildingTint({ mode: v as BuildingTintMode })}
      />
      <ValueSlider
        label="intensity"
        value={tint.intensity}
        min={0}
        max={1}
        step={0.05}
        onChange={(intensity) => setBuildingTint({ intensity })}
      />
    </SubGroup>
  );
}

// Hue-spectrum track for the facade hue range sliders. Explicit stops every
// 60° (rather than `in hsl longer hue`) for broad browser support; lightness
// 50% so the band reads even though facade lightness is far darker.
const HUE_TRACK: CSSProperties = {
  height: 6,
  background:
    "linear-gradient(to right, hsl(0,70%,50%), hsl(60,70%,50%), hsl(120,70%,50%), hsl(180,70%,50%), hsl(240,70%,50%), hsl(300,70%,50%), hsl(360,70%,50%))",
};

function FacadeSection() {
  const facade = useSceneStore((s) => s.facade);
  const setFacade = useSceneStore((s) => s.setFacade);
  return (
    <>
      <div className="text-foreground/55 text-[10px] leading-snug">
        Wall color. Each building flips a weighted coin (warm %) for its hue family — warm masonry
        vs cool glass — then rolls one hue, saturation + lightness from these ranges (lightness
        skews dark, so pale towers stay rare). Live — no regen.
      </div>
      <ValueSlider
        label="warm %"
        value={facade.warmShare}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setFacade({ warmShare: v })}
      />
      <RangeSlider
        label="warm hue"
        value={[facade.warmHueMin, facade.warmHueMax]}
        min={0}
        max={360}
        step={1}
        trackStyle={HUE_TRACK}
        indicatorClassName="bg-transparent border-y-2 border-white/80"
        onChange={([warmHueMin, warmHueMax]) => setFacade({ warmHueMin, warmHueMax })}
      />
      <RangeSlider
        label="cool hue"
        value={[facade.coolHueMin, facade.coolHueMax]}
        min={0}
        max={360}
        step={1}
        trackStyle={HUE_TRACK}
        indicatorClassName="bg-transparent border-y-2 border-white/80"
        onChange={([coolHueMin, coolHueMax]) => setFacade({ coolHueMin, coolHueMax })}
      />
      <RangeSlider
        label="sat"
        value={[facade.satMin, facade.satMax]}
        min={0}
        max={1}
        step={0.01}
        onChange={([satMin, satMax]) => setFacade({ satMin, satMax })}
      />
      <RangeSlider
        label="light"
        value={[facade.lightMin, facade.lightMax]}
        min={0}
        max={0.5}
        step={0.01}
        onChange={([lightMin, lightMax]) => setFacade({ lightMin, lightMax })}
      />
    </>
  );
}

function WindowsSection() {
  const mode = useSceneStore((s) => s.windowMode);
  const setWindowMode = useSceneStore((s) => s.setWindowMode);
  const stagger = useSceneStore((s) => s.windowAA.stagger);
  const curtain = useSceneStore((s) => s.windowAA.curtain);
  const curtainW = useSceneStore((s) => s.windowAA.curtainW);
  const setWindowAA = useSceneStore((s) => s.setWindowAA);
  return (
    <>
      <div className="flex items-center gap-1">
        {(["simple", "advanced"] as const).map((m) => (
          <Button
            key={m}
            variant="secondary"
            size="sm"
            onClick={() => setWindowMode(m)}
            title={
              m === "simple"
                ? "One window size shared by every building"
                : "Window size + grid pitch per building archetype"
            }
            className={cn(
              "flex-1 capitalize",
              mode === m
                ? "bg-foreground text-background hover:bg-foreground"
                : "bg-foreground/10 text-foreground hover:bg-foreground/20",
            )}
          >
            {m}
          </Button>
        ))}
      </div>
      {mode === "simple" ? <WindowsSimpleControls /> : <WindowProfilesSection />}
      <ValueSlider
        label="stagger"
        value={stagger}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setWindowAA({ stagger: v })}
      />
      <div className="text-foreground/55 text-[10px] leading-snug">
        Share of correlated floors (whole / fractional bands) that switch on in 2–4 column banks
        instead of all at once.
      </div>
      <ValueSlider
        label="curtain"
        value={curtain}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setWindowAA({ curtain: v })}
      />
      <div className="text-foreground/55 text-[10px] leading-snug">
        Share of correlated office towers whose banded floors render as curtain glass — ribbon
        floors on otherwise normal facades, piers at the corners.
      </div>
      <ValueSlider
        label="crt width"
        value={curtainW}
        min={0.85}
        max={1}
        step={0.01}
        onChange={(v) => setWindowAA({ curtainW: v })}
      />
      <div className="text-foreground/55 text-[10px] leading-snug">
        Pane fill on curtain towers. 0.99 keeps hairline mullions; exactly 1.0 merges each lit floor
        into one continuous window. 1 in 5 curtain towers rolls full regardless.
      </div>
    </>
  );
}

function WindowsSimpleControls() {
  const ws = useSceneStore((s) => s.windowSimple);
  const setWindowSimple = useSceneStore((s) => s.setWindowSimple);
  return (
    <>
      <div className="text-foreground/55 text-[10px] leading-snug">
        Each building rolls one window width and height from the ranges (all its windows match); the
        two rolls are independent.
      </div>
      <RangeSlider
        label="width"
        value={[ws.wMin, ws.wMax]}
        min={0.1}
        max={1}
        step={0.01}
        onChange={([wMin, wMax]) => setWindowSimple({ wMin, wMax })}
      />
      <RangeSlider
        label="height"
        value={[ws.hMin, ws.hMax]}
        min={0.1}
        max={1}
        step={0.01}
        onChange={([hMin, hMax]) => setWindowSimple({ hMin, hMax })}
      />
    </>
  );
}

const ARCHETYPE_LABELS: Record<Archetype, string> = {
  "low-rise": "Low-rise",
  warehouse: "Warehouse",
  "mid-rise": "Mid-rise",
  "residential-tower": "Res. tower",
  "narrow-tower": "Narrow tower",
  "office-block": "Office block",
  spire: "Spire",
};

const ARCHETYPE_ICONS: Record<Archetype | "all", LucideIcon> = {
  all: LayoutGrid,
  "low-rise": Home,
  warehouse: Warehouse,
  "mid-rise": Building,
  "residential-tower": Hotel,
  "narrow-tower": TowerControl,
  "office-block": Building2,
  spire: RadioTower,
};

function WindowProfilesSection() {
  const profiles = useSceneStore((s) => s.windowProfiles);
  const setWindowProfile = useSceneStore((s) => s.setWindowProfile);
  const [filter, setFilter] = useState<Archetype | "all">("all");
  const shown = filter === "all" ? ARCHETYPE_ORDER : [filter];
  return (
    <>
      <div className="text-foreground/55 text-[10px] leading-snug">
        Glass-to-cell fraction per building style. Each building rolls one width and one height from
        its archetype&apos;s ranges (all its windows match). Grid spacing is baked per archetype.
      </div>
      <TooltipProvider>
        <div className="flex items-center gap-0.5">
          {(["all", ...ARCHETYPE_ORDER] as (Archetype | "all")[]).map((id) => {
            const Icon = ARCHETYPE_ICONS[id];
            return (
              <Tooltip key={id}>
                <TooltipTrigger
                  onClick={() => setFilter(id)}
                  className={cn(
                    "flex h-7 flex-1 items-center justify-center rounded-md transition-colors",
                    filter === id
                      ? "bg-foreground text-background"
                      : "bg-foreground/10 text-foreground hover:bg-foreground/20",
                  )}
                >
                  <Icon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{id === "all" ? "All types" : ARCHETYPE_LABELS[id]}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
      {shown.map((arch) => (
        <div key={arch} className="flex flex-col gap-1.5">
          <div className="text-foreground/55 pt-1 text-[10px] tracking-wide uppercase">
            {ARCHETYPE_LABELS[arch]}
          </div>
          <RangeSlider
            label="width"
            value={[profiles[arch].wMin, profiles[arch].wMax]}
            min={0.1}
            max={1}
            step={0.01}
            onChange={([wMin, wMax]) => setWindowProfile(arch, { wMin, wMax })}
          />
          <RangeSlider
            label="height"
            value={[profiles[arch].hMin, profiles[arch].hMax]}
            min={0.1}
            max={1}
            step={0.01}
            onChange={([hMin, hMax]) => setWindowProfile(arch, { hMin, hMax })}
          />
        </div>
      ))}
    </>
  );
}

function MoonSection() {
  const moon = useSceneStore((s) => s.moon);
  const setMoon = useSceneStore((s) => s.setMoon);
  const halo = useSceneStore((s) => s.moonHalo);
  const setMoonHalo = useSceneStore((s) => s.setMoonHalo);
  const followCamera = useSceneStore((s) => s.moonFollowCamera);
  const setFollowCamera = useSceneStore((s) => s.setMoonFollowCamera);
  return (
    <>
      <div className="flex items-center justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFollowCamera(!followCamera)}
          title="Moon tracks the camera so it stays opposite the city"
          className={cn(
            followCamera
              ? "bg-indigo-400 text-black hover:bg-indigo-400"
              : "bg-foreground/10 text-foreground hover:bg-foreground/20",
          )}
        >
          {followCamera ? "follow cam (on)" : "follow cam"}
        </Button>
      </div>
      <ValueSlider
        label="az°"
        value={moon.azimuthDeg}
        min={0}
        max={360}
        step={1}
        onChange={(azimuthDeg) => setMoon({ azimuthDeg })}
      />
      <ValueSlider
        label="el°"
        value={moon.elevationDeg}
        min={-10}
        max={90}
        step={0.5}
        onChange={(elevationDeg) => setMoon({ elevationDeg })}
      />
      <ValueSlider
        label="dist"
        value={moon.distance}
        min={500}
        max={30000}
        step={50}
        onChange={(distance) => setMoon({ distance })}
      />
      <ValueSlider
        label="size"
        value={moon.radiusRatio}
        min={0.005}
        max={0.2}
        step={0.001}
        onChange={(radiusRatio) => setMoon({ radiusRatio })}
      />
      <div className="text-foreground/55 pt-1 text-[10px] tracking-wide uppercase">Halo</div>
      <ValueSlider
        label="size×"
        value={halo.radiusMul}
        min={1}
        max={8}
        step={0.05}
        onChange={(radiusMul) => setMoonHalo({ radiusMul })}
      />
      <ValueSlider
        label="core"
        value={halo.innerRadius}
        min={0}
        max={0.3}
        step={0.005}
        onChange={(innerRadius) => setMoonHalo({ innerRadius })}
      />
      <ValueSlider
        label="glow"
        value={halo.intensity}
        min={0}
        max={3}
        step={0.05}
        onChange={(intensity) => setMoonHalo({ intensity })}
      />
      <MoonReadout />
    </>
  );
}

function FogSection() {
  const fog = useSceneStore((s) => s.fog);
  const setFog = useSceneStore((s) => s.setFog);
  const haze = useSceneStore((s) => s.haze);
  const setHaze = useSceneStore((s) => s.setHaze);
  const setFogAdjusting = useSceneStore((s) => s.setFogAdjusting);
  // Show the in-world bracket rings while dragging near/far; linger briefly
  // after the last change so the rings don't blink out mid-adjust.
  const adjustTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingAdjusting = useCallback(() => {
    setFogAdjusting(true);
    if (adjustTimeout.current) clearTimeout(adjustTimeout.current);
    adjustTimeout.current = setTimeout(() => setFogAdjusting(false), 1200);
  }, [setFogAdjusting]);
  useEffect(
    () => () => {
      if (adjustTimeout.current) clearTimeout(adjustTimeout.current);
      setFogAdjusting(false);
    },
    [setFogAdjusting],
  );
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-foreground/55 text-[10px] tracking-wide uppercase">Fog</span>
        <Switch
          checked={fog.enabled}
          onCheckedChange={(enabled) => setFog({ enabled })}
          aria-label="Toggle scene fog"
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground/70 w-14 shrink-0">color</span>
        <input
          type="color"
          value={fog.color}
          onChange={(e) => setFog({ color: e.target.value })}
          className="border-foreground/15 h-7 w-12 cursor-pointer rounded border bg-transparent"
          title="Fog color (also drives the scene background)"
        />
        <code className="text-foreground/60 tabular-nums">{fog.color}</code>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground/70 w-14 shrink-0">mode</span>
        <Select value={fog.mode} onValueChange={(v) => setFog({ mode: v as typeof fog.mode })}>
          <SelectTrigger
            size="sm"
            className="bg-background/50 text-foreground hover:bg-background/60 w-full"
          >
            <SelectValue placeholder="mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="linear">linear (near / far)</SelectItem>
            <SelectItem value="exp2">exp² (density)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {fog.mode === "linear" ? (
        <>
          {/* Positions on the camera→centre axis: 0 = at the camera, 1 = at
              the city centre, >1 = beyond it — not absolute metres. Dragging
              shows the in-world boundary walls (FogBoundsMarkers). */}
          <ValueSlider
            label="near"
            value={fog.near}
            min={0}
            max={4}
            step={0.05}
            onChange={(near) => {
              setFog({ near });
              pingAdjusting();
            }}
          />
          <ValueSlider
            label="far"
            value={fog.far}
            min={0.1}
            max={6}
            step={0.05}
            onChange={(far) => {
              setFog({ far });
              pingAdjusting();
            }}
          />
        </>
      ) : (
        <ValueSlider
          label="amount"
          value={fog.density}
          min={0}
          max={0.9}
          step={0.01}
          onChange={(density) => setFog({ density })}
        />
      )}
      <div className="flex items-center justify-between pt-2">
        <span className="text-foreground/55 text-[10px] tracking-wide uppercase">Ground haze</span>
        <Switch
          checked={haze.enabled}
          onCheckedChange={(enabled) => setHaze({ enabled })}
          aria-label="Toggle ground-haze band"
        />
      </div>
      {haze.enabled ? (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-foreground/70 w-14 shrink-0">color</span>
            <input
              type="color"
              value={haze.color}
              onChange={(e) => setHaze({ color: e.target.value })}
              className="border-foreground/15 h-7 w-12 cursor-pointer rounded border bg-transparent"
            />
            <code className="text-foreground/60 tabular-nums">{haze.color}</code>
          </div>
          <ValueSlider
            label="bottom"
            value={haze.bottomY}
            min={-200}
            max={400}
            step={5}
            onChange={(bottomY) => setHaze({ bottomY })}
          />
          <ValueSlider
            label="top"
            value={haze.topY}
            min={0}
            max={800}
            step={5}
            onChange={(topY) => setHaze({ topY })}
          />
          <ValueSlider
            label="strength"
            value={haze.intensity}
            min={0}
            max={2}
            step={0.05}
            onChange={(intensity) => setHaze({ intensity })}
          />
          <ValueSlider
            label="radius"
            value={haze.radius}
            min={500}
            max={6000}
            step={50}
            onChange={(radius) => setHaze({ radius })}
          />
        </>
      ) : null}
    </>
  );
}

function IntroSection() {
  const intro = useSceneStore((s) => s.intro);
  const starIntro = useSceneStore((s) => s.starIntro);
  const setIntroDuration = useSceneStore((s) => s.setIntroDuration);
  const setStreetlightDuration = useSceneStore((s) => s.setStreetlightDuration);
  const setIntroMode = useSceneStore((s) => s.setIntroMode);
  const setOffCycle = useSceneStore((s) => s.setOffCycle);
  const setRetrigger = useSceneStore((s) => s.setRetrigger);
  const setCycleJitter = useSceneStore((s) => s.setCycleJitter);
  const setStarIntroDuration = useSceneStore((s) => s.setStarIntroDuration);
  const setStarIntroMode = useSceneStore((s) => s.setStarIntroMode);
  const windowModes = ["random", "district", "outside-in", "inside-out", "far-to-near"] as const;
  const starModes = ["random", "bright-first", "horizon-first", "zenith-first"] as const;
  // Speed presets: Default = the slow ambient wake (windows 240s / stars 240s /
  // streetlights 60s); Fast = a quick 30s/30s cascade with a 10s streetlight
  // wake. Empty when durations have been hand-tuned.
  const speedPreset =
    intro.durationSec === 240 &&
    starIntro.durationSec === 240 &&
    intro.streetlightDurationSec === 60
      ? "default"
      : intro.durationSec === 30 &&
          starIntro.durationSec === 30 &&
          intro.streetlightDurationSec === 10
        ? "fast"
        : "";
  const applyIntroSpeed = (v: string) => {
    if (v === "default") {
      setIntroDuration(240);
      setStarIntroDuration(240);
      setStreetlightDuration(60);
    } else if (v === "fast") {
      setIntroDuration(30);
      setStarIntroDuration(30);
      setStreetlightDuration(10);
    }
  };
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-foreground/40 text-xs tracking-wide uppercase">speed</span>
        <Tabs value={speedPreset} onValueChange={applyIntroSpeed}>
          <TabsList className="w-full">
            <TabsTrigger value="default">Default</TabsTrigger>
            <TabsTrigger value="fast">Fast</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Expandable wake-sequence groups (user 2026-06-08), collapsed by default. */}
      <SubGroup label="Windows">
        <ValueSlider
          label="duration"
          value={intro.durationSec}
          min={1}
          max={480}
          step={1}
          onChange={(durationSec) => setIntroDuration(durationSec)}
        />
        <ValueSlider
          label="off cycle"
          value={intro.offCycleSec}
          min={1}
          max={480}
          step={1}
          onChange={(offCycleSec) => setOffCycle(offCycleSec)}
        />
        <ValueSlider
          label="retrigger"
          value={intro.retriggerSec}
          min={1}
          max={480}
          step={1}
          onChange={(retriggerSec) => setRetrigger(retriggerSec)}
        />
        <ValueSlider
          label="jitter"
          value={intro.cycleJitter}
          min={0}
          max={1}
          step={0.02}
          onChange={(cycleJitter) => setCycleJitter(cycleJitter)}
        />
        <ModeSelect
          value={intro.mode}
          modes={windowModes}
          onChange={(v) => setIntroMode(v as typeof intro.mode)}
        />
        <ProgressRow label="progress" value={intro.progress} />
      </SubGroup>

      <SubGroup label="Stars">
        <ValueSlider
          label="duration"
          value={starIntro.durationSec}
          min={1}
          max={480}
          step={1}
          onChange={(durationSec) => setStarIntroDuration(durationSec)}
        />
        <ModeSelect
          value={starIntro.mode}
          modes={starModes}
          onChange={(v) => setStarIntroMode(v as typeof starIntro.mode)}
        />
        <ProgressRow label="progress" value={starIntro.progress} />
      </SubGroup>

      <SubGroup label="Streetlights">
        <ValueSlider
          label="duration"
          value={intro.streetlightDurationSec}
          min={0.5}
          max={120}
          step={0.5}
          onChange={(streetlightDurationSec) => setStreetlightDuration(streetlightDurationSec)}
        />
      </SubGroup>
    </>
  );
}

// Collapsible group: an uppercase header with a chevron toggle. Open
// state is transient (like the archetype filter) — not part of saved configs.
// `action` renders in the header row as a SIBLING of the toggle button (same
// pattern as Section) so clicking it doesn't collapse the group.
function SubGroup({
  label,
  defaultOpen = false,
  action,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="mt-1 flex items-center gap-1.5 border-t border-white/10 pt-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-foreground/55 hover:text-foreground/80 flex flex-1 items-center text-[11px] font-medium tracking-wide uppercase transition-colors"
        >
          {label}
        </button>
        {action}
        {/* Chevron also toggles, but the label button is the accessible /
            tabbable control — keep this one out of the tab order. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setOpen((o) => !o)}
          className="text-foreground/55 hover:text-foreground/80 transition-colors"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        </button>
      </div>
      {open && <div className="flex flex-col gap-2.5">{children}</div>}
    </>
  );
}

// Alphabetised, no "off" (the header switch gates it now, 2026-06-08).
const TINT_MODES = ["archetype", "depth", "district", "height", "landuse", "population"] as const;
const CITY_SHAPE_MODES = ["auto", ...CITY_SHAPES] as const;
const RENDER_GROUP_LABELS: Record<RenderGroup, string> = {
  buildings: "Buildings",
  roads: "Roads",
  ground: "Ground",
  sky: "Sky + Stars",
  moon: "Moon",
};

// Debug View (#39): building tint (Slice A) + per-group render mode (Slice B).
function DebugSection() {
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
        <div className="text-foreground/45 text-[11px] leading-snug">
          Size sets the generated extent (re-rolls the layout; bigger = slower to generate). Crop
          reveals/hides the already-generated city — grow = reveal, never a re-roll. auto = each
          seed picks its shape; square = full field.
        </div>
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
        <div className="text-foreground/45 text-[11px] leading-snug">
          Deviation scales how hard the street field bends (re-rolls on release). ×1 = the
          seed&apos;s own character; lower = calmer grids, higher = stronger warps/shears.
        </div>
      </SubGroup>

      <SubGroup label="Render modes">
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
        <div className="text-foreground/45 text-[11px] leading-snug">
          Wireframe applies to mesh geometry; it&apos;s a no-op for Sky + Stars.
        </div>
      </SubGroup>

      {/* Header switch = the overlay toggle itself (Windows-lights pattern) —
          flippable without expanding the group. */}
      <SubGroup
        label="Tensor field"
        action={
          <Switch
            checked={showTensorField}
            onCheckedChange={setShowTensorField}
            title="Show the grain direction overlay"
          />
        }
      >
        <div className="text-foreground/45 text-[11px] leading-snug">
          The major-eigenvector field the roads follow — ticks colored by grain angle.
        </div>
      </SubGroup>

      {/* #55 tile culling — visualize the per-tile materialisation machinery. */}
      <SubGroup
        label="Tile culling"
        action={
          <Switch
            checked={tileOverlay}
            onCheckedChange={setTileOverlay}
            title="Show the tile grid overlay (green = materialised, red = evicted)"
          />
        }
      >
        <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
          <span className="text-foreground/70">freeze cull frustum</span>
          <Switch checked={tileFreeze} onCheckedChange={setTileFreeze} />
        </label>
        <TileCullReadout />
        <div className="text-foreground/45 text-[11px] leading-snug">
          Tiles are the 500 m cells buildings / streetlights / traffic materialise in — green = in
          the cull frustum, red = evicted. Freeze pins the frustum to the current pose so you can
          orbit out and watch eviction (unfrozen, an evicted tile is offscreen by definition). The
          culling switch itself lives in Roads → Distance LOD.
        </div>
      </SubGroup>

      {/* Pin-plane framing aid (2026-06-14, throwaway): the plane through the focal
          pin with the ortho view outlined on it — dial perspective fov/distance to
          match the outline. */}
      <SubGroup
        label="Pin plane"
        action={
          <Switch
            checked={showPinPlane}
            onCheckedChange={setShowPinPlane}
            title="Show the focal-pin plane + ortho view outline"
          />
        }
      >
        <div className="text-foreground/45 text-[11px] leading-snug">
          On the plane through the focal pin (perpendicular to the view), two footprints: the
          orthographic view in <span className="text-sky-300">sky-blue</span> and the perspective
          view in <span className="text-amber-700">soil-brown</span>. Both honour Screen Y. Adjust
          FOV / distance until the brown rect lands on the blue one — that&apos;s matched framing.
        </div>
      </SubGroup>
    </>
  );
}

// K = visible half-height at the pin plane: ortho sets it directly (orthoSize),
// perspective produces it via distance·tan(fov/2). Equal K ⇒ the two projections
// frame the same content. Δ→0 (green) is the numeric proof that pairs with the
// pin-plane overlay's rects coinciding. (2026-06-14, throwaway tuning aid.)
function PinPlaneReadout() {
  const orthoSize = useSceneStore((s) => s.orthoSize);
  const radius = useSceneStore((s) => s.orbit.radius);
  const fov = useSceneStore((s) => s.cameraIntent.fov);
  const kPersp = radius * Math.tan((fov * Math.PI) / 180 / 2);
  const delta = kPersp - orthoSize;
  return (
    <div className="border-foreground/10 mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t pt-1.5 font-mono text-[11px]">
      <div className="text-sky-300">K ortho (size)</div>
      <div className="text-right tabular-nums">{fmt(orthoSize, 0)}</div>
      <div className="text-amber-700">K persp (d·tan½fov)</div>
      <div className="text-right tabular-nums">{fmt(kPersp, 0)}</div>
      <div className="text-foreground/50">Δ</div>
      <div
        className={cn(
          "text-right tabular-nums",
          Math.abs(delta) < 1 ? "text-emerald-400" : "text-foreground/70",
        )}
      >
        {fmt(delta, 0)}
      </div>
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
function StreetlightsGroup() {
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
function TrafficGroup() {
  const traffic = useSceneStore((s) => s.traffic);
  const setTraffic = useSceneStore((s) => s.setTraffic);
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
    </SubGroup>
  );
}

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

function ModeSelect<T extends string>({
  value,
  modes,
  onChange,
}: {
  value: T;
  modes: readonly T[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-foreground/70 w-14 shrink-0">mode</span>
      <Select value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger
          size="sm"
          className="bg-background/50 text-foreground hover:bg-background/60 w-full"
        >
          <SelectValue placeholder="mode" />
        </SelectTrigger>
        <SelectContent>
          {modes.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-foreground/70 grid grid-cols-[5rem_1fr] gap-1 font-mono text-xs">
      <div>{label}</div>
      <div className="tabular-nums">{fmt(value, 2)}</div>
    </div>
  );
}

// True when the primary pointer is coarse (touch). Client-only; defaults to false
// (desktop / cursor) on first paint, then resolves after mount — avoids a hydration
// mismatch. Guards (pointer: coarse) per the hover/pointer-safety convention.
function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setTouch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return touch;
}

// Orbit section header actions (user 2026-06-14): the orbit controls live in the
// section header now — transport (play/pause), the focal-point pin, and the wheel-zoom
// target — each a compact icon button so all three sit beside the chevron. (The
// pause/resume action moved to the header 2026-06-08; the other two followed here.)
function OrbitHeaderActions() {
  return (
    <div className="flex items-center gap-1">
      <ZoomTargetToggle />
      <FocalPinToggle />
      <OrbitPlayPauseToggle />
    </div>
  );
}

// Play/pause the camera auto-revolution. Transport convention: ⏸ while revolving
// (click to pause), ▶ while paused (click to resume); highlighted while playing.
// Space still toggles it.
function OrbitPlayPauseToggle() {
  const orbitPaused = useSceneStore((s) => s.orbitPaused);
  const setOrbitPaused = useSceneStore((s) => s.setOrbitPaused);
  const playing = !orbitPaused;
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      title={
        playing ? "Pause the orbit revolution (Space)" : "Resume the orbit revolution (Space)"
      }
      aria-label={playing ? "Pause orbit revolution" : "Resume orbit revolution"}
      aria-pressed={playing}
      onClick={() => setOrbitPaused(!orbitPaused)}
      className={cn(
        playing
          ? "bg-amber-300 text-black hover:bg-amber-300/90"
          : "bg-foreground/10 text-foreground/80 hover:bg-foreground/20",
      )}
    >
      {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
    </Button>
  );
}

function FlySpeedSlider() {
  const flySpeed = useSceneStore((s) => s.flySpeed);
  const setFlySpeed = useSceneStore((s) => s.setFlySpeed);
  return (
    <ValueSlider
      label="fly speed"
      value={flySpeed}
      min={0.1}
      max={500}
      step={0.1}
      onChange={setFlySpeed}
      labelClass="text-orange-200/80"
    />
  );
}

function ProjectionRow() {
  const projection = useSceneStore((s) => s.projection);
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-1.5">
        <span className="text-foreground/40 text-xs tracking-wide uppercase">projection</span>
        <Tabs
          value={projection}
          onValueChange={(v) => tweenProjectionTo(v as "perspective" | "orthographic")}
        >
          <TabsList className="w-full">
            <Tooltip>
              <TooltipTrigger
                render={
                  <TabsTrigger value="perspective" aria-label="Perspective">
                    <Telescope className="size-4" />
                  </TabsTrigger>
                }
              />
              <TooltipContent>Perspective</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <TabsTrigger value="orthographic" aria-label="Orthographic">
                    <Box className="size-4" />
                  </TabsTrigger>
                }
              />
              <TooltipContent>Orthographic</TooltipContent>
            </Tooltip>
          </TabsList>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

function FovOrSizeSlider() {
  const projection = useSceneStore((s) => s.projection);
  const fov = useSceneStore((s) => s.cameraIntent.fov);
  const orthoSize = useSceneStore((s) => s.orthoSize);
  const setCameraIntent = useSceneStore((s) => s.setCameraIntent);
  const setOrthoSize = useSceneStore((s) => s.setOrthoSize);
  if (projection === "orthographic") {
    return (
      <ValueSlider
        label="size"
        value={orthoSize}
        min={5}
        max={2000}
        step={1}
        format={{ maximumFractionDigits: 0 }}
        onChange={setOrthoSize}
      />
    );
  }
  return (
    <ValueSlider
      label="fov"
      value={fov}
      min={5}
      max={90}
      step={1}
      format={{ maximumFractionDigits: 0 }}
      onChange={(v) => setCameraIntent({ fov: v })}
    />
  );
}

function CopyButton() {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const onCopy = () => {
    copyConfigToClipboard();
    setCopyState("copied");
    setTimeout(() => setCopyState("idle"), 1200);
  };
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onCopy}
      title="Copy every current setting as JSON to the clipboard"
      className="bg-foreground/10 text-foreground hover:bg-foreground/20"
    >
      {copyState === "copied" ? (
        <>
          <Check className="size-4" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-4" />
          Copy
        </>
      )}
    </Button>
  );
}

// Focal-point pin (moved to the header 2026-06-14): a MapPin icon — the same glyph
// the live readout uses for the focal-point row — highlighted sky-blue while shown.
function FocalPinToggle() {
  const show = useSceneStore((s) => s.showFocalIndicator);
  const setShow = useSceneStore((s) => s.setShowFocalIndicator);
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      onClick={() => setShow(!show)}
      title={show ? "Hide the focal-point pin" : "Show the focal-point pin"}
      aria-label={show ? "Hide focal-point pin" : "Show focal-point pin"}
      aria-pressed={show}
      className={cn(
        show
          ? "bg-amber-300 text-black hover:bg-amber-300/90"
          : "bg-foreground/10 text-foreground/80 hover:bg-foreground/20",
      )}
    >
      <MapPin className="size-3.5" />
    </Button>
  );
}

// Wheel-zoom target (moved to the header 2026-06-14): a magnifying glass paired with
// whatever zoom homes toward — the pin when zooming to the focal pin, otherwise the
// pointer that drives it: an arrow cursor on desktop, a finger on touch. `z` toggles it.
function ZoomTargetToggle() {
  const toPin = useSceneStore((s) => s.orbitZoomToPin);
  const setToPin = useSceneStore((s) => s.setOrbitZoomToPin);
  const isTouch = useIsTouch();
  const TargetIcon = toPin ? MapPin : isTouch ? Pointer : MousePointer2;
  const targetLabel = toPin ? "the pin" : isTouch ? "your finger" : "the cursor";
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => setToPin(!toPin)}
      title={`Wheel-zoom homes toward ${targetLabel} (z to toggle)`}
      aria-label={`Wheel-zoom target: ${targetLabel}`}
      className="bg-foreground/10 text-foreground/80 hover:bg-foreground/20 gap-0.5 px-1.5"
    >
      <ScanSearch className="size-3.5" />
      <TargetIcon className="size-3.5" />
    </Button>
  );
}

function MoonReadout() {
  const moon = useSceneStore((s) => s.moonLive);
  return (
    <div className="border-foreground/10 text-foreground/70 mt-1 grid grid-cols-[5rem_1fr] gap-1 border-t pt-1.5 font-mono text-xs">
      <div>moon pos</div>
      <div className="tabular-nums">
        {fmt(moon.position[0], 0)} {fmt(moon.position[1], 0)} {fmt(moon.position[2], 0)}
      </div>
      <div>moon az°</div>
      <div className="tabular-nums">{fmt(moon.azimuthDeg, 1)}</div>
      <div>moon el°</div>
      <div className="tabular-nums">{fmt(moon.elevationDeg, 1)}</div>
      <div>moon dist</div>
      <div className="tabular-nums">{fmt(moon.distance, 0)}</div>
    </div>
  );
}

// ValueSlider moved to components/ui/value-slider.tsx (shared with RoadsPanel,
// upgraded with a base-ui number-field stepper + label scrubbing).
// Vec3Header/Vec3Input removed with the manual camera-intent inputs (2026-06-07).

function SeedRow() {
  const seed = useSceneStore((s) => s.masterSeed);
  const setSeed = useSceneStore((s) => s.setSeed);
  const [draft, setDraft] = useState(seed);
  const [prevSeed, setPrevSeed] = useState(seed);

  // Reset the draft when the store seed changes (e.g. randomize). Adjust state
  // during render per React docs — no effect, avoids the cascading-render smell.
  if (seed !== prevSeed) {
    setPrevSeed(seed);
    setDraft(seed);
  }

  const commit = () => {
    const v = draft.trim();
    if (v && v !== seed) setSeed(v);
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-foreground/70 w-14 shrink-0">seed</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="border-foreground/15 bg-background/60 text-foreground min-w-0 flex-1 rounded border px-1.5 py-0.5 font-mono"
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setSeed(randomSeed())}
        title="Reroll seed"
        className="bg-foreground/10 text-foreground hover:bg-foreground/20"
      >
        Reroll
      </Button>
    </div>
  );
}

// Performance display — 3-step: off / badge (floating FPS badge) / stats (the
// detailed overlay). Mutually exclusive, so only one floating display shows at a
// time. Rendered as a Section header action (sibling of the trigger); buttons
// stopPropagation so a click selects a mode without toggling the accordion.
function PerfDisplayToggle() {
  const fpsHud = useSceneStore((s) => s.fpsHud);
  const perfStats = useSceneStore((s) => s.perfStats);
  const setFpsHud = useSceneStore((s) => s.setFpsHud);
  const setPerfStats = useSceneStore((s) => s.setPerfStats);
  const active: "off" | "badge" | "stats" = perfStats ? "stats" : fpsHud ? "badge" : "off";
  const apply = (v: "off" | "badge" | "stats") => {
    setFpsHud(v === "badge");
    setPerfStats(v === "stats");
  };
  const opts: Array<{ v: "off" | "badge" | "stats"; title: string }> = [
    { v: "off", title: "No on-screen performance display" },
    { v: "badge", title: "Small floating FPS badge" },
    { v: "stats", title: "Detailed overlay: boot timeline, long tasks, last gen" },
  ];
  return (
    <div
      role="group"
      aria-label="Performance display"
      className="bg-background/40 flex rounded-md p-0.5 text-[11px]"
    >
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          title={o.title}
          onClick={(e) => {
            e.stopPropagation();
            apply(o.v);
          }}
          className={cn(
            "rounded px-1.5 py-0.5 transition-colors",
            active === o.v
              ? "bg-foreground/15 text-foreground"
              : "text-foreground/45 hover:text-foreground/80",
          )}
        >
          {o.v}
        </button>
      ))}
    </div>
  );
}

// Camera header actions (user 2026-06-14): a quick projection switch plus the
// default/free pose toggle, side by side in the section header.
function CameraHeaderActions() {
  return (
    <div className="flex items-center gap-1">
      <CameraProjectionToggle />
      <CameraPoseToggle />
    </div>
  );
}

// Quick projection switch: shows the CURRENT projection's icon — telescope =
// perspective, box = orthographic — and tweens to the other on click (the same
// morph as the body projection tabs). The tabs in the section body remain the
// labelled control; this is the at-a-glance header shortcut.
function CameraProjectionToggle() {
  const projection = useSceneStore((s) => s.projection);
  const isPersp = projection === "perspective";
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      className="bg-foreground/10 text-foreground/80 hover:bg-foreground/20"
      title={isPersp ? "Switch to orthographic" : "Switch to perspective"}
      aria-label={
        isPersp ? "Switch to orthographic projection" : "Switch to perspective projection"
      }
      onClick={() => tweenProjectionTo(isPersp ? "orthographic" : "perspective")}
    >
      {isPersp ? <Telescope className="size-3.5" /> : <Box className="size-3.5" />}
    </Button>
  );
}

// One-press toggle between the DEFAULT orbit framing and the user's own ("free")
// pose (user 2026-06-07). Pressing it from "free" snapshots the current orbit
// (elevation / radius / orthoSize — azimuth is deliberately left alone, same as
// Default Orbit, so nothing spins) and tweens to the default framing; pressing it
// from "default" tweens back to the snapshot. Now a crosshair icon, highlighted
// amber while in the free pose (user 2026-06-14). Snapshot is transient component
// state, never persisted.
function CameraPoseToggle() {
  const [freePose, setFreePose] = useState<{
    elevationDeg: number;
    radius: number;
    orthoSize: number;
    projection: "perspective" | "orthographic";
    fov: number;
  } | null>(null);
  const atDefault = freePose !== null;
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      className={cn(
        atDefault
          ? "bg-foreground/10 text-foreground/80 hover:bg-foreground/20"
          : "bg-amber-300 text-black hover:bg-amber-300/90",
      )}
      title={
        atDefault
          ? "Return to the pose you were at before snapping to default"
          : "Snap to the default orbit framing (remembers your current pose)"
      }
      aria-label={atDefault ? "Return to your free pose" : "Snap to default orbit framing"}
      aria-pressed={!atDefault}
      onClick={() => {
        const s = useSceneStore.getState();
        if (atDefault && freePose) {
          // Return to the free pose: projection + FOV + framing, all as they were.
          // tweenProjectionTo first so the orbit tween captures the matched orthoSize
          // as its start and ramps to the snapshot value without a jump.
          if (s.cameraMode !== "orbit") s.setCameraMode("orbit");
          if (s.projection !== freePose.projection) tweenProjectionTo(freePose.projection);
          s.setCameraIntent({ fov: freePose.fov });
          tweenOrbitTowards(freePose.elevationDeg, freePose.radius, freePose.orthoSize);
          setFreePose(null);
        } else {
          // Snap to the full page-load default: projection + FOV + framing (user
          // 2026-06-14). Snapshot first so "free" can restore exactly what was here.
          setFreePose({
            elevationDeg: s.orbit.elevationDeg,
            radius: s.orbit.radius,
            orthoSize: s.orthoSize,
            projection: s.projection,
            fov: s.cameraIntent.fov,
          });
          if (s.projection !== DEFAULT_PROJECTION) tweenProjectionTo(DEFAULT_PROJECTION);
          s.setCameraIntent({ fov: DEFAULT_INTENT.fov });
          tweenOrbitToDefault();
        }
      }}
    >
      <Crosshair className="size-3.5" />
    </Button>
  );
}

// Atmosphere header action (user 2026-06-07): master on/off for the whole
// section — fog AND ground haze together. Checked while either is on; the
// individual switches inside the section still control each independently.
function AtmosphereToggle() {
  const fogOn = useSceneStore((s) => s.fog.enabled);
  const hazeOn = useSceneStore((s) => s.haze.enabled);
  const setFog = useSceneStore((s) => s.setFog);
  const setHaze = useSceneStore((s) => s.setHaze);
  return (
    <Switch
      checked={fogOn || hazeOn}
      onCheckedChange={(v) => {
        setFog({ enabled: v });
        setHaze({ enabled: v });
      }}
      title="Toggle fog + ground haze together"
      aria-label="Toggle atmosphere"
    />
  );
}

// Quality tier select — the primary Performance control.
function PerfReadout() {
  const qualityTier = useSceneStore((s) => s.qualityTier);
  const setQualityTier = useSceneStore((s) => s.setQualityTier);
  const setStars = useSceneStore((s) => s.setStars);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-foreground/70 w-14 shrink-0">quality</span>
      <Select
        value={qualityTier}
        onValueChange={(v) => {
          const tier = v as QualityTier;
          setQualityTier(tier);
          setStars({ count: QUALITY_TIERS[tier].starCount });
        }}
      >
        <SelectTrigger
          size="sm"
          className="bg-background/50 text-foreground hover:bg-background/60 w-full"
        >
          <SelectValue placeholder="tier" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(QUALITY_TIERS) as QualityTier[]).map((t) => (
            <SelectItem key={t} value={t}>
              {QUALITY_TIERS[t].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Adaptive quality (header toggle) — auto-fit tier + radius for this GPU on enable,
// then dynamic DPR regression to hold framerate. Drives AdaptiveQuality (the
// ?adaptive URL just sets it). Off by default; verify on real hardware first.
function AdaptiveGroup() {
  const adaptive = useSceneStore((s) => s.adaptive);
  const setAdaptive = useSceneStore((s) => s.setAdaptive);
  return (
    <SubGroup
      label="Adaptive quality"
      action={
        <Switch
          checked={adaptive}
          onCheckedChange={(v) => setAdaptive(v)}
          title="Auto-pick the quality tier + render radius for this GPU, then step DPR down to hold framerate. Verify on real hardware."
        />
      }
    >
      <div className="text-foreground/40 text-[10px]">
        Device-fit tier + radius on enable, then dynamic DPR to hold fps. Strong GPUs stay full.
      </div>
    </SubGroup>
  );
}

// Stats — header switch shows the detailed on-screen overlay (PerfOverlay: boot
// timeline, long tasks, last gen); the body is the live readout grid.
// Stats — in-panel live readout grid. The detailed FLOATING overlay (boot
// timeline · long tasks · last gen) is the section header's "stats" option.
function StatsGroup() {
  const perf = useSceneStore((s) => s.perf);
  const qualityTier = useSceneStore((s) => s.qualityTier);
  const dprCap = useSceneStore((s) => s.dprCap);
  const tierCfg = QUALITY_TIERS[qualityTier];
  const fpsColor =
    perf.fps >= 55 ? "text-emerald-300" : perf.fps >= 35 ? "text-amber-300" : "text-rose-400";
  return (
    <SubGroup label="Stats">
      <div className="text-foreground/40 text-[10px]">
        Live readout. Set the header to “stats” for the floating overlay (+ boot timeline · long tasks).
      </div>
      <div className="text-foreground/70 grid grid-cols-[5rem_1fr] gap-1 font-mono text-xs">
        <div>dpr cap</div>
        <div className="tabular-nums">
          {dprCap ?? tierCfg.dprMax}
          {dprCap == null ? " (auto)" : ""}
        </div>
        <div>fps</div>
        <div className={`tabular-nums ${fpsColor}`}>{Math.round(perf.fps)}</div>
        <div>triangles</div>
        <div className="tabular-nums">{perf.triangles.toLocaleString()}</div>
        <div>draw calls</div>
        <div className="tabular-nums">{perf.calls}</div>
        <div>geometries</div>
        <div className="tabular-nums">{perf.geometries}</div>
        <div>textures</div>
        <div className="tabular-nums">{perf.textures}</div>
      </div>
    </SubGroup>
  );
}
