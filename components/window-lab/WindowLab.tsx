"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Canvas } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import type CameraControlsImpl from "camera-controls";
import { Button } from "@/components/ui/button";
import { LabSidebar, LabSection } from "@/components/ui/lab-controls";
import { cn } from "@/lib/utils";
import { APPROACHES, approachById } from "./approaches";
import { LAB_POSES, LAB_SEED, RACK_GAP, SPECIMENS } from "./specimens";

// Window Lab (/window-lab): an isolated bench for trying NEW ways to build and
// light building windows, untethered from the production city (user 2026-07-03).
// Two slots render the same deterministic specimen rack side by side — slot A at
// x=0, slot B at x=+900 — so any visual difference is the approach itself. The
// rack reproduces the three #82 artifact regimes (graze wall / mid cluster / far
// forest); camera presets aim at each. State mirrors to ?a=&b=&pose= so a lab
// setup is shareable like a view link.

const DEFAULT_A = "current";
const DEFAULT_B = "baked-mip";

export function WindowLab() {
  const [open, setOpen] = useState(true);
  const [aId, setAId] = useState(DEFAULT_A);
  const [bId, setBId] = useState<string>(DEFAULT_B); // "none" hides slot B
  const [poseId, setPoseId] = useState("overview");
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
    /* eslint-disable react-hooks/set-state-in-effect -- one-time URL adoption */
    if (approachById(a)) setAId(a!);
    if (b === "none" || approachById(b)) setBId(b!);
    if (LAB_POSES.some((p) => p.id === pose)) setPoseId(pose!);
    /* eslint-enable react-hooks/set-state-in-effect */
    booted.current = true;
  }, []);

  // Mirror lab state back to the address bar (shareable, like view links).
  useEffect(() => {
    if (!booted.current) return;
    const url = `${window.location.pathname}?a=${aId}&b=${bId}&pose=${poseId}`;
    window.history.replaceState(null, "", url);
  }, [aId, bId, poseId]);

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

  return (
    <div className="flex h-dvh w-full bg-black text-zinc-200">
      <LabSidebar open={open} onOpenChange={setOpen}>
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="font-mono text-sm tracking-wider text-zinc-300 uppercase">Window Lab</h1>
          <Link href="/" className="text-xs text-zinc-500 underline-offset-2 hover:underline">
            back to the city
          </Link>
        </div>
        <p className="text-xs leading-relaxed text-zinc-500">
          Same specimens, two constructions, side by side. Slot A is the left rack, slot B the
          right. Presets aim at the three artifact regimes on rack A; drag to compare rack B.
        </p>

        <LabSection title="slot a (left)">
          <ApproachPicker value={aId} onChange={setAId} />
          {a ? <p className="text-xs leading-relaxed text-zinc-500">{a.blurb}</p> : null}
        </LabSection>

        <LabSection title="slot b (right)">
          <ApproachPicker value={bId} onChange={setBId} allowNone />
          {b ? <p className="text-xs leading-relaxed text-zinc-500">{b.blurb}</p> : null}
        </LabSection>

        <LabSection title="camera">
          <div className="flex flex-wrap gap-1.5">
            {LAB_POSES.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant="secondary"
                className={cn(
                  poseId === p.id
                    ? "bg-amber-300 text-black hover:bg-amber-300/90"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700",
                )}
                onClick={() => setPoseId(p.id)}
              >
                {p.name}
              </Button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-zinc-600">
            Graze wall = anisotropic churn. Mid cluster = the 2.5-8 px moire band. Far forest =
            sub-pixel confetti.
          </p>
        </LabSection>
      </LabSidebar>

      <div className="relative min-w-0 flex-1">
        <Canvas
          flat
          camera={{ fov: 40, near: 1, far: 30000, position: LAB_POSES[0].pos }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={["#05060f"]} />
          <CameraControls ref={setControls} makeDefault />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
            <planeGeometry args={[40000, 40000]} />
            <meshBasicMaterial color="#04040a" toneMapped={false} />
          </mesh>
          {a ? (
            <group>
              <a.Rack specimens={SPECIMENS} seed={LAB_SEED} />
            </group>
          ) : null}
          {b ? (
            <group position={[RACK_GAP, 0, 0]}>
              <b.Rack specimens={SPECIMENS} seed={LAB_SEED} />
            </group>
          ) : null}
        </Canvas>
      </div>
    </div>
  );
}

function ApproachPicker({
  value,
  onChange,
  allowNone = false,
}: {
  value: string;
  onChange: (id: string) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {APPROACHES.map((ap) => (
        <Button
          key={ap.id}
          size="sm"
          variant="secondary"
          className={cn(
            value === ap.id
              ? "bg-amber-300 text-black hover:bg-amber-300/90"
              : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700",
          )}
          onClick={() => onChange(ap.id)}
        >
          {ap.name}
        </Button>
      ))}
      {allowNone ? (
        <Button
          size="sm"
          variant="secondary"
          className={cn(
            value === "none"
              ? "bg-amber-300 text-black hover:bg-amber-300/90"
              : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700",
          )}
          onClick={() => onChange("none")}
        >
          None
        </Button>
      ) : null}
    </div>
  );
}
