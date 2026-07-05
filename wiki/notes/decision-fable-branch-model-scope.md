---
tags:
  - status/adopted
---

# Decision: `fable` Branch Is Model-Scoped

**Date:** 2026-07-06. Related: [[decision-merge-styles]].

`fable` is the integration branch for work done with the **Fable AI model** — it exists so model-attributed work stays separable. It is **not** a general staging branch.

- **Fable-model sessions:** `feat/<name>` off `fable` → `fable` → `dev` → `main`.
- **Other models (Opus, etc.):** use the main convention — `feature/<name>` off `dev` → `dev` → `main`. Do **not** route through `fable`.
- No feature branches should hang off `fable` between Fable sessions.

Noted after an Opus session (2026-07-06) shipped the inspect focus/selection batch through `fable` by habit; the work itself is fine (it landed in `main`), but the routing was wrong. Cleaned up the merged fable-stream feature branches (`feat/city-features`, `feat/scene-polish`, `feat/drei-camera-tuning`) so none remain active off `fable`.
