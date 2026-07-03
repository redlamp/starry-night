import { Color } from "three";
import type { Building } from "@/lib/seed/cityGen";
import { correlationModeFor, facadeColorFor, generateWindowTexture } from "@/lib/seed/lightingGen";
import { DEFAULT_FACADE } from "@/lib/state/sceneDefaults";
import { packWindowAtlas, type PackInput } from "@/lib/scene/atlasPacker";
import { drawFacade } from "./approaches/BakedFacadeRack";
import { fillBakeData } from "./approaches/BakedSdfRack";
import { fillCellAtlas } from "./approaches/AtlasSdfRack";
import { CELL_PX } from "./approaches/bakeCommon";
import type { WindowRanges } from "./approaches";
import { LAB_SEED, SPECIMENS } from "./specimens";

// Shared texture-visualisation builders for the hover tooltip and the Inspect
// textures panel: both show per-building groups in the same format — a common
// facts line, then tiles (per-side for the current shader, shared bitmaps for
// the bakes). Everything is rebuilt deterministically from the same functions
// the racks use; nothing reaches into live GPU objects.

export type Tile = { label: string; url: string; w: number; h: number };
// Shared facts (dimensions, texel density, side-sharing) live in `common`,
// above the tiles; per-tile captions stay short ("side 1") — user 2026-07-03.
export type Built = { common: string; tiles: Tile[] };

export function bytesToDataUrl(
  data: Uint8Array,
  w: number,
  h: number,
  stride: number,
  flipY: boolean,
  map: (px: number[]) => [number, number, number],
): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const px: number[] = new Array(stride);
  for (let y = 0; y < h; y++) {
    const srcY = flipY ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const s = (srcY * w + x) * stride;
      for (let k = 0; k < stride; k++) px[k] = data[s + k];
      const [r, g, b] = map(px);
      const d = (y * w + x) * 4;
      img.data[d] = r;
      img.data[d + 1] = g;
      img.data[d + 2] = b;
      img.data[d + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

// One building's textures under one approach, hover-tooltip format.
export function buildBuildingTiles(
  b: Building,
  approachId: string,
  windows: WindowRanges,
  timeSec: number,
): Built {
  if (approachId === "current") {
    // The shader gives each vertical face a different look from the SAME atlas
    // region via per-face shifts: atlasCell = (cell + (face*7, face*11)) mod
    // grid, with the row shift disabled on row-coherent buildings (modes 2/3)
    // so band floors stay aligned. Show all four sides as the shader sees them.
    const tex = generateWindowTexture(LAB_SEED, b);
    const data = tex.texture.image.data as Uint8Array;
    const { cols, rows } = tex;
    tex.texture.dispose();
    const rowCoherent = correlationModeFor(b) >= 2 ? 1 : 0;
    const tiles = [0, 1, 2, 3].map((f) => {
      const shifted = new Uint8Array(cols * rows * 4);
      for (let r = 0; r < rows; r++) {
        const sr = (r + f * 11 * (1 - rowCoherent)) % rows;
        for (let c = 0; c < cols; c++) {
          const sc = (c + f * 7) % cols;
          const si = (sr * cols + sc) * 4;
          const di = (r * cols + c) * 4;
          shifted[di] = data[si];
          shifted[di + 1] = data[si + 1];
          shifted[di + 2] = data[si + 2];
          shifted[di + 3] = data[si + 3];
        }
      }
      return {
        label: `side ${f + 1}`,
        url: bytesToDataUrl(shifted, cols, rows, 4, true, (p) => [p[0], p[1], p[2]]),
        w: cols,
        h: rows,
      };
    });
    return {
      common: `atlas region ${cols}×${rows} px · 1 texel per window · one region, four per-side shifts`,
      tiles,
    };
  }
  if (approachId === "atlas-sdf") {
    const facade = new Color();
    facadeColorFor(b, facade, DEFAULT_FACADE);
    const data = new Uint8Array(b.colsPerFace * b.floors * 4);
    fillCellAtlas(data, b, LAB_SEED, windows, timeSec, [
      Math.round(facade.r * 255),
      Math.round(facade.g * 255),
      Math.round(facade.b * 255),
    ]);
    return {
      common: `cell atlas ${b.colsPerFace}×${b.floors} px · 1 texel per window · pane shape analytic (no field texture) · shared by all 4 sides`,
      tiles: [
        {
          label: "",
          url: bytesToDataUrl(data, b.colsPerFace, b.floors, 4, true, (p) => [p[0], p[1], p[2]]),
          w: b.colsPerFace,
          h: b.floors,
        },
      ],
    };
  }
  const W = b.colsPerFace * CELL_PX;
  const H = b.floors * CELL_PX;
  if (approachId === "baked-mip") {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    drawFacade(canvas, b, LAB_SEED, windows, timeSec);
    return {
      common: `bake ${W}×${H} px · ${CELL_PX} px per window · one bitmap shared by all 4 sides`,
      tiles: [{ label: "", url: canvas.toDataURL(), w: W, h: H }],
    };
  }
  // baked-sdf: colour + field channels
  const facade = new Color();
  facadeColorFor(b, facade, DEFAULT_FACADE);
  const colorData = new Uint8Array(W * H * 4);
  const fieldData = new Uint8Array(W * H * 2);
  fillBakeData(colorData, fieldData, W, b, LAB_SEED, windows, timeSec, [
    Math.round(facade.r * 255),
    Math.round(facade.g * 255),
    Math.round(facade.b * 255),
  ]);
  return {
    common: `${W}×${H} px each · ${CELL_PX} px per window · both shared by all 4 sides`,
    tiles: [
      {
        label: "colour",
        url: bytesToDataUrl(colorData, W, H, 4, true, (p) => [p[0], p[1], p[2]]),
        w: W,
        h: H,
      },
      {
        label: "fields (R: horizontal · G: vertical)",
        url: bytesToDataUrl(fieldData, W, H, 2, true, (p) => [p[0], p[1], 0]),
        w: W,
        h: H,
      },
    ],
  };
}

// Atlas "kind" legend colours: what the alpha channel encodes per cell.
const KIND_COLORS: Record<number, [number, number, number]> = {
  0: [0, 0, 0], // unlit (tungsten default at runtime)
  128: [78, 168, 222], // TV (flickers)
  200: [255, 209, 102], // correlated band (row unit)
  255: [255, 255, 255], // steady per-window lit
};

// The current shader's ACTUAL GPU texture: the whole rack packed in one sheet.
export function buildAtlasSheetTiles(): Tile[] {
  const items: PackInput[] = SPECIMENS.map((b) => {
    const tex = generateWindowTexture(LAB_SEED, b);
    const data = tex.texture.image.data as Uint8Array;
    tex.texture.dispose();
    return { id: b.id, cols: tex.cols, rows: tex.rows, data };
  });
  const pack = packWindowAtlas(items);
  const colors = bytesToDataUrl(pack.atlas, pack.width, pack.height, 4, true, (p) => [
    p[0],
    p[1],
    p[2],
  ]);
  const kinds = bytesToDataUrl(
    pack.atlas,
    pack.width,
    pack.height,
    4,
    true,
    (p) => KIND_COLORS[p[3]] ?? [255, 0, 255],
  );
  return [
    {
      label: `lit colours — ${pack.width}×${pack.height}, 1 texel per window`,
      url: colors,
      w: pack.width,
      h: pack.height,
    },
    {
      label: "cell kinds — white: lit · amber: band · blue: TV · black: unlit",
      url: kinds,
      w: pack.width,
      h: pack.height,
    },
  ];
}
