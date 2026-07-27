// Multi-touch gate: two fingers on the glass is a CAMERA gesture, never a pick.
//
// The scene's selection paths listen to raw pointer/click events (RoadHover on
// window pointerup, InstancedCity + the unit picker on R3F clicks), and touch
// delivers a pointerdown/pointerup pair PER FINGER — so a 2-finger tap, or a
// pinch that ends nearly stationary, would select whatever sits under a
// fingertip and yank the column stack. That collided head-on with the 2-finger
// double-tap zoom (user 2026-07-27): the zoom glide and the new card's framing
// fought over the camera.
//
// The camera model owns the finger count and reports it here; selection paths
// ask before acting. The tail keeps the gate closed briefly after the last
// finger lifts, because the trailing pointerup (and any click the browser
// synthesizes from it) arrives after the count already dropped.
//
// Display/input arbitration only — performance.now() here is not scene state,
// same basis as cameraActivity.

const TAIL_MS = 350;

let multi = false;
let releasedAt = 0;

export function setMultiTouch(on: boolean): void {
  if (on) {
    multi = true;
    releasedAt = 0;
  } else if (multi) {
    multi = false;
    releasedAt = typeof performance !== "undefined" ? performance.now() : 0;
  }
}

export function multiTouchActive(): boolean {
  if (multi) return true;
  if (releasedAt === 0) return false;
  return (typeof performance !== "undefined" ? performance.now() : 0) - releasedAt < TAIL_MS;
}
