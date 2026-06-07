"use client";

import { RoundedBox } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";

type GroupProps = ThreeElements["group"];

/**
 * Placeholder Macintosh Plus at real-world scale (244 × 345 × 277 mm).
 * Stand-in until a sourced/authored model lands. The screen is deliberately
 * a separate flat quad — the starry-night viewport (RenderTexture /
 * MeshPortalMaterial) will target that quad later, so whatever model
 * replaces this must keep the screen as its own mesh.
 */

const BODY_W = 0.244;
const BODY_D = 0.277;
const BODY_H = 0.325; // shell above the base undercut
const BASE_H = 0.02;
const FRONT_Z = BODY_D / 2;

// 9" CRT, 512×342 ⇒ 3:2 visible area
export const SCREEN_W = 0.183;
export const SCREEN_H = (SCREEN_W * 342) / 512;
export const SCREEN_CENTER_Y = BASE_H + BODY_H - 0.04 - SCREEN_H / 2;
export const SCREEN_Z = FRONT_Z + 0.0012;

const BEIGE = "#ddd3bc";
const BEIGE_RECESS = "#c9bfa6";
const SLOT = "#4a443a";
const CRT_OFF = "#16181a";

export function MacPlus(props: GroupProps) {
  return (
    <group {...props}>
      {/* main shell */}
      <RoundedBox
        castShadow
        args={[BODY_W, BODY_H, BODY_D]}
        radius={0.007}
        smoothness={4}
        position={[0, BASE_H + BODY_H / 2, 0]}
      >
        <meshStandardMaterial color={BEIGE} roughness={0.55} metalness={0} />
      </RoundedBox>

      {/* base undercut */}
      <mesh castShadow position={[0, BASE_H / 2, -0.005]}>
        <boxGeometry args={[BODY_W - 0.03, BASE_H, BODY_D - 0.025]} />
        <meshStandardMaterial color={BEIGE_RECESS} roughness={0.65} />
      </mesh>

      {/* moulded bezel recess around the CRT */}
      <mesh position={[0, SCREEN_CENTER_Y, FRONT_Z + 0.0005]}>
        <planeGeometry args={[SCREEN_W + 0.024, SCREEN_H + 0.024]} />
        <meshStandardMaterial color={BEIGE_RECESS} roughness={0.7} />
      </mesh>

      {/* CRT glass — the future starry-night viewport */}
      <mesh name="mac-screen" position={[0, SCREEN_CENTER_Y, SCREEN_Z]}>
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <meshStandardMaterial color={CRT_OFF} roughness={0.25} metalness={0} />
      </mesh>

      {/* floppy slot */}
      <mesh position={[0.062, 0.105, FRONT_Z + 0.0008]}>
        <planeGeometry args={[0.078, 0.006]} />
        <meshStandardMaterial color={SLOT} roughness={0.6} />
      </mesh>
    </group>
  );
}
