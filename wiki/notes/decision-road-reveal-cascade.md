---
tags:
  - domain/city-gen
  - domain/performance
  - status/adopted
---

# Decision: Road Reveal — Centre-Out Cascade

**Date**: 2026-06-05

**Context**: Road network snaps in when generation completes. The #59 GenTrace
blueprint pops segments in batches and hard-cuts to the final ribbons. Metro
gen is ~7 s — the wait reads as broken, the cut as cheap.

**Options** (compared as animated canvas mockups, visual-companion session):
(a) stream-as-traced — draw lines in worker acceptance order, crossfade at the
end; honest but patchy, cold-cache only. (b) centre-out cascade — deterministic
post-gen reveal: highways grow from centre, arterials sprout from highway
junctions, streets from arterial junctions. (c) blueprint→construction — both.

**Chosen**: (b), with (c)'s wait treatment folded in: the GenTrace blueprint
softens (draw-on, dim) during the worker run and fades beneath the cascade —
no blink. Cascade replays on every new city, warm or cold. Roads lead,
buildings follow (intro gated to cascade progress ≈ 35%). Duration slider in
the Roads panel, `0` = off.

**Why**: the cascade is a pure function of road geometry (junction-attach +
radial fallback for orphans), so it satisfies the determinism contract, plays
identically on warm cache, and can join the intro choreography — the
stream-order variant can't do any of those.

Spec: `docs/specs/2026-06-05-road-reveal-cascade.md`. Gen speed itself is a
separate issue (`perf(gen): roads phase`).
