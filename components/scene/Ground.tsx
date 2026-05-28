"use client";

// 1 500 m radius disc (~2× the city extent). Round footprint avoids the
// visible square corners a plane shows when the orbit camera swings around;
// 48 segments are enough to read as a circle at orbit distance without
// chasing perfection. Far ground still fades into the fog colour (== sky bg)
// so the edge stays invisible against the sky.
export function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <circleGeometry args={[1575, 48]} />
      <meshBasicMaterial color="#04060c" toneMapped={false} />
    </mesh>
  );
}
