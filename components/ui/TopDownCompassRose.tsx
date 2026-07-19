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
// doubles as a click-to-north-up affordance. Off/Auto/On via the Orbit panel setting.
//
// Screen-space DOM overlay, parked LEFT of the drift/settings button pair at top-right
// (user 2026-07-19); when the settings drawer is open (the button pair hides) it slides
// to the drawer's left edge instead.
//
// Bearing math: the live camera azimuth is the compass yaw of the EYE relative to the
// FOCAL POINT (0 = eye due north of target, 90 = due east — same convention as
// orbitWriteback's az = atan2(offset.x, offset.z)). At the near-zenith top-down polar
// (StarryNightV3Model's TD_POLAR), working through camera-controls' actual look-at basis
// at that limit puts true north on screen at (azimuthDeg + 180) clockwise from screen-up
// — e.g. azimuthDeg 180 (eye south of target, looking north) reads as north-up (0 deg).
// rotateNorthUp (registered by the model) tweens azimuthDeg to exactly 180 for that
// reason — the shortest-way rotateTo already used by the rest of v3's tweens.
const NORTH_UP_LABEL = "Rotate North-Up";

// Right offset when the drift + settings buttons are visible: 12px edge margin
// + two size-11 (44px) buttons + two 6px gaps.
const RIGHT_OF_BUTTONS_PX = 12 + 44 + 6 + 44 + 6;

export function TopDownCompassRose() {
  const captureMode = useSceneStore((s) => s.captureMode);
  const isV3 = useSceneStore((s) => s.cameraModel === "snv3");
  const parked = useSceneStore((s) => s.topDownParked);
  const mode = useSceneStore((s) => s.compassMode);
  const projection = useSceneStore((s) => s.projection);
  const orthoSize = useSceneStore((s) => s.orthoSize);
  const radius = useSceneStore((s) => s.orbit.radius);
  const panelHidden = useSceneStore((s) => s.panelHidden);
  const panelWidth = useSceneStore((s) => s.settingsPanelWidth);
  const needleRef = useRef<SVGSVGElement | null>(null);
  const tiltRef = useRef(0);

  // Off / Auto / On (user 2026-07-18). Auto = the original top-down park,
  // OR zoomed far enough out that the city reads as a map: ortho view size
  // past 720, or perspective camera more than 3,200 m from its focal point.
  const zoomedOut = projection === "orthographic" ? orthoSize > 720 : radius > 3200;
  const visible =
    mode === "on" ? true : mode === "off" ? false : (isV3 && parked) || zoomedOut;

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
        // v3 publishes north's SCREEN bearing (projected through the live
        // camera quaternion) — this includes the top-down park's ROLL, which
        // is how that pose animates heading; the old azimuth-derived bearing
        // snapped ahead of the visible city (user 2026-07-19). Other models
        // fall back to the 10Hz azimuth mirror.
        const bearing = isV3
          ? cameraCommand.liveNorthScreenDeg
          : (useSceneStore.getState().orbit.azimuthDeg + 180) % 360;
        const elev = isV3
          ? cameraCommand.liveElevationDeg
          : useSceneStore.getState().orbit.elevationDeg;
        const skyline = isV3 && cameraCommand.liveSkyline;
        const targetTilt = skyline ? 0 : Math.min(68, Math.max(0, 90 - elev));
        tiltRef.current += (targetTilt - tiltRef.current) * 0.12; // ~200ms settle
        el.style.transform = `perspective(160px) rotateX(${tiltRef.current}deg) rotateZ(${bearing}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [visible, isV3]);

  if (captureMode) return null;

  return (
    <div
      className="pointer-events-none fixed top-3 z-20"
      style={{ right: panelHidden ? RIGHT_OF_BUTTONS_PX : Math.max(panelWidth, 280) + 12 }}
    >
      <IconTip label={NORTH_UP_LABEL}>
        <button
          type="button"
          onClick={() => cameraCommand.rotateNorthUp?.()}
          aria-label={NORTH_UP_LABEL}
          className={cn(
            "border-foreground/10 bg-popover/70 text-foreground/85 hover:bg-foreground/10 flex size-14 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-[opacity,background-color,color] duration-700",
            visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {/* The rose (ring + needle) rotates and tilts as one disc lying on the
              city plane — the ring's foreshortening is what makes the orientation
              legible (user 2026-07-19); the button chrome stays put. Custom
              two-tone needle (red = north): lucide's Compass draws its needle at
              45°, so it never read as pointing north (user 2026-07-18). */}
          <svg ref={needleRef} viewBox="0 0 24 24" aria-hidden="true" className="size-9">
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
    </div>
  );
}
