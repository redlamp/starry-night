// #69 archetype hover-highlight stroke outline — inverted-hull shell.
//
// Companion shader to cityInstanced.ts, rendered as a second InstancedMesh per
// archetype entry (see InstancedCity.buildMeshes). Buildings are unit-box
// geometry (BoxGeometry(1,1,1)) scaled per instance via instanceMatrix, so a
// constant WORLD-space border requires the LOCAL vertex offset to be divided
// by that axis's instance scale before the instance transform is applied —
// otherwise the transform's own scale would re-scale the offset and a spire
// would get a much thicker (or thinner) border than a low-rise. Offsetting in
// local space also means this shares the exact same geometry object as the
// main mesh; no separate outline geometry is built or disposed.
//
// Rendered with side: BackSide (set on the material in InstancedCity) — the
// classic inverted-hull technique: the enlarged shell's back faces are hidden
// behind the real facade everywhere except at the silhouette edge, where the
// facade doesn't cover them and they read as a border stroke. Default depth
// test/write is sufficient; no polygonOffset needed unless a future look
// change reintroduces z-fighting (see the comment in InstancedCity).
export const cityOutlineVertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

// World-space border thickness, metres. Scaled CPU-side by the same eased
// highlight value the facade dim/lift uses (0 when idle — see the mesh
// visible gate in InstancedCity, which also skips the draw call entirely).
uniform float uOutlineWidth;

void main() {
  mat3 instMat3 = mat3(instanceMatrix);
  vec3 scaleVec = vec3(length(instMat3[0]), length(instMat3[1]), length(instMat3[2]));
  vec3 localOffset = sign(position) * uOutlineWidth / max(scaleVec, vec3(1e-4));
  vec3 shellPos = position + localOffset;

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(shellPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

export const cityOutlineFragmentShader = /* glsl */ `
#include <fog_pars_fragment>

// Authored in DISPLAY space (see wiki/notes/decision-facade-display-space-color.md)
// — this material writes gl_FragColor raw like cityInstanced, so the colour
// arrives here as literal 0..1 components (InstancedCity builds it with
// THREE.Color.setRGB, no colour-space conversion), not a THREE.Color hex that
// would otherwise get converted to linear and read too dark.
uniform vec3 uOutlineColor;

void main() {
  gl_FragColor = vec4(uOutlineColor, 1.0);
  #include <fog_fragment>
}
`;
