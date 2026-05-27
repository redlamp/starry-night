"use client";

import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

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
  backgroundColor,
}: {
  children: React.ReactNode;
  backgroundColor: string;
}) {
  const gl = useThree((s) => s.gl);
  const mainScene = useThree((s) => s.scene);
  const mainCamera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const starScene = useMemo(() => new THREE.Scene(), []);
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
    const persp = mainCamera as THREE.PerspectiveCamera;
    starCamera.position.copy(mainCamera.position);
    starCamera.quaternion.copy(mainCamera.quaternion);
    starCamera.fov = persp.fov || 50;
    starCamera.aspect = size.width / Math.max(1, size.height);
    starCamera.updateProjectionMatrix();

    gl.autoClear = true;
    gl.render(starScene, starCamera);
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(mainScene, mainCamera);
    gl.autoClear = true;
  }, 1);

  return <>{createPortal(children, starScene)}</>;
}
