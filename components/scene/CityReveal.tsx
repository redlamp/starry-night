"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import type { Group } from "three";

// Pre-warm the city's shaders off the visible frame to kill the city-first-frame
// hitch (the long-task spike at city-first-frame in the ?perf HUD). The city
// layers mount inside an INVISIBLE group, so their meshes/instance buffers build
// during the stars phase; gl.compileAsync then compiles the REAL materials
// (guaranteed program-cache-key match — they're the actual objects) with the live
// scene as targetScene (so fog/lights/tone-mapping match), and we only flip the
// group visible once compilation resolves. The brief invisible gap is masked by
// the wake-in cascade (IntroTicker).
//
// Fails safe: no compileAsync support, an error, or a stalled compile past the
// timeout just reveals immediately (= today's behavior). The only added cost is
// the compileAsync call. All setState happens in async callbacks (never
// synchronously in the effect body), per the React 19 set-state-in-effect rule.
export function CityReveal({ children }: { children: ReactNode }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const ref = useRef<Group>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let alive = true;
    const reveal = () => {
      if (alive) setShown(true);
    };
    const g = ref.current;
    const canCompile = !!g && typeof gl.compileAsync === "function";
    // Hard fallback so the city can never stay stuck hidden; immediate (next
    // tick) when there's nothing to pre-warm, so reveal stays async either way.
    const timer = window.setTimeout(reveal, canCompile ? 2000 : 0);
    if (canCompile) gl.compileAsync(g as Group, camera, scene).then(reveal, reveal);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [gl, scene, camera]);

  return (
    <group ref={ref} visible={shown}>
      {children}
    </group>
  );
}
