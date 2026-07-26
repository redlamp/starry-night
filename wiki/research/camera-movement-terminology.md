---
tags:
  - domain/camera
  - status/adopted
  - origin/external-research
---

# Camera Movement Terminology

Shared vocabulary for camera-feel work (user 2026-07-25: "if you say it to me,
it should make sense" - Taylor may not always reach for the term, but reads
them fine). Visual guide:

![[camera-movement-terms.png]]

## The six moves

| Term | Motion | In this project |
| --- | --- | --- |
| **Dolly** | Camera translates forward/back along its view axis | Wheel zoom (perspective), double-click zoom glide |
| **Truck** | Camera translates left/right, perpendicular to the view | Horizontal part of the LMB ground pan; A/D keys |
| **Pedestal** | Camera translates straight up/down | Skyline-mode vertical drag (perspective); Q/E keys |
| **Pan** | Camera ROTATES left/right in place (yaw, position fixed) | Ctrl+LMB free-look, horizontal component |
| **Tilt** | Camera ROTATES up/down in place (pitch, position fixed) | RMB-drag vertical / Tilt slider (about the pivot, so ours also moves) |
| **Roll** | Camera rotates about its view axis | Never user-driven; appears implicitly in the top-down park's north-up tween |

Gotcha: colloquially (and in most map apps) "pan" means what film calls
TRUCK/dolly - moving the camera across the ground. Project code and test plans
use "pan" in the map-app sense (the LMB ground grab); when the film sense is
meant, say "free-look".

Related: [[test-plan-2026-07-25-camera-round-2]],
[[2026-07-18-andy-zawadzki-playtest]].
