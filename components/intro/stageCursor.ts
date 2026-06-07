// Shared cursor resolver for the intro stage. R3F rays hit every object
// along the line, so zones overlap — resolve by priority instead of racing
// individual handlers: draggable (knob) beats clickables (badge=dice reroll,
// screen=pointer) beats orbitables (mac, stage) beats default.
const flags = { knob: false, screen: false, badge: false, mac: false, stage: false };

// The brightness wheel wants a scrub affordance no stock cursor offers:
// left-right arrows over a shallow arc (the wheel's roll). Custom SVG
// cursor — white glyph, black halo so it reads on the beige case — with
// ew-resize as the no-custom-cursor fallback.
const KNOB_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <g fill="none" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 11 H18"/>
    <path d="M8.5 7.5 L5 11 L8.5 14.5"/>
    <path d="M15.5 7.5 L19 11 L15.5 14.5"/>
    <path d="M7 17 Q12 20 17 17"/>
  </g>
  <g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 11 H18"/>
    <path d="M8.5 7.5 L5 11 L8.5 14.5"/>
    <path d="M15.5 7.5 L19 11 L15.5 14.5"/>
    <path d="M7 17 Q12 20 17 17"/>
  </g>
</svg>`;
const KNOB_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(KNOB_CURSOR_SVG)}") 12 12, ew-resize`;

// The Apple badge rerolls the city seed — a dice affordance. Rounded square
// with five pips; white fill + black outline so it reads on the beige case.
// Falls back to pointer (it's still a click target).
const DICE_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <rect x="4" y="4" width="16" height="16" rx="3.5" fill="#fff" stroke="#000" stroke-width="2"/>
  <g fill="#000">
    <circle cx="8.5" cy="8.5" r="1.6"/>
    <circle cx="15.5" cy="8.5" r="1.6"/>
    <circle cx="12" cy="12" r="1.6"/>
    <circle cx="8.5" cy="15.5" r="1.6"/>
    <circle cx="15.5" cy="15.5" r="1.6"/>
  </g>
</svg>`;
const DICE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(DICE_CURSOR_SVG)}") 12 12, pointer`;

// One input event at a time: while a drag is in progress its owner locks the
// cursor (zones keep tracking underneath, so the right cursor resolves the
// moment the drag releases).
export type StageDragOwner = "studio" | "screen" | "knob";
let dragLock: StageDragOwner | null = null;

// Grace period: a press isn't a drag until the pointer travels past this. Until
// then the cursor stays the zone's resting cursor (grab/pointer) — the press
// might still be a click. `grabbing` only appears once the drag is committed.
const DRAG_SLOP = 6; // px
let pressAt: { x: number; y: number } | null = null;
let dragMoved = false;

function zoneCursor() {
  return flags.knob
    ? KNOB_CURSOR
    : flags.badge
      ? DICE_CURSOR
      : flags.screen
        ? "pointer"
        : flags.mac || flags.stage
          ? "grab"
          : "auto";
}

function resolve() {
  if (typeof document === "undefined") return;
  document.body.style.cursor =
    dragLock === "knob"
      ? KNOB_CURSOR // scrub from the first press — no grace needed
      : dragLock && dragMoved
        ? "grabbing" // committed studio/screen drag
        : zoneCursor(); // grace period (pressed, not yet moved) or no drag
}

// Global press/move tracking for the grace threshold. Native listeners (R3F's
// stopPropagation doesn't stop the DOM event), harmless when no drag is armed.
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => {
    pressAt = { x: e.clientX, y: e.clientY };
    dragMoved = false;
  });
  window.addEventListener("pointermove", (e) => {
    if (!pressAt || dragMoved) return;
    if (Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > DRAG_SLOP) {
      dragMoved = true;
      resolve(); // cross the threshold → grab flips to grabbing
    }
  });
  const end = () => {
    pressAt = null;
    dragMoved = false;
    resolve();
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

export function setCursorZone(zone: keyof typeof flags, on: boolean) {
  flags[zone] = on;
  resolve();
}

export function setDragCursorLock(lock: StageDragOwner | null) {
  dragLock = lock;
  resolve();
}

/**
 * Synchronous "the pointer is over an input-owning zone" check. The flags
 * are set in the same R3F handler tick as the hover state, but the React
 * state → enabled-prop path takes a commit — under load a pointerdown can
 * land in that window and the studio controls grab a drag that belongs to
 * the screen/knob. Their onStart vetoes against this instead.
 */
export function stagePointerHot() {
  return flags.screen || flags.knob;
}
