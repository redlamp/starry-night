/**
 * Single shared THREE uniform-like object holding elapsed seconds since page load.
 * Every building's ShaderMaterial points its `uTime` slot at this object so a
 * single TimeTicker can update one value and have all materials pick it up
 * (no per-material per-frame work).
 */
export const sharedTime: { value: number } = { value: 0 };
