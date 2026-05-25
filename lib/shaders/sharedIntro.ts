// Shared uniform-like objects driven by IntroTicker and consumed by the city +
// streetlights shaders. Same pattern as sharedTime: one writer, many materials
// pointing their uniform slot at the same object reference.
//
// `progress` is the wake-up sequence position in 0..1.
// `mode` selects the per-window ordering function (0..3 — see city shader).
export const sharedIntroProgress: { value: number } = { value: 0 };
export const sharedIntroMode: { value: number } = { value: 0 };
