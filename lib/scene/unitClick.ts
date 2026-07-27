// Which DOM click a unit box claimed. The FOCUSED building's walls are
// transparent to clicks so the ray can reach unit boxes on any side
// (first-unit-hit wins), which means the building's own handler can't tell
// "clicked a unit" from "clicked the building". It queues a microtask instead
// and asks here after the dispatch finishes: a unit that fired in the same
// event claimed it, otherwise the click was on the building itself and
// selection falls back to the building (user 2026-07-27).
//
// Keyed by the native MouseEvent identity, so a claim can't leak into the next
// click even when the unit's handler stops propagation and the building's
// never runs.

let claimedEvent: object | null = null;

export function claimUnitClick(nativeEvent: object): void {
  claimedEvent = nativeEvent;
}

export function unitClaimedClick(nativeEvent: object): boolean {
  return claimedEvent === nativeEvent;
}
