"use client";

export function Moon() {
  return (
    <mesh position={[-180, 320, -500]}>
      <sphereGeometry args={[22, 32, 32]} />
      <meshBasicMaterial color="#f7f1d8" toneMapped={false} fog={false} />
    </mesh>
  );
}
