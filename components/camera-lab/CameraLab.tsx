"use client";

// Camera Lab (/camera-lab): a grey-box "zoo" for comparing camera control methods
// on desktop + mobile. Pick a method (each labelled with its real-world parallel),
// tune it with live sliders/toggles, run the test-plan tasks, and rate it. Feedback
// persists between sessions and exports as JSON for review. See the wiki notes
// camera-systems-history + camera-lab-test-plan.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  CameraControls,
  GizmoHelper,
  GizmoViewport,
  PerspectiveCamera,
} from "@react-three/drei";
import type CameraControlsImpl from "camera-controls";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LabSidebar, LabSection, LabSlider } from "@/components/ui/lab-controls";
import { cn } from "@/lib/utils";
import { METHODS, DEFAULT_METHOD_ID, type CameraMethod } from "./methods";
import { DEFAULT_TUNING, TUNING_STORAGE_KEY, type LabTuning } from "./tuning";
import { GreyBoxCity } from "./GreyBoxCity";
import { CustomOrbitControls } from "./CustomOrbitControls";
import { DreiConfigControls } from "./DreiConfigControls";
import { FlyRig } from "./FlyRig";
import { LabMapControls } from "./LabMapControls";
import { ProjectionRig } from "./ProjectionRig";
import { CameraDiagram, type CamReadout } from "@/components/scene/CameraDiagram";
import { ControlsGuide } from "@/components/ui/ControlsGuide";
import { SurveyPanel } from "./SurveyPanel";
import { useLabFeedback } from "./useLabFeedback";

const HOME = { pos: [1700, 820, 1700] as const, target: [0, 0, 0] as const }; // focal Y = 0 (ground) by default
const HERE_DIST = 400; // fly -> orbit: focal dropped ahead of the fly camera
const METHOD_KEY = "camera-lab.method";
const PROJECTION_KEY = "camera-lab.projection";

type Projection = "perspective" | "orthographic";
const ZERO_CAM: CamReadout = { elev: 0, dist: 0, focalY: 0, camY: 0, parallel: false, frustumHh: 0, blend: 0 };

const _dir = new THREE.Vector3();
const _focal = new THREE.Vector3();
const _t = new THREE.Vector3();
// methods driven by the shared camera-controls instance (vs MapControls / fly, which mount their own)
const isCCKind = (k: string) => k === "leverArm" || k === "fixedRate" || k === "drei";

const TASKS = [
  "Frame the amber tower (NE) so it fills the view.",
  "Orbit a full turn around the centre, smoothly.",
  "Drop to street level and look UP at a tall tower.",
  "Pan across to the violet spire (SW) without spinning.",
  "Zoom from the whole field down to one block, then back out.",
  "Toggle perspective ↔ ortho (P) on one view — watch the side-view diagram and how depth reads.",
  "Tilt all the way down — the camera stops at the ground (never goes under).",
  "Recover to a clean default with Reset.",
  "On a phone: repeat with 1-finger rotate + 2-finger pan/pinch.",
];

// Focus pin: a teal marker at the orbit pivot (the controls target) — a dot at the
// focus, a stem down to the ground, and a ground ring — so you can see what you are
// orbiting around. Lab analogue of the app's FocalIndicator.
function LabPin({ focusRef }: { focusRef: React.RefObject<THREE.Vector3> }) {
  const dot = useRef<THREE.Mesh>(null);
  const stem = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const f = focusRef.current;
    dot.current?.position.set(f.x, f.y, f.z);
    if (stem.current) {
      stem.current.position.set(f.x, f.y / 2, f.z);
      stem.current.scale.set(1, Math.max(0.01, f.y), 1);
    }
    ring.current?.position.set(f.x, 1, f.z);
  });
  return (
    <group>
      <mesh ref={dot} renderOrder={10}>
        <sphereGeometry args={[22, 16, 16]} />
        <meshBasicMaterial color="#34e0c8" toneMapped={false} depthTest={false} />
      </mesh>
      <mesh ref={stem} renderOrder={10}>
        <cylinderGeometry args={[2.5, 2.5, 1, 8]} />
        <meshBasicMaterial color="#34e0c8" transparent opacity={0.5} toneMapped={false} depthTest={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
        <ringGeometry args={[40, 52, 48]} />
        <meshBasicMaterial
          color="#34e0c8"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          toneMapped={false}
          depthTest={false}
        />
      </mesh>
    </group>
  );
}

// Frame-rate meter (inside the Canvas, so it sees the real render loop). Reports current FPS plus
// a recent LOW (min over the last ~3s) — the low is what surfaces the transient drops you feel,
// which a current-only readout misses. A window with a >1s gap (tab was backgrounded) is skipped so
// the rAF-pause artifact on return doesn't masquerade as a real drop.
function FpsMeter({ onFps }: { onFps: (v: { fps: number; low: number }) => void }) {
  const frames = useRef(0);
  const elapsed = useRef(0);
  const last = useRef(0);
  const lows = useRef<number[]>([]);
  useFrame(() => {
    const now = performance.now();
    if (last.current === 0) {
      last.current = now;
      return;
    }
    const dt = now - last.current;
    last.current = now;
    if (dt > 1000) {
      frames.current = 0;
      elapsed.current = 0;
      return; // backgrounded — drop the artifact window
    }
    frames.current += 1;
    elapsed.current += dt;
    if (elapsed.current >= 500) {
      const fps = Math.round((frames.current * 1000) / elapsed.current);
      frames.current = 0;
      elapsed.current = 0;
      lows.current.push(fps);
      if (lows.current.length > 6) lows.current.shift();
      onFps({ fps, low: Math.min(...lows.current) });
    }
  });
  return null;
}

// HUD overlay (readout card + side-view diagram). Self-drives from the readout/fps REFS via its own
// rAF, repainting only itself — and only when a displayed value actually changed — so the diagram
// tracks the scene at display rate (was capped at ~8fps by the throttled React-state path, which
// looked choppy) without re-rendering CameraLab or the sidebar.
function LabHud({
  readoutRef,
  fpsRef,
  method,
  showDiagram,
  onToggleProjection,
}: {
  readoutRef: React.RefObject<CamReadout>;
  fpsRef: React.RefObject<{ fps: number; low: number }>;
  method: CameraMethod;
  showDiagram: boolean;
  onToggleProjection?: () => void;
}) {
  const isFly = method.kind === "fly";
  // Snapshot the refs into state on each rAF tick (only when a displayed value changed). Rendering
  // reads the snapshot, not the refs, so the diagram repaints at display rate and stays correct.
  const [{ cam, fps }, setSnap] = useState<{ cam: CamReadout; fps: { fps: number; low: number } }>({
    cam: ZERO_CAM,
    fps: { fps: 0, low: 0 },
  });
  const sig = useRef("");
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const c = readoutRef.current;
      const f = fpsRef.current;
      const s = `${c.elev.toFixed(1)}|${Math.round(c.dist)}|${c.focalY.toFixed(1)}|${c.camY.toFixed(0)}|${c.blend.toFixed(2)}|${c.parallel}|${Math.round(c.frustumHh)}|${f.fps}|${f.low}`;
      if (s !== sig.current) {
        sig.current = s;
        setSnap({ cam: c, fps: f });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [readoutRef, fpsRef]);

  return (
    <>
      <div className="pointer-events-none absolute top-3 right-3 z-10 rounded bg-black/40 px-2 py-1 text-right font-mono text-[10px] text-zinc-300 backdrop-blur">
        <div className="text-teal-300">{method.name}</div>
        <div>
          elev {isFly ? "—" : cam.elev.toFixed(1)}° · dist {isFly ? "—" : Math.round(cam.dist)}
          {!isFly && <span className="text-zinc-500"> · {cam.parallel ? "ortho" : "persp"}</span>}
        </div>
        <div className="tabular-nums">
          <span style={{ color: fps.fps >= 55 ? "#6ee7b7" : fps.fps >= 35 ? "#fcd34d" : "#fb7185" }}>
            {fps.fps} fps
          </span>
          <span className="text-zinc-500"> · low {fps.low}</span>
        </div>
      </div>
      <CameraDiagram
        data={cam}
        mode={method.kind}
        show={showDiagram}
        onToggleProjection={onToggleProjection}
      />
    </>
  );
}

function SceneInner({
  method,
  tuning,
  controlsRef,
  resetSignal,
  onReadout,
  focusRef,
  showPin,
  onReset,
  projection,
  onFps,
}: {
  method: CameraMethod;
  tuning: LabTuning;
  controlsRef: React.RefObject<CameraControlsImpl | null>;
  resetSignal: number;
  onReadout: (r: CamReadout) => void;
  focusRef: React.RefObject<THREE.Vector3>;
  showPin: boolean;
  onReset: () => void;
  projection: Projection;
  onFps: (v: { fps: number; low: number }) => void;
}) {
  const isCC = isCCKind(method.kind);
  const isFly = method.kind === "fly";
  const isMap = method.kind === "mapControls";
  return (
    <>
      {/* One perspective camera renders everything; <ProjectionRig> fakes orthographic by blending
          its projection matrix, so the pose is continuous and the toggle morphs (no camera swap). */}
      <PerspectiveCamera makeDefault position={[...HOME.pos]} fov={50} near={1} far={20000} />

      {/* makeDefault so the GizmoHelper (and any drei consumer) sees the controls and can drive them */}
      {isCC && <CameraControls ref={controlsRef} makeDefault />}
      {isCC && (
        <ProjectionRig
          controls={controlsRef}
          leverArm={method.kind === "leverArm"}
          projection={projection}
          focusRef={focusRef}
          onReadout={onReadout}
        />
      )}
      {method.kind === "leverArm" && (
        <CustomOrbitControls
          controls={controlsRef}
          leverArm
          tuning={tuning}
          showPin={showPin}
          onReset={onReset}
        />
      )}
      {method.kind === "fixedRate" && (
        <CustomOrbitControls
          controls={controlsRef}
          leverArm={false}
          tuning={tuning}
          showPin={showPin}
          onReset={onReset}
        />
      )}
      {method.kind === "drei" && (
        <DreiConfigControls controls={controlsRef} method={method} tuning={tuning} />
      )}
      {isMap && (
        <LabMapControls
          tuning={tuning}
          home={HOME}
          resetSignal={resetSignal}
          onReadout={onReadout}
          focusRef={focusRef}
          showPin={showPin}
        />
      )}
      {isFly && <FlyRig tuning={tuning} home={HOME} resetSignal={resetSignal} />}
      {!isFly && showPin && <LabPin focusRef={focusRef} />}
      <FpsMeter onFps={onFps} />

      {/* bright, neutral "zoo" lighting — clearly a test rig, not the night city */}
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#c2d2e0", "#34343c", 0.55]} />
      <directionalLight position={[1600, 2600, 1200]} intensity={1.25} />
      <directionalLight position={[-1400, 1200, -1000]} intensity={0.35} />

      <GreyBoxCity />

      {/* gizmo drives the active controls (camera-controls / MapControls); fly has no controls to
          drive, so it's hidden there rather than clicking into a no-op / error */}
      {!isFly && (
        <GizmoHelper alignment="bottom-right" margin={[72, 88]}>
          <GizmoViewport labelColor="white" axisHeadScale={1} />
        </GizmoHelper>
      )}
    </>
  );
}

export function CameraLab() {
  const controls = useRef<CameraControlsImpl | null>(null);
  const [methodId, setMethodId] = useState(DEFAULT_METHOD_ID);
  const [tuning, setTuning] = useState<LabTuning>(DEFAULT_TUNING);
  const [panelOpen, setPanelOpen] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [showPin, setShowPin] = useState(true);
  const [showDiagram, setShowDiagram] = useState(true);
  const [projection, setProjection] = useState<Projection>("perspective");
  // readout + fps flow through REFS (written every frame in-scene) and are painted by <LabHud>,
  // which self-drives at display rate — so the diagram tracks the scene smoothly without
  // re-rendering CameraLab / the sidebar (the old throttled state path capped it at ~8fps).
  const readoutRef = useRef<CamReadout>(ZERO_CAM);
  const fpsRef = useRef({ fps: 0, low: 0 });
  const writeReadout = useCallback((r: CamReadout) => {
    readoutRef.current = r;
  }, []);
  const writeFps = useCallback((f: { fps: number; low: number }) => {
    fpsRef.current = f;
  }, []);
  const focus = useRef(new THREE.Vector3(HOME.target[0], HOME.target[1], HOME.target[2]));
  const { fb, setRating, setNotes, setGlobalNotes } = useLabFeedback();

  const method = METHODS.find((m) => m.id === methodId) ?? METHODS[0];
  const isFly = method.kind === "fly";
  const isMap = method.kind === "mapControls";
  const isCC = isCCKind(method.kind);
  const projectionLocked = isFly || isMap; // these mount their own camera → perspective only
  // Effective projection: MapControls / fly run their own camera, so force perspective there
  // (derived, not stored — keeps the user's orbit-method preference intact for when they return).
  const effProjection: Projection = projectionLocked ? "perspective" : projection;

  // hydrate persisted method + tuning + projection (after mount, so prerender stays default)
  useEffect(() => {
    try {
      /* eslint-disable react-hooks/set-state-in-effect -- one-time hydrate of persisted
         settings after mount; first render stays default so the static-export prerender
         does not mismatch */
      const m = window.localStorage.getItem(METHOD_KEY);
      if (m && METHODS.some((x) => x.id === m)) setMethodId(m);
      const t = window.localStorage.getItem(TUNING_STORAGE_KEY);
      if (t) setTuning({ ...DEFAULT_TUNING, ...(JSON.parse(t) as Partial<LabTuning>) });
      const p = window.localStorage.getItem(PROJECTION_KEY);
      if (p === "perspective" || p === "orthographic") setProjection(p);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // defaults are fine
    }
  }, []);

  const selectProjection = useCallback((p: Projection) => {
    setProjection(p);
    try {
      window.localStorage.setItem(PROJECTION_KEY, p);
    } catch {
      // best effort
    }
  }, []);
  const toggleProjection = useCallback(
    () => selectProjection(projection === "perspective" ? "orthographic" : "perspective"),
    [projection, selectProjection],
  );

  // P toggles projection (orbit / camera-controls methods only — MapControls and fly run their
  // own camera and stay perspective). Ignore while typing in a field.
  useEffect(() => {
    if (projectionLocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.code === "KeyP") {
        e.preventDefault();
        selectProjection(projection === "perspective" ? "orthographic" : "perspective");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectionLocked, projection, selectProjection]);

  const selectMethod = useCallback((id: string) => {
    setMethodId(id);
    try {
      window.localStorage.setItem(METHOD_KEY, id);
    } catch {
      // best effort
    }
  }, []);

  const patchTuning = useCallback((patch: Partial<LabTuning>) => {
    setTuning((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // best effort
      }
      return next;
    });
  }, []);

  const resetView = useCallback(() => {
    if (!isCC) {
      setResetSignal((s) => s + 1); // MapControls / fly home themselves on the signal
      return;
    }
    controls.current?.setLookAt(
      HOME.pos[0],
      HOME.pos[1],
      HOME.pos[2],
      HOME.target[0],
      HOME.target[1],
      HOME.target[2],
      true,
    );
  }, [isCC]);

  // First orbit init + "orbit from here" when returning from fly. (Orbit<->orbit
  // switches keep the live pose so you can A/B the controls on the same view.)
  const prevKind = useRef<string>(method.kind);
  const inited = useRef(false);
  useEffect(() => {
    const fromNonCC = !isCCKind(prevKind.current) && isCCKind(method.kind);
    prevKind.current = method.kind;
    if (!isCCKind(method.kind)) return;
    // R3F mounts <CameraControls> on its own reconciler tick (so controls.current is null a frame
    // or two after this DOM-side effect runs), AND drei's CameraControls re-reads the camera on its
    // own mount, stomping an early setLookAt back to its default target (0,0,0). So retry across
    // frames until the controls exist and the HOME framing actually HOLDS, then stop.
    let raf = 0;
    let tries = 0;
    const tick = () => {
      const c = controls.current;
      if (!c) {
        if (tries++ < 180) raf = requestAnimationFrame(tick);
        return;
      }
      if (!inited.current) {
        c.getTarget(_t);
        const atHome =
          Math.hypot(_t.x - HOME.target[0], _t.y - HOME.target[1], _t.z - HOME.target[2]) < 1;
        if (!atHome) {
          c.setLookAt(
            HOME.pos[0],
            HOME.pos[1],
            HOME.pos[2],
            HOME.target[0],
            HOME.target[1],
            HOME.target[2],
            false,
          );
          if (tries++ < 180) raf = requestAnimationFrame(tick); // re-apply until drei stops stomping it
          return;
        }
        inited.current = true;
        return;
      }
      if (fromNonCC) {
        const cam = c.camera;
        cam.getWorldDirection(_dir);
        _focal.copy(cam.position).addScaledVector(_dir, HERE_DIST);
        c.setLookAt(cam.position.x, cam.position.y, cam.position.z, _focal.x, _focal.y, _focal.z, false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [method.kind]);

  return (
    <main className="fixed inset-0 flex bg-[#15171c] text-white">
      <LabSidebar open={panelOpen} onOpenChange={setPanelOpen} width={360}>
        <div className="flex items-baseline justify-between">
          <h1 className="font-mono text-sm text-zinc-200">camera lab</h1>
          <Button
            variant="link"
            size="xs"
            className="px-0 text-zinc-400 hover:text-white"
            render={<Link href="/" />}
            nativeButton={false}
          >
            ← scene
          </Button>
        </div>
        <p className="-mt-3 text-xs text-zinc-500">grey-box zoo · compare control methods</p>

        <LabSection title="survey" collapsible storageKey="camera-lab.sect.survey">
          <SurveyPanel
            method={method}
            tuning={tuning}
            feedback={fb}
            onRate={setRating}
            onNotes={setNotes}
            onGlobalNotes={setGlobalNotes}
          />
        </LabSection>

        <LabSection title="method" collapsible storageKey="camera-lab.sect.method">
          <div className="flex flex-col gap-1.5">
            {METHODS.map((m) => (
              <Button
                key={m.id}
                variant="outline"
                size="sm"
                onClick={() => selectMethod(m.id)}
                className={cn(
                  "h-auto w-full flex-col items-start gap-0.5 py-1.5 text-left whitespace-normal",
                  m.id === methodId && "border-teal-600 bg-teal-500/10 text-teal-100 hover:bg-teal-500/15",
                )}
              >
                <span className="text-xs">{m.name}</span>
                <span className="text-[10px] text-zinc-500">≈ {m.parallel}</span>
              </Button>
            ))}
          </div>
          <div className="rounded bg-zinc-900/60 p-2 text-[11px] leading-snug text-zinc-400">
            <p>{method.blurb}</p>
            <p className="mt-1.5 text-zinc-500">
              <span className="text-zinc-400">desktop:</span> {method.desktop}
            </p>
            <p className="mt-0.5 text-zinc-500">
              <span className="text-zinc-400">touch:</span> {method.touch}
            </p>
          </div>
        </LabSection>

        <LabSection title="settings" collapsible storageKey="camera-lab.sect.settings">
          <Button variant="outline" size="sm" onClick={resetView}>
            Reset view
          </Button>

          <Label className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-normal text-zinc-300">
            <span>
              orthographic <span className="text-zinc-600">(P · tweens)</span>
            </span>
            <Switch
              checked={effProjection === "orthographic"}
              disabled={projectionLocked}
              onCheckedChange={(c) => selectProjection(c ? "orthographic" : "perspective")}
            />
          </Label>
          {projectionLocked && (
            <p className="-mt-1 text-[10px] text-zinc-600">{method.name} is perspective-only.</p>
          )}

          <Label className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-normal text-zinc-300">
            <span>focus pin</span>
            <Switch checked={showPin} onCheckedChange={setShowPin} />
          </Label>
          <Label className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-normal text-zinc-300">
            <span>side-view diagram</span>
            <Switch checked={showDiagram} onCheckedChange={setShowDiagram} />
          </Label>
        </LabSection>

        <LabSection title="tuning" collapsible storageKey="camera-lab.sect.tuning">
          {!isFly && (
            <>
              <LabSlider
                label="rotate speed"
                min={0.1}
                max={3}
                step={0.05}
                value={tuning.rotateSpeed}
                onCommit={(v) => patchTuning({ rotateSpeed: v })}
              />
              {!isMap && (
                <LabSlider
                  label="tilt speed"
                  min={0.1}
                  max={1.5}
                  step={0.05}
                  value={tuning.tiltSpeed}
                  onCommit={(v) => patchTuning({ tiltSpeed: v })}
                />
              )}
              <LabSlider
                label="pan speed"
                min={0.2}
                max={3}
                step={0.05}
                value={tuning.panSpeed}
                onCommit={(v) => patchTuning({ panSpeed: v })}
              />
              <LabSlider
                label="zoom speed"
                min={0.2}
                max={3}
                step={0.05}
                value={tuning.zoomSpeed}
                onCommit={(v) => patchTuning({ zoomSpeed: v })}
              />
              <LabSlider
                label="damping (s)"
                min={0}
                max={0.6}
                step={0.01}
                value={tuning.smoothTime}
                onCommit={(v) => patchTuning({ smoothTime: v })}
              />
            </>
          )}
          {method.kind === "leverArm" && (
            <>
              <LabSlider
                label="lever floor (px)"
                min={5}
                max={200}
                step={1}
                value={tuning.leverMinR}
                onCommit={(v) => patchTuning({ leverMinR: v })}
              />
              <LabSlider
                label="low-angle speed"
                min={0.1}
                max={1}
                step={0.05}
                value={tuning.lowAngleGain}
                onCommit={(v) => patchTuning({ lowAngleGain: v })}
              />
              <LabSlider
                label="slow below °"
                min={0}
                max={45}
                step={1}
                value={tuning.slowBelowDeg}
                onCommit={(v) => patchTuning({ slowBelowDeg: v })}
              />
              <Label className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-normal text-zinc-300">
                <span>tilt/rotate axis gate</span>
                <Switch
                  checked={tuning.axisGate}
                  onCheckedChange={(c) => patchTuning({ axisGate: c })}
                />
              </Label>
            </>
          )}
          {isFly && (
            <>
              <LabSlider
                label="move speed"
                min={20}
                max={800}
                step={10}
                value={tuning.flyMove}
                onCommit={(v) => patchTuning({ flyMove: v })}
              />
              <LabSlider
                label="look sens (x1000)"
                min={1}
                max={8}
                step={0.25}
                value={tuning.flyLook * 1000}
                onCommit={(v) => patchTuning({ flyLook: v / 1000 })}
              />
            </>
          )}
        </LabSection>

        <LabSection title="test plan" collapsible storageKey="camera-lab.sect.testplan">
          <ol className="ml-4 list-decimal space-y-1 text-[11px] leading-snug text-zinc-400">
            {TASKS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </LabSection>

      </LabSidebar>

      <div className="relative flex-1">
        <LabHud
          readoutRef={readoutRef}
          fpsRef={fpsRef}
          method={method}
          showDiagram={showDiagram}
          onToggleProjection={projectionLocked ? undefined : toggleProjection}
        />
        <Canvas dpr={[1, 2]} style={{ touchAction: "none" }}>
          <color attach="background" args={["#1a1d23"]} />
          <SceneInner
            method={method}
            tuning={tuning}
            controlsRef={controls}
            resetSignal={resetSignal}
            onReadout={writeReadout}
            focusRef={focus}
            showPin={showPin}
            onReset={resetView}
            projection={effProjection}
            onFps={writeFps}
          />
        </Canvas>
        <ControlsGuide />
      </div>
    </main>
  );
}
