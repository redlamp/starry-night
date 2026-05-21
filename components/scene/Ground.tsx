"use client";

export function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[4000, 4000]} />
      <meshBasicMaterial color="#04060c" toneMapped={false} fog={false} />
    </mesh>
  );
}
