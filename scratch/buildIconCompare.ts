/** Assemble docs/prototypes/touch-gesture-icons.html: current control glyphs vs
 * downloaded candidates (Tabler / MDI / Phosphor), inline SVG on the app's dark bg. */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CAND =
  process.env.TEMP + "\\..\\..\\" // placeholder, replaced below
;
const candDir =
  "C:\\Users\\taylo\\AppData\\Local\\Temp\\claude\\C--workspace-starry-night\\0348e222-9835-41de-bb80-108ab027e738\\scratchpad\\icons";
const currentDir = "public\\controls";

const inline = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

const cell = (label: string, svg: string, note = "") => `
  <div class="cell">
    <div class="glyph">${svg}</div>
    <div class="label">${label}</div>
    ${note ? `<div class="note">${note}</div>` : ""}
  </div>`;

const cur = (name: string) => inline(join(currentDir, name + ".svg"));
const cand = (name: string) => inline(join(candDir, name + ".svg"));

const groups: Array<{ title: string; cells: string }> = [
  {
    title: "1 finger — Move",
    cells:
      cell("current: finger-1", cur("finger-1")) +
      cell("tabler hand-finger", cand("tabler-hand-finger"), "MIT · stroke, lucide-like") +
      cell("tabler hand-move", cand("tabler-hand-move"), "MIT · arrows baked in") +
      cell("mdi gesture-swipe", cand("mdi-gesture-swipe"), "Apache-2.0 · filled") +
      cell("phosphor hand-tap", cand("phosphor-hand-tap"), "MIT · filled outline"),
  },
  {
    title: "2 fingers — Orbit / Tilt (guide overlays its own arrows)",
    cells:
      cell("current: finger-2", cur("finger-2")) +
      cell("tabler hand-two-fingers", cand("tabler-hand-two-fingers"), "MIT · stroke") +
      cell("mdi swipe-horizontal", cand("mdi-gesture-swipe-horizontal"), "arrows baked in") +
      cell("mdi swipe-vertical", cand("mdi-gesture-swipe-vertical"), "arrows baked in"),
  },
  {
    title: "Twist — Rotate",
    cells:
      cell("current: finger-2 + sub", cur("finger-2")) +
      cell("mdi rotate-360", cand("mdi-rotate-360"), "abstract, no hand") +
      cell("phosphor hand-grabbing", cand("phosphor-hand-grabbing"), "grab metaphor"),
  },
  {
    title: "Pinch — Zoom",
    cells:
      cell("current: pinch", cur("pinch")) +
      cell("mdi gesture-pinch", cand("mdi-gesture-pinch"), "pinch IN") +
      cell("mdi gesture-spread", cand("mdi-gesture-spread"), "spread OUT"),
  },
  {
    title: "Double-tap — Zoom In",
    cells:
      cell("current: finger-1 + ×2", cur("finger-1")) +
      cell("mdi gesture-double-tap", cand("mdi-gesture-double-tap")) +
      cell("mdi two-double-tap", cand("mdi-gesture-two-double-tap")) +
      cell("tabler hand-click", cand("tabler-hand-click")),
  },
];

const html = `<!doctype html>
<meta charset="utf-8">
<title>Touch gesture icon candidates</title>
<style>
  body { background: #0b0e14; color: #e4e4e7; font: 14px/1.4 system-ui, sans-serif; padding: 24px; }
  h1 { font-size: 18px; } h2 { font-size: 14px; color: #a1a1aa; margin: 28px 0 8px; }
  .row { display: flex; gap: 14px; flex-wrap: wrap; }
  .cell { width: 150px; border: 1px solid #27272a; border-radius: 10px; padding: 12px; background: #101420; }
  .glyph { height: 48px; display: flex; align-items: center; }
  .glyph svg { height: 40px; width: auto; color: #e4e4e7; fill: currentColor; }
  .glyph svg[stroke] { fill: none; }
  .label { margin-top: 8px; font-size: 12px; }
  .note { color: #71717a; font-size: 11px; margin-top: 2px; }
</style>
<h1>Touch gesture icons — current vs candidates (rendered at guide size, dark bg)</h1>
<p style="color:#a1a1aa">Sources: Tabler (MIT), Material Design Icons (Apache 2.0), Phosphor (MIT).
All are plain SVGs — adopting one = dropping the file into public/controls/ (colors adjusted), no npm dependency.</p>
${groups.map((g) => `<h2>${g.title}</h2><div class="row">${g.cells}</div>`).join("\n")}
`;

writeFileSync("docs/prototypes/touch-gesture-icons.html", html);
console.log("written docs/prototypes/touch-gesture-icons.html");
void CAND;
void readdirSync;
