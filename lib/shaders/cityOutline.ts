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
//
// #87 single-instance pick reuses this exact shell, gated per-instance by
// comparing each instance's world-space centre to uPickPosition (see the
// matching comment on cityInstanced's uPickPosition — no free vertex-
// attribute slot exists to carry a per-instance identity, so position stands
// in for it) instead of the whole-mesh `visible` flip #69 uses.
//
// #87 click-to-select layers a SECOND, independent gate (uSelectPosition)
// alongside the hover pick above — either can outline an instance on the same
// mesh at once, so a fragment-side colour mix (vColorMix) picks uSelectColor
// for the selected instance and uOutlineColor for everything else, selection
// winning ties. Non-outlined instances (gate 0) are collapsed to a degenerate
// off-screen point in the vertex shader (see the end of main() below) — left
// at their unmoved position they'd sit exactly coincident with the real
// facade and z-fight it at the silhouette edge, a stray hairline on every
// OTHER building of the outlined instance's archetype (invisible under
// bright windows, obvious with windows off).
export const cityOutlineVertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

// World-space border thickness, metres. Scaled CPU-side by the same eased
// highlight value the facade dim/lift uses for the archetype-hover case (0
// when idle), or applied instantly for a single-instance pick — see the
// per-frame feed in InstancedCity.
uniform float uOutlineWidth;
// #87: the picked building's world-space centre, or a sentinel far outside
// the city when nothing is picked (InstancedCity's PICK_SENTINEL) — see
// cityInstanced.ts's uPickPosition comment for why position, not an
// instance-index attribute.
uniform vec3 uPickPosition;
// 1 = apply uOutlineWidth to EVERY instance (archetype-icon hover, #69);
// 0 = apply it to ONLY the instance at uPickPosition (#87). Never both at
// once for a given mesh — see InstancedCity's frame loop.
uniform float uOutlineWhole;
// #87 click-to-select: the SELECTED building's world-space centre, or the
// same PICK_SENTINEL when nothing is selected — see cityInstanced.ts's
// uSelectPosition comment. A second, independent per-instance gate: a
// hover-pick and a persistent selection can both be live on the same mesh.
uniform vec3 uSelectPosition;

// #69 hairline floor (2026-07-04): below this, uOutlineWidth 0 collapsed the
// shell to nothing. uHairlinePx is DEVICE pixels; uViewportHeight (CSS px,
// from R3F's useThree size().height) and uDpr (gl.getPixelRatio()) convert it
// to a clip-space push in main() below. Applied ADDITIVELY on top of the
// world-space width — at width 0 it's the whole story (a crisp hairline); at
// width > 0 it's a small, usually-invisible top-up that only matters once the
// world-space thickening itself has shrunk under a pixel at range.
uniform float uHairlinePx;
uniform float uViewportHeight;
uniform float uDpr;

// #87: 1.0 when THIS instance is the click-selected building, else 0.0 — set
// in main() below, consumed by the fragment shader to pick uSelectColor over
// uOutlineColor. Not gated by the outline gate itself: it's a colour CHOICE
// for whichever instance ends up outlined, independent of why it's outlined.
varying float vColorMix;

void main() {
  mat3 instMat3 = mat3(instanceMatrix);
  vec3 scaleVec = vec3(length(instMat3[0]), length(instMat3[1]), length(instMat3[2]));

  // #87 per-instance gate: which instances this mesh's current width applies
  // to. Squared-distance vs. a 0.5 m gate (0.25 = 0.5*0.5) avoids a sqrt;
  // building footprints never overlap, so each test only ever matches the
  // single instance actually sitting at that position.
  vec3 instCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 pickDelta = instCenter - uPickPosition;
  float isPicked = dot(pickDelta, pickDelta) < 0.25 ? 1.0 : 0.0;
  vec3 selDelta = instCenter - uSelectPosition;
  float isSelected = dot(selDelta, selDelta) < 0.25 ? 1.0 : 0.0;
  float gate = max(uOutlineWhole, max(isPicked, isSelected));
  vColorMix = isSelected;

  vec3 outwardLocal = sign(position);
  vec3 localOffset = outwardLocal * (uOutlineWidth * gate) / max(scaleVec, vec3(1e-4));
  vec3 shellPos = position + localOffset;

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(shellPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Screen-space pixel floor: push the projected shell outward along its
  // silhouette direction by a small CONSTANT screen amount, gated by the same
  // gate value above so untouched instances stay exactly on the facade (no
  // stray hairline on every building). Direction uses the FACE NORMAL, not
  // outwardLocal (the corner diagonal used for the world-space offset above):
  // outwardLocal differs per VERTEX within a single triangle (a box face's 4
  // corners share only one sign component), so pushing each vertex along it
  // independently warps the triangle instead of translating it — enough to
  // occasionally flip its screen-space winding, which with side:BackSide
  // means the GPU silently culls it (this was the bug behind the "hairline
  // just doesn't render" symptom, confirmed by an exaggerated-width probe
  // showing literally zero pixels regardless of size). BoxGeometry duplicates
  // vertices per face specifically so the normal attribute is IDENTICAL
  // across all 4 corners of a face (same trick cityInstanced's vFaceId relies
  // on) — pushing by it is a pure translation, which cannot change winding at
  // any magnitude.
  // gl_Position.xy is CLIP space, so the NDC-space push is scaled by
  // gl_Position.w to survive the perspective divide unchanged.
  mat3 instRot = mat3(instMat3[0] / scaleVec.x, instMat3[1] / scaleVec.y, instMat3[2] / scaleVec.z);
  vec3 viewDir = mat3(modelViewMatrix) * (instRot * normal);
  float pushLen = length(viewDir.xy);
  vec2 pushDir = pushLen > 1e-5 ? viewDir.xy / pushLen : vec2(0.0);
  float physPxHeight = max(uViewportHeight * uDpr, 1.0);
  // Fade the push out as the world-space border widens: because it pushes each
  // FACE along its OWN normal, adjacent faces separate at the box's shared
  // vertical edges — a visible seam once the border is thicker than a hairline.
  // Kept in full at width 0 (there the hairline IS this push); gone by ~0.5 m,
  // so a normal-width border's faces stay joined at the corners.
  float pushFade = 1.0 - smoothstep(0.0, 0.5, uOutlineWidth * gate);
  gl_Position.xy += pushDir * (2.0 * uHairlinePx * gate * pushFade / physPxHeight) * gl_Position.w;

  #include <fog_vertex>

  // #87 pick/select + #69 hover: a NON-outlined instance (gate 0) leaves its
  // shell exactly coincident with the facade, which z-fights it at the
  // silhouette edge — a stray hairline on every OTHER building of the
  // outlined instance's archetype, invisible under bright windows but
  // obvious with windows off. Collapse those instances to a degenerate
  // off-screen point so only the outlined instance(s) ever rasterize.
  // Whole-mesh archetype hover sets uOutlineWhole = 1, so gate is 1
  // everywhere there and nothing collapses.
  if (gate < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
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
// #87 click-to-select colour — same DISPLAY-space authoring as uOutlineColor
// above. vColorMix (set in the vertex shader) picks this over uOutlineColor
// for the selected instance, so a selection reads in a distinct colour even
// while a hover-pick or archetype-hover outline is ALSO live on this mesh.
uniform vec3 uSelectColor;
varying float vColorMix;

void main() {
  gl_FragColor = vec4(mix(uOutlineColor, uSelectColor, vColorMix), 1.0);
  #include <fog_fragment>
}
`;
