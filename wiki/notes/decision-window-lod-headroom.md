---
tags:
  - domain/stack
  - status/adopted
---

# Decision: Window LOD Is Reserved Headroom, Off by Default (2026-07-03)

**Context.** The window distance wash ("LOD") repeatedly traded artifacts:
classic's warm glow and hybrid's per-building mean both erased fenestration
structure at range ("orange columns"), and a synthetic banding patch read as
patchwork. Asking what the LOD actually buys clarified the design: in this
system it is **not** a performance feature — geometry never simplifies and
the shader runs per-pixel regardless. Its only job was temporal stability
where per-cell window state goes sub-Nyquist.

**Options.**

1. Keep the wash on and keep polishing its look.
2. Turn it off and accept point-sampled state at extreme range.
3. Turn it off by default AND rebuild the on-path so it is worth re-enabling.

**Chosen: 3.**

- `DEFAULT_WINDOW_AA.lodEnabled = false` — the current per-cell render is
  cheap enough to run at every distance, and it is the most detailed, most
  truthful image. The existing LOD-group switch re-enables live. (Saved
  configs pin their own value — toggle or reset to adopt the new default.)
- The LOD-on far field is now the **mip-atlas construction** (window-lab
  approach 4 in production): a trilinear-mipped twin of the packed atlas
  sampled at the continuous facade coordinate — the box-filtered average of
  the real cells, not a flat statistic. See
  [[window-lod-moire-diagnosis]] "Far field v2".

**Why.** Forward plan (user, 2026-07-03): the near-field window shader is
expected to grow more complex/nuanced. When it does, the LOD becomes a real
graduation — complex shading up close, cheap filtered pattern at range — and
only then earns its place on by default, potentially with an early-out for
actual per-fragment savings. Until then the wash was solving a problem
(stability) at the cost of the image, on hardware that doesn't need the help.

**Trade accepted.** With the LOD off, extreme-range windows are point-sampled
again and may shimmer subtly in motion (stills are crisp). If that reads as a
regression in live use, the mip wash is one switch away.
