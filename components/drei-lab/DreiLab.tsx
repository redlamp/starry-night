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
import { Canvas, useFrame } from "@react-three/fiber";
import {
  CameraControls,
  FlyControls,
  Grid,
  GizmoHelper,
  GizmoViewport,
  PerspectiveCamera,
  OrthographicCamera,
} from "@react-three/drei";
import type CameraControlsImpl from "camera-controls";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LabSection as Section } from "@/components/ui/lab-controls";

type Projection = "perspective" | "orthographic";

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

export function DreiLab() {
  const controls = useRef<CameraControlsImpl | null>(null);
  const [projection, setProjection] = useState<Projection>("perspective");
  const [mode, setMode] = useState<"orbit" | "fly">("orbit");
  const [readout, setReadout] = useState({ pos: "—", tgt: "—" });

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

  // F toggles orbit <-> fly (matches `/`).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      setMode((m) => (m === "orbit" ? "fly" : "orbit"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Orbit pivots on the "focus point" — camera-controls calls it the TARGET.
  // Frame the centre box as the target whenever we (re)enter orbit, or swap
  // projection (which remounts the controls and would reset the target to origin).
  useEffect(() => {
    if (mode !== "orbit") return;
    controls.current?.setLookAt(14, 9, 14, 0, 1, 0, true);
  }, [mode, projection]);

  // imperative-API probes — the migration-critical camera-controls calls
  const poseA = () => controls.current?.setLookAt(20, 12, 20, 0, 1, 0, true);
  // Top-down: rotate ONLY the polar angle to straight-down, keeping the current
  // azimuth — so it never sweeps the long way round. camera-controls lerps the
  // raw azimuth, so setLookAt to a fixed overhead point can take the 300°-route.
  const topDown = () => controls.current?.rotatePolarTo(0.0001, true);
  const fit = () =>
    controls.current?.fitToBox(
      new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1)),
      true,
    );
  const save = () => controls.current?.saveState();
  const reset = () => controls.current?.reset(true);

  return (
    <main className="fixed inset-0 flex bg-[#080c18] text-white">
      {/* left sidebar — controls + acceptance checklist */}
      <aside className="w-[340px] max-w-[88vw] shrink-0">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-4 p-4">
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
                  onCheckedChange={(c) => setMode(c ? "fly" : "orbit")}
                />
              </Label>
              <p className="text-[11px] text-zinc-500">
                {mode === "orbit"
                  ? "orbit pivots on the target (= focus point); right-drag / two-finger trucks it"
                  : "WASD / R-F move · drag to look — drei FlyControls (stock; rolls). Migration pairs it with PointerLockControls."}
              </p>
            </Section>

            <Section title="projection">
              <Label className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-normal text-zinc-300">
                orthographic
                <Switch
                  checked={projection === "orthographic"}
                  onCheckedChange={(c) => setProjection(c ? "orthographic" : "perspective")}
                />
              </Label>
            </Section>

            <Section title="camera-controls api">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" disabled={mode === "fly"} onClick={poseA}>
                  transition A
                </Button>
                <Button variant="outline" size="sm" disabled={mode === "fly"} onClick={topDown}>
                  top-down
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
          </div>
        </ScrollArea>
      </aside>

      {/* right pane — the live scene */}
      <div className="relative flex-1">
        <Canvas shadows dpr={[1, 2]} style={{ touchAction: "none" }}>
          {projection === "perspective" ? (
            <PerspectiveCamera makeDefault position={[14, 9, 14]} fov={45} near={0.1} far={500} />
          ) : (
            <OrthographicCamera makeDefault position={[14, 9, 14]} zoom={28} near={0.1} far={500} />
          )}
          {/* key=projection forces a re-bind when the default camera swaps */}
          {mode === "orbit" ? (
            <CameraControls key={projection} ref={controls} />
          ) : (
            <FlyControls movementSpeed={12} rollSpeed={0.4} dragToLook />
          )}
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
