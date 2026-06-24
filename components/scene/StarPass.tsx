"use client";

import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
// Fallback fov only — used if the main camera is somehow not a PerspectiveCamera.
// Normally the star camera MATCHES the main camera's live fov (see the sync below),
// so this constant is just a safety default.
export const STAR_FOV = 60;

// Renders its children (the star field + moon) in a dedicated perspective pass
// drawn *before* the main scene. The main camera is often orthographic (city
// framing, orthoSize ~240), which collapses the distant star shell (radius ~6400)
// far off-screen. Stars need a true perspective projection to spread across the
// sky regardless of how the city is framed.
//
// Each frame we sync a private PerspectiveCamera pinned at the world origin (city
// centre), copying the main camera's ORIENTATION and FOV (never its position), and
// kept perspective even when the city goes ortho. Centre-anchored = the sky is
// locked to the city centre with zero parallax (the eye can't leave the dome);
// fov-matched = the sky pitches at the city's rate, so it tracks elevation 1:1
// instead of slipping behind the horizon.
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
  const starCamera = useMemo(() => new THREE.PerspectiveCamera(50, 1, 0.5, 12000), []);

  // The sky colour lives on the star pass (drawn first). The main scene must
  // have no background, or three would force-clear over the stars even with
  // autoClear disabled.
  useEffect(() => {
    starScene.background = new THREE.Color(backgroundColor);
  }, [starScene, backgroundColor]);

  useFrame(() => {
    // The star camera has the SAME TRANSFORM as the city camera (position +
    // orientation + fov), so the sky is rendered from the city camera's exact
    // viewpoint and tracks it 1:1 — the only difference is it stays PERSPECTIVE
    // when the city goes ortho (ortho collapses the distant shell).
    //
    // To make the sky behave as if it's INFINITELY far (so it can't parallax or be
    // escaped), the star SCENE rides along with the camera: with the eye always at
    // the dome's centre, the stars keep their fixed sky directions and only ROTATE
    // with the view — they never slide around, and the camera can never travel past
    // the dome. (Parallax only appears when a FINITE dome is pinned at a fixed point
    // while the eye moves — the shell sits only ~1.3× the orbit radius away, so it
    // swims; an eye-centred/infinite sky removes that.) (#65, 2026-06-24)
    const pcam = mainCamera as THREE.PerspectiveCamera;
    starCamera.position.copy(mainCamera.position);
    starCamera.quaternion.copy(mainCamera.quaternion);
    starCamera.fov = pcam.isPerspectiveCamera && pcam.fov > 0 ? pcam.fov : STAR_FOV;
    starCamera.near = mainCamera.near;
    starCamera.far = mainCamera.far;
    starCamera.aspect = size.width / Math.max(1, size.height);
    starCamera.updateProjectionMatrix();
    starScene.position.copy(mainCamera.position); // sky rides the eye → infinite, no parallax

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
