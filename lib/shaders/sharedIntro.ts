// Shared uniform-like objects driven by IntroTicker and consumed by the city +
// streetlights shaders. Same pattern as sharedTime: one writer, many materials
// pointing their uniform slot at the same object reference.
//
// `progress` is the wake-up sequence position in 0..1.
// `mode` selects the per-window ordering function (0..4 — see city shader).
// `completeAt` is the value of sharedTime when progress first hit 1 — the
// shader uses (uTime - uIntroCompleteAt) to fade in the post-intro window
// breathing. Sentinel 1e9 = "intro never completed", keeps breathing off.
export const sharedIntroProgress: { value: number } = { value: 0 };
export const sharedIntroMode: { value: number } = { value: 0 };
export const sharedIntroCompleteAt: { value: number } = { value: 1e9 };
// Base period of the post-intro breathing cycle in seconds. Per-window period
// derived in the shader as: base + lifeSeed * base * 2, so smaller = faster
// city-wide on/off rhythm.
export const sharedBreathingPeriod: { value: number } = { value: 90 };
