"use client";

import { useState } from "react";
import { useSceneStore, DEFAULT_INTENT, DEFAULT_PROJECTION } from "@/lib/state/sceneStore";
import { tweenOrbitToDefault, tweenOrbitTowards, tweenProjectionTo } from "@/lib/scene/cameraView";
import { cn } from "@/lib/utils";
import { Box, Crosshair, Telescope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ValueSlider } from "@/components/ui/value-slider";
import { fmt } from "./shared";

// 35 mm-equivalent focal length (in mm) for a vertical field of view (degrees).
// Full-frame reference: sensor height 24 mm, so f = (24/2) / tan(vFOV/2). This is
// the aspect-independent "lens size" a photographer would recognise — three.js `fov`
// is the vertical angle, and vertical-FOV↔24 mm yields the true full-frame focal length
// (e.g. 27° → 50 mm normal, 74° → 16 mm ultra-wide).
export const focalLengthMm = (vfovDeg: number) =>
  Math.round(12 / Math.tan((vfovDeg * Math.PI) / 360));

// Inverse of focalLengthMm: vertical fov (degrees) for a 35 mm-equivalent focal length.
export const fovFromFocalMm = (mm: number) => (360 / Math.PI) * Math.atan(12 / mm);

// Real-world full-frame lens bounds for the "lens" slider. The fov slider shares these
// exact limits (converted), so the two controls stay in lock-step and never disagree.
export const LENS_MIN_MM = 12; // ultra-wide prime -> 90 deg fov
export const LENS_MAX_MM = 300; // telephoto -> ~4.6 deg fov
export const FOV_MIN_DEG = fovFromFocalMm(LENS_MAX_MM); // ~4.58
export const FOV_MAX_DEG = 90; // === fovFromFocalMm(LENS_MIN_MM)

// Rough full-frame focal-length category, shown beside the live focal length.
export function lensName(mm: number): string {
  if (mm < 24) return "ultra-wide";
  if (mm < 35) return "wide";
  if (mm < 60) return "normal";
  if (mm < 105) return "short tele";
  if (mm < 300) return "telephoto";
  return "super-tele";
}

// The manual position / orient-by / lookAt / rotation intent inputs were
// removed 2026-06-07 (user): `locked = flying || orbiting` is true in every
// camera mode that exists, so they were permanently disabled — pre-orbit-rig
// plumbing. The live readout below the section covers the read side; the
// store API (setCameraIntent) is unchanged for scripts + camera internals.
export function PoseSection({ flying }: { flying: boolean }) {
  return (
    <>
      <ProjectionRow />
      <FovOrSizeSlider />
      {flying ? <FlySpeedSlider /> : null}
      <DiagramRow />
      <LiveViewLinkRow />
    </>
  );
}

// The live side-view diagram toggle (bottom-left rig cross-section). Lived at the
// bottom of the Orbit section until 2026-07-16 — it reads on the CAMERA, not the
// orbit, so it sits with the camera rows now.
export function DiagramRow() {
  const show = useSceneStore((s) => s.showSideView);
  const setShow = useSceneStore((s) => s.setShowSideView);
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className="text-foreground/40 text-xs tracking-wide uppercase"
        title="Live elevation cross-section of the camera rig, bottom-left"
      >
        diagram
      </span>
      <Switch checked={show} onCheckedChange={setShow} />
    </div>
  );
}

// Google-Maps-style URL following: while on, the address bar mirrors the live
// camera as a shareable ?seed=&cam= view link (CaptureBoot URL sync). The
// footer's Copy View Link works either way — this just keeps the URL current
// without clicking.
export function LiveViewLinkRow() {
  const on = useSceneStore((s) => s.liveViewLink);
  const setLiveViewLink = useSceneStore((s) => s.setLiveViewLink);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-foreground/40 text-xs tracking-wide uppercase">live view link</span>
      <Switch
        checked={on}
        onCheckedChange={setLiveViewLink}
        title="Address bar follows the camera"
      />
    </div>
  );
}

export function FlySpeedSlider() {
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

export function ProjectionRow() {
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

export function FovOrSizeSlider() {
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
    <>
      <ValueSlider
        label="fov"
        hint={
          <>
            Vertical field of view. The <b>lens</b> row below is the same setting shown as a 35
            mm-equivalent focal length; the two sliders are locked together.
          </>
        }
        value={fov}
        min={FOV_MIN_DEG}
        max={FOV_MAX_DEG}
        step={1}
        format={{ maximumFractionDigits: 0 }}
        onChange={(v) => setCameraIntent({ fov: v })}
      />
      <ValueSlider
        label="lens"
        hint={
          <>
            35 mm-equivalent focal length (full-frame). Locked to fov: {LENS_MIN_MM} mm ≈{" "}
            {FOV_MAX_DEG}°, {LENS_MAX_MM} mm ≈ {Math.round(FOV_MIN_DEG)}°.
          </>
        }
        value={focalLengthMm(fov)}
        min={LENS_MIN_MM}
        max={LENS_MAX_MM}
        step={1}
        format={{ maximumFractionDigits: 0 }}
        onChange={(mm) => setCameraIntent({ fov: fovFromFocalMm(mm) })}
      />
    </>
  );
}

// K = visible half-height at the pin plane: ortho sets it directly (orthoSize),
// perspective produces it via distance·tan(fov/2). Equal K ⇒ the two projections
// frame the same content. Δ→0 (green) is the numeric proof that pairs with the
// pin-plane overlay's rects coinciding. (2026-06-14, throwaway tuning aid.)
export function PinPlaneReadout() {
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

// Camera header actions (user 2026-06-14): a quick projection switch plus the
// default/free pose toggle, side by side in the section header.
export function CameraHeaderActions() {
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
