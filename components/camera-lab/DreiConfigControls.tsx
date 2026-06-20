"use client";

// Configures the shared drei <CameraControls> instance for the "drei" methods
// (stock, Google-Maps, Blender) purely by setting its mouseButtons / touches /
// dollyToCursor + speeds. The library does all the work — this is the "what does
// the lib give you out of the box, just remapped" baseline.

import { useEffect } from "react";
import CameraControlsImpl from "camera-controls";
import type { CameraMethod, ActionName } from "./methods";
import type { LabTuning } from "./tuning";

export function DreiConfigControls({
  controls,
  method,
  tuning,
}: {
  controls: React.RefObject<CameraControlsImpl | null>;
  method: CameraMethod;
  tuning: LabTuning;
}) {
  // button / touch mapping (per method)
  useEffect(() => {
    const c = controls.current;
    const cfg = method.drei;
    if (!c || !cfg) return;
    // camera-controls types each button/touch slot as a narrow ACTION subset; we map
    // by name dynamically, so treat the enum + slots as number bags (enum values are
    // numbers at runtime). Safe — every name in DreiConfig is a real ACTION member.
    const A = CameraControlsImpl.ACTION as unknown as Record<ActionName, number>;
    const mouse = c.mouseButtons as unknown as {
      left: number;
      middle: number;
      right: number;
      wheel: number;
    };
    const touch = c.touches as unknown as { one: number; two: number; three: number };
    mouse.left = A[cfg.mouse.left];
    mouse.middle = A[cfg.mouse.middle];
    mouse.right = A[cfg.mouse.right];
    mouse.wheel = A[cfg.mouse.wheel];
    touch.one = A[cfg.touch.one];
    touch.two = A[cfg.touch.two];
    touch.three = A[cfg.touch.three];
    c.dollyToCursor = cfg.dollyToCursor;
    c.setFocalOffset(0, 0, 0, false); // clear any Screen-Y park left by the lever-arm method

    // Blender idiom: Shift+MMB pans. Swap the middle action while Shift is held.
    if (!cfg.shiftMiddlePan) return;
    const onShift = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      mouse.middle = e.type === "keydown" ? A.TRUCK : A[cfg.mouse.middle];
    };
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);
    return () => {
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
    };
  }, [controls, method]);

  // live speed / damping tuning
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.azimuthRotateSpeed = tuning.rotateSpeed;
    c.polarRotateSpeed = tuning.rotateSpeed * tuning.tiltSpeed * 2; // tiltSpeed 0.5 -> 1 (drei default)
    c.truckSpeed = 2 * tuning.panSpeed;
    c.dollySpeed = tuning.zoomSpeed;
    c.smoothTime = tuning.smoothTime;
    c.draggingSmoothTime = Math.min(tuning.smoothTime, 0.12);
  }, [controls, tuning]);

  return null;
}
