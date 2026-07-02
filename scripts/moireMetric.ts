/**
 * Speckle/moiré metric for starry-night captures.
 *   bun moireMetric.ts <a.png> [b.png ...]
 *
 * Decodes PNG (8-bit RGB/RGBA, non-interlaced), computes per-pixel luma, and
 * counts "speckle" pixels: luma deviating > DEV from the 3x3 median in regions
 * with content (median or pixel > FLOOR). Salt-and-pepper aliasing scores high;
 * smooth gradients and solid windows score ~0. Reports rate per kilopixel of
 * lit content, split into image-height thirds (far/mid/near for a horizon shot).
 */
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

const DEV = 25;
const FLOOR = 35;

function decodePng(path: string): { w: number; h: number; rgba: Uint8Array } {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let w = 0,
    h = 0,
    bitDepth = 0,
    colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG unsupported");
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6))
    throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0; // left
      const b = prev[x]; // up
      const c = x >= bpp ? prev[x - bpp] : 0; // up-left
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 4] = cur[x * bpp];
      out[(y * w + x) * 4 + 1] = cur[x * bpp + 1];
      out[(y * w + x) * 4 + 2] = cur[x * bpp + 2];
      out[(y * w + x) * 4 + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev = cur;
  }
  return { w, h, rgba: out };
}

function luma(rgba: Uint8Array, i: number): number {
  return 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
}

function median9(v: number[]): number {
  v.sort((a, b) => a - b);
  return v[4];
}

function analyze(path: string): void {
  const { w, h, rgba } = decodePng(path);
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = luma(rgba, i);
  const thirds = [0, 0, 0];
  const litThirds = [0, 0, 0];
  let speckle = 0;
  let lit = 0;
  const neigh: number[] = new Array(9);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) neigh[k++] = L[(y + dy) * w + (x + dx)];
      const me = L[y * w + x];
      const med = median9(neigh.slice());
      if (me < FLOOR && med < FLOOR) continue;
      lit++;
      const third = Math.min(2, Math.floor((y / h) * 3));
      litThirds[third]++;
      if (Math.abs(me - med) > DEV) {
        speckle++;
        thirds[third]++;
      }
    }
  }
  const rate = (n: number, d: number) => (d ? ((1000 * n) / d).toFixed(1) : "0");
  console.log(
    `${path.split(/[\\/]/).pop()}: speckle/klit=${rate(speckle, lit)} ` +
      `(top=${rate(thirds[0], litThirds[0])} mid=${rate(thirds[1], litThirds[1])} bot=${rate(thirds[2], litThirds[2])}) ` +
      `lit=${lit} speckle=${speckle}`,
  );
}

for (const p of process.argv.slice(2)) analyze(p);
