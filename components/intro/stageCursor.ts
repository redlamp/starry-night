// Shared cursor resolver for the intro stage. R3F rays hit every object
// along the line, so zones overlap — resolve by priority instead of racing
// individual handlers: draggables (knob) beat clickables (screen, badge)
// beat orbitables (mac, stage) beat default.
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

// One input event at a time: while a drag is in progress its owner locks the
// cursor (zones keep tracking underneath, so the right cursor resolves the
// moment the drag releases).
export type StageDragOwner = "studio" | "screen" | "knob";
let dragLock: StageDragOwner | null = null;

function resolve() {
  if (typeof document === "undefined") return;
  document.body.style.cursor = dragLock
    ? dragLock === "knob"
      ? KNOB_CURSOR
      : "grabbing"
    : flags.knob
      ? KNOB_CURSOR
      : flags.screen || flags.badge
        ? "pointer"
        : flags.mac || flags.stage
          ? "grab"
          : "auto";
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
