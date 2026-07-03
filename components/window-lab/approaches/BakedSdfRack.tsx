"use client";

import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { Building } from "@/lib/seed/cityGen";
import { facadeColorFor } from "@/lib/seed/lightingGen";
import { DEFAULT_FACADE } from "@/lib/state/sceneDefaults";
import { CELL_PX, collectCells } from "./bakeCommon";
import type { RackProps, WindowRanges } from "./index";

// Experiment 2: signed distance fields for the window mask (user 2026-07-03,
// "can SDFs give sharper edges?"). The mip rack's close-range softness is
// bilinear MAGNIFICATION of a 16 px/cell colour bake. An SDF stores distance
// to the window edge instead: distance varies linearly along a straight edge,
// so bilinear interpolation reconstructs the edge almost exactly, and a tiny
// shader thresholds it with screen-space AA — crisp at ANY zoom, from the same
// 16 px/cell texture.
//
// CORNERS (user 2026-07-03, "rounded rectangle look"): a single combined field
// cannot give square corners — a corner is two linear ramps meeting, and
// bilinear filtering bows the iso-line into an arc across the corner texel
// (the classic SDF-text problem; MSDF is the general fix). Axis-aligned pane
// rects allow the exact cheap version: store the two 1D distances (to the
// vertical edges and to the horizontal edges) in SEPARATE channels — each is
// linear along its axis, so each edge reconstructs exactly — and intersect
// the two masks in the shader. Corners come out square by construction.
//
// Textures per building (no colour space — the shader writes raw like
// cityInstanced, so bytes are display-parity by construction):
//   colour RGBA8 — the cell's lit colour, full-bleed across the cell
//   field  RG8   — R: horizontal pane distance, G: vertical, 0.5 = edge
// Fragment: mask = smoothstep(R) * smoothstep(G); colour = mix(facade, RGB).
//
// Same wake/sleep cycle and colour parity as the mip rack (shared
// bakeCommon.collectCells), same one-building-per-frame refresh.
//
// Known costs / limits, on purpose:
//   - needs a (small) custom shader — no longer pure fixed-function sampling
//   - a second texture (RG8) per building: +50% bake memory
//   - minification is approximate: per-axis mip-averaged masks multiply into
//     a coverage-ish value, not exact average coverage — usable, but the mip
//     rack stays the far-field reference
//   - near-full-bleed panes (bands at 0.96) can seam at cell borders, since
//     each cell's field is independent and filtering crosses the boundary

const sdfVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// uTexView: 0 = final, 1 = the colour bake as-is, 2 = the RG field texture
// raw (R = horizontal distance channel, G = vertical; 0.5 = the pane edge).
const sdfFragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uField;
uniform vec3 uFacade;
uniform float uTexView;
varying vec2 vUv;
void main() {
  vec3 lit = texture2D(uMap, vUv).rgb;
  vec2 fxy = texture2D(uField, vUv).rg;
  if (uTexView > 1.5) {
    gl_FragColor = vec4(fxy.x, fxy.y, 0.0, 1.0);
    return;
  }
  if (uTexView > 0.5) {
    gl_FragColor = vec4(lit, 1.0);
    return;
  }
  // Screen-space AA per axis around each 0.5 iso-line. The floor keeps edges
  // from shimmering when a texel spans many pixels; growing fwidth at
  // minification degrades toward a soft coverage-ish blend (see header).
  float aaX = max(fwidth(fxy.x), 0.006);
  float aaY = max(fwidth(fxy.y), 0.006);
  float mask = smoothstep(0.5 - aaX, 0.5 + aaX, fxy.x) *
               smoothstep(0.5 - aaY, 0.5 + aaY, fxy.y);
  gl_FragColor = vec4(mix(uFacade, lit, mask), 1.0);
}
`;

// SDF encode scale: distances (in cell units) map to a channel as 0.5 - d * 1.5,
// so the encodable band is ±1/3 cell around each edge — plenty for pane rects,
// and steep enough that bilinear reconstruction stays sharp.
const SDF_SCALE = 1.5;

export function BakedSdfRack({ specimens, seed, windows, texView, onHover, onFocus }: RackProps) {
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
        (e.sideMat.uniforms.uField.value as THREE.Texture | null)?.dispose();
        e.sideMat.dispose();
        e.capMat.dispose();
      }
    };
  }, [built]);

  // Wake/sleep refresh: one building per frame, round-robin (same rhythm as
  // the mip rack). Both textures' backing arrays are refilled in place.
  const cursor = useRef(0);
  useFrame((state) => {
    const entries = built.entries;
    if (entries.length === 0) return;
    const e = entries[cursor.current++ % entries.length];
    const colorTex = e.sideMat.uniforms.uMap.value as THREE.DataTexture;
    const fieldTex = e.sideMat.uniforms.uField.value as THREE.DataTexture;
    fillBakeData(
      colorTex.image.data as Uint8Array,
      fieldTex.image.data as Uint8Array,
      colorTex.image.width,
      e.b,
      seed,
      deferredWindows,
      state.clock.elapsedTime,
      e.facadeBytes,
    );
    colorTex.needsUpdate = true;
    fieldTex.needsUpdate = true;
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

function labTexture(tex: THREE.DataTexture, maxAniso: number): THREE.DataTexture {
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

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

    const W = b.colsPerFace * CELL_PX;
    const H = b.floors * CELL_PX;
    const colorData = new Uint8Array(W * H * 4);
    const fieldData = new Uint8Array(W * H * 2);
    fillBakeData(colorData, fieldData, W, b, seed, windows, 0, facadeBytes);
    const colorTex = labTexture(new THREE.DataTexture(colorData, W, H, THREE.RGBAFormat), maxAniso);
    const fieldTex = labTexture(new THREE.DataTexture(fieldData, W, H, THREE.RGFormat), maxAniso);

    const sideMat = new THREE.ShaderMaterial({
      vertexShader: sdfVertexShader,
      fragmentShader: sdfFragmentShader,
      uniforms: {
        uMap: { value: colorTex },
        uField: { value: fieldTex },
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

// Rasterise the building's glowing cells: full-bleed lit colour into the RGBA
// array, per-axis pane distances into the RG array. Dark texels hold the
// facade colour with both fields at 0 (deep outside), so mip averages stay
// sensible.
export function fillBakeData(
  colorData: Uint8Array,
  fieldData: Uint8Array,
  W: number,
  b: Building,
  seed: string,
  windows: WindowRanges,
  timeSec: number,
  facadeBytes: readonly [number, number, number],
): void {
  const { cells } = collectCells(b, seed, windows, timeSec);

  for (let i = 0, j = 0; j < colorData.length; i += 2, j += 4) {
    colorData[j] = facadeBytes[0];
    colorData[j + 1] = facadeBytes[1];
    colorData[j + 2] = facadeBytes[2];
    colorData[j + 3] = 255;
    fieldData[i] = 0;
    fieldData[i + 1] = 0;
  }

  for (const cell of cells) {
    const halfW = cell.fw / 2;
    const halfH = cell.fh / 2;
    // DataTexture V runs bottom-up already (no canvas flip): row r maps to the
    // r-th 16 px band from the bottom.
    const y0 = cell.r * CELL_PX;
    const x0 = cell.c * CELL_PX;
    for (let py = 0; py < CELL_PX; py++) {
      const ly = (py + 0.5) / CELL_PX - 0.5;
      // 1D distance to the pane's horizontal edges — linear along Y, so
      // bilinear filtering reconstructs it exactly (see CORNERS above).
      const ay = Math.max(0, Math.min(1, 0.5 - (Math.abs(ly) - halfH) * SDF_SCALE));
      for (let px = 0; px < CELL_PX; px++) {
        const lx = (px + 0.5) / CELL_PX - 0.5;
        const ax = Math.max(0, Math.min(1, 0.5 - (Math.abs(lx) - halfW) * SDF_SCALE));
        const p = (y0 + py) * W + x0 + px;
        const ci = p * 4;
        colorData[ci] = cell.rgb[0];
        colorData[ci + 1] = cell.rgb[1];
        colorData[ci + 2] = cell.rgb[2];
        const fi = p * 2;
        fieldData[fi] = Math.round(ax * 255);
        fieldData[fi + 1] = Math.round(ay * 255);
      }
    }
  }
}
