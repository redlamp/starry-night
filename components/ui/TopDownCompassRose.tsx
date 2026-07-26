"use client";

import { useEffect, useRef } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { cameraCommand } from "@/lib/scene/cameraCommand";
import { cn } from "@/lib/utils";
import { IconTip } from "@/components/ui/columns/EntityColumns";

// Google-Maps-style compass rose (#95). Cam v3's in-model top-down keeps the camera's
// current compass heading through the dive instead of rolling north-up like a real map
// (see wiki/notes/decision-camera-v3-continuous-modes) — a plan view with no north
// reference reads as disorienting, so this rotates live to show where north is, and
// doubles as a click-to-north-up affordance.
//
// Placement + visibility (user 2026-07-26): the rose is a size-11 HUD button that sits
// BETWEEN the drift and settings buttons in the top-right row (CameraPanel renders
// CompassHudSlot there); when the settings drawer is open — the row is gone — it parks at
// the drawer's left edge instead (TopDownCompassRose below). The Orbit panel's Off/Auto/On
// setting: On = always visible, Auto = follows the HUD chrome (shows with the buttons,
// fades with them on idle), Off = hidden.
//
// Bearing math: the live needle tracks cameraCommand.liveNorthScreenDeg — the ground-plane
// bearing of world-north (stable at every elevation, roll-tracking at the top-down pole);
// see the cameraCommand doc. Other models fall back to the 10Hz azimuth mirror.
const NORTH_UP_LABEL = "Rotate North-Up";

// Rose tilt legibility cap (user 2026-07-26 4.**): proportional up to TILT_LINEAR_TO, then
// COMPRESSED — a near-flat camera used to push the disc to 68° (nearly edge-on, hard to
// read). Raw look-flatness 40–90° now maps linearly into 40°–TILT_MAX, so the rose still
// suggests the city plane at low elevations but stays mainly face-on. TILT_MAX is the
// tuning knob (Taylor to supply the preferred value; 58 is the starting point).
const TILT_LINEAR_TO = 40;
const TILT_MAX = 58;

// The rose button itself — size/chrome matched to its row neighbours (size-11, same
// border/backdrop as the drift + settings buttons), position left to the host.
export function CompassRoseButton({ visible }: { visible: boolean }) {
  const isV3 = useSceneStore((s) => s.cameraModel === "snv3");
  const needleRef = useRef<SVGSVGElement | null>(null);
  const tiltRef = useRef(0);

  // The needle tethers to the camera's per-frame pose (cameraCommand.live*)
  // via rAF and a direct style write — NOT the orbit store mirror, whose 10Hz
  // sampling plus a CSS tween made the needle step and drift out of sync with
  // the city (user 2026-07-18). The HEADING is instant (the needle is bolted
  // to the city); the 3D TILT that lays the rose on the city plane EASES
  // toward its target instead — the regime flip at the skyline boundary used
  // to step it 68 -> 0 in one frame (user 2026-07-19: "a snap").
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const tick = () => {
      const el = needleRef.current;
      if (el) {
        const bearing = isV3
          ? cameraCommand.liveNorthScreenDeg
          : (useSceneStore.getState().orbit.azimuthDeg + 180) % 360;
        const elev = isV3
          ? cameraCommand.liveElevationDeg
          : useSceneStore.getState().orbit.elevationDeg;
        const skyline = isV3 && cameraCommand.liveSkyline;
        // Compressed tilt (4.**): linear to TILT_LINEAR_TO, then 40–90 squeezed into
        // 40–TILT_MAX so low elevations keep the disc readable instead of edge-on.
        const raw = Math.max(0, 90 - elev);
        const legible =
          raw <= TILT_LINEAR_TO
            ? raw
            : TILT_LINEAR_TO +
              ((raw - TILT_LINEAR_TO) * (TILT_MAX - TILT_LINEAR_TO)) / (90 - TILT_LINEAR_TO);
        const targetTilt = skyline ? 0 : legible;
        tiltRef.current += (targetTilt - tiltRef.current) * 0.12; // ~200ms settle
        el.style.transform = `perspective(160px) rotateX(${tiltRef.current}deg) rotateZ(${bearing}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [visible, isV3]);

  return (
    <IconTip label={NORTH_UP_LABEL}>
      <button
        type="button"
        onClick={() => cameraCommand.rotateNorthUp?.()}
        aria-label={NORTH_UP_LABEL}
        className={cn(
          "border-foreground/10 bg-popover/70 text-foreground/85 hover:bg-foreground/10 flex size-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-[opacity,background-color,color] duration-700",
          visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {/* The rose (ring + needle) rotates and tilts as one disc lying on the
            city plane — the ring's foreshortening is what makes the orientation
            legible (user 2026-07-19); the button chrome stays put. Custom
            two-tone needle (red = north): lucide's Compass draws its needle at
            45°, so it never read as pointing north (user 2026-07-18). */}
        <svg ref={needleRef} viewBox="0 0 24 24" aria-hidden="true" className="size-8">
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            opacity={0.4}
          />
          <path d="M12 2.5 L15 12 L9 12 Z" fill="#e5484d" />
          <path d="M12 21.5 L9 12 L15 12 Z" fill="currentColor" opacity={0.5} />
          <circle cx="12" cy="12" r="1.1" fill="currentColor" opacity={0.7} />
        </svg>
      </button>
    </IconTip>
  );
}

// The top-right HUD row slot (CameraPanel, drawer closed): between the drift and the
// settings buttons. On = always shown; Auto = fades with the row on idle; Off = gone.
export function CompassHudSlot({ idle }: { idle: boolean }) {
  const mode = useSceneStore((s) => s.compassMode);
  if (mode === "off") return null;
  return <CompassRoseButton visible={mode === "on" ? true : !idle} />;
}

// Drawer-open placement: the button row is replaced by the settings panel, so the rose
// parks at the drawer's left edge (the user is active — no idle fade applies).
export function TopDownCompassRose() {
  const captureMode = useSceneStore((s) => s.captureMode);
  const mode = useSceneStore((s) => s.compassMode);
  const panelHidden = useSceneStore((s) => s.panelHidden);
  const panelWidth = useSceneStore((s) => s.settingsPanelWidth);

  if (captureMode || panelHidden || mode === "off") return null;
  return (
    <div
      className="pointer-events-none fixed top-3 z-20"
      style={{ right: Math.max(panelWidth, 280) + 12 }}
    >
      <CompassRoseButton visible />
    </div>
  );
}
