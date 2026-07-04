"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSceneStore, type Vec3 } from "@/lib/state/sceneStore";
import { randomSeedForReroll } from "@/lib/seed/rng";
import { cn, isTypingTarget } from "@/lib/utils";
import { useIdle } from "@/lib/useIdle";
import {
  Bug,
  Building2,
  Camera,
  Check,
  CloudFog,
  Contrast,
  Copy,
  Gauge,
  Info,
  Link2,
  Map as MapIcon,
  Moon,
  MoonStar,
  Orbit as OrbitIcon,
  MapPin,
  Rotate3d,
  Route,
  RulerDimensionLine,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Stars,
  Sun,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CAMERA_MODELS, getCameraModelMeta } from "@/components/scene/camera-models/catalog";
import { buildViewLink } from "@/lib/scene/viewLink";
import type { CameraModelId } from "@/lib/state/sceneStore";
import { Accordion } from "@/components/ui/accordion";
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
  CityDetailsSection,
  RoadHighlightAction,
} from "@/components/ui/RoadsPanel";
import { fmt, RAD2DEG, Section, SubGroup } from "@/components/ui/panels/shared";
import {
  PoseSection,
  CameraHeaderActions,
  PinPlaneReadout,
  focalLengthMm,
  lensName,
} from "@/components/ui/panels/PosePanel";
import { OrbitSection, OrbitHeaderActions } from "@/components/ui/panels/OrbitPanel";
import { StarsSection } from "@/components/ui/panels/StarsPanel";
import { BuildingsSection } from "@/components/ui/panels/BuildingsPanel";
import { MoonSection } from "@/components/ui/panels/MoonPanel";
import { FogSection, AtmosphereToggle } from "@/components/ui/panels/AtmospherePanel";
import { IntroSection } from "@/components/ui/panels/IntroPanel";
import {
  DebugSection,
  StreetlightsGroup,
  TrafficGroup,
  FlightsGroup,
} from "@/components/ui/panels/DebugPanel";
import {
  PerfReadout,
  AdaptiveGroup,
  AntiAliasingSection,
  ResolutionSection,
  LevelOfDetailSection,
  StatsGroup,
  PerfDisplayToggle,
} from "@/components/ui/panels/PerformancePanel";

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
    clearSavedConfig,
  } = useSceneStore();
  const showPinPlane = useSceneStore((s) => s.debug.showPinPlane);
  const cameraModel = useSceneStore((s) => s.cameraModel);
  const setCameraModel = useSceneStore((s) => s.setCameraModel);
  const setCameraMode = useSceneStore((s) => s.setCameraMode);

  const hidden = useSceneStore((s) => s.panelHidden);
  const setHidden = useSceneStore((s) => s.setPanelHidden);
  const [savedExists, setSavedExists] = useState(() => hasSavedConfig());
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<string[]>([]);
  const captureMode = useSceneStore((s) => s.captureMode);
  // Panel never renders during SSR (starts hidden), so reading localStorage in
  // the initializer can't cause a hydration mismatch.
  const [panelWidth, setPanelWidth] = useState<number>(readStoredPanelWidth);
  const idle = useIdle(); // fade the gear button when the user goes idle (screensaver feel)

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
      if (e.key === "h" || e.key === "H") {
        const s = useSceneStore.getState();
        s.setPanelHidden(!s.panelHidden);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (captureMode) return null;

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        className={cn(
          "bg-popover/70 text-foreground/85 border-foreground/10 active:bg-foreground/5 fixed top-3 right-3 z-20 flex size-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-opacity duration-700",
          idle ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100",
        )}
        title="Show settings (H)"
        aria-label="Show settings"
      >
        <Settings className="size-5" />
      </button>
    );
  }

  const flying = cameraMode === "fly";
  // Stage B: cameraModel is the single camera selector (map/drift/turntable/topdown/fly).
  // cameraMode is kept in sync (fly → "fly", else "orbit") for the orbit models' self-gate
  // and the framing helpers; Fly + Top-down are now models in the registry.
  const activeCamera = cameraModel;
  const pickCamera = (id: string | null) => {
    if (id == null) return;
    setCameraModel(id as CameraModelId);
    setCameraMode(id === "fly" ? "fly" : "orbit");
    // Land in the model's transport default (Map paused on its still pose; Drift /
    // Turntable auto-play). The shared orbitPaused flag can't encode per-model
    // defaults on its own, so each switch applies the active model's.
    useSceneStore
      .getState()
      .setOrbitPaused(getCameraModelMeta(id as CameraModelId).startsPaused ?? false);
  };
  const cameraCaption = getCameraModelMeta(cameraModel).character;
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
      className="border-foreground/10 bg-popover/70 text-foreground pointer-events-auto fixed top-0 right-0 bottom-0 z-40 flex h-dvh max-h-dvh max-w-full flex-col border-l shadow-2xl backdrop-blur-md"
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
        {/* One "Camera" picker (Stage A) — collapses the old Fly/Orbit/Top-down tabs and
            the Map/Drift/Turntable selector into a single dropdown over the existing
            cameraMode + cameraModel. See wiki plan-unify-camera-selector. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-foreground/55 text-[10px] font-medium tracking-wide uppercase">
            Camera
          </span>
          <Select value={activeCamera} onValueChange={pickCamera}>
            <SelectTrigger className="w-full" aria-label="Camera">
              <SelectValue>
                {(value) => (value ? getCameraModelMeta(value as CameraModelId).label : "")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[...CAMERA_MODELS]
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <span className="text-foreground/50 text-[11px] leading-snug">{cameraCaption}</span>
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
            {/* Section order (2026-06-28): Camera, Orbit, Intro, Roads, Buildings,
                Population, City Details*, Stars, Moon, Atmosphere, Debug, Performance.
                (*unlisted — kept with the city group.) */}
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

                    <div className="text-foreground/40 text-[10px] uppercase">lens</div>
                    <div className="text-right tabular-nums">
                      {focalLengthMm(cameraLive.fov)} mm
                    </div>
                    <div className="text-foreground/50 col-span-2 pl-3">
                      {lensName(focalLengthMm(cameraLive.fov))}
                    </div>
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

            {/* Intro moved below Camera + Orbit (user 2026-06-28). */}
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

            {/* Roads (user 2026-06-08): each block is its own expandable
                sub-group — Highlight (tri-switch on header), Streetlights,
                Traffic, Flights (#67) — all collapsed by default. (Distance LOD
                moved to Performance → Level of Detail, user 2026-06-13.) */}
            <Section value="roads" icon={Route} label="Roads" hidden={!show("roads")}>
              <SubGroup label="Highlight" action={<RoadHighlightAction />}>
                <RoadHighlightTiers />
              </SubGroup>
              <StreetlightsGroup />
              <TrafficGroup />
              <FlightsGroup />
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
              No settings match &quot;{query.trim()}&quot;.
            </p>
          )}
        </div>
      </ScrollArea>

      {/* Sticky footer — icon-only actions; labels live in the tooltips. */}
      <TooltipProvider>
        <div className="border-foreground/10 flex shrink-0 flex-wrap items-center gap-2 border-t px-4 pt-3 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <FooterAction
              label="Reset All"
              onClick={() => resetCamera()}
              className="text-rose-400 hover:bg-rose-400/10 hover:text-rose-300"
            >
              <RotateCcw className="size-4" />
            </FooterAction>
            {savedExists && (
              <FooterAction
                label="Revert to Saved"
                onClick={() => revertToSaved()}
                className="text-amber-400 hover:bg-amber-400/10 hover:text-amber-300"
              >
                <Undo2 className="size-4" />
              </FooterAction>
            )}
            {savedExists && (
              <FooterAction
                label="Clear Saved"
                onClick={() => {
                  clearSavedConfig();
                  setSavedExists(false);
                }}
                className="text-foreground/55 hover:bg-foreground/10 hover:text-foreground/80"
              >
                <Trash2 className="size-4" />
              </FooterAction>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <CopyViewLinkButton />
            <CopyButton />
            <FooterAction
              label="Save Settings"
              variant="default"
              onClick={() => {
                saveCurrentAsDefault();
                setSavedExists(true);
              }}
              className="bg-emerald-400 text-black hover:bg-emerald-400/90"
            >
              <Save className="size-4" />
            </FooterAction>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}

// One footer icon button + its hover/focus tooltip (action name only —
// user 2026-07-02). base-ui's Trigger merges onto the Button via `render`
// (same idiom as the gauge icons above) so we don't nest <button> in
// <button>. aria-label mirrors the tooltip text.
function FooterAction({
  label,
  onClick,
  className,
  variant = "ghost",
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  variant?: "ghost" | "default" | "secondary";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size="icon"
            aria-label={label}
            onClick={onClick}
            className={className}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
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
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="secondary"
            size="icon"
            aria-label="Copy Settings"
            onClick={onCopy}
            className="bg-foreground/10 text-foreground hover:bg-foreground/20"
          >
            {copyState === "copied" ? (
              <Check className="size-4 text-emerald-400" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
        }
      />
      <TooltipContent side="top">
        {copyState === "copied" ? "Copied!" : "Copy Settings"}
      </TooltipContent>
    </Tooltip>
  );
}

// Google-Maps-style "link to what I'm looking at": a ?seed=&cam= URL of the
// LIVE camera (lib/scene/viewLink). Same copied-feedback idiom as CopyButton.
function CopyViewLinkButton() {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const onCopy = () => {
    void navigator.clipboard.writeText(buildViewLink());
    setCopyState("copied");
    setTimeout(() => setCopyState("idle"), 1200);
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="secondary"
            size="icon"
            aria-label="Copy View Link"
            onClick={onCopy}
            className="bg-foreground/10 text-foreground hover:bg-foreground/20"
          >
            {copyState === "copied" ? (
              <Check className="size-4 text-emerald-400" />
            ) : (
              <Link2 className="size-4" />
            )}
          </Button>
        }
      />
      <TooltipContent side="top">
        {copyState === "copied" ? "Copied!" : "Copy View Link"}
      </TooltipContent>
    </Tooltip>
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
        onClick={() => setSeed(randomSeedForReroll())}
        title="Reroll seed"
        className="bg-foreground/10 text-foreground hover:bg-foreground/20"
      >
        Reroll
      </Button>
    </div>
  );
}

// ValueSlider moved to components/ui/value-slider.tsx (shared with RoadsPanel,
// upgraded with a base-ui number-field stepper + label scrubbing).
// Vec3Header/Vec3Input removed with the manual camera-intent inputs (2026-06-07).
