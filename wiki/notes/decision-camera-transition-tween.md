---
tags:
  - domain/3d
  - status/adopted
  - scope/m3-plus
---

# Decision: Camera Transition Tween (#83) + Size-Invariant Blend (#84)

**Date:** shipped 2026-07-04, noted 2026-07-05. Related: [[plan-unify-camera-selector]], [[decision-camera-model-registry]], [[decision-perspective-skyline-reframe]], [[plan-camera-follows-crop]].

Shipped originally as commit messages only (`0779a22`, integrated to `feat/scene-polish` as `903941e`); this note closes that gap — flagged by the #56 planning agent, which builds on both. See [[plan-overnight-agents-2026-07-05]].

## #84 — ortho/persp blend no longer "breathes"

**Problem:** the blend's perspective size reference (`perspK`) was derived from the *live, tweening* orbit radius, so mid-blend the framed extent grew ~15% (a visible size dip) at t=0.5, then relaxed back — it read as a dolly, not a projection change.

**Decision:** freeze `restPerspK` at the last at-rest perspective distance (captured in `ProjectionBlender`'s `blend <= 0.0001` early return) and hold it across the whole blend; foreshortening (`d`/`E`/`dz`/near/far) still tracks the live camera. Only the *perspective* side is frozen — freezing the ortho side regresses the Home-reset tween (where orthoSize and blend co-animate). Verified 0.00% deviation across the full blend both directions via `scripts/verifyProjectionSizeInvariance.ts` (negative control reproduced the ~15% dip).

## #83 — top-down `T` tween + return-to-previous-model

`t` snapshots the current camera model + pose into a transient `TopDownEntry` (Zustand, `persist:false`) and tweens into top-down along a **held azimuth** (trivially the shortest arc — top-down looks identical from any azimuth, so no seam revolve). `t` again reverses the *same* GSAP tween back to the previous model + pose. Restore fidelity: `map`/`snv2`/`fly` exact (`snv2` needed a mount-effect gate so its `DEFAULT_INTENT` framing doesn't stomp the restored handoff); `drift`/`turntable` return to the model and resume their own motion. Reversible mid-flight (press `t` again during the sweep).

The old `cameraView.ts` `topDownFraming`/`tweenOrbitTopDown` path is now dead in the live path (only the `?controls=legacy` fallback); left in place, not deleted.
