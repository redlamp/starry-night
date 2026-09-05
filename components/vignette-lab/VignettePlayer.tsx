"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clipboard, Download, Pause, Play, Repeat } from "lucide-react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { useGeneratedCity } from "@/lib/hooks/useGeneratedCity";
import { generateCity } from "@/lib/seed/cityGen";
import { liveViewPose } from "@/lib/scene/viewLink";
import { sharedTime } from "@/lib/shaders/sharedTime";
import {
  generateVignette,
  type MoveKind,
  type Vignette,
  type VignetteShot,
} from "@/lib/vignette/shotList";
import {
  applyHoldMove,
  DEFAULT_TRANSITION_EASE,
  DEFAULT_TRANSITION_SEC,
  ease,
  lerpPose,
} from "@/lib/vignette/moveMath";
import { parseVignetteJSON, serializeVignette, shotViewLink } from "@/lib/vignette/shotIO";
import { LabSidebar, LabSection } from "@/components/ui/lab-controls";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { ShotTable } from "./ShotTable";

type Phase = "transition" | "hold";

// A shot's active duration on the timeline: transition-in (if it moves in,
// zero for a cut) plus its hold.
function shotDuration(shot: VignetteShot): number {
  const trans = shot.transitionIn === "move" ? (shot.transitionSec ?? DEFAULT_TRANSITION_SEC) : 0;
  return trans + shot.holdSec;
}

function totalDuration(shots: VignetteShot[]): number {
  return shots.reduce((sum, s) => sum + shotDuration(s), 0);
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Drives the real city camera (Scene.tsx, mounted by VignetteLab) through a
// deterministic shot list. Cameo mode: sets cameraMode "still" and writes
// cameraIntent every frame from here — the same channel `?cam=` view links
// use (lib/scene/viewLink). See wiki/projects/vignette-lab.md for the design.
//
// Clock discipline (CLAUDE.md determinism contract): every animation here is
// driven by elapsed seconds sampled from `sharedTime` (lib/shaders/sharedTime,
// advanced by the Canvas's own useFrame delta) — never Date.now/performance.now.
// requestAnimationFrame is scheduling only; the values it reads are the clock.
export function VignettePlayer() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const { ready } = useGeneratedCity(masterSeed, cityShape);

  const [vignette, setVignette] = useState<Vignette | null>(null);
  const generatedForSeed = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (generatedForSeed.current === masterSeed && vignette) return;
    const city = generateCity(masterSeed, cityShape, cityShapeScale);
    generatedForSeed.current = masterSeed;
    setVignette(generateVignette(masterSeed, city, "establishing"));
    // Regenerate only on a genuinely new seed — city-shape/scale tweaks alone
    // don't discard hand-edited holds/moves/captured poses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, masterSeed]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [uiTime, setUiTime] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  const shotsRef = useRef<VignetteShot[]>([]);
  const indexRef = useRef(0);
  const playingRef = useRef(false);
  const loopRef = useRef(true);
  const phaseRef = useRef<Phase>("hold");
  const phaseElapsedRef = useRef(0);
  const fromPoseRef = useRef<VignetteShot["pose"] | null>(null);
  const lastAppliedPoseRef = useRef<VignetteShot["pose"] | null>(null);
  const customIdCounter = useRef(0);
  // Set by Delete/Add Shot After (which may reassign what `indexRef` points
  // at without changing its numeric value) to force the sync effect below to
  // re-cut even when the index itself didn't move.
  const forceCutRef = useRef(false);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  const applyPose = useCallback((pose: VignetteShot["pose"]) => {
    lastAppliedPoseRef.current = pose;
    useSceneStore.getState().setCameraIntent({
      position: pose.position,
      lookAt: pose.lookAt,
      fov: pose.fov,
      orient: "lookAt",
    });
  }, []);

  const goToShot = useCallback(
    (idx: number, opts?: { cut?: boolean }) => {
      const shots = shotsRef.current;
      const clamped = Math.max(0, Math.min(shots.length - 1, idx));
      if (!shots[clamped]) return;
      indexRef.current = clamped;
      setIndex(clamped);
      const shot = shots[clamped];
      const cut = opts?.cut ?? shot.transitionIn === "cut";
      phaseElapsedRef.current = 0;
      if (cut) {
        phaseRef.current = "hold";
        applyPose(shot.pose);
      } else {
        phaseRef.current = "transition";
        fromPoseRef.current = lastAppliedPoseRef.current ?? shot.pose;
      }
      setUiTime(elapsedUpTo(shots, clamped, phaseRef.current, phaseElapsedRef.current));
    },
    [applyPose],
  );

  const advance = useCallback(() => {
    const shots = shotsRef.current;
    let next = indexRef.current + 1;
    if (next >= shots.length) {
      if (loopRef.current) next = 0;
      else {
        playingRef.current = false;
        setPlaying(false);
        return;
      }
    }
    goToShot(next);
  }, [goToShot]);

  // Sync the engine's shot array whenever the vignette (regeneration OR any
  // edit) changes; cut to the (clamped) current shot only if the edit moved
  // the timeline out from under it — an edit to a NON-current shot, or a
  // hold/move tweak on the current one, should never yank the live camera.
  useEffect(() => {
    if (!vignette) return;
    shotsRef.current = vignette.shots;
    const clamped = Math.min(indexRef.current, vignette.shots.length - 1);
    const forceCut = forceCutRef.current;
    forceCutRef.current = false;
    if (forceCut || clamped !== indexRef.current || !lastAppliedPoseRef.current) {
      goToShot(clamped, { cut: true });
    }
  }, [vignette, goToShot]);

  // Playback tick: scheduled by rAF, timed by sharedTime deltas.
  useEffect(() => {
    let raf = 0;
    let lastSample = sharedTime.value;
    let uiThrottle = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = sharedTime.value;
      const dt = Math.max(0, Math.min(0.25, now - lastSample));
      lastSample = now;
      if (!playingRef.current) return;
      if (useSceneStore.getState().cameraMode !== "still") {
        // The canvas was grabbed (drag/wheel releases still-mode to orbit,
        // per CameraControls) — stop rather than fight the user for it.
        playingRef.current = false;
        setPlaying(false);
        return;
      }
      const shot = shotsRef.current[indexRef.current];
      if (!shot) return;
      phaseElapsedRef.current += dt;
      if (phaseRef.current === "transition") {
        const dur = shot.transitionSec ?? DEFAULT_TRANSITION_SEC;
        const t = dur > 0 ? phaseElapsedRef.current / dur : 1;
        const from = fromPoseRef.current ?? shot.pose;
        applyPose(lerpPose(from, shot.pose, ease(DEFAULT_TRANSITION_EASE, t)));
        if (t >= 1) {
          phaseRef.current = "hold";
          phaseElapsedRef.current = 0;
        }
      } else {
        const t = shot.holdSec > 0 ? phaseElapsedRef.current / shot.holdSec : 1;
        applyPose(applyHoldMove(shot.pose, shot.move, Math.min(1, t)));
        if (t >= 1) advance();
      }
      uiThrottle += dt;
      if (uiThrottle > 1 / 12) {
        uiThrottle = 0;
        setUiTime(
          elapsedUpTo(
            shotsRef.current,
            indexRef.current,
            phaseRef.current,
            phaseElapsedRef.current,
          ),
        );
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [applyPose, advance]);

  const total = useMemo(() => (vignette ? totalDuration(vignette.shots) : 0), [vignette]);

  const play = useCallback(() => {
    useSceneStore.getState().setCameraMode("still");
    playingRef.current = true;
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const seekToTime = useCallback(
    (targetSec: number) => {
      const shots = shotsRef.current;
      if (!shots.length) return;
      let remaining = Math.max(0, targetSec);
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        const trans =
          shot.transitionIn === "move" ? (shot.transitionSec ?? DEFAULT_TRANSITION_SEC) : 0;
        const dur = trans + shot.holdSec;
        const last = i === shots.length - 1;
        if (remaining <= dur || last) {
          indexRef.current = i;
          setIndex(i);
          if (remaining < trans) {
            phaseRef.current = "transition";
            phaseElapsedRef.current = remaining;
            const from = i > 0 ? shots[i - 1].pose : shot.pose;
            fromPoseRef.current = from;
            const t = trans > 0 ? remaining / trans : 1;
            applyPose(lerpPose(from, shot.pose, ease(DEFAULT_TRANSITION_EASE, t)));
          } else {
            phaseRef.current = "hold";
            const holdElapsed = Math.max(0, remaining - trans);
            phaseElapsedRef.current = holdElapsed;
            const t = shot.holdSec > 0 ? holdElapsed / shot.holdSec : 1;
            applyPose(applyHoldMove(shot.pose, shot.move, Math.min(1, t)));
          }
          setUiTime(targetSec);
          return;
        }
        remaining -= dur;
      }
    },
    [applyPose],
  );

  const updateShots = useCallback((mutate: (shots: VignetteShot[]) => VignetteShot[]) => {
    setVignette((v) => (v ? { ...v, shots: mutate(v.shots) } : v));
  }, []);

  const onSelect = useCallback(
    (i: number) => {
      pause();
      goToShot(i, { cut: true });
    },
    [pause, goToShot],
  );
  const onPrev = useCallback(() => goToShot(indexRef.current - 1, { cut: true }), [goToShot]);
  const onNext = useCallback(() => goToShot(indexRef.current + 1, { cut: true }), [goToShot]);

  const onChangeHold = useCallback(
    (i: number, holdSec: number) =>
      updateShots((shots) => shots.map((s, j) => (j === i ? { ...s, holdSec } : s))),
    [updateShots],
  );
  const onChangeMove = useCallback(
    (i: number, move: MoveKind) =>
      updateShots((shots) => shots.map((s, j) => (j === i ? { ...s, move } : s))),
    [updateShots],
  );
  const onCapturePose = useCallback(
    (i: number) =>
      updateShots((shots) => shots.map((s, j) => (j === i ? { ...s, pose: liveViewPose() } : s))),
    [updateShots],
  );
  const onCopyLink = useCallback(
    (i: number) => {
      const shot = shotsRef.current[i];
      if (!shot || !vignette) return;
      void navigator.clipboard.writeText(shotViewLink(vignette.seed, shot.pose));
    },
    [vignette],
  );
  const onDelete = useCallback(
    (i: number) => {
      if (i < indexRef.current) indexRef.current -= 1;
      forceCutRef.current = true;
      updateShots((shots) => (shots.length > 1 ? shots.filter((_, j) => j !== i) : shots));
    },
    [updateShots],
  );
  const onAddAfter = useCallback(
    (i: number) => {
      customIdCounter.current += 1;
      const n = customIdCounter.current;
      if (i < indexRef.current) indexRef.current += 1;
      forceCutRef.current = true;
      updateShots((shots) => {
        const base = shots[i];
        const copy: VignetteShot = {
          ...base,
          id: `custom-${n}`,
          label: `${base.label} (Copy)`,
        };
        return [...shots.slice(0, i + 1), copy, ...shots.slice(i + 1)];
      });
    },
    [updateShots],
  );

  const onExport = useCallback(() => {
    if (!vignette) return;
    void navigator.clipboard.writeText(serializeVignette(vignette));
  }, [vignette]);
  const onImport = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseVignetteJSON(text);
      if (parsed) {
        pause();
        setVignette(parsed);
      }
    } catch {
      // clipboard read denied/unavailable — no-op, matches the export button's silent write
    }
  }, [pause]);

  // Claim the camera on mount so the first shot is framed immediately; hand
  // it back to whatever mode was active on the way out.
  useEffect(() => {
    const prevMode = useSceneStore.getState().cameraMode;
    useSceneStore.getState().setCameraMode("still");
    return () => {
      if (useSceneStore.getState().cameraMode === "still") {
        useSceneStore.getState().setCameraMode(prevMode);
      }
    };
  }, []);

  if (!vignette) {
    return (
      <div className="text-muted-foreground pointer-events-auto fixed top-3 left-3 z-40 rounded-lg bg-black/55 px-3 py-2 text-xs backdrop-blur-sm">
        Generating vignette…
      </div>
    );
  }

  const shot = vignette.shots[index];

  return (
    <div className="pointer-events-auto">
      <LabSidebar open={sidebarOpen} onOpenChange={setSidebarOpen} width={360}>
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold">Vignette Lab</h1>
          <span className="text-muted-foreground font-mono text-xs">{vignette.seed}</span>
        </div>

        <LabSection title="Playback">
          <div className="flex items-center justify-center gap-1.5">
            <Button variant="outline" size="icon-sm" onClick={onPrev} aria-label="Previous Shot">
              <ChevronLeft />
            </Button>
            <Button
              variant="default"
              size="icon-sm"
              onClick={playing ? pause : play}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause /> : <Play />}
            </Button>
            <Button variant="outline" size="icon-sm" onClick={onNext} aria-label="Next Shot">
              <ChevronRight />
            </Button>
            <Label className="ml-2 flex items-center gap-1.5 text-xs">
              <Switch checked={loop} onCheckedChange={setLoop} size="sm" />
              <Repeat className="size-3.5" aria-hidden />
              Loop
            </Label>
          </div>
          <div className="flex flex-col gap-1">
            <Slider
              min={0}
              max={Math.max(0.001, total)}
              step={0.1}
              value={scrubbing ? uiTime : Math.min(uiTime, total)}
              onValueChange={(v) => {
                setScrubbing(true);
                pause();
                const t = typeof v === "number" ? v : v[0];
                setUiTime(t);
                seekToTime(t);
              }}
              onValueCommitted={() => setScrubbing(false)}
            />
            <div className="text-muted-foreground flex justify-between font-mono text-xs">
              <span>{fmt(uiTime)}</span>
              <span>
                Shot {index + 1}/{vignette.shots.length} · {shot.label}
              </span>
              <span>{fmt(total)}</span>
            </div>
          </div>
        </LabSection>

        <LabSection title="Shots">
          <ShotTable
            shots={vignette.shots}
            activeIndex={index}
            onSelect={onSelect}
            onChangeHold={onChangeHold}
            onChangeMove={onChangeMove}
            onCapturePose={onCapturePose}
            onCopyLink={onCopyLink}
            onDelete={onDelete}
            onAddAfter={onAddAfter}
          />
        </LabSection>

        <LabSection title="Import / Export">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={onExport}>
              <Download className="size-3.5" />
              Export
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => void onImport()}>
              <Clipboard className="size-3.5" />
              Import
            </Button>
          </div>
        </LabSection>
      </LabSidebar>
    </div>
  );
}

function elapsedUpTo(
  shots: VignetteShot[],
  index: number,
  phase: Phase,
  phaseElapsed: number,
): number {
  let sum = 0;
  for (let i = 0; i < index; i++) sum += shotDuration(shots[i]);
  const shot = shots[index];
  if (!shot) return sum;
  const trans = shot.transitionIn === "move" ? (shot.transitionSec ?? DEFAULT_TRANSITION_SEC) : 0;
  if (phase === "hold") sum += trans + phaseElapsed;
  else sum += phaseElapsed;
  return sum;
}
