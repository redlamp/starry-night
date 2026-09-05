"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSceneStore, type Vec3 } from "@/lib/state/sceneStore";
import { randomSeedForReroll } from "@/lib/seed/rng";
import { cn, isTypingTarget } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useIdle } from "@/lib/useIdle";
import { IconTip } from "@/components/ui/columns/EntityColumns";
import { CompassHudSlot } from "@/components/ui/TopDownCompassRose";
import {
  Bug,
  Building2,
  Camera,
  Check,
  CloudFog,
  Copy,
  ExternalLink,
  FlaskConical,
  Gauge,
  Globe,
  Helicopter,
  Info,
  Link2,
  Map as MapIcon,
  Moon,
  Orbit as OrbitIcon,
  MapPin,
  Rotate3d,
  Route,
  RulerDimensionLine,
  RotateCcw,
  Save,
  Search,
  Settings,
  Lightbulb,
  Sparkles,
  Stars,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CAMERA_MODELS, getCameraModelMeta } from "@/components/scene/camera-models/catalog";
import { buildViewLink } from "@/lib/scene/viewLink";
import { cameraCommand } from "@/lib/scene/cameraCommand";
import type { CameraModelId } from "@/lib/state/sceneStore";
import { Accordion } from "@/components/ui/accordion";
import { GLASS } from "@/components/ui/FloatingPanel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  NamingRegionRow,
} from "@/components/ui/RoadsPanel";
import { fmt, RAD2DEG, Section, SubGroup } from "@/components/ui/panels/shared";
import {
  PoseSection,
  CameraHeaderActions,
  PinPlaneReadout,
  focalLengthMm,
  lensName,
} from "@/components/ui/panels/PosePanel";
import {
  OrbitSection,
  OrbitHeaderActions,
  DriftSection,
  DriftHeaderActions,
} from "@/components/ui/panels/OrbitPanel";
import { LightsSection, LightsHeaderActions } from "@/components/ui/panels/LightsPanel";
import { StarsSection } from "@/components/ui/panels/StarsPanel";
import { BuildingsSection } from "@/components/ui/panels/BuildingsPanel";
import { MoonSection } from "@/components/ui/panels/MoonPanel";
import { FogSection, AtmosphereToggle } from "@/components/ui/panels/AtmospherePanel";
import { IntroSection } from "@/components/ui/panels/IntroPanel";
import {
  DebugSection,
  WorldSection,
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

// The drift transport as floating chrome (user 2026-07-16): a round button left of the
// settings gear, mirroring exactly what Space does (cameraCommand.toggleDrift's
// three-way). Icon = what the camera is doing: Rotate3d = manual camera (no drift),
// Helicopter = a drift flight is up (commanded mode OR an idle-drift takeoff). Fades
// with the rest of the chrome on idle; v3-only (the other models have no drift).
function DriftTransportButton({ idle }: { idle: boolean }) {
  const isV3 = useSceneStore((s) => s.cameraModel === "snv3");
  const driftMode = useSceneStore((s) => s.driftMode);
  const setDriftMode = useSceneStore((s) => s.setDriftMode);
  const driftFlying = useSceneStore((s) => s.driftFlying);
  if (!isV3) return null;
  const on = driftMode || driftFlying;
  const label = on ? "Stop Drift" : "Start Drift";
  return (
    <IconTip label={label}>
      <button
        onClick={() => (cameraCommand.toggleDrift ?? (() => setDriftMode(!driftMode)))()}
        aria-label={label}
        aria-pressed={on}
        className={cn(
          "flex size-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-[opacity,background-color,color] duration-700 motion-reduce:transition-none",
          on
            ? "bg-primary text-primary-foreground border-transparent"
            : "bg-popover/70 text-foreground/85 border-foreground/10 active:bg-foreground/5",
          // Fades with the rest of the chrome even while a flight is up (user
          // 2026-07-16) — during a drift you're watching the city, not the buttons.
          idle ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100",
        )}
      >
        {on ? <Helicopter className="size-5" /> : <Rotate3d className="size-5" />}
      </button>
    </IconTip>
  );
}

function copyConfigToClipboard() {
  const s = useSceneStore.getState();
  const snippet = JSON.stringify(s.copyableConfig(), null, 2);
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(snippet);
  }
}

// Settings search. Each accordion section carries hidden keywords so a query can
// surface a control filed under a non-obvious section label — e.g. the tensor
// field toggle lives under "Debug View", not "Roads". Matching is AND-over-tokens
// against label + value + keywords; matching sections auto-expand while searching.
// Search spans BOTH tabs (LOOK_SECTIONS / STUDIO_SECTIONS below) — a match that
// lives in the other tab is surfaced as a small "in Studio"/"in Look" tag instead
// of a full accordion item (owner 2026-09-05, Look/Studio split).
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
      "position rotation fov projection orthographic perspective look at orient pose lens live readout telemetry default free diagram side view link",
  },
  {
    value: "orbit",
    label: "Orbit",
    keywords: "elevation azimuth compass radius distance spin speed pause center focal auto rotate",
  },
  {
    value: "drift",
    label: "Drift",
    keywords: "wander speed revolve breathe bob elevation idle delay auto flight helicopter space",
  },
  {
    value: "lights",
    label: "Lights",
    keywords:
      "light size glow gamma falloff drop off curve bezier brightness distance sprite point floor ceiling attenuation",
  },
  {
    value: "roads",
    label: "Transport",
    keywords:
      "highways arterials streets traffic cars headlights taillights planning tier ribbons network highlight flights airliner cessna corridor runway spawn",
  },
  {
    value: "window-profiles",
    label: "Buildings",
    keywords:
      "windows lit ratio width range min max size flicker brightness emissive profiles glow building facade wall color colour saturation lightness hue masonry glass debug tint highlight hover outline population district landuse archetype depth height wash",
  },
  {
    value: "population",
    label: "Population",
    keywords:
      "districts shells borders boundaries outline color region zones density heat map heatmap people residents traffic coupling estimate profile centres centers spread shoulder satellites gradient",
  },
  {
    value: "world",
    label: "World",
    keywords:
      "city shape circle square scale size buildings count footprint crop km deviation field warp shear grain tier",
  },
  {
    value: "city-details",
    label: "City Details",
    keywords:
      "seed reroll random refresh regenerate naming region street names us uk high street gate topology crossroads bypass ring radial highway arterial street counts",
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
      "render modes wireframe hidden tensor field flow visualization overlay ground tile culling cull frustum freeze grid materialise fog bounds walls boundary always show",
  },
  {
    value: "perf",
    label: "Performance",
    keywords:
      "fps frame rate draw calls monitor gpu aa msaa samples smoothing jaggies moire anti-aliasing dpr resolution pixel ratio quality tier lod level of detail distance culling tiles attenuation wash",
  },
  {
    value: "labs",
    label: "Labs",
    keywords:
      "writing lab camera lab drei lab window lab palette plan tensor tenancy layout prototype workbench pages tools external",
  },
];

// "Labs" (user 2026-07-15): the standalone workbench pages, linked from the settings
// drawer instead of app chrome (the Writing Lab button used to ride the ControlDock).
// Each opens in a NEW TAB — they are separate authoring/testing surfaces, not part of
// this page's 3D scene state.
const LAB_LINKS: { href: string; label: string }[] = [
  { href: "/writing-lab", label: "Writing Lab" },
  { href: "/camera-lab", label: "Camera Lab" },
  { href: "/drei-lab", label: "Drei Lab" },
  { href: "/window-lab", label: "Window Lab" },
  { href: "/palette", label: "Palette" },
  { href: "/plan", label: "Plan View" },
  { href: "/tensor", label: "Tensor Field" },
  // A static prototype page, not an app route — served from public/prototypes/ (moved
  // out of docs/prototypes/ so it's reachable in dev AND the Pages export); Link still
  // applies the deploy basePath. prefetch is off on every row: labs are separate
  // surfaces and the .html one isn't a route at all.
  { href: "/prototypes/tenancy-layout.html", label: "Tenancy Layout" },
];

// Look / Studio tab section order (owner 2026-09-05, decision-settings-look-studio).
// "window-profiles" (Buildings) and "perf" (Performance) appear in BOTH — each
// renders different sub-groups depending on studioMode (see BuildingsSection /
// the Performance Section body below), not duplicated section code.
const LOOK_SECTIONS = [
  "pose",
  "orbit",
  "drift",
  "lights",
  "stars",
  "moon",
  "fog",
  "window-profiles",
  "perf",
  "intro",
];
const STUDIO_SECTIONS = [
  "world",
  "roads",
  "population",
  "city-details",
  "window-profiles",
  "perf",
  "debug",
  "labs",
];

function LabsSection() {
  return (
    <div className="flex flex-col">
      {LAB_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
          className="text-foreground/80 hover:bg-foreground/10 hover:text-foreground flex items-center justify-between gap-2 rounded px-1.5 py-1.5 text-sm no-underline"
        >
          <span>{l.label}</span>
          <ExternalLink aria-hidden="true" className="text-foreground/50 size-3.5 shrink-0" />
        </Link>
      ))}
    </div>
  );
}

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
  const studioMode = useSceneStore((s) => s.studioMode);
  const setStudioMode = useSceneStore((s) => s.setStudioMode);
  const [savedExists, setSavedExists] = useState(() => hasSavedConfig());
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<string[]>([]);
  const captureMode = useSceneStore((s) => s.captureMode);
  // Panel never renders during SSR (starts hidden), so reading localStorage in
  // the initializer can't cause a hydration mismatch.
  const [panelWidth, setPanelWidth] = useState<number>(readStoredPanelWidth);
  const idle = useIdle(); // fade the gear button when the user goes idle (screensaver feel)

  // Publish the live drawer width so the entity-columns row can stop short of
  // it (EntityColumns caps its max-width against this + the gear button).
  const setSettingsPanelWidth = useSceneStore((s) => s.setSettingsPanelWidth);
  useEffect(() => {
    setSettingsPanelWidth(panelWidth);
  }, [panelWidth, setSettingsPanelWidth]);

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
      <div className="fixed top-3 right-3 z-20 flex items-center gap-1.5">
        <DriftTransportButton idle={idle} />
        {/* Compass rose between drift + settings (user 2026-07-26); its Off/Auto/On
            visibility lives in the slot (Auto rides this row's idle fade). */}
        <CompassHudSlot idle={idle} />
        <IconTip label="Show Settings">
          <button
            onClick={() => setHidden(false)}
            className={cn(
              "bg-popover/70 text-foreground/85 border-foreground/10 active:bg-foreground/5 flex size-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-opacity duration-700 motion-reduce:transition-none",
              idle ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100",
            )}
            aria-label="Show Settings"
          >
            <Settings className="size-5" />
          </button>
        </IconTip>
      </div>
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

  const activeSections = studioMode ? STUDIO_SECTIONS : LOOK_SECTIONS;
  const searching = query.trim().length > 0;
  // Search spans both tabs; only matches that live in the CURRENT tab become full
  // accordion sections (openValues/show below) — a match in the other tab surfaces
  // as a small "in Studio"/"in Look" tag instead (rendered after the accordion).
  const matchedAll = SETTINGS_SECTIONS.filter((s) => matchSection(query, s));
  const currentTabMatches = matchedAll.filter((s) => activeSections.includes(s.value));
  const otherTabMatches = matchedAll.filter((s) => !activeSections.includes(s.value));
  const shownSections = new Set(searching ? currentTabMatches.map((s) => s.value) : activeSections);
  const openValues = searching ? currentTabMatches.map((s) => s.value) : openSections;
  const show = (value: string) => shownSections.has(value);
  const orderOf = (value: string) => {
    const idx = activeSections.indexOf(value);
    return idx === -1 ? 999 : idx;
  };

  return (
    <div
      // GLASS recipe (presentation batch item 2).
      className={cn(
        "text-foreground pointer-events-auto fixed top-0 right-0 bottom-0 z-40 flex h-dvh max-h-dvh max-w-full flex-col border-l",
        GLASS,
      )}
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
            <IconTip label="Hide Settings">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setHidden(true)}
                aria-label="Hide Settings"
                className="text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
              >
                ×
              </Button>
            </IconTip>
          </div>
        </div>
        {/* Look / Studio (owner 2026-09-05, decision-settings-look-studio): Look is the
            curated viewer set; Studio adds generation/debug/labs tools. Sections shared
            by both (Buildings, Performance) show different sub-groups per mode — see
            each section body below. */}
        <div className="flex flex-col gap-1">
          <Tabs
            value={studioMode ? "studio" : "look"}
            onValueChange={(v) => setStudioMode(v === "studio")}
          >
            <TabsList className="w-full">
              <TabsTrigger value="look">Look</TabsTrigger>
              <TabsTrigger value="studio">Studio</TabsTrigger>
            </TabsList>
          </Tabs>
          {studioMode && (
            <span className="text-foreground/50 px-0.5 text-xs leading-snug">
              author tools: generation, debug, labs
            </span>
          )}
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
          <span className="text-foreground/55 text-xs font-medium tracking-wide uppercase">
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
          <span className="text-foreground/50 text-xs leading-snug">{cameraCaption}</span>
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
            {/* Every section stays mounted; `order` (CSS flex order, not DOM order) lays
                each tab's sections out per LOOK_SECTIONS / STUDIO_SECTIONS above, and
                `hidden` unmounts whatever isn't in the active tab (or doesn't match a
                search). Look: Camera, Orbit, Drift, Lights, Stars, Moon, Atmosphere,
                Buildings, Performance, Intro. Studio: World, Transport, Population,
                City Details, Buildings, Performance, Debug View, Labs. */}
            <Section
              value="pose"
              icon={Camera}
              label="Camera"
              hidden={!show("pose")}
              order={orderOf("pose")}
              action={<CameraHeaderActions />}
            >
              <PoseSection flying={flying} />
              {/* Live readout — lives with the camera controls (user 2026-06-07). */}
              <div className="border-foreground/10 border-t pt-2">
                <TooltipProvider>
                  <div className="text-foreground/70 grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-x-2 gap-y-1 font-mono text-xs">
                    {/* header row: x / y / z over the value columns */}
                    <div />
                    <div className="text-foreground/40 text-right text-xs uppercase">x</div>
                    <div className="text-foreground/40 text-right text-xs uppercase">y</div>
                    <div className="text-foreground/40 text-right text-xs uppercase">z</div>

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

                    <div className="text-foreground/40 text-xs uppercase">fov</div>
                    <div className="text-right tabular-nums">{fmt(cameraLive.fov)}</div>
                    <Tooltip>
                      <TooltipTrigger
                        render={<RulerDimensionLine className="size-3.5 justify-self-end" />}
                      />
                      <TooltipContent>distance camera → focal</TooltipContent>
                    </Tooltip>
                    <div className="text-right tabular-nums">{fmt(orbit.radius)}</div>

                    <div className="text-foreground/40 text-xs uppercase">lens</div>
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
              order={orderOf("orbit")}
              action={<OrbitHeaderActions />}
            >
              <OrbitSection />
            </Section>

            {/* Drift: own section since 2026-07-26 (was a SubGroup under Orbit). */}
            <Section
              value="drift"
              icon={Helicopter}
              label="Drift"
              hidden={!show("drift")}
              order={orderOf("drift")}
              action={<DriftHeaderActions />}
            >
              <DriftSection />
            </Section>

            {/* Intro moved below Camera + Orbit (user 2026-06-28). */}
            <Section
              value="intro"
              icon={Sparkles}
              label="Intro"
              hidden={!show("intro")}
              order={orderOf("intro")}
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

            {/* World (owner 2026-09-05, Studio-only): city shape / size / crop /
                deviation — gen inputs, moved out of Debug View to read as authoring
                controls rather than inspection tools. */}
            <Section
              value="world"
              icon={Globe}
              label="World"
              hidden={!show("world")}
              order={orderOf("world")}
            >
              <WorldSection />
            </Section>

            {/* Transport (user 2026-06-08; relabelled from "Roads" 2026-07-04 once
                Flights landed alongside the road layers): each block is its own
                expandable sub-group — Highlight (tri-switch on header), Streetlights,
                Traffic, Flights (#67) — all collapsed by default. (Distance LOD
                moved to Performance → Level of Detail, user 2026-06-13.) Internal
                section key stays "roads" — only the visible label changed. */}
            {/* Lights (#99): shared point-light sizing/brightness over distance. */}
            <Section
              value="lights"
              icon={Lightbulb}
              label="Lights"
              hidden={!show("lights")}
              order={orderOf("lights")}
              action={<LightsHeaderActions />}
            >
              <LightsSection />
            </Section>

            <Section
              value="roads"
              icon={Route}
              label="Transport"
              hidden={!show("roads")}
              order={orderOf("roads")}
            >
              <SubGroup label="Highlight" action={<RoadHighlightAction />}>
                <RoadHighlightTiers />
              </SubGroup>
              <StreetlightsGroup />
              <TrafficGroup />
              <FlightsGroup />
            </Section>

            {/* Buildings appears in both tabs — BuildingsSection itself picks the
                sub-groups per studioMode (Facade + Debug Highlight in Look; Windows +
                Hover Highlight in Studio). Placement only, one component. */}
            <Section
              value="window-profiles"
              icon={Building2}
              label="Buildings"
              hidden={!show("window-profiles")}
              order={orderOf("window-profiles")}
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
              order={orderOf("population")}
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
              order={orderOf("city-details")}
            >
              <SeedRow />
              <NamingRegionRow />
              <CityDetailsSection />
            </Section>

            <Section
              value="stars"
              icon={Stars}
              label="Stars"
              hidden={!show("stars")}
              order={orderOf("stars")}
            >
              <StarsSection />
            </Section>

            <Section
              value="moon"
              icon={Moon}
              label="Moon"
              hidden={!show("moon")}
              order={orderOf("moon")}
            >
              <MoonSection />
            </Section>

            <Section
              value="fog"
              icon={CloudFog}
              label="Atmosphere"
              hidden={!show("fog")}
              order={orderOf("fog")}
              action={<AtmosphereToggle />}
            >
              <FogSection />
            </Section>

            <Section
              value="debug"
              icon={Bug}
              label="Debug View"
              hidden={!show("debug")}
              order={orderOf("debug")}
            >
              <DebugSection />
            </Section>

            {/* Performance appears in both tabs — Look keeps just the tier select
                (header action = the badge/stats display toggle); Studio swaps in
                everything else (adaptive fit, AA, DPR, LOD, live stats). */}
            <Section
              value="perf"
              icon={Gauge}
              label="Performance"
              hidden={!show("perf")}
              order={orderOf("perf")}
              action={<PerfDisplayToggle />}
            >
              {studioMode ? (
                <>
                  <AdaptiveGroup />
                  <AntiAliasingSection />
                  <ResolutionSection />
                  <LevelOfDetailSection />
                  <StatsGroup />
                </>
              ) : (
                <PerfReadout />
              )}
            </Section>

            <Section
              value="labs"
              icon={FlaskConical}
              label="Labs"
              hidden={!show("labs")}
              order={orderOf("labs")}
            >
              <LabsSection />
            </Section>
          </Accordion>
          {searching && matchedAll.length === 0 && (
            <p className="text-foreground/50 px-1 py-6 text-center text-sm">
              No settings match &quot;{query.trim()}&quot;.
            </p>
          )}
          {searching && otherTabMatches.length > 0 && (
            <div className="border-foreground/10 mt-2 flex flex-col gap-1 border-t pt-2">
              {otherTabMatches.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStudioMode(!studioMode)}
                  className="text-foreground/70 hover:bg-foreground/10 hover:text-foreground flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm"
                >
                  <span>{s.label}</span>
                  <span className="bg-foreground/10 text-foreground/60 rounded px-1.5 py-0.5 text-xs tracking-wide uppercase">
                    in {studioMode ? "Look" : "Studio"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Sticky footer — icon + visible text (2026-09-05: icon-only buttons with a
          tooltip-only label weren't discoverable on touch; text now shows outright). */}
      <div className="border-foreground/10 flex shrink-0 flex-wrap items-center gap-2 border-t px-4 pt-3 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <FooterAction
            label="Reset"
            onClick={() => resetCamera()}
            className="text-rose-400 hover:bg-rose-400/10 hover:text-rose-300"
          >
            <RotateCcw className="size-4" />
          </FooterAction>
          {savedExists && (
            <FooterAction
              label="Revert"
              onClick={() => revertToSaved()}
              className="text-amber-400 hover:bg-amber-400/10 hover:text-amber-300"
            >
              <Undo2 className="size-4" />
            </FooterAction>
          )}
          {savedExists && (
            <FooterAction
              label="Clear"
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
            label="Save"
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
    </div>
  );
}

// One footer button: icon + visible text label (2026-09-05, replacing the icon-only
// + tooltip pattern). aria-label mirrors the visible text.
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
    <Button
      variant={variant}
      size="sm"
      aria-label={label}
      onClick={onClick}
      className={cn("gap-1.5 px-2.5", className)}
    >
      {children}
      {label}
    </Button>
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
      aria-label="Copy"
      onClick={onCopy}
      className="bg-foreground/10 text-foreground hover:bg-foreground/20 gap-1.5 px-2.5"
    >
      {copyState === "copied" ? (
        <Check className="size-4 text-emerald-400" />
      ) : (
        <Copy className="size-4" />
      )}
      {copyState === "copied" ? "Copied!" : "Copy"}
    </Button>
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
    <Button
      variant="secondary"
      size="sm"
      aria-label="Link"
      onClick={onCopy}
      className="bg-foreground/10 text-foreground hover:bg-foreground/20 gap-1.5 px-2.5"
    >
      {copyState === "copied" ? (
        <Check className="size-4 text-emerald-400" />
      ) : (
        <Link2 className="size-4" />
      )}
      {copyState === "copied" ? "Copied!" : "Link"}
    </Button>
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
