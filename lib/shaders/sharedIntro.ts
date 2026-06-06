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
// After-Dark wake-up model. Each window picks a random t0 in [0, duration],
// turns on at t0, then alternates: ON for offCycle (±30% per-window jitter),
// OFF for retrigger (±30%), repeating. sharedIntroStartTime is sharedTime at
// the moment the intro fires — windows compute their absolute wake from
// (startTime + baseline * duration). All in seconds.
export const sharedIntroStartTime: { value: number } = { value: 0 };
export const sharedIntroDuration: { value: number } = { value: 60 };
export const sharedOffCycle: { value: number } = { value: 60 };
export const sharedRetrigger: { value: number } = { value: 30 };
// Per-window jitter amplitude on the on/off cycle: 0 = lockstep, 0.5 = ±50%.
export const sharedCycleJitter: { value: number } = { value: 0.3 };

// Star-intro shared uniforms — independent from the window intro so stars can
// wake on their own timeline + ordering. Mode index: 0=random per-star,
// 1=bright-first, 2=horizon-first (stars near horizon wake first),
// 3=zenith-first (stars near zenith wake first).
export const sharedStarIntroProgress: { value: number } = { value: 0 };
export const sharedStarIntroMode: { value: number } = { value: 0 };

// Streetlights wake on their own (shorter) timeline — derived in IntroTicker from
// the window-intro progress scaled by streetlightDurationSec, so they pop in
// quickly instead of waiting out the multi-minute window wake.
export const sharedStreetlightIntroProgress: { value: number } = { value: 0 };

// Road reveal cascade (spec 2026-06-05): 0 → drawing, 1 → settled. Driven by
// RoadRevealTicker; consumed by the three Roads tier materials + GenTrace's
// fade. Starts at 1 so anything rendered before the ticker mounts is visible.
export const sharedRoadRevealProgress: { value: number } = { value: 1 };
