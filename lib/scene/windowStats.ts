// Per-building window statistics for the hybrid far field (#82): the
// on-weighted mean lit colour (display-parity: sRGB decode × emissive boost,
// per-channel clamped like the raw framebuffer) and the expected on-fraction,
// computed from a building's window-atlas texels. Atlas-unlit cells glow the
// shader's default tungsten; steady/band cells cycle at the 60s-on/30s-off
// duty (2/3); TVs stay on at ~0.7 mean shimmer brightness. Shared by
// InstancedCity and the Window Lab's CurrentShaderRack so the lab reference
// carries the exact production aMeanLit data.

const srgbToLinear = (u: number) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
const TUNGSTEN_FAR = [0.77, 0.6314, 0.4235] as const; // (1.0,0.82,0.55) * 1.4 * 0.55
const boost = (v: number) => Math.min(1, srgbToLinear(v / 255) * 1.4);

export function meanLitStats(
  data: Uint8Array,
  cellCount: number,
): [number, number, number, number] {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let onSum = 0;
  for (let i = 0; i < cellCount; i++) {
    const a = data[i * 4 + 3];
    let r: number;
    let g: number;
    let bl: number;
    let on: number;
    if (a === 0) {
      [r, g, bl] = TUNGSTEN_FAR;
      on = 2 / 3;
    } else {
      r = boost(data[i * 4]);
      g = boost(data[i * 4 + 1]);
      bl = boost(data[i * 4 + 2]);
      on = a === 128 ? 0.7 : 2 / 3;
    }
    sr += r * on;
    sg += g * on;
    sb += bl * on;
    onSum += on;
  }
  const inv = 1 / Math.max(onSum, 1e-3);
  return [sr * inv, sg * inv, sb * inv, onSum / Math.max(cellCount, 1)];
}
