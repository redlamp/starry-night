"use client";

import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
// Fixed wide fov for the star camera regardless of projection. The main
// camera's perspective fov (~28°) is narrow on purpose for city framing —
// using it for the star pass leaves only a tiny slice of the dome visible.
// Locking the star pass to a wider fov keeps the star density similar in
// perspective and orthographic modes; the city is unaffected because it
// renders in the main scene with its own camera/projection.
const STAR_FOV = 60;

// Renders its children (the star field) in a dedicated perspective pass drawn
// *before* the main scene. The main camera is often orthographic (city framing,
// orthoSize ~240), which collapses the distant star shell (radius ~4500) far
// off-screen. Stars need a true perspective projection to spread across the sky
// regardless of how the city is framed.
//
// Each frame we sync a private PerspectiveCamera to the main camera's transform
// + fov (so the sky tracks the orbit), render the stars over the sky-colour
// background, clear depth, then composite the main scene on top. In pure
// perspective mode the star camera matches the main camera exactly, so the
// result is identical to rendering stars inline.
//
// Adding any positive-priority useFrame disables R3F's automatic render, so the
// main scene render is taken over here too.
export function StarPass({
  children,
  haze,
  backgroundColor,
}: {
  children: React.ReactNode;
  haze?: React.ReactNode;
  backgroundColor: string;
}) {
  const gl = useThree((s) => s.gl);
  const mainScene = useThree((s) => s.scene);
  const mainCamera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const starScene = useMemo(() => new THREE.Scene(), []);
  const hazeScene = useMemo(() => new THREE.Scene(), []);
  const starCamera = useMemo(
    () => new THREE.PerspectiveCamera(50, 1, 0.5, 12000),
    [],
  );

  // The sky colour lives on the star pass (drawn first). The main scene must
  // have no background, or three would force-clear over the stars even with
  // autoClear disabled.
  useEffect(() => {
    starScene.background = new THREE.Color(backgroundColor);
  }, [starScene, backgroundColor]);

  useFrame(() => {
    // Skybox-style: anchor star camera at the dome centre (world origin) and
    // only copy main camera orientation. The sky then rotates with camera
    // rotation, not camera position, so stars sweep at the same rate as the
    // city's look direction during orbit — no parallax mismatch.
    starCamera.position.set(0, 0, 0);
    starCamera.quaternion.copy(mainCamera.quaternion);
    starCamera.fov = STAR_FOV;
    starCamera.aspect = size.width / Math.max(1, size.height);
    starCamera.updateProjectionMatrix();

    // Pass 1: sky background + stars.
    gl.autoClear = true;
    gl.render(starScene, starCamera);

    // Pass 2: ground haze in world space, drawn over the sky. Cleared depth
    // before so it tests against an empty buffer (always passes), then we
    // clear again so the main scene's opaque ground/city can write over the
    // haze where they cover.
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(hazeScene, mainCamera);

    // Pass 3: main world (ground, city, moon, etc.).
    gl.clearDepth();
    gl.render(mainScene, mainCamera);
    gl.autoClear = true;
  }, 1);

  return (
    <>
      {createPortal(children, starScene)}
      {haze && createPortal(haze, hazeScene)}
    </>
  );
}
