import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";

// Run `handler` on a double-click anywhere on the WebGL canvas. Shared by the camera models so each
// can offer "double-click to reset this mode" (mirroring Map's dbl-click → home) without re-rolling
// the listener. The handler is read through a ref, so a model can pass an inline closure that captures
// fresh values without re-subscribing every render.
export function useDoubleClickReset(handler: () => void) {
  const gl = useThree((s) => s.gl);
  const ref = useRef(handler);
  // Keep the latest handler in the ref (updated in an effect, never during render), so the listener
  // below subscribes once per canvas yet always calls the current closure.
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const dom = gl.domElement;
    const onDbl = () => ref.current();
    dom.addEventListener("dblclick", onDbl);
    return () => dom.removeEventListener("dblclick", onDbl);
  }, [gl]);
}

// True if any field of `cur` differs from `def` — the "only reset if it's actually been changed" gate
// for config-backed models (Drift / Turntable). Pose-backed models snap instead, which is a no-op when
// already home, so they don't need this.
export function changedFromDefault<T extends object>(cur: T, def: T): boolean {
  return (Object.keys(def) as (keyof T)[]).some((k) => cur[k] !== def[k]);
}
