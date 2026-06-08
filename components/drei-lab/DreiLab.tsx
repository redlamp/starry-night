"use client";

// Phase-0 spike for the drei camera migration (wiki: plan-drei-camera-migration).
// A throwaway lab route to feel out drei <CameraControls> (the camera-controls
// wrapper) against everything `/` and `/intro` do today, BEFORE committing to the
// migration. The checklist is the acceptance list: every interaction the unified
// controls must preserve (or we consciously drop). Tick items as drei proves it;
// ticks persist to localStorage.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  CameraControls,
  Grid,
  GizmoHelper,
  GizmoViewport,
  PerspectiveCamera,
} from "@react-three/drei";
import type CameraControlsImpl from "camera-controls";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LabSection as Section, LabSidebar } from "@/components/ui/lab-controls";

// --- the acceptance checklist: what the migration must preserve ----------------
type Group = { title: string; items: { id: string; label: string }[] };

const CHECKLIST: { route: string; groups: Group[] }[] = [
  {
    route: "/ — main scene",
    groups: [
      {
        title: "Orbit mode",
        items: [
          { id: "orbit-drag", label: "Drag orbits (yaw + elevation) around the focal point" },
          { id: "orbit-focalrmb", label: "Right-drag raises / lowers the focal point (lookAt Y)" },
          { id: "orbit-focal2f", label: "Two-finger drag adjusts the focal point (touch)" },
          { id: "orbit-zoom", label: "Pinch / scroll-wheel zooms (radius)" },
          { id: "orbit-spacepause", label: "Spacebar pauses / resumes auto-revolution" },
          { id: "orbit-autorev", label: "Auto-revolution: the ambient slow orbit (screensaver turn)" },
        ],
      },
      {
        title: "Fly mode",
        items: [
          { id: "fly-toggle", label: "F toggles fly ↔ orbit" },
          { id: "fly-wasd", label: "WASD / Q-E fly through the scene" },
          { id: "fly-sprint", label: "Shift sprints" },
          { id: "fly-mouselook", label: "Mouse drag looks around (pointer-lock)" },
          { id: "fly-touchlook", label: "One-finger drag looks (touch)" },
          { id: "fly-touchdolly", label: "Two-finger pinch flies forward / back (touch)" },
          { id: "fly-wheelspeed", label: "Scroll-wheel adjusts fly speed" },
        ],
      },
      {
        title: "Framing / projection / save",
        items: [
          { id: "topdown", label: "Top-down (T) frames the whole city, north-up" },
          { id: "projection", label: "Perspective ↔ orthographic toggle" },
          { id: "save", label: "Save captures the current pose (WYSIWYG)" },
          { id: "restore", label: "Revert / Default restores a saved pose (smooth)" },
          { id: "aspect", label: "Aspect-aware framing (resize the window)" },
        ],
      },
    ],
  },
  {
    route: "/intro — Mac studio",
    groups: [
      {
        title: "Stage (the Mac)",
        items: [
          { id: "intro-stage-orbit", label: "Drag orbits the Mac" },
          { id: "intro-stage-zoom", label: "Pinch / wheel zooms" },
          { id: "intro-stage-dbl", label: "Double-click / tap the stage recenters the studio camera" },
          { id: "intro-mac-dbl", label: "Double-click / tap a Mac focuses + recenters on it" },
        ],
      },
      {
        title: "Screen (the CRT city)",
        items: [
          { id: "intro-screen-enter", label: "Hover (desktop) / tap-to-focus (touch) enters screen interaction" },
          { id: "intro-screen-manip", label: "Drag orbits the city, pinch zooms, two-finger adjusts focus" },
          { id: "intro-screen-dbl", label: "Double-click / tap the screen recenters the city camera" },
          { id: "intro-snowglobe", label: "Snow-globe: the city parallaxes with the camera orbit" },
          { id: "intro-skey", label: "S toggles screen ↔ snow-globe" },
        ],
      },
      {
        title: "Other",
        items: [
          { id: "intro-badge", label: "Apple-badge reroll (tap / click)" },
          { id: "intro-knob", label: "Brightness knob drag / scroll" },
          { id: "intro-turntable", label: "Spacebar (over the screen) turntable auto-orbit" },
        ],
      },
    ],
  },
];

const STORAGE_KEY = "drei-lab.checklist";

// reusable temps for the readout (no per-frame allocation)
const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
// projection-morph temps
const _projTgt = new THREE.Vector3();
const _projMat = new THREE.Matrix4();
const _projTrans = new THREE.Matrix4();
const _projBlend = new THREE.Matrix4();
// drag-look fly temps
const _flyFwd = new THREE.Vector3();
const _flyRight = new THREE.Vector3();
const _flyEuler = new THREE.Euler(0, 0, 0, "YXZ");
const _FLY_UP = new THREE.Vector3(0, 1, 0);
// fly → orbit "from here" temps
const _orbitDir = new THREE.Vector3();
const _orbitFocal = new THREE.Vector3();
const ORBIT_HERE_DIST = 8; // focal distance dropped ahead of the fly camera

function Readout({
  controls,
  onChange,
}: {
  controls: React.RefObject<CameraControlsImpl | null>;
  onChange: (pos: THREE.Vector3, tgt: THREE.Vector3) => void;
}) {
  const last = useRef(0);
  useFrame((state) => {
    // throttle to ~6/s so the overlay isn't a re-render storm
    if (state.clock.elapsedTime - last.current < 0.16) return;
    last.current = state.clock.elapsedTime;
    _pos.copy(state.camera.position); // camera position works in orbit AND fly
    controls.current?.getTarget(_tgt); // target is only meaningful in orbit
    onChange(_pos, _tgt);
  });
  return null;
}

function Satellites() {
  const sats: [string, [number, number, number]][] = [
    ["#e06c75", [9, 1, 0]],
    ["#61afef", [-9, 1, 0]],
    ["#e5c07b", [0, 1, 9]],
    ["#c678dd", [0, 1, -9]],
  ];
  return (
    <>
      {sats.map(([color, p]) => (
        <mesh key={color} position={p} castShadow>
          <sphereGeometry args={[1, 24, 24]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </>
  );
}

// Perspective↔ortho MORPH (no hard camera swap): keeps one PerspectiveCamera and
// rewrites its projection matrix each frame from a receding virtual eye — ortho ==
// perspective with the eye at infinity (same trick as /'s ProjectionBlender).
// `targetRef` is the 0..1 goal; blend damps toward it so the toggle TWEENS. Runs
// after the controls' useFrame (rendered after them) so it owns the projection.
function ProjectionMorph({
  controls,
  targetRef,
}: {
  controls: React.RefObject<CameraControlsImpl | null>;
  targetRef: React.RefObject<number>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const blend = useRef(0);
  useFrame((_, dt) => {
    if (!camera.isPerspectiveCamera) return;
    blend.current = THREE.MathUtils.damp(blend.current, targetRef.current ?? 0, 6, dt);
    const b = blend.current;
    camera.updateProjectionMatrix(); // rebuild pure perspective first
    if (b <= 0.0001) return;

    const c = controls.current;
    if (c) c.getTarget(_projTgt);
    else _projTgt.set(0, 1, 0);
    const d = Math.max(1, camera.position.distanceTo(_projTgt)); // focal distance
    const halfH = d * Math.tan((camera.fov * Math.PI) / 360); // match size at the focal plane
    const aspect = size.width / Math.max(1, size.height);
    const near = camera.near;
    const far = camera.far;

    if (b >= 0.9999) {
      _projMat.makeOrthographic(-aspect * halfH, aspect * halfH, halfH, -halfH, near, far);
      camera.projectionMatrix.copy(_projMat);
      camera.projectionMatrixInverse.copy(_projMat).invert();
      return;
    }
    const u = Math.max(1 - b, 1e-4); // 1 = perspective … 0 = ortho
    const E = d / u; // virtual eye recedes toward infinity as b → 1
    const dz = E - d;
    const top = ((near + dz) * halfH) / E;
    const right = top * aspect;
    _projMat.makePerspective(-right, right, top, -top, near + dz, far + dz);
    _projTrans.makeTranslation(0, 0, -dz);
    _projBlend.multiplyMatrices(_projMat, _projTrans);
    camera.projectionMatrix.copy(_projBlend);
    camera.projectionMatrixInverse.copy(_projBlend).invert();
  });
  return null;
}

// Drag-to-look first-person fly: WASD / Q-E move, and the heading changes ONLY
// while the mouse is held (horizon-locked yaw/pitch, no roll). Releasing frees the
// cursor, so you can move to the settings without the camera re-aiming — the gap
// in drei's FirstPersonControls (which steers continuously from cursor position).
function DragLookFly({
  moveSpeed = 10,
  lookSpeed = 0.0025,
}: {
  moveSpeed?: number;
  lookSpeed?: number;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const keys = useRef<Record<string, boolean>>({});
  const dragging = useRef(false);
  const yaw = useRef(0);
  const pitch = useRef(0);
  const speed = useRef(moveSpeed); // live-adjusted by the wheel (no Shift-sprint)

  // seed yaw/pitch from the camera's current orientation (carry over from orbit)
  useEffect(() => {
    _flyEuler.setFromQuaternion(camera.quaternion);
    yaw.current = _flyEuler.y;
    pitch.current = _flyEuler.x;
  }, [camera]);

  useEffect(() => {
    const dom = gl.domElement;
    // Track deltas from clientX/Y, not e.movementX: movement* is unreliable for
    // touch pointers (iOS Safari reports 0), so it would kill touch-look.
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      dragging.current = true;
      lastX = e.clientX;
      lastY = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      dragging.current = false;
      dom.releasePointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      yaw.current -= (e.clientX - lastX) * lookSpeed;
      pitch.current -= (e.clientY - lastY) * lookSpeed;
      lastX = e.clientX;
      lastY = e.clientY;
      const lim = Math.PI / 2 - 0.01;
      pitch.current = Math.max(-lim, Math.min(lim, pitch.current));
    };
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    // Track by e.code (physical key), not e.key: holding Shift changes the
    // *case* of letter keydowns, which breaks e.key-based held movement; e.code
    // is layout- and modifier-independent and splits ShiftLeft/ShiftRight.
    const kd = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.code === "Space") e.preventDefault(); // Space would scroll the page
      keys.current[e.code] = true;
    };
    const ku = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    // wheel adjusts fly speed (replaces the Shift-sprint idiom — Shift is down)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.001); // scroll up = faster
      speed.current = Math.min(120, Math.max(1, speed.current * f));
    };
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      keys.current = {};
      dragging.current = false;
    };
  }, [gl, lookSpeed]);

  useFrame((_, dt) => {
    _flyEuler.set(pitch.current, yaw.current, 0, "YXZ");
    camera.quaternion.setFromEuler(_flyEuler);
    const k = keys.current;
    const v = speed.current * dt;
    camera.getWorldDirection(_flyFwd);
    _flyRight.crossVectors(_flyFwd, _FLY_UP).normalize();
    if (k["KeyW"]) camera.position.addScaledVector(_flyFwd, v);
    if (k["KeyS"]) camera.position.addScaledVector(_flyFwd, -v);
    if (k["KeyD"]) camera.position.addScaledVector(_flyRight, v);
    if (k["KeyA"]) camera.position.addScaledVector(_flyRight, -v);
    if (k["KeyE"] || k["Space"]) camera.position.y += v; // E / Space = up
    // Q / C / Shift = down
    if (k["KeyQ"] || k["KeyC"] || k["ShiftLeft"] || k["ShiftRight"])
      camera.position.y -= v;
  });

  return null;
}

// Auto-orbit: camera-controls has no autoRotate, so advance the azimuth each
// frame (the screensaver turn). Pauses while the user is actively controlling
// (controlstart/controlend) so a manual drag isn't fought, then resumes.
const AUTO_ORBIT_SPEED = 0.15; // rad/s — gentle
function AutoOrbit({
  controls,
  enabled,
}: {
  controls: React.RefObject<CameraControlsImpl | null>;
  enabled: boolean;
}) {
  const interacting = useRef(false);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const start = () => {
      interacting.current = true;
    };
    const end = () => {
      interacting.current = false;
    };
    c.addEventListener("controlstart", start);
    c.addEventListener("controlend", end);
    return () => {
      c.removeEventListener("controlstart", start);
      c.removeEventListener("controlend", end);
    };
  }, [controls]);
  useFrame((_, dt) => {
    if (!enabled || interacting.current) return;
    controls.current?.rotate(AUTO_ORBIT_SPEED * dt, 0, false);
  });
  return null;
}

export function DreiLab() {
  const controls = useRef<CameraControlsImpl | null>(null);
  const [ortho, setOrtho] = useState(false);
  const orthoTarget = useRef(0); // 0 persp … 1 ortho — ProjectionMorph damps toward it
  const [mode, setMode] = useState<"orbit" | "fly">("orbit");
  const [autoOrbit, setAutoOrbit] = useState(false);
  // how the next orbit-entry frames: "home" tweens back, "fromHere" keeps the
  // fly camera + targets along its look direction
  const flyExit = useRef<"home" | "fromHere">("home");
  const enterFly = useCallback(() => setMode("fly"), []);
  const enterOrbit = useCallback((behavior: "home" | "fromHere") => {
    flyExit.current = behavior;
    setMode("orbit");
  }, []);
  const [readout, setReadout] = useState({ pos: "—", tgt: "—" });
  const [panelOpen, setPanelOpen] = useState(true);

  // checklist tick state, persisted to localStorage (hydration-safe: load in effect)
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate of persisted ticks after mount; the first render stays empty so the static-export prerender doesn't mismatch
      if (raw) setChecked(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // ignore — empty checklist is a fine default
    }
  }, []);
  const toggle = useCallback((id: string) => {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // best effort
      }
      return next;
    });
  }, []);

  const fmt = (v: THREE.Vector3) => `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
  const onReadout = useCallback((pos: THREE.Vector3, tgt: THREE.Vector3) => {
    setReadout({ pos: fmt(pos), tgt: fmt(tgt) });
  }, []);

  // F toggles orbit <-> fly; exiting fly drops into "orbit from here".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (mode === "fly") enterOrbit("fromHere");
      else enterFly();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, enterFly, enterOrbit]);

  // Space toggles auto-orbit in orbit mode (fly mode uses Space for up).
  useEffect(() => {
    if (mode !== "orbit") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      setAutoOrbit((a) => !a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // Entering orbit applies one of two transitions (camera-controls calls the
  // orbit pivot the TARGET): "home" tweens back to the framed centre box;
  // "fromHere" keeps the (fly) camera put and targets a point along its look
  // direction, so you orbit whatever you flew up to.
  useEffect(() => {
    if (mode !== "orbit") return;
    const c = controls.current;
    if (!c) return;
    if (flyExit.current === "home") {
      c.setLookAt(14, 9, 14, 0, 1, 0, true);
    } else {
      const cam = c.camera;
      cam.getWorldDirection(_orbitDir);
      _orbitFocal.copy(cam.position).addScaledVector(_orbitDir, ORBIT_HERE_DIST);
      c.setLookAt(
        cam.position.x,
        cam.position.y,
        cam.position.z,
        _orbitFocal.x,
        _orbitFocal.y,
        _orbitFocal.z,
        false,
      );
    }
  }, [mode]);

  // imperative-API probes — the migration-critical camera-controls calls
  const poseA = () => controls.current?.setLookAt(20, 12, 20, 0, 1, 0, true);
  // Top-down, NORTH UP, framing everything. At a tiny overhead polar,
  // camera-controls' azimuth is atan2(x, z), so azimuth = PI puts +Z (north) at
  // screen-top (azimuth 0 would put -Z up). Snap to that azimuth the SHORTEST
  // way — never the long route the raw-azimuth lerp would take — recentre the
  // target, tilt straight down, then dolly out to frame the content.
  const topDown = useCallback(() => {
    const c = controls.current;
    if (!c) return;
    const NORTH_AZ = Math.PI;
    const cur = c.azimuthAngle;
    let d = (NORTH_AZ - cur) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    c.setTarget(0, 1, 0, true); // recentre so the whole scene is framed
    c.rotateTo(cur + d, 0.0001, true); // north-up azimuth + polar ≈ straight down
    // Dolly out to frame all lab content (±~10 satellites): fit the limiting
    // screen axis for the current aspect. NOTE: lab content only — fitting the
    // real city's live bounds is the app's job, deferred (see GitHub issue).
    const cam = c.camera as THREE.PerspectiveCamera;
    const half = 11;
    const t = Math.tan((cam.fov * Math.PI) / 360);
    c.dollyTo(Math.max(half / t, half / (t * cam.aspect)) * 1.05, true);
  }, []);
  const fit = () =>
    controls.current?.fitToBox(
      new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1)),
      true,
    );
  const save = () => controls.current?.saveState();
  const reset = () => controls.current?.reset(true);

  // T frames the whole scene top-down, north-up (orbit only — the buttons are
  // orbit-gated too; in fly mode CameraControls is unmounted so it'd no-op).
  useEffect(() => {
    if (mode !== "orbit") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      topDown();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, topDown]);

  return (
    <main className="fixed inset-0 flex bg-[#080c18] text-white">
      {/* left sidebar — controls + acceptance checklist (collapsible for mobile) */}
      <LabSidebar open={panelOpen} onOpenChange={setPanelOpen} width={340}>
        <div className="flex items-baseline justify-between">
          <h1 className="font-mono text-sm text-zinc-300">drei lab</h1>
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
        <p className="-mt-3 text-xs text-zinc-500">phase-0 camera-controls spike</p>

            <Section title="mode">
              <Label className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-normal text-zinc-300">
                <span>
                  fly mode <span className="text-zinc-600">(F)</span>
                </span>
                <Switch
                  checked={mode === "fly"}
                  onCheckedChange={(c) => (c ? enterFly() : enterOrbit("fromHere"))}
                />
              </Label>
              <Label className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-normal text-zinc-300">
                <span>
                  auto-orbit <span className="text-zinc-600">(Space)</span>
                </span>
                <Switch checked={autoOrbit} onCheckedChange={setAutoOrbit} />
              </Label>
              {mode === "fly" && (
                <div className="grid grid-cols-1 gap-2">
                  <Button variant="outline" size="sm" onClick={() => enterOrbit("fromHere")}>
                    exit → orbit from here
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => enterOrbit("home")}>
                    exit → return to orbit (home)
                  </Button>
                </div>
              )}
              <p className="text-[11px] text-zinc-500">
                {mode === "orbit"
                  ? "orbit pivots on the target (= focus point); right-drag / two-finger trucks it"
                  : "WASD move · E/Space up, Q/C/Shift down · wheel = speed · hold-drag to look (horizon-locked); release frees the cursor."}
              </p>
            </Section>

            <Section title="projection">
              <Label className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-normal text-zinc-300">
                <span>
                  orthographic <span className="text-zinc-600">(tweens)</span>
                </span>
                <Switch
                  checked={ortho}
                  onCheckedChange={(c) => {
                    setOrtho(c);
                    orthoTarget.current = c ? 1 : 0;
                  }}
                />
              </Label>
            </Section>

            <Section title="camera-controls api">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" disabled={mode === "fly"} onClick={poseA}>
                  transition A
                </Button>
                <Button variant="outline" size="sm" disabled={mode === "fly"} onClick={topDown}>
                  top-down (T)
                </Button>
                <Button variant="outline" size="sm" disabled={mode === "fly"} onClick={fit}>
                  fitToBox
                </Button>
                <Button variant="outline" size="sm" disabled={mode === "fly"} onClick={save}>
                  saveState
                </Button>
                <Button variant="outline" size="sm" disabled={mode === "fly"} onClick={reset}>
                  reset
                </Button>
              </div>
            </Section>

            <Section title="focus point">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mode === "fly"}
                  onClick={() => controls.current?.setTarget(0, 1, 0, true)}
                >
                  → centre
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mode === "fly"}
                  onClick={() => controls.current?.setTarget(9, 1, 0, true)}
                >
                  → red
                </Button>
              </div>
              <div className="font-mono text-[10px] text-zinc-500">
                pos [{readout.pos}]
                <br />
                tgt [{readout.tgt}]
              </div>
            </Section>

            {CHECKLIST.map((sectionData) => (
              <Section key={sectionData.route} title={sectionData.route}>
                {sectionData.groups.map((g) => (
                  <div key={g.title} className="flex flex-col gap-1.5">
                    <div className="font-mono text-[11px] text-zinc-600">{g.title}</div>
                    {g.items.map((it) => (
                      <Label
                        key={it.id}
                        className="flex w-full cursor-pointer items-center justify-between gap-3 text-[11px] leading-snug font-normal text-zinc-300"
                      >
                        <span className={checked[it.id] ? "text-zinc-600 line-through" : ""}>
                          {it.label}
                        </span>
                        <Switch checked={!!checked[it.id]} onCheckedChange={() => toggle(it.id)} />
                      </Label>
                    ))}
                  </div>
                ))}
              </Section>
            ))}
      </LabSidebar>

      {/* right pane — the live scene */}
      <div className="relative flex-1">
        <Canvas shadows dpr={[1, 2]} style={{ touchAction: "none" }}>
          {/* one perspective camera always; ProjectionMorph rewrites its matrix
              to tween toward ortho — no hard camera swap, so it doesn't snap */}
          <PerspectiveCamera makeDefault position={[14, 9, 14]} fov={45} near={0.1} far={500} />
          {mode === "orbit" ? (
            <>
              <CameraControls ref={controls} />
              <AutoOrbit controls={controls} enabled={autoOrbit} />
            </>
          ) : (
            <DragLookFly moveSpeed={12} lookSpeed={0.0025} />
          )}
          {/* after the controls so it owns the final projection matrix */}
          <ProjectionMorph controls={controls} targetRef={orthoTarget} />
          <Readout controls={controls} onChange={onReadout} />

          <ambientLight intensity={0.6} />
          <directionalLight position={[6, 10, 6]} intensity={1.3} castShadow />
          <Grid
            args={[60, 60]}
            infiniteGrid
            fadeDistance={70}
            cellColor="#333"
            sectionColor="#555"
            position={[0, 0, 0]}
          />
          {/* centre target (the fitToBox + focus subject) + cardinal satellites */}
          <mesh position={[0, 1, 0]} castShadow>
            <boxGeometry args={[2, 2, 2]} />
            <meshStandardMaterial color="#5fb89e" />
          </mesh>
          <Satellites />

          <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
            <GizmoViewport labelColor="white" axisHeadScale={1} />
          </GizmoHelper>
        </Canvas>
      </div>
    </main>
  );
}
