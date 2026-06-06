"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  useSceneStore,
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
  AppWindow,
  Bug,
  Building,
  Building2,
  Camera,
  Check,
  CloudFog,
  Contrast,
  Copy,
  Gauge,
  Home,
  Hotel,
  Info,
  LayoutGrid,
  Map as MapIcon,
  Moon,
  MoonStar,
  Orbit as OrbitIcon,
  Radio,
  RadioTower,
  RotateCcw,
  Route,
  Save,
  Search,
  Settings,
  Sparkles,
  Sprout,
  Stars,
  Sun,
  TowerControl,
  Undo2,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RangeSlider, ValueSlider } from "@/components/ui/value-slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { DistrictsSection } from "@/components/ui/DistrictsPanel";
import { RoadsSection, LodSection, CityDetailsSection } from "@/components/ui/RoadsPanel";
import {
  setCameraTab,
  currentCameraTab,
  tweenOrbitToDefault,
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
  { value: "grey", icon: Contrast, label: "Grey" },
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
const DEG2RAD = Math.PI / 180;


function fmt(n: number, p = 2) {
  return n.toFixed(p);
}

// Settings search. Each accordion section carries hidden keywords so a query can
// surface a control filed under a non-obvious section label — e.g. the tensor
// field toggle lives under "Debug View", not "Roads". Matching is AND-over-tokens
// against label + value + keywords; matching sections auto-expand while searching.
const SETTINGS_SECTIONS: { value: string; label: string; keywords: string }[] = [
  {
    value: "pose",
    label: "Camera",
    keywords: "position rotation fov projection orthographic perspective look at orient pose lens",
  },
  {
    value: "orbit",
    label: "Orbit",
    keywords: "elevation azimuth radius spin speed pause center focal auto rotate",
  },
  { value: "districts", label: "Districts", keywords: "shells borders outline color region zones" },
  {
    value: "roads",
    label: "Roads",
    keywords:
      "highways arterials streets traffic cars headlights taillights planning tier ribbons network",
  },
  {
    value: "city-details",
    label: "City Details",
    keywords: "shape circle square scale size buildings count footprint",
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
  { value: "windows", label: "Anti-Aliasing", keywords: "aa msaa samples smoothing jaggies moire" },
  {
    value: "window-profiles",
    label: "Buildings",
    keywords: "windows lit ratio width range min max size flicker brightness emissive profiles glow building",
  },
  {
    value: "intro",
    label: "Intro",
    keywords: "wake reveal duration streetlight stars speed animation startup",
  },
  { value: "live", label: "Live readout", keywords: "position rotation fov debug telemetry" },
  { value: "seed", label: "Seed", keywords: "reroll random refresh regenerate city" },
  { value: "perf", label: "Performance", keywords: "fps frame rate draw calls monitor gpu" },
  {
    value: "debug",
    label: "Debug View",
    keywords:
      "render modes wireframe hidden tensor field flow visualization overlay building tint ground",
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
    cameraIntent,
    cameraLive,
    setCameraIntent,
    resetCamera,
    saveCurrentAsDefault,
    revertToSaved,
    hasSavedConfig,
  } = useSceneStore();
  const orbitRestoreSet = useSceneStore((s) => s.orbitRestore !== null);

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
        className="bg-popover text-foreground/85 border-foreground/10 active:bg-foreground/5 grey:bg-popover/70 grey:backdrop-blur-md pointer-events-auto fixed top-3 right-3 z-30 flex size-11 items-center justify-center rounded-full border shadow-lg"
        title="Show settings (H)"
        aria-label="Show settings"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          ⚙
        </span>
      </button>
    );
  }

  const flying = cameraMode === "fly";
  const orbiting = cameraMode === "orbit";
  const locked = flying || orbiting;
  const modeTab = currentCameraTab(cameraMode, orbitRestoreSet);
  const livePos = cameraLive.position;
  const liveRotDeg: Vec3 = [
    cameraLive.rotation[0] * RAD2DEG,
    cameraLive.rotation[1] * RAD2DEG,
    cameraLive.rotation[2] * RAD2DEG,
  ];
  const intentRotDeg: Vec3 = [
    cameraIntent.rotation[0] * RAD2DEG,
    cameraIntent.rotation[1] * RAD2DEG,
    cameraIntent.rotation[2] * RAD2DEG,
  ];

  const searching = query.trim().length > 0;
  const matchedValues = SETTINGS_SECTIONS.filter((s) => matchSection(query, s)).map((s) => s.value);
  const shownSections = searching ? new Set(matchedValues) : null;
  const openValues = searching ? matchedValues : openSections;
  const show = (value: string) => !shownSections || shownSections.has(value);

  return (
    <div
      className="border-foreground/10 bg-popover text-foreground grey:bg-popover/70 grey:backdrop-blur-md pointer-events-auto fixed top-0 right-0 bottom-0 z-20 flex h-dvh max-h-dvh max-w-full flex-col border-l shadow-2xl"
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
            <HeaderPauseButton tab={modeTab} />
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
            <Section value="pose" icon={Camera} label="Camera" hidden={!show("pose")}>
              <PoseSection
                locked={locked}
                flying={flying}
                cameraIntent={cameraIntent}
                intentRotDeg={intentRotDeg}
                setCameraIntent={setCameraIntent}
              />
            </Section>

            <Section value="orbit" icon={OrbitIcon} label="Orbit" hidden={!show("orbit")}>
              <OrbitSection />
            </Section>

            <Section value="districts" icon={MapIcon} label="Districts" hidden={!show("districts")}>
              <DistrictsSection />
            </Section>
            <Section value="roads" icon={Route} label="Roads" hidden={!show("roads")}>
              <RoadsSection />
              <TrafficSection />
              <LodSection />
            </Section>

            <Section
              value="city-details"
              icon={Info}
              label="City Details"
              hidden={!show("city-details")}
            >
              <CityDetailsSection />
            </Section>

            <Section value="stars" icon={Stars} label="Stars" hidden={!show("stars")}>
              <StarsSection />
            </Section>

            <Section value="moon" icon={Moon} label="Moon" hidden={!show("moon")}>
              <MoonSection />
            </Section>

            <Section value="fog" icon={CloudFog} label="Atmosphere" hidden={!show("fog")}>
              <FogSection />
            </Section>

            <Section
              value="windows"
              icon={AppWindow}
              label="Anti-Aliasing"
              hidden={!show("windows")}
            >
              <AntiAliasingSection />
            </Section>

            <Section
              value="window-profiles"
              icon={Building2}
              label="Buildings"
              hidden={!show("window-profiles")}
            >
              <WindowsSection />
            </Section>

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
                  className="h-6 bg-amber-300 px-2 text-xs text-black hover:bg-amber-300/90"
                  onClick={() => useSceneStore.getState().playAllIntros()}
                >
                  ▶ play
                </Button>
              }
            >
              <IntroSection />
            </Section>

            <Section value="live" icon={Radio} label="Live readout" hidden={!show("live")}>
              <div className="text-foreground/70 grid grid-cols-[5rem_1fr] gap-1 font-mono text-xs">
                <div>position</div>
                <div className="tabular-nums">
                  {fmt(livePos[0])} {fmt(livePos[1])} {fmt(livePos[2])}
                </div>
                <div>rotation°</div>
                <div className="tabular-nums">
                  {fmt(liveRotDeg[0], 1)} {fmt(liveRotDeg[1], 1)} {fmt(liveRotDeg[2], 1)}
                </div>
                <div>fov</div>
                <div className="tabular-nums">{fmt(cameraLive.fov)}</div>
              </div>
            </Section>

            <Section value="seed" icon={Sprout} label="Seed" hidden={!show("seed")}>
              <SeedRow />
            </Section>

            <Section value="perf" icon={Gauge} label="Performance" hidden={!show("perf")}>
              <PerfReadout />
            </Section>

            <Section value="debug" icon={Bug} label="Debug View" hidden={!show("debug")}>
              <DebugSection />
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

function PoseSection({
  locked,
  flying,
  cameraIntent,
  intentRotDeg,
  setCameraIntent,
}: {
  locked: boolean;
  flying: boolean;
  cameraIntent: ReturnType<typeof useSceneStore.getState>["cameraIntent"];
  intentRotDeg: Vec3;
  setCameraIntent: ReturnType<typeof useSceneStore.getState>["setCameraIntent"];
}) {
  return (
    <>
      <ProjectionRow />
      <FovOrSizeSlider />

      <Vec3Header />
      <Vec3Input
        label="position"
        value={cameraIntent.position}
        disabled={locked}
        onChange={(position) => setCameraIntent({ position })}
      />

      <div className="flex items-center justify-between">
        <span className="text-foreground/40 text-xs tracking-wide uppercase">orient by</span>
        <div className="flex gap-1">
          {(["lookAt", "rotation"] as const).map((o) => (
            <Button
              key={o}
              variant="secondary"
              size="sm"
              disabled={locked}
              onClick={() => setCameraIntent({ orient: o })}
              className={cn(
                cameraIntent.orient === o
                  ? "bg-foreground/25 text-foreground hover:bg-foreground/25"
                  : "bg-foreground/5 text-foreground/60 hover:bg-foreground/15",
              )}
            >
              {o}
            </Button>
          ))}
        </div>
      </div>

      <Vec3Input
        label="lookAt"
        value={cameraIntent.lookAt}
        disabled={locked || cameraIntent.orient !== "lookAt"}
        onChange={(lookAt) => setCameraIntent({ lookAt, orient: "lookAt" })}
      />

      <Vec3Input
        label="rotation"
        hint="degrees"
        step={1}
        value={intentRotDeg}
        disabled={locked || cameraIntent.orient !== "rotation"}
        onChange={(rotDeg) =>
          setCameraIntent({
            rotation: [rotDeg[0] * DEG2RAD, rotDeg[1] * DEG2RAD, rotDeg[2] * DEG2RAD],
            orient: "rotation",
          })
        }
      />

      {flying ? <FlySpeedSlider /> : null}
    </>
  );
}

function OrbitSection() {
  const orbit = useSceneStore((s) => s.orbit);
  const setOrbit = useSceneStore((s) => s.setOrbit);
  return (
    <>
      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => tweenOrbitToDefault()}
          title="Tween the orbit back to its default framing"
          className="bg-purple-500/20 text-purple-200 hover:bg-purple-500/30"
        >
          Default Orbit
        </Button>
        <FocalIndicatorToggle />
      </div>
      <ValueSlider
        label="speed °/s"
        value={Number((360 / Math.max(1, orbit.periodSec)).toFixed(1))}
        min={0}
        max={72}
        step={0.1}
        onChange={(dps) => setOrbit({ periodSec: 360 / Math.max(0.1, dps) })}
      />
      <ValueSlider
        label="radius"
        value={orbit.radius}
        min={50}
        max={5000}
        step={5}
        onChange={(radius) => setOrbit({ radius })}
      />
      <ValueSlider
        label="elev°"
        value={orbit.elevationDeg}
        min={0.01}
        max={90}
        step={0.5}
        onChange={(elevationDeg) => setOrbit({ elevationDeg })}
      />
      <ValueSlider
        label="azim°"
        value={orbit.azimuthDeg}
        min={0}
        max={360}
        step={1}
        onChange={(azimuthDeg) => setOrbit({ azimuthDeg })}
      />
      <ValueSlider
        label="focal y"
        value={orbit.lookAtY}
        min={-200}
        max={2000}
        step={1}
        onChange={(lookAtY) => setOrbit({ lookAtY })}
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

function AntiAliasingSection() {
  const wa = useSceneStore((s) => s.windowAA);
  const setWindowAA = useSceneStore((s) => s.setWindowAA);
  return (
    <>
      <div className="text-foreground/55 text-[10px] tracking-wide uppercase">Anti-alias / LOD</div>
      <ValueSlider
        label="edge AA"
        value={wa.edge}
        min={0.25}
        max={3}
        step={0.05}
        onChange={(edge) => setWindowAA({ edge })}
      />
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
      <SubHeader label="Windows" />
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
        Pane fill on curtain towers. 0.99 keeps hairline mullions; exactly 1.0 merges each lit
        floor into one continuous window. 1 in 5 curtain towers rolls full regardless.
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
        Each building rolls one window width and height from the ranges (all its windows match);
        the two rolls are independent.
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
        Glass-to-cell fraction per building style. Each building rolls one width and one height
        from its archetype&apos;s ranges (all its windows match). Grid spacing is baked per
        archetype.
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
          title="Fog colour (also drives the scene background)"
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

      <SubHeader label="Windows" />
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

      <SubHeader label="Stars" />
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

      <SubHeader label="Streetlights" />
      <ValueSlider
        label="duration"
        value={intro.streetlightDurationSec}
        min={0.5}
        max={120}
        step={0.5}
        onChange={(streetlightDurationSec) => setStreetlightDuration(streetlightDurationSec)}
      />
    </>
  );
}

function SubHeader({ label }: { label: string }) {
  return (
    <div className="text-foreground/55 mt-1 border-t border-white/10 pt-2 text-[11px] font-medium tracking-wide uppercase">
      {label}
    </div>
  );
}

const TINT_MODES = ["off", "district", "landuse", "archetype", "depth", "height"] as const;
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
  const tint = useSceneStore((s) => s.debug.buildingTint);
  const renderModes = useSceneStore((s) => s.debug.renderModes);
  const showTensorField = useSceneStore((s) => s.debug.showTensorField);
  const setBuildingTint = useSceneStore((s) => s.setBuildingTint);
  const setRenderMode = useSceneStore((s) => s.setRenderMode);
  const setAllRenderModes = useSceneStore((s) => s.setAllRenderModes);
  const setShowTensorField = useSceneStore((s) => s.setShowTensorField);
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
      <SubHeader label="City shape" />
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
        reveals/hides the already-generated city — grow = reveal, never a re-roll. auto = each seed
        picks its shape; square = full field.
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
        Deviation scales how hard the street field bends (re-rolls on release). ×1 = the seed&apos;s
        own character; lower = calmer grids, higher = stronger warps/shears.
      </div>

      <SubHeader label="Building tint" />
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

      <SubHeader label="Render modes" />
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

      <SubHeader label="Tensor field" />
      <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
        <span className="text-foreground/70">grain direction overlay</span>
        <Switch checked={showTensorField} onCheckedChange={setShowTensorField} />
      </label>
      <div className="text-foreground/45 text-[11px] leading-snug">
        The major-eigenvector field the roads follow — ticks coloured by grain angle.
      </div>
    </>
  );
}

function TrafficSection() {
  const traffic = useSceneStore((s) => s.traffic);
  const setTraffic = useSceneStore((s) => s.setTraffic);
  return (
    <>
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-foreground/60 text-[11px] font-medium tracking-wide uppercase">
          Traffic
        </span>
        <Switch checked={traffic.enabled} onCheckedChange={(v) => setTraffic({ enabled: v })} />
      </div>
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
    </>
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

// Pause/resume in the panel header. Contextual: in Orbit it pauses the camera
// auto-revolution (orbitPaused); in Top-down — a static pose — it freezes the
// scene animation clock (paused) so traffic / twinkle / flicker hold. Hidden in
// Fly (you're driving manually). Replaces the old per-mode detail box.
function HeaderPauseButton({ tab }: { tab: CameraTab }) {
  const orbitPaused = useSceneStore((s) => s.orbitPaused);
  const setOrbitPaused = useSceneStore((s) => s.setOrbitPaused);
  const paused = useSceneStore((s) => s.paused);
  const setPaused = useSceneStore((s) => s.setPaused);
  if (tab === "fly") return null;
  const isOrbit = tab === "orbit";
  const active = isOrbit ? orbitPaused : paused;
  const toggle = () => (isOrbit ? setOrbitPaused(!orbitPaused) : setPaused(!paused));
  const what = isOrbit ? "orbit revolution" : "scene animation";
  return (
    <Button
      size="sm"
      onClick={toggle}
      title={
        active
          ? `Resume ${what}${isOrbit ? " (Space)" : ""}`
          : `Pause ${what}${isOrbit ? " (Space)" : ""}`
      }
      aria-label={active ? `Resume ${what}` : `Pause ${what}`}
      className={cn(
        "min-w-[5.5rem] gap-1.5 font-medium",
        active
          ? "bg-emerald-400 text-black hover:bg-emerald-400/90"
          : "bg-sky-400 text-black hover:bg-sky-400/90",
      )}
    >
      {active ? "▶ Resume" : "⏸ Pause"}
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
    <div className="flex flex-col gap-1.5">
      <span className="text-foreground/40 text-xs tracking-wide uppercase">projection</span>
      <Tabs
        value={projection}
        onValueChange={(v) => tweenProjectionTo(v as "perspective" | "orthographic")}
      >
        <TabsList className="w-full">
          <TabsTrigger value="perspective">Perspective</TabsTrigger>
          <TabsTrigger value="orthographic">Orthographic</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
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
        onChange={setOrthoSize}
      />
    );
  }
  return (
    <ValueSlider
      label="fov"
      value={fov}
      min={5}
      max={150}
      step={1}
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

function FocalIndicatorToggle() {
  const show = useSceneStore((s) => s.showFocalIndicator);
  const setShow = useSceneStore((s) => s.setShowFocalIndicator);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => setShow(!show)}
      title="Toggle the screen-space focal-point crosshair"
      className={cn(
        show
          ? "bg-sky-400 text-black hover:bg-sky-400"
          : "bg-foreground/10 text-foreground/80 hover:bg-foreground/20",
      )}
    >
      focal point {show ? "[on]" : "[off]"}
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

function Vec3Header() {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-16 shrink-0" />
      {(["X", "Y", "Z"] as const).map((axis) => (
        <span
          key={axis}
          className="text-foreground/40 flex-1 text-center text-[11px] font-medium tracking-wider uppercase"
        >
          {axis}
        </span>
      ))}
    </div>
  );
}

function Vec3Input({
  label,
  value,
  disabled,
  hint,
  step = 0.5,
  onChange,
}: {
  label: string;
  value: Vec3;
  disabled: boolean;
  hint?: string;
  step?: number;
  onChange: (v: Vec3) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="text-foreground/60 flex w-16 shrink-0 flex-col">
        <span>{label}</span>
        {hint ? <span className="text-foreground/35 text-[10px]">{hint}</span> : null}
      </div>
      {(["x", "y", "z"] as const).map((axis, i) => (
        <input
          key={axis}
          type="number"
          step={step}
          disabled={disabled}
          value={value[i]}
          onChange={(e) => {
            const v = [...value] as Vec3;
            v[i] = parseFloat(e.target.value) || 0;
            onChange(v);
          }}
          className="border-foreground/15 bg-background/60 text-foreground w-0 min-w-0 flex-1 rounded border px-1.5 py-1 tabular-nums disabled:opacity-50"
        />
      ))}
    </div>
  );
}

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

function PerfReadout() {
  const perf = useSceneStore((s) => s.perf);
  const qualityTier = useSceneStore((s) => s.qualityTier);
  const setQualityTier = useSceneStore((s) => s.setQualityTier);
  const setStars = useSceneStore((s) => s.setStars);
  const fpsHud = useSceneStore((s) => s.fpsHud);
  const setFpsHud = useSceneStore((s) => s.setFpsHud);
  const tierCfg = QUALITY_TIERS[qualityTier];
  const fpsColor =
    perf.fps >= 55 ? "text-emerald-300" : perf.fps >= 35 ? "text-amber-300" : "text-rose-400";
  return (
    <div className="flex flex-col gap-2">
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
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground/70 w-14 shrink-0">fps badge</span>
        <Switch checked={fpsHud} onCheckedChange={setFpsHud} />
      </div>
      <div className="text-foreground/70 grid grid-cols-[5rem_1fr] gap-1 font-mono text-xs">
        <div>dpr cap</div>
        <div className="tabular-nums">{tierCfg.dprMax}</div>
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
    </div>
  );
}
