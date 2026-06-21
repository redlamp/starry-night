// Camera control methods compared in the Camera Lab (/camera-lab). Each is a
// distinct desktop + mobile control scheme, labelled with its real-world parallel.
//
// kind:
//   "drei"      — pure camera-controls button/touch configuration (the lib does the work)
//   "leverArm"  — the app's custom press-point-relative turntable input layer
//   "fixedRate" — a custom uniform-rate orbit (classic OrbitControls feel)
//   "fly"       — a WASD drag-look first-person rig (CameraControls unmounted)

export type MethodKind = "leverArm" | "drei" | "fixedRate" | "mapControls" | "fly";

// Member names on camera-controls' ACTION enum; resolved to the enum at apply time.
export type ActionName =
  | "NONE"
  | "ROTATE"
  | "TRUCK"
  | "OFFSET"
  | "DOLLY"
  | "ZOOM"
  | "TOUCH_ROTATE"
  | "TOUCH_TRUCK"
  | "TOUCH_DOLLY"
  | "TOUCH_ZOOM"
  | "TOUCH_DOLLY_TRUCK"
  | "TOUCH_DOLLY_ROTATE"
  | "TOUCH_ZOOM_TRUCK"
  | "TOUCH_ZOOM_ROTATE";

export type DreiConfig = {
  mouse: { left: ActionName; middle: ActionName; right: ActionName; wheel: ActionName };
  touch: { one: ActionName; two: ActionName; three: ActionName };
  dollyToCursor: boolean;
  // Blender idiom: hold Shift to turn the middle-mouse orbit into a pan (truck).
  shiftMiddlePan?: boolean;
};

export type CameraMethod = {
  id: string;
  name: string;
  parallel: string; // real-world system this feels like
  blurb: string; // what it does, in one breath
  desktop: string; // desktop gesture map (human readable)
  touch: string; // touch gesture map (human readable)
  kind: MethodKind;
  drei?: DreiConfig; // present iff kind === "drei"
};

export const METHODS: CameraMethod[] = [
  {
    id: "lever-arm",
    name: "App orbit — lever-arm",
    parallel: "Google Earth globe-drag, refined",
    blurb:
      "Your current app scheme, ported faithfully. LMB is a press-point-relative turntable: rotate speed scales with how far you grab from the focus (the lever arm), with decoupled, regulated tilt that eases off at grazing angles and far zoom, plus a tilt-vs-rotate axis gate so a vertical drag stays pure tilt. Grab the pin to scrub Focal Y, RMB or Shift+LMB grabs the ground to pan, and LMB+RMB (or Ctrl/Cmd+LMB) looks around in place.",
    desktop:
      "LMB = rotate + tilt · LMB on pin = Focal Y · RMB / Shift+LMB = pan · Ctrl/Cmd+LMB or LMB+RMB = free-look · wheel = zoom · dbl-click = reset",
    touch:
      "1-finger = rotate + tilt · 2-finger = pan + pinch zoom · 3-finger = free-look · double-tap = reset",
    kind: "leverArm",
  },
  {
    id: "drei-stock",
    name: "Stock drei CameraControls",
    parallel: "camera-controls lib defaults / model viewers",
    blurb:
      "The library out of the box, with native damping. LMB orbits around the target, RMB trucks (screen-plane pan), the wheel dollies toward the target. The baseline every other method is tuned against.",
    desktop: "LMB = orbit · RMB = pan (truck) · MMB / wheel = dolly",
    touch: "1-finger = orbit · 2-finger = pinch zoom + pan",
    kind: "drei",
    drei: {
      mouse: { left: "ROTATE", middle: "DOLLY", right: "TRUCK", wheel: "DOLLY" },
      touch: { one: "TOUCH_ROTATE", two: "TOUCH_DOLLY_TRUCK", three: "NONE" },
      dollyToCursor: false,
    },
  },
  {
    id: "google-maps",
    name: "Google Maps",
    parallel: "Google Maps / Earth (2.5D)",
    blurb:
      "Grab-the-earth: LMB pans across the ground, RMB rotates + tilts, the wheel zooms toward the cursor. Two-finger pinch zooms while twisting rotates — the full Maps mobile model.",
    desktop: "LMB = pan · RMB = rotate + tilt · wheel = zoom to cursor",
    touch: "1-finger = pan · 2-finger = pinch zoom + twist rotate",
    kind: "drei",
    drei: {
      mouse: { left: "TRUCK", middle: "DOLLY", right: "ROTATE", wheel: "DOLLY" },
      touch: { one: "TOUCH_TRUCK", two: "TOUCH_DOLLY_ROTATE", three: "NONE" },
      dollyToCursor: true,
    },
  },
  {
    id: "drei-map",
    name: "Drei MapControls",
    parallel: "three.js OrbitControls (drei MapControls class)",
    blurb:
      "drei's MapControls class, LMB/RMB flipped to orbit-first: LMB orbits, RMB pans, wheel/pinch zooms. Drag the focus pin to scrub focal Y (re-aims from the same spot). A different library from the other orbit methods (three.js OrbitControls, not camera-controls). Touch stays map-style (1-finger pans).",
    desktop: "LMB = orbit · RMB = pan · drag pin = focal Y · wheel = zoom",
    touch: "1-finger = pan · 2-finger = zoom + rotate",
    kind: "mapControls",
  },
  {
    id: "blender",
    name: "Blender / Maya turntable",
    parallel: "Blender · Maya · CAD viewports",
    blurb:
      "The DCC turntable: middle-mouse orbits the pivot, Shift+middle pans, the wheel dollies. Left and right mouse stay free (in real tools they select), so the camera lives entirely on the middle button.",
    desktop: "MMB = orbit · Shift+MMB = pan · wheel = dolly",
    touch: "1-finger = orbit · 2-finger = pinch zoom + pan",
    kind: "drei",
    drei: {
      mouse: { left: "NONE", middle: "ROTATE", right: "NONE", wheel: "DOLLY" },
      touch: { one: "TOUCH_ROTATE", two: "TOUCH_DOLLY_TRUCK", three: "NONE" },
      dollyToCursor: false,
      shiftMiddlePan: true,
    },
  },
  {
    id: "fixed-rate",
    name: "Fixed-rate orbit",
    parallel: "Three.js OrbitControls (classic)",
    blurb:
      "Uniform degrees-per-pixel rotate + tilt — the same speed wherever you grab, no lever-arm and no easing. Snappy, with little damping. Pan on RMB / Shift+LMB, wheel zoom. The honest baseline for 'does the fancy scaling actually help?'",
    desktop: "LMB = rotate + tilt (uniform) · RMB / Shift+LMB = pan · wheel = zoom",
    touch: "1-finger = rotate + tilt · 2-finger = pan + pinch",
    kind: "fixedRate",
  },
  {
    id: "fps-fly",
    name: "FPS fly",
    parallel: "FPS / editor flythrough (UE5, Unity)",
    blurb:
      "WASD to move, hold-drag to look (horizon-locked, no roll), E/Space up and Q/C/Shift down, wheel sets move speed. Releasing the drag frees the cursor (no continuous re-aim). Desktop-focused; touch drags to look.",
    desktop: "WASD = move · E/Space = up · Q/C/Shift = down · hold-drag = look · wheel = speed",
    touch: "1-finger drag = look (no locomotion)",
    kind: "fly",
  },
];

export const DEFAULT_METHOD_ID = "lever-arm";
