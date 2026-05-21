"use client";

export function PlaceholderBuilding() {
  return (
    <mesh position={[0, 2, 0]}>
      <boxGeometry args={[3, 8, 3]} />
      <meshStandardMaterial color="#1a1a22" roughness={0.9} />
    </mesh>
  );
}
