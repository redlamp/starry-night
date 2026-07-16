"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { cameraCommand } from "@/lib/scene/cameraCommand";
import { cn } from "@/lib/utils";
import { MapPin, MousePointer2, Pause, Play, Pointer, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RangeSlider, ValueSlider } from "@/components/ui/value-slider";
import { HelpHint } from "@/components/ui/tooltip";
import { SubGroup } from "./shared";

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

export function OrbitSection() {
  const orbit = useSceneStore((s) => s.orbit);
  const setOrbit = useSceneStore((s) => s.setOrbit);
  const pivot = useSceneStore((s) => s.orbitPivotFromBottom);
  const setPivot = useSceneStore((s) => s.setOrbitPivotFromBottom);
  const groundFraming = useSceneStore((s) => s.groundFraming);
  const setGroundFraming = useSceneStore((s) => s.setGroundFraming);
  const groundFrameLow = useSceneStore((s) => s.groundFrameLow);
  const setGroundFrameLow = useSceneStore((s) => s.setGroundFrameLow);
  const rotateFloor = useSceneStore((s) => s.rotateLowAngleGain);
  const setRotateFloor = useSceneStore((s) => s.setRotateLowAngleGain);
  const rotateSlowBelow = useSceneStore((s) => s.rotateSlowBelowDeg);
  const setRotateSlowBelow = useSceneStore((s) => s.setRotateSlowBelowDeg);
  const tiltSpeed = useSceneStore((s) => s.tiltSpeed);
  const setTiltSpeed = useSceneStore((s) => s.setTiltSpeed);
  const cameraModel = useSceneStore((s) => s.cameraModel);
  const drift = useSceneStore((s) => s.drift);
  const setDrift = useSceneStore((s) => s.setDrift);
  const turntable = useSceneStore((s) => s.turntable);
  const setTurntable = useSceneStore((s) => s.setTurntable);
  const snv2 = useSceneStore((s) => s.snv2);
  const setSnv2 = useSceneStore((s) => s.setSnv2);
  const snv3 = useSceneStore((s) => s.snv3);
  const setSnv3 = useSceneStore((s) => s.setSnv3);
  const driftMode = useSceneStore((s) => s.driftMode);
  const setDriftMode = useSceneStore((s) => s.setDriftMode);
  const isDrift = cameraModel === "drift";
  const isMap = cameraModel === "map";
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
      {/* Drift model controls — its motion is auto-driven, so the Map pose sliders
          (Speed/Distance/Compass/Focal) are hidden while Drift is active; the framing
          controls below (Screen Y / ground pull) still apply to both. */}
      {isDrift && (
        <SubGroup
          label="Drift"
          defaultOpen
          action={
            <HelpHint>
              Hands-off ambient orbit — Space pauses. Revolve s = 0 stops the spin (pure wander +
              bob). Screen Y sets how low the skyline sits.
            </HelpHint>
          }
        >
          <ValueSlider
            label="Wander"
            value={drift.wanderRadius}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setDrift({ wanderRadius: v })}
            stepperClass="w-32"
            format={{ maximumFractionDigits: 2 }}
          />
          <ValueSlider
            label="Wander spd"
            value={drift.wanderSpeed}
            min={0.2}
            max={3}
            step={0.1}
            onChange={(v) => setDrift({ wanderSpeed: v })}
            stepperClass="w-32"
            format={{ maximumFractionDigits: 1 }}
          />
          <ValueSlider
            label="Elev mean"
            value={drift.elevMid}
            min={1}
            max={8}
            step={0.5}
            onChange={(v) => setDrift({ elevMid: v })}
            stepperClass="w-32"
            format={{ maximumFractionDigits: 1 }}
          />
          <ValueSlider
            label="Elev bob"
            value={drift.elevAmp}
            min={0}
            max={5}
            step={0.5}
            onChange={(v) => setDrift({ elevAmp: v })}
            stepperClass="w-32"
            format={{ maximumFractionDigits: 1 }}
          />
          <ValueSlider
            label="Revolve s"
            value={drift.revolveSec}
            min={0}
            max={900}
            step={30}
            onChange={(v) => setDrift({ revolveSec: v })}
            stepperClass="w-32"
            format={{ maximumFractionDigits: 0 }}
          />
          <ValueSlider
            label="Breathe"
            value={drift.breathe}
            min={0}
            max={0.2}
            step={0.01}
            onChange={(v) => setDrift({ breathe: v })}
            stepperClass="w-32"
            format={{ maximumFractionDigits: 2 }}
          />
        </SubGroup>
      )}
      {cameraModel === "turntable" && (
        <SubGroup
          label="Turntable"
          defaultOpen
          action={
            <HelpHint>
              Showcase spin — drag to grab and spin it; Space pauses. Spin s = 0 is manual only. A
              higher elevation shows more of the city (best in perspective); low keeps the skyline +
              sky.
            </HelpHint>
          }
        >
          <ValueSlider
            label="Elevation"
            value={turntable.elevDeg}
            min={2}
            max={45}
            step={1}
            onChange={(v) => setTurntable({ elevDeg: v })}
            stepperClass="w-32"
            format={{ maximumFractionDigits: 0 }}
          />
          <ValueSlider
            label="Spin s"
            value={turntable.spinSec}
            min={0}
            max={300}
            step={5}
            onChange={(v) => setTurntable({ spinSec: v })}
            stepperClass="w-32"
            format={{ maximumFractionDigits: 0 }}
          />
        </SubGroup>
      )}
      {cameraModel === "snv3" && (
        <>
          <SubGroup
            label="Starry Night Cam v3"
            defaultOpen
            action={
              <HelpHint>
                Distance bounds — how close (left) and how far (right) the camera may get from its
                target, in world metres. Wheel zoom is clamped to this range. T dives to a top-down
                plan view and back; controls stay live up there.
              </HelpHint>
            }
          >
            <RangeSlider
              label="Distance"
              value={[snv3.minDist, snv3.maxDist]}
              min={1}
              max={24000}
              step={100}
              onChange={([minDist, maxDist]) => setSnv3({ minDist, maxDist })}
            />
            <ValueSlider
              label="Orbit"
              hint="Tilt / rotate drag sensitivity."
              value={snv3.orbitSpeed}
              min={0.25}
              max={3}
              step={0.05}
              onChange={(orbitSpeed) => setSnv3({ orbitSpeed })}
            />
            <ValueSlider
              label="Zoom"
              hint="Mouse-wheel zoom rate."
              value={snv3.zoomSpeed}
              min={0.25}
              max={3}
              step={0.05}
              onChange={(zoomSpeed) => setSnv3({ zoomSpeed })}
            />
            <ValueSlider
              label="Move"
              hint="WASD glides across the city, Q/E down/up. Speed scales with height above the ground (perspective) or view size (ortho), so it feels constant at any zoom — this multiplies that."
              value={snv3.moveSpeed}
              min={0.25}
              max={3}
              step={0.05}
              onChange={(moveSpeed) => setSnv3({ moveSpeed })}
            />
            <ValueSlider
              label="Tilt°"
              hint="The camera's current tilt (look-down angle). 0 = parallel to the ground; 90 = straight down. Drag to re-pitch in place — azimuth, distance, and target hold. Clamped by Min tilt."
              value={orbit.elevationDeg}
              min={0}
              max={90}
              step={0.5}
              onChange={(deg) => cameraCommand.setTiltDeg?.(deg, false)}
            />
            <ValueSlider
              label="Min tilt°"
              hint="Perspective: lowest the view tilts. 0 = level (no looking up); negative lets the camera drop to a low vantage looking up; positive keeps it angled down."
              value={snv3.tiltFloorDeg}
              min={-45}
              max={60}
              step={1}
              onChange={(tiltFloorDeg) => setSnv3({ tiltFloorDeg })}
            />
          </SubGroup>
          <SubGroup
            label="Drift"
            defaultOpen
            afterLabel={
              <HelpHint>
                A slow flight around the city — the view revolves, the focus wanders, the height
                bobs gently. The header switch (or Space, or the helicopter button) turns the
                drift on: adjust the camera any time and it eases back into the flight when you
                let go. With idle drift on instead, the flight starts by itself after Delay
                seconds of no input, and any input stops it until the timer runs down again.
                Feel knobs are shared with the Drift camera model.
              </HelpHint>
            }
            action={
              <Switch
                checked={driftMode}
                onCheckedChange={setDriftMode}
                aria-label="Drift"
              />
            }
          >
            <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
              <span className="text-foreground/70">idle drift</span>
              <Switch
                checked={snv3.idleDrift}
                onCheckedChange={(idleDrift) => setSnv3({ idleDrift })}
                aria-label="Idle drift"
              />
            </label>
            <ValueSlider
              label="Delay"
              hint="Seconds of no input before the idle drift starts."
              value={snv3.idleDelaySec}
              min={2}
              max={60}
              step={1}
              onChange={(idleDelaySec) => setSnv3({ idleDelaySec })}
              format={{ maximumFractionDigits: 0 }}
            />
            <ValueSlider
              label="Wander"
              hint="How far across the city the drifting focus roams."
              value={drift.wanderRadius}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setDrift({ wanderRadius: v })}
              format={{ maximumFractionDigits: 2 }}
            />
            <ValueSlider
              label="Speed"
              hint="Wander pace — how briskly the focus tours the city."
              value={drift.wanderSpeed}
              min={0.2}
              max={3}
              step={0.1}
              onChange={(v) => setDrift({ wanderSpeed: v })}
              format={{ maximumFractionDigits: 1 }}
            />
            <ValueSlider
              label="Elev bob"
              hint="The gentle up/down deviation while drifting (degrees)."
              value={drift.elevAmp}
              min={0}
              max={5}
              step={0.5}
              onChange={(v) => setDrift({ elevAmp: v })}
              format={{ maximumFractionDigits: 1 }}
            />
            <ValueSlider
              label="Revolve s"
              hint="Seconds per full revolution while drifting; 0 = no revolve (pure wander + bob)."
              value={drift.revolveSec}
              min={0}
              max={900}
              step={30}
              onChange={(v) => setDrift({ revolveSec: v })}
              format={{ maximumFractionDigits: 0 }}
            />
          </SubGroup>
        </>
      )}
      {cameraModel === "snv2" && (
        <SubGroup
          label="Starry Night Cam v2"
          defaultOpen
          action={
            <HelpHint>
              Distance bounds — how close (left) and how far (right) the camera may get from its
              target, in world metres. Wheel zoom is clamped to this range.
            </HelpHint>
          }
        >
          <RangeSlider
            label="Distance"
            value={[snv2.minDist, snv2.maxDist]}
            min={1}
            max={24000}
            step={100}
            onChange={([minDist, maxDist]) => setSnv2({ minDist, maxDist })}
          />
          <ValueSlider
            label="Orbit speed"
            hint="Tilt / rotate drag sensitivity."
            value={snv2.orbitSpeed}
            min={0.25}
            max={3}
            step={0.05}
            onChange={(orbitSpeed) => setSnv2({ orbitSpeed })}
          />
          <ValueSlider
            label="Zoom speed"
            hint="Mouse-wheel zoom rate."
            value={snv2.zoomSpeed}
            min={0.25}
            max={3}
            step={0.05}
            onChange={(zoomSpeed) => setSnv2({ zoomSpeed })}
          />
          <ValueSlider
            label="Move speed"
            hint="WASD glides across the city, Q/E down/up. Speed scales with height above the ground (perspective) or view size (ortho), so it feels constant at any zoom — this multiplies that."
            value={snv2.moveSpeed}
            min={0.25}
            max={3}
            step={0.05}
            onChange={(moveSpeed) => setSnv2({ moveSpeed })}
          />
          <ValueSlider
            label="Tilt°"
            hint="The camera's current tilt (look-down angle). 0 = parallel to the ground; 90 = straight down. Drag to re-pitch in place — azimuth, distance, and target hold. Clamped by Min tilt."
            value={orbit.elevationDeg}
            min={0}
            max={90}
            step={0.5}
            onChange={(deg) => cameraCommand.setTiltDeg?.(deg, false)}
          />
          <ValueSlider
            label="Min tilt°"
            hint="Perspective: lowest the view tilts. 0 = level (no looking up); negative lets the camera drop to a low vantage looking up; positive keeps it angled down."
            value={snv2.tiltFloorDeg}
            min={-45}
            max={60}
            step={1}
            onChange={(tiltFloorDeg) => setSnv2({ tiltFloorDeg })}
          />
        </SubGroup>
      )}
      {isMap && (
        <>
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
            format={{ maximumFractionDigits: 1 }} // cap the readout to XXXX.X (radius is often a float, e.g. the ortho park value)
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
            label="Focal X"
            value={orbit.centerX}
            min={-5000}
            max={5000}
            step={5}
            onChange={(centerX) => {
              setOrbit({ centerX });
              showFocalAdjust("focalY");
            }}
            onCommit={endFocalAdjust}
            stepperClass="w-32"
          />
          <ValueSlider
            label="Focal Z"
            value={orbit.centerZ}
            min={-5000}
            max={5000}
            step={5}
            onChange={(centerZ) => {
              setOrbit({ centerZ });
              showFocalAdjust("focalY");
            }}
            onCommit={endFocalAdjust}
            stepperClass="w-32"
          />
        </>
      )}
      {/* Shared framing controls (Screen Y focal pivot + the low-angle ground pull and
          its easing) are consumed by the Map + Drift models only — Cam v3 (like v2's
          fork base) drives its own framing, so showing them there was pure confusion
          (user, test round 2026-07-15 item 2.**). Hidden while v3 is active. */}
      {cameraModel !== "snv3" && (
        <>
      <RangeSlider
        label="Screen Y"
        hint={
          <>
            Where the focal sits on screen (0 top, 100 bottom). Left thumb = resting spot; with the
            ground pull on, near the horizon it eases DOWN to the right thumb so the skyline settles
            low with sky above. Off holds the resting spot at every angle.
          </>
        }
        // Screen Y is top-down (0 = top, 100 = bottom); the store holds fractions UP from the bottom,
        // so invert. Left thumb = resting Screen Y (orbitPivotFromBottom); right thumb = the low-angle
        // Screen Y it eases DOWN to near the horizon (groundFrameLow), used when the ground pull is on.
        value={[Math.round((1 - pivot) * 100), Math.round((1 - groundFrameLow) * 100)]}
        min={0}
        max={96}
        step={1}
        onChange={([rest, low]) => {
          setPivot(1 - rest / 100);
          setGroundFrameLow(1 - low / 100);
          showFocalAdjust("screenY");
        }}
      />
      <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
        <span className="text-foreground/70">low-angle ground pull</span>
        <Switch checked={groundFraming} onCheckedChange={setGroundFraming} />
      </label>
      <ValueSlider
        label="Tilt speed"
        hint="How fast a vertical drag pitches the view (lower = more regulated; 1 = the old rate)."
        value={tiltSpeed}
        min={0.1}
        max={1}
        step={0.05}
        onChange={setTiltSpeed}
        stepperClass="w-32"
      />
      <ValueSlider
        label="Low-angle speed"
        hint="Eases rotate + tilt speed down near the horizon (1 = no limit); distance past the city tapers them further."
        value={rotateFloor}
        min={0.1}
        max={1}
        step={0.05}
        onChange={setRotateFloor}
        stepperClass="w-32"
      />
      <ValueSlider
        label="Slow below °"
        hint="The elevation below which the low-angle easing (and the ground pull) start."
        value={rotateSlowBelow}
        min={2}
        max={45}
        step={1}
        onChange={setRotateSlowBelow}
        stepperClass="w-32"
      />
        </>
      )}
      {/* ("Default Orbit" removed 2026-07-15 round 3; the Diagram toggle moved to the
          Camera section above Live View Link, user 2026-07-16.) */}
    </>
  );
}

// Orbit section header actions (user 2026-06-14): the orbit controls live in the
// section header now — transport (play/pause), the focal-point pin, and the wheel-zoom
// target — each a compact icon button so all three sit beside the chevron. (The
// pause/resume action moved to the header 2026-06-08; the other two followed here.)
export function OrbitHeaderActions() {
  return (
    <div className="flex items-center gap-1">
      <ZoomTargetToggle />
      <FocalPinToggle />
      <OrbitPlayPauseToggle />
    </div>
  );
}

// Play/pause the camera's ambient motion. Transport convention: ⏸ while playing
// (click to pause), ▶ while paused (click to resume); highlighted while playing.
// For Cam v3 the ambient motion is the DRIFT (2026-07-16 rework): this button is
// the same three-way transport as Space and the helicopter button
// (cameraCommand.toggleDrift) — lit whenever a flight is up, mode or idle. Other
// models keep the auto-revolution flag (orbitPaused; Space toggles that in Drift).
function OrbitPlayPauseToggle() {
  const orbitPaused = useSceneStore((s) => s.orbitPaused);
  const setOrbitPaused = useSceneStore((s) => s.setOrbitPaused);
  const isV3 = useSceneStore((s) => s.cameraModel === "snv3");
  const driftMode = useSceneStore((s) => s.driftMode);
  const setDriftMode = useSceneStore((s) => s.setDriftMode);
  const driftFlying = useSceneStore((s) => s.driftFlying);
  const playing = isV3 ? driftMode || driftFlying : !orbitPaused;
  const v3Title = playing ? "Stop Drift (Space)" : "Start Drift (Space)";
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      title={
        isV3
          ? v3Title
          : playing
            ? "Pause the orbit revolution (Space)"
            : "Resume the orbit revolution (Space)"
      }
      aria-label={isV3 ? v3Title : playing ? "Pause orbit revolution" : "Resume orbit revolution"}
      aria-pressed={playing}
      onClick={() =>
        isV3
          ? (cameraCommand.toggleDrift ?? (() => setDriftMode(!driftMode)))()
          : setOrbitPaused(!orbitPaused)
      }
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
