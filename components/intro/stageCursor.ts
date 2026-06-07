// Shared cursor resolver for the intro stage. R3F rays hit every object
// along the line, so zones overlap — resolve by priority instead of racing
// individual handlers: clickables (screen, badge) beat orbitables (mac,
// stage) beat default.
const flags = { screen: false, badge: false, mac: false, stage: false };

export function setCursorZone(zone: keyof typeof flags, on: boolean) {
  flags[zone] = on;
  if (typeof document === "undefined") return;
  document.body.style.cursor =
    flags.screen || flags.badge ? "pointer" : flags.mac || flags.stage ? "grab" : "auto";
}
