"use client";

import { useEffect, useState, type ReactNode } from "react";
import gsap from "gsap";
import {
  useSceneStore,
  type Vec3,
  type QualityTier,
  PRESETS,
  QUALITY_TIERS,
} from "@/lib/state/sceneStore";
import { randomSeed } from "@/lib/seed/rng";
import { ARCHETYPE_ORDER, type Archetype } from "@/lib/seed/cityGen";
import { cn } from "@/lib/utils";
import {
  AppWindow,
  Building2,
  Camera,
  CloudFog,
  Contrast,
  Gauge,
  Map as MapIcon,
  Moon,
  MoonStar,
  Orbit as OrbitIcon,
  Radio,
  Route,
  Settings,
  Sparkles,
  Sprout,
  Stars,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { RoadsSection } from "@/components/ui/RoadsPanel";

const PROJECTION_TWEEN_DURATION = 0.5;

function tweenProjectionTo(target: "perspective" | "orthographic") {
  const s = useSceneStore.getState();
  if (s.projection === target) return;
  // Match framing at lookAt distance so projection swap stays visually
  // continuous: ortho frustum half-height = perspective tangent half-extent at d.
  const d = Math.max(1, s.orbit.radius);
  const fovRad = (s.cameraIntent.fov * Math.PI) / 180;
  if (target === "orthographic") {
    s.setOrthoSize(d * Math.tan(fovRad / 2));
  } else {
    const matchedFov = (2 * Math.atan(s.orthoSize / d) * 180) / Math.PI;
    s.setCameraIntent({ fov: matchedFov });
  }
  s.setProjection(target);
  const from = s.projectionBlend;
  const to = target === "orthographic" ? 1 : 0;
  const proxy = { v: from };
  gsap.to(proxy, {
    v: to,
    duration: PROJECTION_TWEEN_DURATION,
    ease: "power2.inOut",
    onUpdate: () => useSceneStore.getState().setProjectionBlend(proxy.v),
  });
}

// Orbit top-down: tilt the orbit straight down + pause the auto-sweep, without
// leaving orbit mode (per request — don't drop to Still). elevationDeg 90 sits
// the camera directly above the city; orbitPaused stops the revolution.
function tweenOrbitTopDown() {
  const s = useSceneStore.getState();
  s.setOrbitPaused(true);
  const proxy = { v: s.orbit.elevationDeg };
  gsap.to(proxy, {
    v: 90,
    duration: 0.8,
    ease: "power2.inOut",
    onUpdate: () => useSceneStore.getState().setOrbit({ elevationDeg: proxy.v }),
  });
}

function copyConfigToClipboard() {
  const s = useSceneStore.getState();
  const snippet = JSON.stringify(
    {
      cameraIntent: s.cameraIntent,
      orbit: s.orbit,
      projection: s.projection,
      orthoSize: s.orthoSize,
      moon: s.moon,
      stars: s.stars,
      windowAA: s.windowAA,
      windowMode: s.windowMode,
      windowSimple: s.windowSimple,
      windowProfiles: s.windowProfiles,
      fog: s.fog,
      haze: s.haze,
      cityPlanning: {
        showHighways: s.cityPlanning.showHighways,
        showDistrictShells: s.cityPlanning.showDistrictShells,
        showArterials: s.cityPlanning.showArterials,
      },
    },
    null,
    2,
  );
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

export function CameraPanel() {
  const {
    cameraMode,
    cameraIntent,
    cameraLive,
    setCameraMode,
    setCameraIntent,
    resetCamera,
    saveCurrentAsDefault,
    tweenCameraTo,
  } = useSceneStore();

  const [hidden, setHidden] = useState(true);
  const captureMode = useSceneStore((s) => s.captureMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  return (
    <div className="border-foreground/10 bg-popover text-foreground grey:bg-popover/70 grey:backdrop-blur-md pointer-events-auto fixed top-0 right-0 bottom-0 z-20 flex h-screen w-[26rem] flex-col border-l shadow-2xl">
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
        <div className="flex items-center gap-1.5">
          <ModeButton
            label="Fly"
            hotkey="F"
            active={flying}
            activeClass="bg-orange-500 text-black hover:bg-orange-500"
            onClick={() => setCameraMode("fly")}
          />
          <ModeButton
            label="Orbit"
            hotkey="G"
            active={orbiting}
            activeClass="bg-sky-400 text-black hover:bg-sky-400"
            onClick={() => setCameraMode("orbit")}
          />
        </div>
        <ModeDetailPanel mode={cameraMode} />
      </div>

      {/* Scrollable middle */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-3">
          <Accordion multiple defaultValue={[]} className="flex flex-col gap-1.5">
            <Section value="pose" icon={Camera} label="Camera">
              <PoseSection
                locked={locked}
                cameraIntent={cameraIntent}
                intentRotDeg={intentRotDeg}
                setCameraIntent={setCameraIntent}
                tweenCameraTo={tweenCameraTo}
              />
            </Section>

            <Section value="orbit" icon={OrbitIcon} label="Orbit">
              <OrbitSection />
            </Section>

            <Section value="districts" icon={MapIcon} label="Districts">
              <DistrictsSection />
            </Section>
            <Section value="roads" icon={Route} label="Roads">
              <RoadsSection />
            </Section>

            <Section value="stars" icon={Stars} label="Stars">
              <StarsSection />
            </Section>

            <Section value="moon" icon={Moon} label="Moon">
              <MoonSection />
            </Section>

            <Section value="fog" icon={CloudFog} label="Fog">
              <FogSection />
            </Section>

            <Section value="windows" icon={AppWindow} label="Anti-Aliasing">
              <AntiAliasingSection />
            </Section>

            <Section value="window-profiles" icon={Building2} label="Windows">
              <WindowsSection />
            </Section>

            <Section value="intro" icon={Sparkles} label="Intro">
              <IntroSection />
            </Section>

            <Section value="live" icon={Radio} label="Live readout">
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

            <Section value="seed" icon={Sprout} label="Seed">
              <SeedRow />
            </Section>

            <Section value="perf" icon={Gauge} label="Performance">
              <PerfReadout />
            </Section>
          </Accordion>
        </div>
      </ScrollArea>

      {/* Sticky footer */}
      <div className="border-foreground/10 flex shrink-0 items-center justify-between gap-2 border-t px-4 pt-3 pb-3">
        <Button
          variant="ghost"
          onClick={() => resetCamera()}
          title="Restore last saved values (falls back to hardcoded defaults if none saved)"
          className="text-rose-400 hover:bg-rose-400/10 hover:text-rose-300"
        >
          Reset
        </Button>
        <div className="flex items-center gap-1.5">
          <CopyButton />
          <Button
            onClick={() => saveCurrentAsDefault()}
            title="Snapshot current camera + orbit + moon + stars as the new Reset target"
            className="bg-emerald-400 text-black hover:bg-emerald-400/90"
          >
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
}: {
  value: string;
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem
      value={value}
      className="border-foreground/10 bg-foreground/[0.04] rounded-lg border not-last:border-b"
    >
      <AccordionTrigger className="text-foreground/85 px-3 py-2.5 text-sm font-medium tracking-wide hover:no-underline">
        <span className="flex items-center gap-2.5">
          <Icon aria-hidden="true" className="text-foreground/70 size-[18px]" />
          <span>{label}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-3 pt-0 pb-3">
        <div className="flex flex-col gap-2.5">{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
}

function PoseSection({
  locked,
  cameraIntent,
  intentRotDeg,
  setCameraIntent,
  tweenCameraTo,
}: {
  locked: boolean;
  cameraIntent: ReturnType<typeof useSceneStore.getState>["cameraIntent"];
  intentRotDeg: Vec3;
  setCameraIntent: ReturnType<typeof useSceneStore.getState>["setCameraIntent"];
  tweenCameraTo: ReturnType<typeof useSceneStore.getState>["tweenCameraTo"];
}) {
  const orbiting = useSceneStore((s) => s.cameraMode === "orbit");
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-foreground/40 w-16 shrink-0 text-xs tracking-wide uppercase">
          tween to
        </span>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => {
            // In orbit mode the still-pose presets stay disabled, except
            // "Top-down" — it tilts the orbit straight down + pauses the sweep
            // instead of dropping to Still.
            const orbitTopDown = orbiting && p.id === "top-down";
            return (
              <Button
                key={p.id}
                variant="secondary"
                size="sm"
                disabled={locked && !orbitTopDown}
                onClick={() => (orbitTopDown ? tweenOrbitTopDown() : tweenCameraTo(p.intent, 900))}
                className="bg-foreground/10 text-foreground hover:bg-foreground/20"
              >
                {p.label}
              </Button>
            );
          })}
        </div>
      </div>

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

      <ProjectionRow />
      <FovOrSizeSlider />
    </>
  );
}

function OrbitSection() {
  const orbit = useSceneStore((s) => s.orbit);
  const setOrbit = useSceneStore((s) => s.setOrbit);
  return (
    <>
      <div className="flex items-center justify-end">
        <FocalIndicatorToggle />
      </div>
      <ValueSlider
        label="speed"
        value={orbit.periodSec}
        min={5}
        max={3600}
        step={5}
        onChange={(periodSec) => setOrbit({ periodSec })}
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
    </>
  );
}

function AntiAliasingSection() {
  const wa = useSceneStore((s) => s.windowAA);
  const setWindowAA = useSceneStore((s) => s.setWindowAA);
  return (
    <>
      <div className="text-foreground/55 text-[10px] tracking-wide uppercase">Occupancy</div>
      <ValueSlider
        label="lit ratio"
        value={wa.litBias}
        min={0}
        max={1}
        step={0.02}
        onChange={(litBias) => setWindowAA({ litBias })}
      />
      <ValueSlider
        label="activity"
        value={wa.churn}
        min={0}
        max={1}
        step={0.02}
        onChange={(churn) => setWindowAA({ churn })}
      />
      <div className="text-foreground/55 pt-1 text-[10px] tracking-wide uppercase">
        Anti-alias / LOD
      </div>
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
    </>
  );
}

function WindowsSimpleControls() {
  const ws = useSceneStore((s) => s.windowSimple);
  const setWindowSimple = useSceneStore((s) => s.setWindowSimple);
  return (
    <>
      <div className="text-foreground/55 text-[10px] leading-snug">
        All buildings share one window size.
      </div>
      <ValueSlider
        label="width"
        value={ws.w}
        min={0.1}
        max={0.95}
        step={0.01}
        onChange={(w) => setWindowSimple({ w })}
      />
      <ValueSlider
        label="height"
        value={ws.h}
        min={0.1}
        max={0.95}
        step={0.01}
        onChange={(h) => setWindowSimple({ h })}
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

function WindowProfilesSection() {
  const profiles = useSceneStore((s) => s.windowProfiles);
  const setWindowProfile = useSceneStore((s) => s.setWindowProfile);
  return (
    <>
      <div className="text-foreground/55 text-[10px] leading-snug">
        Glass-to-cell fraction per building style. Grid spacing is baked per archetype.
      </div>
      {ARCHETYPE_ORDER.map((arch) => (
        <div key={arch} className="flex flex-col gap-1.5">
          <div className="text-foreground/55 pt-1 text-[10px] tracking-wide uppercase">
            {ARCHETYPE_LABELS[arch]}
          </div>
          <ValueSlider
            label="width"
            value={profiles[arch].w}
            min={0.1}
            max={0.95}
            step={0.01}
            onChange={(w) => setWindowProfile(arch, { w })}
          />
          <ValueSlider
            label="height"
            value={profiles[arch].h}
            min={0.1}
            max={0.95}
            step={0.01}
            onChange={(h) => setWindowProfile(arch, { h })}
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
  return (
    <>
      <div className="flex items-center justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFog({ enabled: !fog.enabled })}
          title="Toggle scene fog on/off"
          className={cn(
            fog.enabled
              ? "bg-foreground text-background hover:bg-foreground"
              : "bg-foreground/10 text-foreground hover:bg-foreground/20",
          )}
        >
          {fog.enabled ? "on" : "off"}
        </Button>
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
          <ValueSlider
            label="near"
            value={fog.near}
            min={0}
            max={6000}
            step={10}
            onChange={(near) => setFog({ near })}
          />
          <ValueSlider
            label="far"
            value={fog.far}
            min={50}
            max={6000}
            step={10}
            onChange={(far) => setFog({ far })}
          />
        </>
      ) : (
        <ValueSlider
          label="density"
          value={fog.density}
          min={0}
          max={0.005}
          step={0.0001}
          onChange={(density) => setFog({ density })}
        />
      )}
      <div className="flex items-center justify-between pt-2">
        <span className="text-foreground/55 text-[10px] tracking-wide uppercase">Ground haze</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setHaze({ enabled: !haze.enabled })}
          title="Toggle ground-haze band on/off"
          className={cn(
            haze.enabled
              ? "bg-foreground text-background hover:bg-foreground"
              : "bg-foreground/10 text-foreground hover:bg-foreground/20",
          )}
        >
          {haze.enabled ? "on" : "off"}
        </Button>
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
  const setIntroDuration = useSceneStore((s) => s.setIntroDuration);
  const setIntroMode = useSceneStore((s) => s.setIntroMode);
  const setBreathingPeriod = useSceneStore((s) => s.setBreathingPeriod);
  const playIntro = useSceneStore((s) => s.playIntro);
  const modes = ["random", "district", "outside-in", "inside-out", "far-to-near"] as const;
  return (
    <>
      <div className="flex items-center justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => playIntro()}
          title="Replay the wake-up sequence from progress = 0"
          className="bg-amber-300 text-black hover:bg-amber-300/90"
        >
          ▶ play
        </Button>
      </div>
      <ValueSlider
        label="duration"
        value={intro.durationSec}
        min={1}
        max={30}
        step={0.5}
        onChange={(durationSec) => setIntroDuration(durationSec)}
      />
      <ValueSlider
        label="off cycle"
        value={intro.breathingPeriodSec}
        min={3}
        max={600}
        step={1}
        onChange={(breathingPeriodSec) => setBreathingPeriod(breathingPeriodSec)}
      />
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground/70 w-14 shrink-0">mode</span>
        <Select value={intro.mode} onValueChange={(v) => setIntroMode(v as typeof intro.mode)}>
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
      <div className="text-foreground/70 grid grid-cols-[5rem_1fr] gap-1 font-mono text-xs">
        <div>progress</div>
        <div className="tabular-nums">{fmt(intro.progress, 2)}</div>
      </div>
    </>
  );
}

function ModeDetailPanel({ mode }: { mode: "still" | "fly" | "orbit" }) {
  if (mode === "fly") {
    return (
      <div className="text-foreground/70 flex flex-col gap-1.5 rounded-lg border border-orange-400/30 bg-orange-400/5 p-2">
        <div className="text-xs tracking-wide text-orange-200/80 uppercase">fly</div>
        <div className="text-xs leading-snug">
          Hold LMB look · WASD move · Space up · C down · Q/E roll · Shift sprint · wheel = speed ·
          F exit
        </div>
        <FlySpeedSlider />
      </div>
    );
  }
  if (mode === "orbit") {
    return (
      <div className="text-foreground/70 flex flex-col gap-1.5 rounded-lg border border-sky-400/30 bg-sky-400/5 p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs tracking-wide text-sky-300/80 uppercase">orbit</span>
          <OrbitPauseBadge />
        </div>
        <div className="text-xs leading-snug">
          Drag spin · RMB drag = focal Y · pinch / wheel zoom · two-finger pan = focal Y · Space
          pause
        </div>
      </div>
    );
  }
  return (
    <div className="border-foreground/15 bg-foreground/5 text-foreground/70 flex flex-col gap-1 rounded-lg border p-2">
      <div className="text-foreground/55 text-xs tracking-wide uppercase">still</div>
      <div className="text-xs leading-snug">
        Pose set by position / lookAt / rotation / FOV. Tween presets to jump to common framings;
        switch to Fly (F) or Orbit (G) for motion.
      </div>
    </div>
  );
}

function OrbitPauseBadge() {
  const paused = useSceneStore((s) => s.orbitPaused);
  const setOrbitPaused = useSceneStore((s) => s.setOrbitPaused);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => setOrbitPaused(!paused)}
      title="Pause / resume orbit auto-revolution (Space)"
      className={cn(
        paused
          ? "bg-sky-400 text-black hover:bg-sky-400"
          : "bg-foreground/10 text-foreground/80 hover:bg-foreground/20",
      )}
    >
      {paused ? "▶ resume" : "⏸ pause"}
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
    <div className="flex items-center gap-2">
      <span className="text-foreground/40 w-16 shrink-0 text-xs tracking-wide uppercase">
        projection
      </span>
      <div className="flex flex-1 gap-1">
        {(["perspective", "orthographic"] as const).map((p) => (
          <Button
            key={p}
            variant="secondary"
            size="sm"
            onClick={() => tweenProjectionTo(p)}
            title={`Switch to ${p} projection (tweens via GSAP)`}
            className={cn(
              "flex-1 capitalize",
              projection === p
                ? "bg-foreground text-background hover:bg-foreground"
                : "bg-foreground/10 text-foreground hover:bg-foreground/20",
            )}
          >
            {p}
          </Button>
        ))}
      </div>
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

function ModeButton({
  label,
  hotkey,
  active,
  activeClass,
  onClick,
}: {
  label: string;
  hotkey: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      title={`${label} mode (${hotkey})`}
      className={cn(
        active ? activeClass : "bg-foreground/10 text-foreground hover:bg-foreground/20",
      )}
    >
      {label}
      <span className="text-[10px] opacity-70">({hotkey})</span>
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
      onClick={onCopy}
      title="Copy camera + orbit + moon + stars as JSON to clipboard"
      className="bg-foreground/10 text-foreground hover:bg-foreground/20"
    >
      {copyState === "copied" ? "copied" : "copy"}
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

function ValueSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  labelClass,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  labelClass?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn("text-foreground/70 w-14 shrink-0", labelClass)}>{label}</span>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(v) => onChange(typeof v === "number" ? v : v[0])}
        className="flex-1"
      />
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || min)}
        className="border-foreground/15 bg-background/60 text-foreground w-16 rounded border px-1.5 py-0.5 tabular-nums"
      />
    </div>
  );
}

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

  useEffect(() => setDraft(seed), [seed]);

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
