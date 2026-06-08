"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Backdrop, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { MacDaz, MacDazStock } from "./MacModel";
import {
  setCursorZone,
  setDragCursorLock,
  stagePointerHot,
  isDoubleTap,
  type StageDragOwner,
} from "./stageCursor";
import { PerfMonitor } from "@/components/scene/PerfMonitor";
import { STUDIO_CAM_POS, STUDIO_TARGET } from "./studioCamera";
import type { BwLevels, IntroViewMode, ScreenColorMode } from "./viewMode";

// Stage layout: working Mac centre, the unmodified-from-source Daz model
// to its right. Double-clicking a Mac pans the orbit rig over to it.
const MAC_X: Record<"daz" | "stock", number> = { daz: 0, stock: 0.5 };
type MacId = keyof typeof MAC_X;

// The stock reference Mac is parked for now — it returns when the material /
// compression work lands (it's the before/after yardstick). Flip to restore;
// the focus/dblclick machinery (orbitToMac("stock"), MAC_X.stock) is kept
// intact so it's a one-line bring-back. See #74 / wiki intro decision note.
const SHOW_REFERENCE_MAC = false;

// Orbit-down limit: the eye may dip below the Mac's chin to peek under the
// front overhang, but must stay above the sweep at any orbit radius — so the
// polar cap is derived from the current radius on every change, not fixed.
const CAM_MIN_Y = 0.04;
const MAX_POLAR = Math.PI / 2 + 0.45;

/**
 * Orbit the camera to a Mac's default frontal pose (the studio home pose
 * shifted to that Mac's stage position) — spherical interp around the
 * (tweening) target, same idiom as lib/scene/cameraView.ts. Serves both the
 * stage double-click (reset to the focused Mac) and Mac double-click
 * (focus + reset to that Mac).
 */
function tweenStudioOrbitTo(
  controls: OrbitControlsImpl,
  macX: number,
  onDone: () => void,
): gsap.core.Tween {
  // flush damping inertia BEFORE reading the start pose — a big sweep's
  // leftover sphericalDelta would otherwise keep draining after the tween
  // ends and drift the camera off the home pose. update() without damping
  // applies the residual fully and zeroes it.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;

  const cam = controls.object;
  const endTarget = new THREE.Vector3(STUDIO_TARGET[0] + macX, STUDIO_TARGET[1], STUDIO_TARGET[2]);
  const endSph = new THREE.Spherical().setFromVector3(
    new THREE.Vector3(STUDIO_CAM_POS[0] + macX, STUDIO_CAM_POS[1], STUDIO_CAM_POS[2]).sub(
      endTarget,
    ),
  );
  const startTarget = controls.target.clone();
  const startSph = new THREE.Spherical().setFromVector3(
    cam.position.clone().sub(startTarget),
  );
  const state = { t: 0 };
  const sph = new THREE.Spherical();
  return gsap.to(state, {
    t: 1,
    duration: 1.4,
    ease: "power3.inOut",
    onUpdate: () => {
      const k = state.t;
      sph.set(
        THREE.MathUtils.lerp(startSph.radius, endSph.radius, k),
        THREE.MathUtils.lerp(startSph.phi, endSph.phi, k),
        THREE.MathUtils.lerp(startSph.theta, endSph.theta, k),
      );
      controls.target.lerpVectors(startTarget, endTarget, k);
      cam.position.setFromSpherical(sph).add(controls.target);
      controls.update();
    },
    onComplete: onDone,
  });
}

/**
 * '80s product-shoot studio: seamless light-grey cyc (no wall/floor seam),
 * soft shadow-mapped key + fill + rim, Mac Plus on the sweep. Azimuth is
 * clamped to the front hemisphere so the camera never sees past the cyc.
 * Double-click the stage to return the camera to its start pose.
 */
export function IntroScene({
  mode,
  colorMode,
  bwLevels,
  brightness,
  glow,
  halation,
  scanline,
  bloom,
  autoOrbit,
  onToggleAutoOrbit,
  onBrightnessChange,
  onScreenSettingsReset,
}: {
  mode: IntroViewMode;
  colorMode: ScreenColorMode;
  bwLevels: BwLevels;
  brightness: number;
  glow: number;
  halation: number;
  scanline: number;
  bloom: number;
  autoOrbit: boolean;
  onToggleAutoOrbit: () => void;
  onBrightnessChange: (v: number) => void;
  onScreenSettingsReset?: () => void;
}) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camTween = useRef<gsap.core.Tween | null>(null);
  // Pointer over the CRT routes input to the city camera; studio controls
  // stand down for the duration. Same while a tween owns the camera, or
  // while the pointer engages the brightness knob (its drag owns the input).
  const [screenHover, setScreenHover] = useState(false);
  // Touch path: tapping the glass arms this (touch has no hover to do it), and
  // it persists until you tap the stage or double-tap a Mac. Desktop never
  // sets it — it stays hover-driven via screenHover below.
  const [screenFocused, setScreenFocused] = useState(false);
  const [knobEngaged, setKnobEngaged] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [selectedMac, setSelectedMac] = useState<MacId>("daz");

  // Spacebar toggles the city's orbit (the record player) — but only while
  // the pointer is over the screen. A ref (not state) so the keydown listener
  // reads the live value without re-binding.
  const screenHoverRef = useRef(false);
  const handleScreenHoverChange = useCallback((h: boolean) => {
    screenHoverRef.current = h;
    setScreenHover(h);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || !screenHoverRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault(); // Space would scroll the page
      onToggleAutoOrbit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggleAutoOrbit]);

  // One input event at a time: the first gesture to press claims the drag
  // and keeps it until release. Hover states keep tracking RAW underneath
  // (so the right mode resumes the moment the drag ends) but their effects
  // — rerouting input, disabling controls, cursor changes — are suppressed
  // while someone else owns the drag. Fixes the studio orbit stalling when
  // the cursor crosses the CRT mid-drag.
  const [dragOwner, setDragOwner] = useState<StageDragOwner | null>(null);
  const claimDrag = useCallback(
    (owner: StageDragOwner) => setDragOwner((cur) => (cur === null ? owner : cur)),
    [],
  );
  const releaseDrag = useCallback(
    (owner: StageDragOwner) => setDragOwner((cur) => (cur === owner ? null : cur)),
    [],
  );
  useEffect(() => {
    setDragCursorLock(dragOwner);
  }, [dragOwner]);
  // safety net: a drag whose owner unmounts mid-gesture (so its end event
  // never fires) must not wedge the lock
  useEffect(() => {
    const clear = () => setDragOwner(null);
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, []);

  // hover takes effect only while unowned; an owning drag holds its mode
  // even when the pointer strays (city drag keeps the city, studio drag
  // never reroutes to the city)
  const screenActive =
    dragOwner === "screen" || screenFocused || (dragOwner === null && screenHover);
  const knobActive = dragOwner === "knob" || (dragOwner === null && knobEngaged);

  // dblclick a Mac: focus it AND reset the camera to its frontal pose;
  // dblclick the stage: reset to the currently focused Mac's pose.
  const orbitToMac = useCallback((id: MacId) => {
    const controls = controlsRef.current;
    if (!controls) return;
    camTween.current?.kill();
    setSelectedMac(id);
    setResetting(true);
    camTween.current = tweenStudioOrbitTo(controls, MAC_X[id], () => setResetting(false));
  }, []);

  const handleStageDoubleClick = useCallback(
    () => orbitToMac(selectedMac),
    [orbitToMac, selectedMac],
  );

  // Re-derive the polar cap from the current orbit radius: close in, the
  // camera can drop well below the chin; zoomed out, the same floor height
  // yields a shallower angle. Fires on every controls change (incl. damping).
  const clampPolarToFloor = useCallback(() => {
    const c = controlsRef.current;
    if (!c) return;
    const r = c.object.position.distanceTo(c.target);
    const cosFloor = (CAM_MIN_Y - c.target.y) / r;
    c.maxPolarAngle = Math.min(MAX_POLAR, Math.acos(THREE.MathUtils.clamp(cosFloor, -1, 1)));
  }, []);

  return (
    <Canvas
      shadows="soft"
      camera={{ position: STUDIO_CAM_POS, fov: 35, near: 0.05, far: 50 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      dpr={[1, 2]}
      style={{ touchAction: "none" }}
      // with azimuth unclamped the camera can face past the cyc where a
      // dblclick hits nothing — treat a double-click on the void as a stage
      // reset too (detail 2 = second click of a double-click)
      onPointerMissed={(e) => {
        if (e.detail === 2) handleStageDoubleClick();
      }}
    >
      <color attach="background" args={["#c8c8c8"]} />
      <PerfMonitor />

      {/* studio lighting: key high camera-left (shadow-mapped), soft fill right, rim from behind */}
      <ambientLight intensity={0.55} />
      <directionalLight
        castShadow
        position={[2, 3, 1.5]}
        intensity={2.0}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-0.7}
        shadow-camera-right={0.7}
        shadow-camera-top={0.7}
        shadow-camera-bottom={-0.7}
        shadow-camera-near={0.5}
        shadow-camera-far={8}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-2.5, 1.2, 2]} intensity={0.6} />
      <directionalLight position={[0, 2.5, -3]} intensity={0.8} />

      {/* seamless cyc — Mac sits on the flat run, curve well behind it */}
      <Backdrop
        receiveShadow
        floor={0.5}
        segments={64}
        scale={[16, 6, 6]}
        position={[0, -0.012, -2.1]}
        onDoubleClick={handleStageDoubleClick}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          // touch: tapping the stage exits screen-focus; double-tap recenters
          if (e.pointerType !== "touch") return;
          setScreenFocused(false);
          if (isDoubleTap(e, "stage")) handleStageDoubleClick();
        }}
        onPointerOver={() => setCursorZone("stage", true)}
        onPointerOut={() => setCursorZone("stage", false)}
      >
        <meshStandardMaterial color="#d4d4d4" roughness={0.95} metalness={0} />
      </Backdrop>

      <Suspense fallback={null}>
        <MacDaz
          mode={mode}
          colorMode={colorMode}
          bwLevels={bwLevels}
          brightness={brightness}
          glow={glow}
          halation={halation}
          scanline={scanline}
          screenInteractive={screenActive}
          screenAutoOrbit={autoOrbit}
          knobLocked={dragOwner !== null && dragOwner !== "knob"}
          onScreenHoverChange={handleScreenHoverChange}
          onScreenDragChange={(d) => (d ? claimDrag("screen") : releaseDrag("screen"))}
          onScreenFocus={() => setScreenFocused(true)}
          onBrightnessChange={onBrightnessChange}
          onKnobEngageChange={setKnobEngaged}
          onKnobDragChange={(d) => (d ? claimDrag("knob") : releaseDrag("knob"))}
          onKnobReset={onScreenSettingsReset}
          position={[MAC_X.daz, 0, 0]}
          onDoubleClick={(e) => {
            // R3F rays pass through to the backdrop unless stopped — without
            // this, the same dblclick also fires the stage reset behind us
            e.stopPropagation();
            orbitToMac("daz");
          }}
          onPointerDown={(e) => {
            // touch: a tap on the Mac BODY (the screen stops propagation, so
            // this never fires for the glass) exits screen-focus; double-tap
            // recenters the studio camera on this Mac
            if (e.pointerType !== "touch") return;
            setScreenFocused(false);
            if (isDoubleTap(e, "mac:daz")) orbitToMac("daz");
          }}
          onPointerOver={() => setCursorZone("mac", true)}
          onPointerOut={() => setCursorZone("mac", false)}
        />
      </Suspense>
      {/* the Daz model unchanged from source, stage right — parked until the
          material/compression work lands (the before/after reference) */}
      {SHOW_REFERENCE_MAC && (
        <Suspense fallback={null}>
          <MacDazStock
            position={[MAC_X.stock, 0, 0]}
            onDoubleClick={(e) => {
              e.stopPropagation();
              orbitToMac("stock");
            }}
            onPointerOver={() => setCursorZone("mac", true)}
            onPointerOut={() => setCursorZone("mac", false)}
          />
        </Suspense>
      )}

      {/* step 2 of the glow plan: over-the-bezel bloom. HDR buffer so only
          emissive (>1) content crosses the threshold — the screen, not the
          studio. TODO: gate behind quality tiers before mobile ship. */}
      {bloom > 0 && (
        <EffectComposer multisampling={4} frameBufferType={THREE.HalfFloatType}>
          <Bloom mipmapBlur intensity={bloom} luminanceThreshold={1.1} levels={5} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}

      {/* azimuth unclamped: full orbit around the focused Mac — behind the
          cyc the page background carries (close enough in tone). Polar cap
          is dynamic (floor-aware) via clampPolarToFloor. */}
      <OrbitControls
        ref={controlsRef}
        enabled={!screenActive && !knobActive && !resetting}
        target={STUDIO_TARGET}
        minDistance={0.3}
        maxDistance={3}
        maxPolarAngle={MAX_POLAR}
        onChange={clampPolarToFloor}
        onStart={() => {
          // enabled-prop race: a press right after hovering the CRT/knob can
          // start before React commits enabled=false — veto synchronously
          // (the prop re-asserts the right value on the next commit)
          if (stagePointerHot()) {
            if (controlsRef.current) controlsRef.current.enabled = false;
            return;
          }
          claimDrag("studio");
        }}
        onEnd={() => releaseDrag("studio")}
        enableDamping
      />
    </Canvas>
  );
}
