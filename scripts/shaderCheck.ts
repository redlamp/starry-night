/**
 * Headless GLSL syntax check for every custom shader string (the Playwright
 * path is broken on this box, so compile errors otherwise only surface in the
 * user's browser console — truncated). Parses with @shaderfrog/glsl-parser
 * after prepending the three.js ShaderMaterial preamble.
 *   bun run scripts/shaderCheck.ts
 */
import { parser } from "@shaderfrog/glsl-parser";
import { shootingStarVertexShader, shootingStarFragmentShader } from "@/lib/shaders/shootingStar";
import { starFieldVertexShader, starFieldFragmentShader } from "@/lib/shaders/starField";
import { skyGradientVertexShader, skyGradientFragmentShader } from "@/lib/shaders/skyGradient";
import { fogBoundsVertexShader, fogBoundsFragmentShader } from "@/lib/shaders/fogBounds";
import { moonVertexShader, moonFragmentShader } from "@/lib/shaders/moon";
import { moonHaloVertexShader, moonHaloFragmentShader } from "@/lib/shaders/moonHalo";

// Minimal stand-in for three's injected vertex prelude.
const VERTEX_PRELUDE = `
precision highp float;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
`;
const FRAGMENT_PRELUDE = `
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
`;

const CASES: Array<[string, string, string]> = [
  ["shootingStar.vertex", VERTEX_PRELUDE, shootingStarVertexShader],
  ["shootingStar.fragment", FRAGMENT_PRELUDE, shootingStarFragmentShader],
  ["starField.vertex", VERTEX_PRELUDE, starFieldVertexShader],
  ["starField.fragment", FRAGMENT_PRELUDE, starFieldFragmentShader],
  ["skyGradient.vertex", VERTEX_PRELUDE, skyGradientVertexShader],
  ["skyGradient.fragment", FRAGMENT_PRELUDE, skyGradientFragmentShader],
  ["fogBounds.vertex", VERTEX_PRELUDE, fogBoundsVertexShader],
  ["fogBounds.fragment", FRAGMENT_PRELUDE, fogBoundsFragmentShader],
  ["moon.vertex", VERTEX_PRELUDE, moonVertexShader],
  ["moon.fragment", FRAGMENT_PRELUDE, moonFragmentShader],
  ["moonHalo.vertex", VERTEX_PRELUDE, moonHaloVertexShader],
  ["moonHalo.fragment", FRAGMENT_PRELUDE, moonHaloFragmentShader],
];

let failed = 0;
for (const [name, prelude, src] of CASES) {
  try {
    parser.parse(prelude + src, { quiet: true });
    console.log(`${name.padEnd(26)} PARSE OK`);
  } catch (e) {
    failed++;
    console.log(`${name.padEnd(26)} PARSE FAIL`);
    console.log(String(e instanceof Error ? e.message : e).slice(0, 600));
  }
}
process.exit(failed > 0 ? 1 : 0);
