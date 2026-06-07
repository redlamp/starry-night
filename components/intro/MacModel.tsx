"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RenderTexture, useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { ThreeElements } from "@react-three/fiber";
import { ScreenCity } from "./ScreenCity";
import { setCursorZone } from "./stageCursor";
import { useSceneStore } from "@/lib/state/sceneStore";
import { randomSeed } from "@/lib/seed/rng";
import {
  SCREEN_COLOR_MODE_INDEX,
  type BwLevels,
  type IntroViewMode,
  type ScreenColorMode,
} from "./viewMode";

type GroupProps = ThreeElements["group"];

/**
 * Hero Mac model, normalized to a common convention: centred on x/z, base
 * resting on y=0, real-world metres.
 *
 * Daz "Macintosh 128K Computer (1984)", CC BY-NC 4.0 — see
 * public/models/CREDITS.md; attribution also embedded in the GLB's
 * asset.copyright. Authored in centimetres, separate objects.
 *
 * The GLB's dedicated screen mesh (`Computer_Screen_0`) is hidden and
 * re-rendered with the same geometry (exact rounded-CRT silhouette,
 * planar-remapped UVs) carrying a live RenderTexture of the city —
 * the starry-night viewport.
 */

const DAZ_URL = "/models/mac-128k-daz.glb";
const SCREEN_MESH = "Computer_Screen_0";
const COMPUTER_ONLY = /^(Computer|Brightness)_/;

function NormalizedModel({
  url,
  unitScale = 1,
  show,
  hide,
  cloneScene = false,
  children,
  ...groupProps
}: {
  url: string;
  unitScale?: number;
  show?: RegExp;
  hide?: string;
  /** Deep-clone the cached GLTF scene — required for a second on-stage
   * instance (an Object3D has one parent; geometry/materials stay shared). */
  cloneScene?: boolean;
} & GroupProps) {
  const { scene } = useGLTF(url);

  const { root, offset } = useMemo(() => {
    const root = cloneScene ? scene.clone(true) : scene;
    root.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.visible = (show ? show.test(mesh.name) : true) && mesh.name !== hide;
      mesh.castShadow = mesh.visible;
      // self-shadowing: without this the recessed brightness knob renders as
      // bright as open surfaces — the case never occludes it
      mesh.receiveShadow = mesh.visible;
    });
    // bbox of the visible meshes only, in the GLB's own (post-transform) space
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    root.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.visible) box.expandByObject(mesh);
    });
    const center = box.getCenter(new THREE.Vector3());
    return { root, offset: new THREE.Vector3(-center.x, -box.min.y, -center.z) };
  }, [scene, show, hide, cloneScene]);

  return (
    <group {...groupProps}>
      <group scale={unitScale}>
        {/* children share the GLB's coordinate space */}
        <group position={offset.toArray()}>
          <primitive object={root} />
          {children}
        </group>
      </group>
    </group>
  );
}

// Native Mac raster + the CRT's dead border: the glass is bigger than the
// active display area.
const RASTER_W = 512;
const RASTER_H = 342;
const RASTER_ASPECT = RASTER_W / RASTER_H;
// Reference: apple-mac-plus photos — the raster runs snug to the sides
// (~3-4% side borders), with the leftover height as top/bottom bands.
const ACTIVE_W_FRACTION = 0.95; // of glass width
const MAX_H_FRACTION = 0.88; // of glass height

// Colour-depth processing runs in its OWN pass at native raster resolution
// (512×342), and the processed result is mip-filtered onto the glass.
// Processing per canvas pixel (the old way) undersampled dither/window
// grids and produced moiré; process-then-filter averages the processed
// raster instead — like a real 1-bit CRT blending to grey at distance.
const PROCESS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // fullscreen quad, camera-free
  }
`;

const PROCESS_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uColorMode; // 0 = 1-bit b/w, 1 = greyscale, 2 = mac 256, 3 = full
  uniform float uBwLo;      // levels black point (below ⇒ solid black)
  uniform float uBwHi;      // levels white point (above ⇒ solid white)
  uniform float uBrightness; // the front-panel knob: beam gain ahead of everything
  varying vec2 vUv;

  float crtBayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
  float crtBayer4(vec2 a) { return crtBayer2(0.5 * a) * 0.25 + crtBayer2(a); }

  void main() {
    vec3 c = texture2D(uTex, vUv).rgb * uBrightness;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float d = crtBayer4(gl_FragCoord.xy);
    vec3 outc;
    if (uColorMode < 0.5) {
      // 1-bit with a levels pre-pass: crush faces/sky to black, lift
      // windows/stars to white — dither only in the knee between the points.
      // Strictly-greater test: the Bayer tile's zero cell must NOT fire on
      // zero luminance (lv >= d would paint one white px per tile on black).
      float lv = smoothstep(uBwLo, max(uBwHi, uBwLo + 0.001), l);
      outc = vec3(step(d + 0.001, lv));
    } else if (uColorMode < 1.5) {
      outc = vec3(l);
    } else if (uColorMode < 2.5) {
      outc = clamp(floor(c * 5.0 + d) / 5.0, 0.0, 1.0);
    } else {
      outc = c;
    }
    gl_FragColor = vec4(outc, 1.0);
  }
`;

// Halation pass: phosphor light scatter — every texel gathers brightness
// from its neighbourhood (gaussian falloff, ~3 texel radius) and screen-
// blends it over itself. Runs at native raster res, so cost is constant
// regardless of display size. Sits between process pass and the glass.
const HALATION_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec2 uTexel;     // 1 / raster size
  uniform float uHalation; // scatter strength
  varying vec2 vUv;

  void main() {
    vec3 base = texture2D(uTex, vUv).rgb;
    vec3 halo = vec3(0.0);
    float wsum = 0.0;
    for (int x = -3; x <= 3; x++) {
      for (int y = -3; y <= 3; y++) {
        if (x == 0 && y == 0) continue;
        vec2 off = vec2(float(x), float(y));
        float d2 = dot(off, off);
        float w = exp(-d2 * 0.35);
        halo += texture2D(uTex, vUv + off * uTexel).rgb * w;
        wsum += w;
      }
    }
    halo /= wsum;
    // screen blend keeps lit pixels from clipping while the halo lifts
    // their dark neighbours
    vec3 outc = 1.0 - (1.0 - base) * (1.0 - halo * uHalation);
    gl_FragColor = vec4(outc, 1.0);
  }
`;

// Material injection: the model's own screen texture stays the base (its
// painted glass, vignette, bezel shading), and the live raster composites
// over it with a SCREEN blend — black raster shows the glass, bright pixels
// add. Raster UVs travel as a second attribute (crtUvAttr) since the
// original map keeps the GLB's own UVs.
const CRT_VERT_HEADER = /* glsl */ `
  attribute vec2 crtUvAttr;
  varying vec2 vCrtUv;
`;

const CRT_UV_VERTEX = /* glsl */ `
  #include <uv_vertex>
  vCrtUv = crtUvAttr;
`;

const CRT_HEADER = /* glsl */ `
  uniform sampler2D uCrt;   // processed raster (city → colour-depth pass)
  uniform vec2 uActive;     // active raster fraction of the glass
  uniform float uGlow;      // phosphor self-emission strength
  uniform float uScanline;  // raster-row mask strength (#71)
  varying vec2 vCrtUv;
`;

const CRT_MAP_FRAGMENT = /* glsl */ `
  #include <map_fragment>
  vec2 crtUv = (vCrtUv - 0.5) / uActive + 0.5;
  vec3 crtCol = vec3(0.0); // outside the active raster: glass only
  if (!(any(lessThan(crtUv, vec2(0.0))) || any(greaterThan(crtUv, vec2(1.0))))) {
    crtCol = texture2D(uCrt, crtUv).rgb;
    // Scanlines (#71): the gaps between raster rows are sub-texel, so the
    // mask runs at display sampling time — faded out by fwidth when a row
    // covers < ~1 screen px, otherwise it would moiré exactly like the
    // pre-mipmap dither did.
    float rowY = crtUv.y * ${RASTER_H.toFixed(1)};
    float scanVis = clamp((1.0 - fwidth(rowY)) * 2.0, 0.0, 1.0);
    crtCol *= 1.0 - uScanline * scanVis * (0.5 + 0.5 * cos(6.2831853 * fract(rowY)));
  }
  // screen blend over the model's glass
  diffuseColor.rgb = 1.0 - (1.0 - diffuseColor.rgb) * (1.0 - crtCol);
`;

// crtCol stays in scope from map_fragment (same main body, earlier include).
const CRT_EMISSIVE_FRAGMENT = /* glsl */ `
  totalEmissiveRadiance += crtCol * uGlow;
`;

/**
 * Hotspot over the rainbow Apple badge (lower-left front face). Clicking it
 * rerolls the master seed — a fresh city on every press of the apple.
 * Rendered in GLB space inside NormalizedModel, so it works on both the
 * working and stock Macs. Coplanar with the body's front face — a floating
 * plane parallax-shifts off the painted logo as the camera orbits.
 * Hovering shows a soft highlight (doubles as the alignment debug visual).
 */
const BADGE_DEBUG = false; // true: badge zone always visible
const FACADE_TILT = -0.12; // rad — the front face leans back slightly

function AppleBadge() {
  const { scene } = useGLTF(DAZ_URL);
  const setSeed = useSceneStore((s) => s.setSeed);
  const position = useMemo(() => {
    let glassMesh: THREE.Mesh | undefined;
    let bodyMesh: THREE.Mesh | undefined;
    scene.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name === SCREEN_MESH) glassMesh = mesh;
      if (mesh.name === "Computer_Computer_0") bodyMesh = mesh;
    });
    if (!glassMesh || !bodyMesh) return null;
    scene.updateMatrixWorld(true);
    const glass = new THREE.Box3().setFromObject(glassMesh);
    const body = new THREE.Box3().setFromObject(bodyMesh);
    // x/y verified against the painted logo via debug render; z hugs the
    // body's front plane so the zone tracks the logo at any camera angle
    return new THREE.Vector3(glass.min.x + 0.05, glass.min.y - 7.55, body.max.z + 0.05);
  }, [scene]);

  if (!position) return null;
  return (
    <mesh
      position={position.toArray()}
      rotation={[FACADE_TILT, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        setSeed(randomSeed());
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerOver={(e) => {
        e.stopPropagation();
        setCursorZone("badge", true);
      }}
      onPointerOut={() => setCursorZone("badge", false)}
    >
      <planeGeometry args={[2.1, 2.2]} />
      <meshBasicMaterial
        transparent
        opacity={BADGE_DEBUG ? 0.35 : 0}
        color="#ffffff"
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * The front-panel brightness thumbwheel, wired two-way to the Screen
 * settings: scrub over the wheel (or scroll) to set brightness, and the
 * wheel rolls to match wherever the value comes from (knob, slider, Reset).
 * The GLB authors the wheel as its own node with the pivot dead-centre, but
 * the disc is baked TILTED with the facade lean (bbox math: circular disc
 * d=2.24 tilted ~0.12 rad explains the y-extent and a 2.5mm thickness;
 * an untilted disc would be a 4% oval, 1cm thick) — so the spin axis is
 * the facade normal, not pure z, or the wheel wobbles like a coin. While
 * the pointer engages the knob the studio OrbitControls stand down —
 * pointer capture owns the drag. Working Mac only; the stock Mac keeps
 * its static source wheel.
 */
const KNOB_MESH = "Brightness_Computer_0";
const KNOB_MAX = 2; // value domain [0, 2], 1 = neutral beam gain
const KNOB_ROT_PER_UNIT = Math.PI * 0.6; // wheel roll per unit of brightness
const KNOB_DRAG_PER_PX = 0.008;
// the wheel's axle: perpendicular to the leaned-back facade (same tilt the
// AppleBadge plane uses)
const KNOB_AXIS = new THREE.Vector3(0, -Math.sin(FACADE_TILT), Math.cos(FACADE_TILT));

function BrightnessKnob({
  value,
  locked = false,
  onChange,
  onEngageChange,
  onDragChange,
  onReset,
}: {
  value: number;
  /** another gesture owns the input — don't start a drag or eat the wheel */
  locked?: boolean;
  onChange: (v: number) => void;
  onEngageChange?: (engaged: boolean) => void;
  onDragChange?: (dragging: boolean) => void;
  /** double-click: restore the screen settings to their defaults */
  onReset?: () => void;
}) {
  const { scene } = useGLTF(DAZ_URL);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startValue: number;
  } | null>(null);
  const engaged = useRef({ hover: false, drag: false });

  const knob = useMemo(() => {
    const mesh = scene.getObjectByName(KNOB_MESH) as THREE.Mesh | undefined;
    if (!mesh) return null;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    return {
      mesh,
      center: box.getCenter(new THREE.Vector3()),
      size: box.getSize(new THREE.Vector3()),
    };
  }, [scene]);

  // the wheel angle tracks the value, whatever set it (drag, slider, Reset).
  // Sign: the hand pushes the EXPOSED BOTTOM of the wheel, so value-up
  // (drag right) rolls the bottom rim rightward = CCW seen from the front.
  useEffect(() => {
    if (knob) knob.mesh.quaternion.setFromAxisAngle(KNOB_AXIS, (value - 1) * KNOB_ROT_PER_UNIT);
  }, [knob, value]);
  // leave the shared scene as found — the stock Mac clones from it
  useEffect(() => {
    return () => {
      if (knob) knob.mesh.quaternion.identity();
    };
  }, [knob]);

  const setEngaged = (patch: Partial<typeof engaged.current>) => {
    Object.assign(engaged.current, patch);
    onEngageChange?.(engaged.current.hover || engaged.current.drag);
  };

  if (!knob) return null;
  return (
    // invisible hotspot over the wheel, padded for grabbability and poking
    // through the bezel slot (the wheel itself is mostly recessed)
    <mesh
      position={knob.center.toArray()}
      onPointerOver={(e) => {
        e.stopPropagation();
        setEngaged({ hover: true });
        setCursorZone("knob", true);
      }}
      onPointerOut={() => {
        setEngaged({ hover: false });
        setCursorZone("knob", false);
      }}
      onPointerDown={(e) => {
        if (locked) return;
        e.stopPropagation();
        drag.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          startValue: value,
        };
        (e.target as Element).setPointerCapture?.(e.pointerId);
        setEngaged({ drag: true });
        onDragChange?.(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.pointerId) return;
        e.stopPropagation();
        // dual-axis scrub: right or up brightens, left or down dims —
        // whichever way the hand naturally rolls the wheel
        const delta = e.clientX - d.startX + (d.startY - e.clientY);
        onChange(THREE.MathUtils.clamp(d.startValue + delta * KNOB_DRAG_PER_PX, 0, KNOB_MAX));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        (e.target as Element).releasePointerCapture?.(e.pointerId);
        drag.current = null;
        setEngaged({ drag: false });
        onDragChange?.(false);
      }}
      onWheel={(e) => {
        if (locked) return;
        e.stopPropagation();
        onChange(THREE.MathUtils.clamp(value - e.deltaY * 0.0008, 0, KNOB_MAX));
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        // dblclick the knob = factory reset for the whole Screen card
        // (don't bubble into the Mac-focus dblclick)
        e.stopPropagation();
        if (!locked) onReset?.();
      }}
    >
      <boxGeometry args={[knob.size.x * 1.5, knob.size.y * 1.5, knob.size.z * 3.5]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/**
 * The Mac's CRT: the model's own curved screen surface carrying the live
 * city render as its base colour — studio lighting/roughness act on the
 * content. UVs are planar-projected across the glass; the curvature buys
 * authentic CRT edge distortion for free.
 *
 * Render chain: city (FBO, 512×342, MSAA) → colour-depth process pass
 * (FBO, 512×342, mipmapped) → glass material map. Double-click the screen
 * to glide the city camera back to its default orbit.
 */
function DazScreenViewport({
  mode,
  interactive,
  colorMode,
  bwLevels,
  brightness,
  glow,
  halation,
  scanline,
  onHoverChange,
  onDragChange,
}: {
  mode: IntroViewMode;
  interactive: boolean;
  colorMode: ScreenColorMode;
  bwLevels: BwLevels;
  brightness: number;
  glow: number;
  halation: number;
  scanline: number;
  onHoverChange?: (hovering: boolean) => void;
  onDragChange?: (dragging: boolean) => void;
}) {
  const { scene } = useGLTF(DAZ_URL);
  const dpr = useThree((s) => s.viewport.dpr);
  const processRef = useRef<THREE.ShaderMaterial>(null);
  const halationRef = useRef<THREE.ShaderMaterial>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const parts = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.name === SCREEN_MESH) src = mesh;
    });
    if (!src) return null;
    scene.updateMatrixWorld(true);

    // Bake the node transform so the clone lives directly in GLB space (cm),
    // then planar-project raster UVs across the glass rect (x right, y up)
    // into a SECOND attribute — the original `uv` keeps feeding the model's
    // own glass texture. The active raster is a 512:342 inset of the glass.
    const geometry = src.geometry.clone();
    geometry.applyMatrix4(src.matrixWorld);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const span = new THREE.Vector3().subVectors(bb.max, bb.min);
    const pos = geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) - bb.min.x) / span.x;
      uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / span.y;
    }
    geometry.setAttribute("crtUvAttr", new THREE.BufferAttribute(uv, 2));

    let activeW = ACTIVE_W_FRACTION;
    let activeH = (activeW * span.x) / RASTER_ASPECT / span.y;
    if (activeH > MAX_H_FRACTION) {
      activeH = MAX_H_FRACTION;
      activeW = (activeH * span.y * RASTER_ASPECT) / span.x;
    }

    const srcMat = src.material as THREE.MeshStandardMaterial;
    const material = new THREE.MeshStandardMaterial({
      map: srcMat.map,
      // The Daz glass texture is painted near-black; lift its albedo so the
      // studio key reads on the tube face (real CRT glass in a lit room is
      // grey, not void), and keep it glossy for the specular sheen.
      color: new THREE.Color(1.6, 1.6, 1.6),
      roughness: 0.22,
      metalness: srcMat.metalness ?? 0,
    });
    // custom-uniform pattern: uniform objects live in userData so they can
    // be mutated before/after compile alike — crtTex additionally so the
    // RenderTexture can attach into it (onBeforeCompile reuses the SAME
    // objects, so writes keep landing after the shader exists)
    material.userData.crtTex = { value: null };
    material.userData.uGlow = { value: glow };
    material.userData.uScanline = { value: scanline };
    material.customProgramCacheKey = () => "intro-crt-raster";
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uCrt = material.userData.crtTex;
      shader.uniforms.uActive = { value: new THREE.Vector2(activeW, activeH) };
      shader.uniforms.uGlow = material.userData.uGlow;
      shader.uniforms.uScanline = material.userData.uScanline;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${CRT_VERT_HEADER}`)
        .replace("#include <uv_vertex>", CRT_UV_VERTEX);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${CRT_HEADER}`)
        .replace("#include <map_fragment>", CRT_MAP_FRAGMENT)
        .replace("#include <emissivemap_fragment>", CRT_EMISSIVE_FRAGMENT);
    };
    return { geometry, material };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- glow/scanline seed initial uniform values only; updates flow through the userData uniforms below
  }, [scene]);

  useEffect(() => {
    if (!parts) return;
    parts.material.userData.uGlow.value = glow;
    parts.material.userData.uScanline.value = scanline;
  }, [parts, glow, scanline]);

  const processUniforms = useMemo(
    () => ({
      uTex: { value: null },
      uColorMode: { value: SCREEN_COLOR_MODE_INDEX[colorMode] },
      uBwLo: { value: bwLevels.lo },
      uBwHi: { value: bwLevels.hi },
      uBrightness: { value: brightness },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- template for material construction only
    [],
  );
  const halationUniforms = useMemo(
    () => ({
      uTex: { value: null },
      uTexel: { value: new THREE.Vector2(1 / RASTER_W, 1 / RASTER_H) },
      uHalation: { value: halation },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- template for material construction only
    [],
  );
  // R3F clones the uniforms prop — mutate the material's own copy via ref.
  useEffect(() => {
    const u = processRef.current?.uniforms;
    if (!u) return;
    u.uColorMode.value = SCREEN_COLOR_MODE_INDEX[colorMode];
    u.uBwLo.value = bwLevels.lo;
    u.uBwHi.value = bwLevels.hi;
    u.uBrightness.value = brightness;
  }, [colorMode, bwLevels, brightness]);
  useEffect(() => {
    const u = halationRef.current?.uniforms;
    if (u) u.uHalation.value = halation;
  }, [halation]);

  if (!parts) return null;
  return (
    <mesh
      geometry={parts.geometry}
      onPointerOver={() => {
        onHoverChange?.(true);
        setCursorZone("screen", true);
      }}
      onPointerOut={() => {
        onHoverChange?.(false);
        setCursorZone("screen", false);
      }}
      onDoubleClick={(e) => {
        // screen dblclick = city-orbit reset only; don't bubble into the
        // Mac-focus dblclick on the body group
        e.stopPropagation();
        setResetSignal((c) => c + 1);
      }}
    >
      <primitive object={parts.material} attach="material">
        {/* halation pass (final texture): mipmapped so minification averages
            the PROCESSED raster (no moiré). drei multiplies by dpr — divide out. */}
        <RenderTexture
          attach="userData-crtTex-value"
          width={RASTER_W / dpr}
          height={RASTER_H / dpr}
          samples={0}
          depthBuffer={false}
          generateMipmaps
          minFilter={THREE.LinearMipmapLinearFilter}
          magFilter={THREE.NearestFilter}
        >
          <mesh frustumCulled={false}>
            <planeGeometry args={[2, 2]} />
            <shaderMaterial
              ref={halationRef}
              uniforms={halationUniforms}
              vertexShader={PROCESS_VERT}
              fragmentShader={HALATION_FRAG}
            >
              {/* colour-depth process pass, native res */}
              <RenderTexture
                attach="uniforms-uTex-value"
                width={RASTER_W / dpr}
                height={RASTER_H / dpr}
                samples={0}
                depthBuffer={false}
              >
                <mesh frustumCulled={false}>
                  <planeGeometry args={[2, 2]} />
                  <shaderMaterial
                    ref={processRef}
                    uniforms={processUniforms}
                    vertexShader={PROCESS_VERT}
                    fragmentShader={PROCESS_FRAG}
                  >
                    {/* city pass: native res + MSAA for clean edges pre-process */}
                    <RenderTexture
                      attach="uniforms-uTex-value"
                      width={RASTER_W / dpr}
                      height={RASTER_H / dpr}
                      samples={4}
                    >
                      <ScreenCity
                        mode={mode}
                        interactive={interactive}
                        resetSignal={resetSignal}
                        onDragChange={onDragChange}
                      />
                    </RenderTexture>
                  </shaderMaterial>
                </mesh>
              </RenderTexture>
            </shaderMaterial>
          </mesh>
        </RenderTexture>
      </primitive>
    </mesh>
  );
}

const DEFAULT_BW_LEVELS: BwLevels = { lo: 0.16, hi: 0.38 };

export function MacDaz({
  mode = "screen",
  colorMode = "full",
  bwLevels = DEFAULT_BW_LEVELS,
  brightness = 1,
  glow = 0.8,
  halation = 0.1,
  scanline = 0.6,
  showPeripherals = false,
  screenInteractive = false,
  knobLocked = false,
  onScreenHoverChange,
  onScreenDragChange,
  onBrightnessChange,
  onKnobEngageChange,
  onKnobDragChange,
  onKnobReset,
  ...props
}: {
  mode?: IntroViewMode;
  colorMode?: ScreenColorMode;
  bwLevels?: BwLevels;
  brightness?: number;
  glow?: number;
  halation?: number;
  scanline?: number;
  showPeripherals?: boolean;
  screenInteractive?: boolean;
  knobLocked?: boolean;
  onScreenHoverChange?: (hovering: boolean) => void;
  onScreenDragChange?: (dragging: boolean) => void;
  onBrightnessChange?: (v: number) => void;
  onKnobEngageChange?: (engaged: boolean) => void;
  onKnobDragChange?: (dragging: boolean) => void;
  onKnobReset?: () => void;
} & GroupProps) {
  return (
    <NormalizedModel
      url={DAZ_URL}
      unitScale={0.01}
      show={showPeripherals ? undefined : COMPUTER_ONLY}
      hide={SCREEN_MESH}
      {...props}
    >
      <DazScreenViewport
        mode={mode}
        colorMode={colorMode}
        bwLevels={bwLevels}
        brightness={brightness}
        glow={glow}
        halation={halation}
        scanline={scanline}
        interactive={screenInteractive}
        onHoverChange={onScreenHoverChange}
        onDragChange={onScreenDragChange}
      />
      <AppleBadge />
      {onBrightnessChange && (
        <BrightnessKnob
          value={brightness}
          locked={knobLocked}
          onChange={onBrightnessChange}
          onEngageChange={onKnobEngageChange}
          onDragChange={onKnobDragChange}
          onReset={onKnobReset}
        />
      )}
    </NormalizedModel>
  );
}

/**
 * The Daz model exactly as authored — original baked screen texture, no
 * viewport, peripherals included. Stage reference next to the working Mac.
 */
export function MacDazStock(props: GroupProps) {
  return (
    <NormalizedModel url={DAZ_URL} unitScale={0.01} cloneScene {...props}>
      <AppleBadge />
    </NormalizedModel>
  );
}

useGLTF.preload(DAZ_URL);
