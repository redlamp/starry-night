"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  NumberField,
  NumberFieldScrubArea,
  NumberFieldGroup,
  NumberFieldDecrement,
  NumberFieldInput,
  NumberFieldIncrement,
} from "@/components/ui/number-field";
import {
  recoverOrientationField,
  makeSketchTensor,
  RECOVER_DEFAULTS,
} from "@/lib/sketch/orientationField";
import { generateTensorStreets } from "@/lib/seed/tensorStreets";

// Sketch → tensor lab (#40). Drop a photo of a hand-hatched sketch and watch
// it become a street-traceable tensor field — recovery, internalized tensor
// crosses, implied flow, and the RK4 street trace, each a toggleable layer on
// one canvas. Deliberately tiny: no scene store, no city generator — only the
// pure recovery math + the street tracer with a sketch-backed field override.

const ANALYSIS_W = 1100; // analysis resolution (matches the script prototypes)

type SketchImage = { gray: Float32Array; W: number; H: number; name: string };

async function decodeSketch(file: File | Blob, name: string): Promise<SketchImage> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const W = ANALYSIS_W;
  const H = Math.max(1, Math.round((bmp.height / bmp.width) * W));
  const cnv = document.createElement("canvas");
  cnv.width = W;
  cnv.height = H;
  const ctx = cnv.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.drawImage(bmp, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  bmp.close();
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++)
    gray[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return { gray, W, H, name };
}

type Layers = {
  sketch: boolean;
  orientation: boolean; // hue ticks, angle mod π
  flow: boolean; // implied direction after sign propagation (2π + arrowheads)
  crosses: boolean; // major/minor eigenvector crosses — the tracer's view
  streets: boolean; // RK4 street trace
};

const DEFAULT_LAYERS: Layers = {
  sketch: true,
  orientation: false,
  flow: false,
  crosses: true,
  streets: true,
};

const LAYER_LABELS: Record<keyof Layers, string> = {
  sketch: "sketch",
  orientation: "orientation (mod π)",
  flow: "implied flow",
  crosses: "tensor crosses",
  streets: "streets",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <Separator className="bg-zinc-800" />
      <h2 className="font-mono text-xs tracking-wider text-zinc-500 uppercase">{title}</h2>
      {children}
    </div>
  );
}

// Slider + number-field stepper, both bound to the same committed value. The
// slider keeps a local drag preview — heavy recomputes fire on release only
// (same pattern as the city-size tier slider); the stepper (and scrubbing the
// label) commits directly, for dialling exact values.
function LabSlider({
  label,
  min,
  max,
  step,
  value,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const commit = (v: number) => onCommit(Math.min(max, Math.max(min, v)));
  return (
    <NumberField
      value={shown}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => {
        if (v !== null && v !== shown) {
          setDrag(null);
          commit(v);
        }
      }}
      className="w-full"
    >
      <div className="flex w-full items-center gap-2">
        <NumberFieldScrubArea className="w-20 shrink-0">
          <span className="text-xs text-zinc-400">{label}</span>
        </NumberFieldScrubArea>
        <Slider
          min={min}
          max={max}
          step={step}
          value={shown}
          onValueChange={(v) => setDrag(typeof v === "number" ? v : v[0])}
          onValueCommitted={(v) => {
            setDrag(null);
            commit(typeof v === "number" ? v : v[0]);
          }}
          className="flex-1"
        />
        <NumberFieldGroup className="w-24 shrink-0">
          <NumberFieldDecrement />
          <NumberFieldInput className="font-mono text-xs" />
          <NumberFieldIncrement />
        </NumberFieldGroup>
      </div>
    </NumberField>
  );
}

export function SketchTensorLab() {
  const [img, setImg] = useState<SketchImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);

  // recovery knobs
  const [smoothR, setSmoothR] = useState<number>(RECOVER_DEFAULTS.smoothR);
  const [minCoherence, setMinCoherence] = useState<number>(RECOVER_DEFAULTS.minCoherence);
  const [minEnergyPct, setMinEnergyPct] = useState<number>(RECOVER_DEFAULTS.minEnergyPct);

  // trace knobs
  const [worldKm, setWorldKm] = useState(3);
  const [wMin, setWMin] = useState(0.05);
  const [seed, setSeed] = useState("sketch");

  // sidebar width — drag the border to resize
  const [sideW, setSideW] = useState(300);
  const sideDrag = useRef(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  async function loadFile(file: File | Blob, name: string) {
    try {
      setImg(await decodeSketch(file, name));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // paste-an-image support — notebook photos straight from the clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      const file = item?.getAsFile();
      if (file) void loadFile(file, "pasted image");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // stage 1 — structure-tensor recovery (pure; reruns on knob commit)
  const field = useMemo(
    () =>
      img
        ? recoverOrientationField(img.gray, img.W, img.H, { smoothR, minCoherence, minEnergyPct })
        : null,
    [img, smoothR, minCoherence, minEnergyPct],
  );

  // stage 2 — the recovered grid as the tracer's TensorField
  const st = useMemo(
    () => (field ? makeSketchTensor(field, worldKm * 1000, wMin) : null),
    [field, worldKm, wMin],
  );

  // stage 3 — RK4 street trace through the sketch field (pure per seed)
  const trace = useMemo(
    () =>
      st && layers.streets
        ? generateTensorStreets(seed, st.bounds, st.mask, undefined, st.field)
        : null,
    [st, seed, layers.streets],
  );

  // composite all enabled layers onto the canvas
  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv || !field || !st) return;
    const { W, H, grid, gw, gh } = field;
    cnv.width = W;
    cnv.height = H;
    const ctx = cnv.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0a0c16";
    ctx.fillRect(0, 0, W, H);

    if (layers.sketch) {
      // ink ghost on night-blue — dark strokes render bright
      const id = ctx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        const ink = 1 - field.gray[i];
        id.data[i * 4] = 10 + ink * 60;
        id.data[i * 4 + 1] = 12 + ink * 76;
        id.data[i * 4 + 2] = 22 + ink * 96;
        id.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
    }

    const S = st.metersPerPx;
    ctx.lineWidth = 1;

    if (layers.orientation) {
      // raw recovery: per-cell tick, hue = angle mod π, length ∝ coherence
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const g = gy * gw + gx;
          if (!field.valid[g]) continue;
          const cx = (gx + 0.5) * grid;
          const cy = (gy + 0.5) * grid;
          const len = grid * 0.55 * (0.4 + 0.6 * field.coh[g]);
          const dx = Math.cos(field.theta[g]) * len;
          const dy = Math.sin(field.theta[g]) * len;
          const hue = ((((field.theta[g] % Math.PI) + Math.PI) % Math.PI) / Math.PI) * 360;
          ctx.strokeStyle = `hsl(${hue}deg 85% 60%)`;
          ctx.beginPath();
          ctx.moveTo(cx - dx, cy - dy);
          ctx.lineTo(cx + dx, cy + dy);
          ctx.stroke();
        }
      }
    }

    if (layers.flow) {
      // implied direction after sign propagation: full-2π hue + arrowheads
      for (let gy = 0; gy < gh; gy += 2) {
        for (let gx = 0; gx < gw; gx += 2) {
          const g = gy * gw + gx;
          if (!field.assigned[g]) continue;
          const cx = (gx + 0.5) * grid;
          const cy = (gy + 0.5) * grid;
          const len = grid * 1.1 * (0.4 + 0.6 * field.coh[g]);
          const ang = Math.atan2(field.dirY[g], field.dirX[g]);
          const hue = ((ang + Math.PI) / (2 * Math.PI)) * 360;
          ctx.strokeStyle = `hsl(${hue}deg 85% 60%)`;
          const hx = cx + field.dirX[g] * len;
          const hy = cy + field.dirY[g] * len;
          ctx.beginPath();
          ctx.moveTo(cx - field.dirX[g] * len, cy - field.dirY[g] * len);
          ctx.lineTo(hx, hy);
          for (const rot of [(150 * Math.PI) / 180, (-150 * Math.PI) / 180]) {
            ctx.moveTo(hx, hy);
            ctx.lineTo(
              hx + Math.cos(ang + rot) * grid * 0.7,
              hy + Math.sin(ang + rot) * grid * 0.7,
            );
          }
          ctx.stroke();
        }
      }
    }

    if (layers.crosses) {
      // the INTERNALIZED field — major/minor eigenvector crosses sampled
      // through the same field.sample() the tracer sees (bilinear + gates).
      // No arrowheads: a tensor has orientation, not direction.
      for (let gy = 0; gy < gh; gy += 2) {
        for (let gx = 0; gx < gw; gx += 2) {
          const cx = (gx + 0.5) * grid;
          const cy = (gy + 0.5) * grid;
          const maj = st.field.sample(cx * S, cy * S, true);
          if (!maj) continue; // degenerate — the tracer would stop here too
          const w = st.weightAt(cx * S, cy * S);
          const len = grid * (0.6 + 1.1 * Math.min(1, w * 1.6));
          ctx.strokeStyle = "#ffb040"; // major
          ctx.beginPath();
          ctx.moveTo(cx - maj.x * len, cy - maj.z * len);
          ctx.lineTo(cx + maj.x * len, cy + maj.z * len);
          ctx.stroke();
          const ml = len * 0.55;
          ctx.strokeStyle = "#40bed2"; // minor — perpendicular by construction
          ctx.beginPath();
          ctx.moveTo(cx + maj.z * ml, cy - maj.x * ml);
          ctx.lineTo(cx - maj.z * ml, cy + maj.x * ml);
          ctx.stroke();
        }
      }
    }

    if (layers.streets && trace) {
      const drawPolys = (polys: typeof trace.arterials, color: string, width: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (const rd of polys) {
          for (let i = 0; i < rd.vertices.length; i++) {
            const x = rd.vertices[i].x / S;
            const y = rd.vertices[i].z / S;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      };
      drawPolys(trace.minorStreets, "#5c74a8", 1);
      drawPolys(trace.arterials, "#ffbe5a", 2.5);
      ctx.lineWidth = 1;
    }
  }, [field, st, trace, layers]);

  function toggleLayer(key: keyof Layers) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const totalKm = trace
    ? [...trace.arterials, ...trace.minorStreets].reduce((acc, rd) => {
        let m = 0;
        for (let i = 1; i < rd.vertices.length; i++)
          m += Math.hypot(
            rd.vertices[i].x - rd.vertices[i - 1].x,
            rd.vertices[i].z - rd.vertices[i - 1].z,
          );
        return acc + m;
      }, 0) / 1000
    : 0;

  return (
    <main
      className="fixed inset-0 flex bg-[#080c18] text-white"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file?.type.startsWith("image/")) void loadFile(file, file.name);
      }}
    >
      {/* Left sidebar — all settings */}
      <aside className="shrink-0" style={{ width: sideW }}>
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-4 p-4">
            <div className="flex items-baseline justify-between">
              <h1 className="font-mono text-sm text-zinc-300">Tensor lab</h1>
              <Link
                href="/"
                className="text-sm text-zinc-400 underline-offset-4 hover:text-white hover:underline"
              >
                ← scene
              </Link>
            </div>
            <p className="-mt-3 text-xs text-zinc-500">sketch → field → streets</p>

            <Section title="sketch">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadFile(file, file.name);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
                {img ? "Replace sketch" : "Load sketch"}
              </Button>
              {img ? <p className="truncate font-mono text-xs text-zinc-500">{img.name}</p> : null}
            </Section>

            <Section title="layers">
              {(Object.keys(DEFAULT_LAYERS) as (keyof Layers)[]).map((key) => (
                <Label
                  key={key}
                  className="flex w-full cursor-pointer items-center gap-2 text-sm text-zinc-200"
                >
                  <Switch checked={layers[key]} onCheckedChange={() => toggleLayer(key)} />
                  {LAYER_LABELS[key]}
                </Label>
              ))}
            </Section>

            <Section title="field">
              <LabSlider
                label="smooth"
                min={3}
                max={14}
                step={1}
                value={smoothR}
                onCommit={setSmoothR}
              />
              <LabSlider
                label="coherence"
                min={0.05}
                max={0.5}
                step={0.01}
                value={minCoherence}
                onCommit={setMinCoherence}
              />
              <LabSlider
                label="ink gate"
                min={0}
                max={0.8}
                step={0.05}
                value={minEnergyPct}
                onCommit={setMinEnergyPct}
              />
            </Section>

            <Section title="streets">
              <LabSlider
                label="page km"
                min={1.5}
                max={6}
                step={0.5}
                value={worldKm}
                onCommit={setWorldKm}
              />
              <LabSlider
                label="degenerate"
                min={0.01}
                max={0.2}
                step={0.01}
                value={wMin}
                onCommit={setWMin}
              />
              <div className="flex w-full items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-zinc-400">seed</span>
                <Input
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  className="h-8 min-w-0 flex-1 font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSeed(Math.random().toString(36).slice(2, 8))}
                  title="Reroll seed"
                  aria-label="Reroll seed"
                >
                  <Dices size={16} />
                </Button>
              </div>
            </Section>

            {field ? (
              <Section title="stats">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs text-zinc-400">
                  <dt className="text-zinc-500">cells</dt>
                  <dd className="text-right tabular-nums">
                    {field.validCount}/{field.gw * field.gh}
                  </dd>
                  <dt className="text-zinc-500">coherence</dt>
                  <dd className="text-right tabular-nums">{field.seedCoherence.toFixed(2)}</dd>
                  <dt className="text-zinc-500">sign flips</dt>
                  <dd className="text-right tabular-nums">{field.flips}</dd>
                  {trace ? (
                    <>
                      <dt className="text-zinc-500">arterials</dt>
                      <dd className="text-right tabular-nums">{trace.arterials.length}</dd>
                      <dt className="text-zinc-500">streets</dt>
                      <dd className="text-right tabular-nums">{trace.minorStreets.length}</dd>
                      <dt className="text-zinc-500">network</dt>
                      <dd className="text-right tabular-nums">{totalKm.toFixed(1)} km</dd>
                    </>
                  ) : null}
                </dl>
              </Section>
            ) : null}
          </div>
        </ScrollArea>
      </aside>

      {/* Drag handle — the sidebar border */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        className="w-1 shrink-0 cursor-col-resize touch-none bg-zinc-800 transition-colors hover:bg-sky-600 active:bg-sky-500"
        onPointerDown={(e) => {
          sideDrag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (sideDrag.current) setSideW(Math.min(520, Math.max(220, e.clientX)));
        }}
        onPointerUp={(e) => {
          sideDrag.current = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          sideDrag.current = false;
        }}
      />

      {/* Canvas area */}
      <section className="flex min-w-0 flex-1 flex-col p-4">
        {img && field ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <canvas
              ref={canvasRef}
              className="max-h-full max-w-full rounded border border-zinc-800"
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-64 w-full max-w-2xl cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-700 text-zinc-400 transition-colors hover:border-sky-600 hover:text-zinc-200"
            >
              <span className="text-lg">Drop a hatched sketch photo</span>
              <span className="text-sm text-zinc-500">
                click to browse · or paste from clipboard
              </span>
              {error ? <span className="text-sm text-red-400">{error}</span> : null}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
