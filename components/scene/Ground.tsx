"use client";

// 24 000 m square covers the camera's far plane (12 000) twice over, so even
// in orthographic mode where bottom-screen rays start at very low world Y the
// plane still fills the visible frame.
// Fog is enabled so distant ground fades into the sky background and there is
// no hard horizon-line where the plane edge becomes visible.
export function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[24000, 24000]} />
      <meshBasicMaterial color="#04060c" toneMapped={false} />
    </mesh>
  );
}
