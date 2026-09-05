---
tags:
  - domain/ui
  - domain/personas
  - domain/camera
  - status/open
  - origin/external-research
---

# Decision: Spatial Toy vs Structured Browse (Draft)

**Date**: 2026-09-05 (draft - options and a recommendation, not yet chosen).
Related: [[decision-entity-columns]], [[decision-inspect-focus-selection]],
[[plan-night-shift-lighting]], [[2026-07-18-andy-zawadzki-playtest]].

## Context

Andy's playtest (theme 2) named a real split: a spatial toy (click the city -
district to building to unit to person, outlines drawn in the scene) and a
structured browse (the directory list). Today they're mixed and the
list-first path dominates: most users reach a person through the directory,
not by clicking into the skyline. What exists: Inspect mode (click
buildings), a district-boundary toggle plus pins in the directory, and Miller
columns ([[decision-entity-columns]]) as the shared detail surface for both
paths.

## Options

**A - Spatial-first.** The scene is the primary surface; every drill (district
-> building -> unit -> person) happens by clicking in 3D, with outlines drawn
live. The directory becomes a search/filter overlay: type a name, jump the
camera and columns to it, but browsing starts in the city. Camera: wants the
skyline regime as the default pose - you have to be looking at the city to
click it, so this pulls against top-down/map framing. Mobile: harder: precise
picking on small buildings needs bigger hit targets or a tap-to-zoom step.
Night Shift: strongest fit - the awake-population framing (see
[[plan-night-shift-lighting]]) rewards scanning the skyline for who's lit,
which only pays off if the scene is where you look first.

**B - Browse-first.** Keep the directory primary; the scene highlights
whatever the list selects, but selection itself still starts in the list.
Camera: compatible with any regime, including top-down/map, since the scene
is a readout, not an input surface. Mobile: easiest - the directory is
already a scrollable list. Night Shift: weakest fit - a list of "who's awake"
is just another census view, the opposite of the ambient "notice who's lit"
read the framing wants.

**C - Two explicit modes with a toggle.** Ship both A and B as switchable
modes. Camera: needs to preserve pose across the toggle so switching doesn't
disorient. Mobile: doubles the surface to maintain and test. Night Shift:
works for whichever mode is active, but a toggle adds a decision point Andy's
feedback was already asking to remove ("I feel like I'm interacting with the
UI more").

## Recommendation

**A, with the directory demoted to search.** It's the only option that pairs
with Night Shift's core idea - the city itself is the thing worth looking at,
and the list should help you find something you already suspect is there,
not be the default entry point. Mobile cost is real but solvable later
(larger hit-testing radius, a tap-to-zoom-then-pick step) and shouldn't block
choosing the direction now.

## What the second playtest should test

Whether a spatial-first flow (directory reduced to a search box) reads as
more discoverable or less, once outlines are drawn live during the district
-> building -> unit -> person drill, and whether losing quick list-scan
access to "who's around" is missed once Night Shift gives the skyline itself
something to scan for.
