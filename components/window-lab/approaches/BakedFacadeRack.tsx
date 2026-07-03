"use client";

import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { Building } from "@/lib/seed/cityGen";
import { facadeColorFor } from "@/lib/seed/lightingGen";
import { DEFAULT_FACADE } from "@/lib/state/sceneDefaults";
import { CELL_PX, collectCells } from "./bakeCommon";
import type { RackProps, WindowRanges } from "./index";

// Experiment 1: bake the whole facade — window mask AND lit colour — into an
// ordinary texture per building, then let the GPU's own minification pipeline
// (trilinear mipmaps + anisotropic filtering) do the anti-aliasing. This is the
// opposite bet from the current shader, which reconstructs windows procedurally
// per fragment and must hand-fight every footprint regime. Prefiltering makes
// all three #82 artifact classes structurally impossible: a mip level IS the
// correctly averaged lit fraction.
//
// Temporal behaviour: windows follow the production wake/sleep duty cycle
// (~60 s on / ~30 s off, jittered per cell). One building re-bakes per FRAME,
// round-robin, so each refreshes about once a second and individual windows
// appear to flip independently on their own schedules. TVs stay lit at a
// time-averaged brightness; the 8 Hz shimmer has no cheap bake equivalent.
//
// COLOUR PARITY (user 2026-07-03, "flattened and bright"): the production
// shader samples its sRGB atlas (hardware-DECODED to linear) and writes
// gl_FragColor RAW — no output re-encode — so a window authored at 0.9
// displays at decode(0.9) ~ 0.79, and its raw facade attribute displays
// as-authored. The bake's MeshBasicMaterial path is a proper round trip
// (decode + re-encode = identity), which displayed every window BRIGHTER than
// the shader and washed it toward white. Parity = pre-apply the decode in the
// bake (see bakeCommon.collectCells); facades are written as raw authored
// bytes (NOT getHexString(), which converts 0.04 up to grey 0.22).
//
// Known costs, on purpose (this rack exists to price them):
//   - one bake per building: ~cols×floors×16² canvas pixels + mip memory,
//     plus one canvas redraw + mip regen per frame for the wake/sleep cycle
//   - all four side faces share one texture (depth faces stretch the grid)
//   - linear mag filter reads slightly soft at point-blank range (the SDF
//     rack exists to fix exactly this)

export function BakedFacadeRack({ specimens, seed, windows, onHover, onFocus }: RackProps) {
  const gl = useThree((s) => s.gl);
  // Slider moves re-bake every facade texture (~60 canvases). Deferring keeps
  // the drag responsive: React re-bakes when the thumb pauses, not per tick.
  const deferredWindows = useDeferredValue(windows);
  const built = useMemo(
    () => buildRack(specimens, seed, deferredWindows, gl.capabilities.getMaxAnisotropy()),
    [specimens, seed, deferredWindows, gl],
  );

  useEffect(() => {
    return () => {
      built.geometry.dispose();
      for (const e of built.entries) {
        e.sideMat.map?.dispose();
        e.sideMat.dispose();
        e.capMat.dispose();
      }
    };
  }, [built]);

  // Wake/sleep refresh (see header): ONE building per frame, round-robin, so
  // every facade lands within ~a second of its cells' schedules and flips read
  // as independent windows, not building-wide steps. needsUpdate re-uploads
  // the canvas and regenerates its mips.
  const cursor = useRef(0);
  useFrame((state) => {
    const entries = built.entries;
    if (entries.length === 0) return;
    const e = entries[cursor.current++ % entries.length];
    const tex = e.sideMat.map as THREE.CanvasTexture | null;
    if (!tex) return;
    drawFacade(tex.image as HTMLCanvasElement, e.b, seed, deferredWindows, state.clock.elapsedTime);
    tex.needsUpdate = true;
  });

  return (
    <>
      {built.entries.map((e) => (
        <mesh
          key={e.b.id}
          geometry={built.geometry}
          material={e.materials}
          position={[e.b.x, e.b.height / 2, e.b.z]}
          rotation={[0, e.b.rotationY, 0]}
          scale={[e.b.width, e.b.height, e.b.depth]}
          onPointerOver={(ev) => {
            ev.stopPropagation();
            onHover?.(e.b.id);
          }}
          onPointerOut={() => onHover?.(null)}
          onDoubleClick={(ev) => {
            ev.stopPropagation();
            onFocus?.(e.b.id);
          }}
        />
      ))}
    </>
  );
}

type RackEntry = {
  b: Building;
  sideMat: THREE.MeshBasicMaterial;
  capMat: THREE.MeshBasicMaterial;
  materials: THREE.Material[];
};

function buildRack(specimens: Building[], seed: string, windows: WindowRanges, maxAniso: number) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const color = new THREE.Color();
  const entries: RackEntry[] = specimens.map((b) => {
    const tex = bakeFacadeTexture(b, seed, windows, maxAniso);
    facadeColorFor(b, color, DEFAULT_FACADE);
    const sideMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    // Material colours are linear working-space and re-encode on output; the
    // authored display-space facade needs the same pre-decode as the bake or
    // the caps render lightened (see COLOUR PARITY above).
    const capMat = new THREE.MeshBasicMaterial({
      color: color.clone().convertSRGBToLinear(),
      toneMapped: false,
    });
    // BoxGeometry group order: +x, -x, +y, -y, +z, -z
    const materials = [sideMat, sideMat, capMat, capMat, sideMat, sideMat];
    return { b, sideMat, capMat, materials };
  });
  return { geometry, entries };
}

function bakeFacadeTexture(
  b: Building,
  seed: string,
  windows: WindowRanges,
  maxAniso: number,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = b.colsPerFace * CELL_PX;
  canvas.height = b.floors * CELL_PX;
  drawFacade(canvas, b, seed, windows, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso;
  return tex;
}

export function drawFacade(
  canvas: HTMLCanvasElement,
  b: Building,
  seed: string,
  windows: WindowRanges,
  timeSec: number,
): void {
  const { rows, cells } = collectCells(b, seed, windows, timeSec);
  const ctx = canvas.getContext("2d")!;

  const facade = new THREE.Color();
  facadeColorFor(b, facade, DEFAULT_FACADE);
  // Raw authored bytes — the shader displays its facade attribute unencoded.
  ctx.fillStyle = `rgb(${Math.round(facade.r * 255)},${Math.round(facade.g * 255)},${Math.round(facade.b * 255)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const cell of cells) {
    ctx.fillStyle = `rgb(${cell.rgb[0]},${cell.rgb[1]},${cell.rgb[2]})`;
    const w = cell.fw * CELL_PX;
    const h = cell.fh * CELL_PX;
    const x = cell.c * CELL_PX + (CELL_PX - w) / 2;
    // Canvas rows run top-down; texture V runs bottom-up. Flip so floor 0 is
    // at the building's base like the shader's grid.
    const y = (rows - 1 - cell.r) * CELL_PX + (CELL_PX - h) / 2;
    ctx.fillRect(x, y, w, h);
  }
}
