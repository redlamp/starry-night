"use client";

import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { Building } from "@/lib/seed/cityGen";
import { facadeColorFor } from "@/lib/seed/lightingGen";
import { DEFAULT_FACADE } from "@/lib/state/sceneDefaults";
import { collectCells, rollFractions } from "./bakeCommon";
import type { RackProps, WindowRanges } from "./index";

// Experiment 3: the optimised endpoint of the SDF route (user 2026-07-03,
// "reduce the source texture so each window is a pixel, apply the window size
// with the SDF"). Taken to its conclusion, the field texture disappears
// ENTIRELY: every cell of a building shares the same pane rectangle (the
// fracW/fracH roll is per building), so the distance field is analytic — two
// subtractions and a max on cell-local UV in the shader, zero shape memory.
//
// What remains is exactly the production atlas density: ONE texel per window
// (colour + kind/state), 4 bytes per cell vs the SDF rack's ~1,536 — a ~340x
// reduction, plus mips (+33%). Near field: NEAREST magnification keeps cells
// clean and the analytic mask draws crisp panes at any zoom (like the SDF
// rack, but exact corners for free). Far field: trilinear mips average the
// cell colours while the widening AA turns the mask into approximate
// coverage — the sketch of the production hybrid (#82) in one material.
//
// Same wake/sleep cycle and colour parity as the other bakes (shared
// collectCells), same one-building-per-frame refresh — and re-bakes here
// touch a cols×rows texture, hundreds of times smaller than the 16 px bakes.

const atlasSdfVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Alpha encodes cell kind: 1.0 window/TV pane, ~0.7 band slab, 0 dark.
// uTexView: 0 = final, 1 = raw cell atlas (NEAREST texel colours), 2 = the
// analytic distance field itself — no texture backs it, so the "field" view
// renders the shader's evaluation: white iso-line at the pane edge, blue
// gradient inside, dark falloff outside.
const atlasSdfFragmentShader = /* glsl */ `
uniform sampler2D uMap;   // 1 texel per window cell
uniform vec2 uGrid;       // cols, rows
uniform vec2 uFrac;       // per-building pane fraction (fracW, fracH)
uniform vec3 uFacade;
uniform float uTexView;
varying vec2 vUv;
void main() {
  vec2 cell = vUv * uGrid;
  vec2 cellLocal = fract(cell);
  vec4 s = texture2D(uMap, vUv);
  bool band = s.a > 0.55 && s.a < 0.85;
  vec2 halfPane = band ? vec2(0.48, min(0.5, uFrac.y * 0.6)) : uFrac * 0.5;
  // Analytic per-axis pane SDF — the "field" the SDF rack baked, computed
  // exactly. fwidth on the CONTINUOUS grid coord (fract would spike at cell
  // borders); crisp near, widening into a soft coverage-ish mask far away.
  vec2 d = abs(cellLocal - 0.5) - halfPane;
  if (uTexView > 1.5) {
    float dd = max(d.x, d.y); // signed box distance, cell units
    // Screen-space floor + energy conservation on the iso-line — a fixed
    // 0.05-cell width goes sub-pixel at range and dithers (the main app's
    // field view showed it first; same fix both places, user 2026-07-03).
    float lineW = max(0.05, fwidth(dd) * 1.2);
    float edge = (1.0 - smoothstep(0.0, lineW, abs(dd))) * (0.05 / lineW);
    vec3 c = dd < 0.0
      ? mix(vec3(0.85, 0.92, 1.0), vec3(0.15, 0.4, 0.9), clamp(-dd * 3.0, 0.0, 1.0))
      : vec3(0.12, 0.12, 0.14) * (1.0 - clamp(dd * 1.5, 0.0, 0.8));
    c = mix(c, vec3(1.0), edge);
    // Sub-pixel cells: converge to the area average via the mask's own
    // coverage — same anti-dither treatment as the main app's field view.
    vec2 spv = fwidth(cell);
    vec2 aav = spv * 0.7 + vec2(1e-4);
    float cov = smoothstep(aav.x, -aav.x, d.x) * smoothstep(aav.y, -aav.y, d.y);
    float sp = max(spv.x, spv.y);
    float narrowFeat =
      min(min(halfPane.x, 0.5 - halfPane.x), min(halfPane.y, 0.5 - halfPane.y)) * 2.0;
    float featPx = narrowFeat / max(sp, 1e-4);
    float vizLod = max(smoothstep(0.15, 0.4, sp), 1.0 - smoothstep(0.9, 1.8, featPx));
    vec3 filteredViz = mix(vec3(0.08, 0.08, 0.1), vec3(0.5, 0.66, 0.97), cov);
    c = mix(c, filteredViz, vizLod);
    gl_FragColor = vec4(c, 1.0);
    return;
  }
  if (uTexView > 0.5) {
    gl_FragColor = vec4(s.rgb, 1.0);
    return;
  }
  vec2 aa = fwidth(cell) * 0.7 + vec2(1e-4);
  vec2 m2 = vec2(smoothstep(aa.x, -aa.x, d.x), smoothstep(aa.y, -aa.y, d.y));
  float mask = m2.x * m2.y * smoothstep(0.1, 0.25, s.a);
  gl_FragColor = vec4(mix(uFacade, s.rgb, mask), 1.0);
}
`;

export function AtlasSdfRack({ specimens, seed, windows, texView, onHover, onFocus }: RackProps) {
  const gl = useThree((s) => s.gl);
  const deferredWindows = useDeferredValue(windows);
  const built = useMemo(
    () => buildRack(specimens, seed, deferredWindows, gl.capabilities.getMaxAnisotropy()),
    [specimens, seed, deferredWindows, gl],
  );

  // Texture-layer view — uniform write only, no rebuild.
  useEffect(() => {
    const v = texView === "field" ? 2 : texView === "atlas" ? 1 : 0;
    for (const e of built.entries) e.sideMat.uniforms.uTexView.value = v;
  }, [built, texView]);

  useEffect(() => {
    return () => {
      built.geometry.dispose();
      for (const e of built.entries) {
        (e.sideMat.uniforms.uMap.value as THREE.Texture | null)?.dispose();
        e.sideMat.dispose();
        e.capMat.dispose();
      }
    };
  }, [built]);

  // Wake/sleep refresh: one building per frame, round-robin — these textures
  // are cols×rows texels, so a refresh is near-free next to the 16 px bakes.
  const cursor = useRef(0);
  useFrame((state) => {
    const entries = built.entries;
    if (entries.length === 0) return;
    const e = entries[cursor.current++ % entries.length];
    const tex = e.sideMat.uniforms.uMap.value as THREE.DataTexture;
    fillCellAtlas(
      tex.image.data as Uint8Array,
      e.b,
      seed,
      deferredWindows,
      state.clock.elapsedTime,
      e.facadeBytes,
    );
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
  sideMat: THREE.ShaderMaterial;
  capMat: THREE.MeshBasicMaterial;
  materials: THREE.Material[];
  facadeBytes: readonly [number, number, number];
};

function buildRack(specimens: Building[], seed: string, windows: WindowRanges, maxAniso: number) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const color = new THREE.Color();
  const entries: RackEntry[] = specimens.map((b) => {
    facadeColorFor(b, color, DEFAULT_FACADE);
    const facadeBytes: [number, number, number] = [
      Math.round(color.r * 255),
      Math.round(color.g * 255),
      Math.round(color.b * 255),
    ];

    const data = new Uint8Array(b.colsPerFace * b.floors * 4);
    fillCellAtlas(data, b, seed, windows, 0, facadeBytes);
    const tex = new THREE.DataTexture(data, b.colsPerFace, b.floors, THREE.RGBAFormat);
    // NEAREST magnification keeps each cell's colour clean up close (the
    // analytic mask draws the pane); trilinear mips take over at distance.
    // No colour space: the shader writes raw like cityInstanced.
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.anisotropy = maxAniso;
    tex.needsUpdate = true;

    const { fracW, fracH } = rollFractions(b, windows);
    const sideMat = new THREE.ShaderMaterial({
      vertexShader: atlasSdfVertexShader,
      fragmentShader: atlasSdfFragmentShader,
      uniforms: {
        uMap: { value: tex },
        uGrid: { value: new THREE.Vector2(b.colsPerFace, b.floors) },
        uFrac: { value: new THREE.Vector2(fracW, fracH) },
        uFacade: { value: new THREE.Color(color.r, color.g, color.b) },
        uTexView: { value: 0 },
      },
    });
    const capMat = new THREE.MeshBasicMaterial({
      color: color.clone().convertSRGBToLinear(),
      toneMapped: false,
    });
    const materials = [sideMat, sideMat, capMat, capMat, sideMat, sideMat];
    return { b, sideMat, capMat, materials, facadeBytes };
  });
  return { geometry, entries };
}

// One texel per window cell: RGB = display-parity lit colour (facade colour on
// dark cells, so far-field mip averages blend toward the real wall instead of
// black), A = kind (255 pane, 180 band slab, 0 dark).
export function fillCellAtlas(
  data: Uint8Array,
  b: Building,
  seed: string,
  windows: WindowRanges,
  timeSec: number,
  facadeBytes: readonly [number, number, number],
): void {
  const { cols, cells } = collectCells(b, seed, windows, timeSec);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = facadeBytes[0];
    data[i + 1] = facadeBytes[1];
    data[i + 2] = facadeBytes[2];
    data[i + 3] = 0;
  }
  for (const cell of cells) {
    const i = (cell.r * cols + cell.c) * 4;
    data[i] = cell.rgb[0];
    data[i + 1] = cell.rgb[1];
    data[i + 2] = cell.rgb[2];
    data[i + 3] = cell.kind === "band" ? 180 : 255;
  }
}
