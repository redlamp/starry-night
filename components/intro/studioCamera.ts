// Studio (stage) camera defaults, shared by IntroScene (Canvas + controls)
// and ScreenCity's snow-globe rig (rest pose = this pose ⇒ zero parallax).
// Head-on product shot: camera at CRT height (Daz Mac is 0.347 m tall, CRT
// centre ≈ 0.24 m up), aimed slightly down at the Mac's mid-height so the
// whole machine sits centred in frame.

export const SCREEN_HEIGHT_M = 0.24;
export const MAC_CENTER_Y = 0.173;
export const STUDIO_CAM_POS: [number, number, number] = [0, SCREEN_HEIGHT_M, 1.0];
export const STUDIO_TARGET: [number, number, number] = [0, MAC_CENTER_Y, 0];
