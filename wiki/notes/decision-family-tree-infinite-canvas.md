---
tags:
  - domain/narrative
  - status/adopted
---

# Decision: Family Tree Is an Infinite Canvas

**Date**: 2026-07-11 · **Context**: the family-tree chart's layout model went through three regimes in two days: (1) scroll the oversized chart, (2) never scale — grow the card and trim generations into "+N more" (the phantom-scrollbar saga, see [[test-plan-2026-07-11-personas]] and the 07-10 day log), (3) this decision.

## Options considered

1. **Grow-to-fit + view-aware trim** (regime 2) — worked, but trimmed real relatives out of big webs, and mobile had no path to navigate what was cut.
2. **Infinite canvas** — the chart renders at full natural size and the viewport is a pan/zoom surface, like a map. Trimming becomes unnecessary (only the global box cap remains); mobile gets pinch + pan for free.

## Chosen: infinite canvas

- Drag pans (4px threshold; pointer capture only once a drag is real, so taps still click boxes). Two-pointer pinch zooms at the midpoint. **Plain wheel pans; Ctrl/Cmd+wheel zooms** (which is also what trackpad pinch reports as) — desktop zoom is deliberate-only per user preference. Double-click **tweens** back to the fit (~280ms ease-out; any gesture cancels). Release snaps the nearest generation column flush (≤40px magnetic). Scale clamps [fit×0.5, 2.5]; pan keeps 48px of chart on screen.
- The chart canvas is `absolute inset-0` and **fills the whole panel**; an invisible in-flow sizer (chart box + overlay allowance) keeps the panel's grow-to-fit sizing. Header and footer/controls hover over the chart on gradient scrims (`pointer-events-none`, `auto` only on controls). The footer "?" toggles a horizontal kbd-chip nav strip (ControlsGuide anatomy).
- **No scroll containers exist** — the transform-ghost scrollbar class of bug ([[../daily/2026-07-10]] post-mortem, global memory `css-transform-overflow-ghosts`) is structurally impossible.
- **Crispness**: no `will-change: transform` on the gesture layer — it pins the composited raster at layout scale, so zooming scales pixels of vector (DOM/SVG) content. Without it the browser re-rasterizes after the gesture settles.
- The measure pass clears the gesture transform before reading rects (an ancestor scale would corrupt the pack shifts), captures per-generation snap targets, and restores the user's view (or the automatic fit) after layout.

## Why

Navigability beats trimming: the user explicitly wanted pinch/pan for mobile, judged desktop zoom secondary, and preferred seeing the whole web over "+N more" cuts. The canvas also ended the panel-sizing whack-a-mole — the panel no longer negotiates with the chart's intrinsic size beyond one sizer element.
