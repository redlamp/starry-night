---
tags:
  - status/open
---

# Deferred Follow-Ups Watchlist

Long-horizon fixes gated on something external or explicitly parked — checked when the gate moves, not tracked as open GitHub issues. One line each; the closed issue holds the full context. Created 2026-07-04 at the issue clear-out (the #43 close prompted it).

| Item | Gate | Recheck when | Source |
|---|---|---|---|
| THREE.Clock deprecation warning (R3F creates it internally) | R3F 10 stable (`THREE.Timer`) | On the R3F major bump | #43 (closed 2026-07-04) |
| KTX2/ETC1S transcode of the Mac GLB textures (VRAM) | #73's glass base-map decision | After the GLB compression pass | #73 |
| Bloom quality-tier gating on /intro | Needed before any mobile ship of /intro | When intro work resumes ([[plan-issue-clearout-2026-07-04]] parked the intro cluster) | #72 |
| CI typecheck/lint/build gate on PRs | — (parked) | Next infra session | 2026-07-02 survey leftovers ([[fable-codebase-survey-2026-07-02]]) |
| `feature/road-reveal` 15 unmerged commits + stale remote branch cleanup | — (parked per user) | Next infra session | 2026-07-02 survey leftovers |
| Stars 120k default vs 24k quality-tier mismatch + stale comment (`sceneDefaults.ts:43-47,154`) | — (one-liner, needs a which-way decision) | Next perf/look session | #61 close-out (2026-07-04) |

Add an entry whenever an issue closes as "upstream-gated" or "parked pending X" instead of staying open as a tracker.
