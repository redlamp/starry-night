"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import type CameraControlsImpl from "camera-controls";
import { Vector3 } from "three";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LabSidebar, LabSection } from "@/components/ui/lab-controls";
import { RangeSlider } from "@/components/ui/value-slider";
import { HelpHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { APPROACHES, approachById, type TexView, type WindowRanges } from "./approaches";
import { TextureInspector } from "./TextureInspector";
import { TextureHoverTip } from "./TextureHoverTip";
import { LAB_POSES, LAB_SEED, RACK_GAP, SPECIMENS, SPECIMEN_GROUPS } from "./specimens";

// Window Lab (/window-lab): an isolated bench for trying NEW ways to build and
// light building windows, untethered from the production city (user 2026-07-03).
// Groups A and B render the same deterministic specimen rack side by side — A at
// x=0, B at x=+RACK_GAP — mirrored down to each building's window-size roll, so
// any visual difference is the approach itself. The rack reproduces the three
// #82 artifact regimes (colour-coded ground outlines + legend); camera presets
// aim at each on group A, and the jump button carries the exact framing across
// to the other group. State mirrors to ?a=&b=&pose= so a lab setup is shareable
// like a view link.

const DEFAULT_A = "current";
const DEFAULT_B = "baked-mip";

// Default window ranges: the app's SIMPLE-mode default (0.22-0.38 wide) reads
// far sparser than the shipped city, which runs advanced per-archetype
// profiles. This band spans the tower profiles the rack is built from
// (office-block 0.7-0.86, narrow 0.62-0.78, residential 0.38-0.54), so the
// reference group still looks like the reference.
const LAB_WINDOW_DEFAULT: WindowRanges = { wMin: 0.5, wMax: 0.8, hMin: 0.5, hMax: 0.7 };

// View tabs: "both" lays the groups out side by side; "a" / "b" render that
// group's construction alone AT THE ORIGIN, so flipping A <-> B swaps the
// approach in place under a frozen camera — the sharpest way to diff them
// (replaces the old camera-jump button, user 2026-07-03).
type LabView = "a" | "both" | "b";

// Active/inactive toggle-button convention borrowed from the main panels
// (WindowsPanel mode buttons).
const BTN_ON = "bg-foreground text-background hover:bg-foreground";
const BTN_OFF = "bg-foreground/10 text-foreground hover:bg-foreground/20";

export function WindowLab() {
  const [open, setOpen] = useState(true);
  const [aId, setAId] = useState(DEFAULT_A);
  const [bId, setBId] = useState<string>(DEFAULT_B);
  const [poseId, setPoseId] = useState("overview");
  const [view, setView] = useState<LabView>("both");
  const [windows, setWindows] = useState<WindowRanges>(LAB_WINDOW_DEFAULT);
  // Texture-layer views, one per group (user 2026-07-03): render the group's
  // racks as their final composite, raw cell atlas, or window field — layer
  // debugging in place, on the actual buildings.
  const [texViewA, setTexViewA] = useState<TexView>("final");
  const [texViewB, setTexViewB] = useState<TexView>("final");
  // State-ref, not useRef: R3F mounts Canvas children a beat after this
  // component's effects run, so the pose effect must re-fire when the controls
  // actually attach (same trap as base-ui portal refs).
  const [controls, setControls] = useState<CameraControlsImpl | null>(null);
  const booted = useRef(false);

  // Adopt ?a=&b=&pose= after mount (post-hydration, same pattern as the other
  // labs' persisted-state reads — the first paint uses defaults either way).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const a = q.get("a");
    const b = q.get("b");
    const pose = q.get("pose");
    const v = q.get("view");
    const ta = q.get("ta");
    const tb = q.get("tb");
    /* eslint-disable react-hooks/set-state-in-effect -- one-time URL adoption */
    if (approachById(a)) setAId(a!);
    if (approachById(b)) setBId(b!);
    if (LAB_POSES.some((p) => p.id === pose)) setPoseId(pose!);
    if (v === "a" || v === "both" || v === "b") setView(v);
    if (approachById(a ?? DEFAULT_A)?.texViews.some((t) => t.id === ta)) setTexViewA(ta as TexView);
    if (approachById(b ?? DEFAULT_B)?.texViews.some((t) => t.id === tb)) setTexViewB(tb as TexView);
    /* eslint-enable react-hooks/set-state-in-effect */
    booted.current = true;
  }, []);

  // Mirror lab state back to the address bar (shareable, like view links).
  useEffect(() => {
    if (!booted.current) return;
    const url = `${window.location.pathname}?a=${aId}&b=${bId}&pose=${poseId}&view=${view}&ta=${texViewA}&tb=${texViewB}`;
    window.history.replaceState(null, "", url);
  }, [aId, bId, poseId, view, texViewA, texViewB]);

  // Switching a group's approach keeps the layer view only if the new
  // approach has it (baked-mip has no atlas/field layer, for instance).
  const pickA = useCallback(
    (id: string) => {
      setAId(id);
      setTexViewA((t) => (approachById(id)?.texViews.some((o) => o.id === t) ? t : "final"));
    },
    [],
  );
  const pickB = useCallback(
    (id: string) => {
      setBId(id);
      setTexViewB((t) => (approachById(id)?.texViews.some((o) => o.id === t) ? t : "final"));
    },
    [],
  );

  // Fly to the selected pose. First application (page load) snaps; later ones glide.
  const posedOnce = useRef(false);
  useEffect(() => {
    const pose = LAB_POSES.find((p) => p.id === poseId);
    if (!controls || !pose) return;
    void controls.setLookAt(...pose.pos, ...pose.target, posedOnce.current);
    posedOnce.current = true;
  }, [controls, poseId]);

  const a = approachById(aId);
  const b = approachById(bId);
  const [perf, setPerf] = useState<PerfStats | null>(null);
  const [texOpen, setTexOpen] = useState(false);
  const [texTime, setTexTime] = useState(0);

  // Scene-clock bridge (PerfProbe writes it every frame): texture inspector and
  // hover tooltip bake at the CURRENT wake/sleep time, matching the racks.
  const clockRef = useRef<{ elapsedTime: number } | null>(null);

  // Hover-to-inspect: building + which group's approach + the scene time the
  // hover started (stored once per building change, so the tooltip doesn't
  // re-bake on every pointer move).
  const [hover, setHover] = useState<{ id: number; approach: string; t: number } | null>(null);
  const [hoverTips, setHoverTips] = useState(true);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });

  // First-frame placement: the tooltip mounts one commit AFTER the pointer
  // event that set `hover`, so without this it flashes at (0,0) until the next
  // move. Applies the remembered cursor position as soon as the tip exists.
  useEffect(() => {
    if (!hover) return;
    placeTip(tipRef.current, lastPointer.current.x, lastPointer.current.y);
  }, [hover]);
  const hoverFor = useCallback((approach: string, id: number | null) => {
    setHover((h) => {
      if (id == null) return null;
      if (h && h.id === id && h.approach === approach) return h;
      return { id, approach, t: clockRef.current?.elapsedTime ?? 0 };
    });
  }, []);
  const onHoverA = useCallback((id: number | null) => hoverFor(aId, id), [hoverFor, aId]);
  const onHoverB = useCallback((id: number | null) => hoverFor(bId, id), [hoverFor, bId]);

  // Double-click focus: TWEEN to frame the building (user 2026-07-03). Keeps
  // the current sight-line — the camera dollies toward the building along the
  // direction it's already looking from, so the move never disorients.
  const focusFor = useCallback(
    (offsetX: number, id: number) => {
      if (!controls) return;
      const b = SPECIMENS.find((s) => s.id === id);
      if (!b) return;
      const target = new Vector3(b.x + offsetX, b.height * 0.55, b.z);
      const dir = controls.getPosition(new Vector3()).sub(target);
      const dist = Math.max(b.height * 1.6, Math.max(b.width, b.depth) * 3.5, 90);
      dir.normalize().multiplyScalar(dist);
      void controls.setLookAt(
        target.x + dir.x,
        target.y + dir.y,
        target.z + dir.z,
        target.x,
        target.y,
        target.z,
        true,
      );
    },
    [controls],
  );
  const onFocusA = useCallback((id: number) => focusFor(0, id), [focusFor]);
  // Group B's rack sits at +RACK_GAP only in the side-by-side view; alone it
  // renders at the origin.
  const onFocusB = useCallback(
    (id: number) => focusFor(view === "both" ? RACK_GAP : 0, id),
    [focusFor, view],
  );

  return (
    <div className="flex h-dvh w-full bg-black text-zinc-200">
      <LabSidebar open={open} onOpenChange={setOpen}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-sm tracking-wider text-zinc-300 uppercase">
              Window Lab
            </h1>
            <HelpHint side="bottom">
              A bench for new building/window constructions, untethered from the production city.
              Groups A and B render identical specimens — same buildings, same lit cells, same
              window-size rolls — so what differs on screen is the approach.
            </HelpHint>
          </div>
          <Link href="/" className="text-sm text-zinc-500 underline-offset-2 hover:underline">
            back to the city
          </Link>
        </div>

        <LabSection title="view">
          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as LabView)} className="flex-1">
              <TabsList className="w-full">
                <TabsTrigger value="both">Both</TabsTrigger>
                <TabsTrigger value="a">Group A</TabsTrigger>
                <TabsTrigger value="b">Group B</TabsTrigger>
              </TabsList>
            </Tabs>
            <HelpHint side="right">
              Both = side by side (A left, B right). Group A / Group B render that construction
              alone at the same spot — flip between them under a still camera to diff the
              approaches in place.
            </HelpHint>
          </div>
        </LabSection>

        <LabSection title="group a">
          <ApproachPicker value={aId} onChange={pickA} />
        </LabSection>

        <LabSection title="group b">
          <ApproachPicker value={bId} onChange={pickB} />
        </LabSection>

        <LabSection title="textures">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className={cn("flex-1 justify-start", texOpen ? BTN_ON : BTN_OFF)}
              onClick={() => {
                setTexTime(clockRef.current?.elapsedTime ?? 0);
                setTexOpen((v) => !v);
              }}
            >
              Inspect textures
            </Button>
            <HelpHint side="right">
              The raw bitmaps behind each approach, flat on screen: the shared one-texel-per-window
              atlas (colours + cell kinds), every baked facade, and the SDF field channels.
            </HelpHint>
          </div>
          <div className="flex items-center gap-2">
            <TexViewSelect approachId={aId} value={texViewA} onChange={setTexViewA} label="A" />
            <TexViewSelect approachId={bId} value={texViewB} onChange={setTexViewB} label="B" />
            <HelpHint side="right">
              What each group renders on its buildings: the final composite, the raw cell atlas the
              shader samples, or the window field/mask that shapes the panes — layer-by-layer
              debugging of how the textures work together. Atlas + SDF has no field texture; its
              field view renders the analytic distance evaluation.
            </HelpHint>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-300">hover details</span>
              <HelpHint side="right">
                Hover a building to see its textures at source size, beside the cursor.
              </HelpHint>
            </div>
            <Switch
              checked={hoverTips}
              onCheckedChange={(v) => {
                setHoverTips(v);
                if (!v) setHover(null);
              }}
            />
          </div>
        </LabSection>

        <LabSection title="windows">
          <RangeSlider
            label="width"
            hint="Glass-to-cell fraction, same as the main app's simple window mode: each building rolls one width and one height from these ranges; both groups share the roll."
            value={[windows.wMin, windows.wMax]}
            min={0.1}
            max={1}
            step={0.01}
            onChange={([wMin, wMax]) => setWindows((w) => ({ ...w, wMin, wMax }))}
          />
          <RangeSlider
            label="height"
            value={[windows.hMin, windows.hMax]}
            min={0.1}
            max={1}
            step={0.01}
            onChange={([hMin, hMax]) => setWindows((w) => ({ ...w, hMin, hMax }))}
          />
        </LabSection>

        <LabSection title="camera">
          <div className="flex flex-col gap-1.5">
            {LAB_POSES.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className={cn("flex-1 justify-start", poseId === p.id ? BTN_ON : BTN_OFF)}
                  onClick={() => setPoseId(p.id)}
                >
                  {p.name}
                </Button>
                {p.id !== "overview" ? (
                  <span
                    className="size-3 shrink-0 rounded-[3px]"
                    style={{
                      backgroundColor: SPECIMEN_GROUPS.find((g) => g.id === p.id)?.color,
                    }}
                  />
                ) : (
                  <span className="size-3 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </LabSection>

        <LabSection title="specimens">
          <div className="flex flex-col gap-1.5">
            {SPECIMEN_GROUPS.map((g) => (
              <div key={g.id} className="flex items-center gap-2 text-sm">
                <span
                  className="size-3 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: g.color }}
                />
                <span className="flex-1 text-zinc-300">{g.name}</span>
                <HelpHint side="right">{g.blurb}</HelpHint>
              </div>
            ))}
          </div>
        </LabSection>
      </LabSidebar>

      <div
        className="relative min-w-0 flex-1"
        onPointerMove={(e) => {
          // Cursor-follow for the hover tooltip, imperative so pointer moves
          // don't re-render.
          lastPointer.current = { x: e.clientX, y: e.clientY };
          placeTip(tipRef.current, e.clientX, e.clientY);
        }}
      >
        <TextureInspector
          open={texOpen}
          onClose={() => setTexOpen(false)}
          windows={windows}
          timeSec={texTime}
          onRefresh={() => setTexTime(clockRef.current?.elapsedTime ?? 0)}
        />
        {hover ? (
          // w-max: a fixed element with only `left` set shrink-to-fits against
          // the viewport edge BEFORE the translate flips it back, which made
          // the panel narrow near the right edge. max-content sizes it to its
          // content no matter where the cursor is.
          <div ref={tipRef} className="pointer-events-none fixed z-30 w-max">
            <TextureHoverTip
              buildingId={hover.id}
              approachId={hover.approach}
              windows={windows}
              timeSec={hover.t}
            />
          </div>
        ) : null}
        {/* Perf readout for benchmarking on real hardware (the iMac M4 test,
            user 2026-07-03) — frame stats per view/pose without dev tools. */}
        {perf ? (
          <div className="pointer-events-none absolute top-2 right-2 z-10 rounded-md bg-black/60 px-2.5 py-1.5 font-mono text-sm text-zinc-300 tabular-nums">
            {perf.fps.toFixed(0)} fps · {perf.ms.toFixed(1)} ms · p95 {perf.p95.toFixed(1)} ·{" "}
            {perf.calls} calls · dpr {perf.dpr.toFixed(2)}
          </div>
        ) : null}
        <Canvas
          flat
          camera={{ fov: 40, near: 1, far: 30000, position: LAB_POSES[0].pos }}
          gl={{ antialias: true }}
        >
          <PerfProbe onStats={setPerf} clockRef={clockRef} />
          <color attach="background" args={["#05060f"]} />
          <CameraControls ref={setControls} makeDefault />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
            <planeGeometry args={[40000, 40000]} />
            <meshBasicMaterial color="#04040a" toneMapped={false} />
          </mesh>
          <GroundOutlines offsetX={0} />
          {view === "both" && b ? <GroundOutlines offsetX={RACK_GAP} /> : null}
          {view !== "b" && a ? (
            <group>
              <a.Rack
                specimens={SPECIMENS}
                seed={LAB_SEED}
                windows={windows}
                texView={texViewA}
                onHover={hoverTips ? onHoverA : undefined}
                onFocus={onFocusA}
              />
            </group>
          ) : null}
          {view === "both" && b ? (
            <group position={[RACK_GAP, 0, 0]}>
              <b.Rack
                specimens={SPECIMENS}
                seed={LAB_SEED}
                windows={windows}
                texView={texViewB}
                onHover={hoverTips ? onHoverB : undefined}
                onFocus={onFocusB}
              />
            </group>
          ) : null}
          {view === "b" && b ? (
            <group>
              <b.Rack
                specimens={SPECIMENS}
                seed={LAB_SEED}
                windows={windows}
                texView={texViewB}
                onHover={hoverTips ? onHoverB : undefined}
                onFocus={onFocusB}
              />
            </group>
          ) : null}
        </Canvas>
      </div>
    </div>
  );
}

// Position the hover tooltip beside the cursor, flipping to the other side
// near the viewport edges, then clamp: tall source-size bakes can exceed the
// space between cursor and edge, and the header must stay on screen.
function placeTip(el: HTMLDivElement | null, x: number, y: number): void {
  if (!el) return;
  const flipX = x > window.innerWidth * 0.55;
  const flipY = y > window.innerHeight * 0.5;
  let left = x + (flipX ? -14 : 14);
  let top = y + (flipY ? -14 : 14);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.transform = `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`;
  const r = el.getBoundingClientRect();
  if (r.top < 8) top += 8 - r.top;
  if (r.left < 8) left += 8 - r.left;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

type PerfStats = { fps: number; ms: number; p95: number; calls: number; dpr: number };

// Samples real frame deltas inside the Canvas and reports a 1 s summary to the
// HUD. p95 is the tell for the baked approach's per-frame re-bakes: a steady
// avg with a spiky p95 means the bakes are breaking cadence on this hardware.
// Doubles as the scene-clock bridge for the texture inspector / hover tooltip.
function PerfProbe({
  onStats,
  clockRef,
}: {
  onStats: (s: PerfStats) => void;
  clockRef: React.MutableRefObject<{ elapsedTime: number } | null>;
}) {
  const gl = useThree((s) => s.gl);
  const buf = useRef<number[]>([]);
  const last = useRef(0);
  const acc = useRef(0);
  useFrame((state) => {
    clockRef.current = state.clock;
    const now = performance.now();
    if (last.current === 0) {
      last.current = now;
      return;
    }
    const dt = now - last.current;
    last.current = now;
    buf.current.push(dt);
    acc.current += dt;
    if (acc.current < 1000) return;
    const d = buf.current.slice().sort((x, y) => x - y);
    const avg = d.reduce((s, v) => s + v, 0) / d.length;
    onStats({
      fps: 1000 / avg,
      ms: avg,
      p95: d[Math.floor(d.length * 0.95)],
      calls: gl.info.render.calls,
      dpr: gl.getPixelRatio(),
    });
    buf.current = [];
    acc.current = 0;
  });
  return null;
}

// Texture-layer dropdown for one group — options come from that group's
// approach (only the layers it actually has).
function TexViewSelect({
  approachId,
  value,
  onChange,
  label,
}: {
  approachId: string;
  value: TexView;
  onChange: (v: TexView) => void;
  label: string;
}) {
  const options = approachById(approachId)?.texViews ?? [];
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="text-sm text-zinc-500">{label}</span>
      <Select value={value} onValueChange={(v) => v && onChange(v as TexView)}>
        <SelectTrigger size="sm" className="bg-background/50 text-foreground w-full min-w-0">
          <SelectValue placeholder="layer" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Vertical stack of full-width approach buttons, one "?" per row for the blurb
// (details live behind the marker, not inline). Hiding a group is the view
// tabs' job now — no "None" entry (user 2026-07-03).
function ApproachPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {APPROACHES.map((ap) => (
        <div key={ap.id} className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className={cn("flex-1 justify-start", value === ap.id ? BTN_ON : BTN_OFF)}
            onClick={() => onChange(ap.id)}
          >
            {ap.name}
          </Button>
          <HelpHint side="right">{ap.blurb}</HelpHint>
        </div>
      ))}
    </div>
  );
}

// Colour-coded ground frames around each specimen group (legend colours), one
// set per rack. Thin flat boxes instead of GL lines so they stay visible at
// distance and don't hit the 1 px line-width cap.
function GroundOutlines({ offsetX }: { offsetX: number }) {
  return (
    <group position={[offsetX, 0, 0]}>
      {SPECIMEN_GROUPS.map((g) => {
        const { x0, x1, z0, z1 } = g.rect;
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        const w = x1 - x0;
        const d = z1 - z0;
        const t = 4; // frame thickness (world units)
        const h = 0.5;
        const y = 0.25;
        return (
          <group key={g.id}>
            <mesh position={[cx, y, z0]}>
              <boxGeometry args={[w + t, h, t]} />
              <meshBasicMaterial color={g.color} toneMapped={false} />
            </mesh>
            <mesh position={[cx, y, z1]}>
              <boxGeometry args={[w + t, h, t]} />
              <meshBasicMaterial color={g.color} toneMapped={false} />
            </mesh>
            <mesh position={[x0, y, cz]}>
              <boxGeometry args={[t, h, d + t]} />
              <meshBasicMaterial color={g.color} toneMapped={false} />
            </mesh>
            <mesh position={[x1, y, cz]}>
              <boxGeometry args={[t, h, d + t]} />
              <meshBasicMaterial color={g.color} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
