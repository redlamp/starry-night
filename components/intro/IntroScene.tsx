"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { Canvas } from "@react-three/fiber";
import { Backdrop, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { MacDaz, MacDazStock } from "./MacModel";
import { setCursorZone } from "./stageCursor";
import { PerfMonitor } from "@/components/scene/PerfMonitor";
import { STUDIO_CAM_POS, STUDIO_TARGET } from "./studioCamera";
import type { BwLevels, IntroViewMode, ScreenColorMode } from "./viewMode";

// Stage layout: working Mac centre, the unmodified-from-source Daz model
// to its right. Double-clicking a Mac pans the orbit rig over to it.
const MAC_X: Record<"daz" | "stock", number> = { daz: 0, stock: 0.5 };
type MacId = keyof typeof MAC_X;

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
  glow,
  halation,
  scanline,
  bloom,
}: {
  mode: IntroViewMode;
  colorMode: ScreenColorMode;
  bwLevels: BwLevels;
  glow: number;
  halation: number;
  scanline: number;
  bloom: number;
}) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camTween = useRef<gsap.core.Tween | null>(null);
  // Pointer over the CRT routes input to the city camera; studio controls
  // stand down for the duration. Same while a tween owns the camera.
  const [screenHover, setScreenHover] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [selectedMac, setSelectedMac] = useState<MacId>("daz");

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
          glow={glow}
          halation={halation}
          scanline={scanline}
          screenInteractive={screenHover}
          onScreenHoverChange={setScreenHover}
          position={[MAC_X.daz, 0, 0]}
          onDoubleClick={(e) => {
            // R3F rays pass through to the backdrop unless stopped — without
            // this, the same dblclick also fires the stage reset behind us
            e.stopPropagation();
            orbitToMac("daz");
          }}
          onPointerOver={() => setCursorZone("mac", true)}
          onPointerOut={() => setCursorZone("mac", false)}
        />
      </Suspense>
      {/* the Daz model unchanged from source, stage right */}
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
          cyc the page background carries (close enough in tone) */}
      <OrbitControls
        ref={controlsRef}
        enabled={!screenHover && !resetting}
        target={STUDIO_TARGET}
        minDistance={0.3}
        maxDistance={3}
        maxPolarAngle={Math.PI / 2 - 0.04}
        enableDamping
      />
    </Canvas>
  );
}
