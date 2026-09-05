---
tags:
  - domain/lighting
  - domain/personas
  - domain/procgen
  - status/draft
  - origin/user-feedback
---

# Plan: Night Shift Lighting (the Modern Lighting Mode)

2026-09-05. Proposal written from the 2.0 review session. Greenlit by Taylor
for a lab experiment; nothing is built yet. Supersedes the PRD's "modern
mode" wording (docs/PRD.md, Window state model) and closes the gap the PRD
status table has carried since 2026-07-02 ("M2: infrastructure ready, not yet
user-facing").

## The problem the PRD left open

The PRD defines two window state models. **Classic**: windows that are on
stay on, with occasional flicker (the After Dark original). **Modern**:
windows respond to a simulated night, residents go to bed, offices power
down on different curves. Classic shipped. Modern assumed a clock, and the
project has decided it will not get a day/night cycle (Taylor, 2026-09-05:
"unlikely for this project").

Perpetual night removes _when_. What is left is _who_.

## Thesis

A window is lit because the person behind it is awake. The lit map is a
census of the awake population, not a statistical scatter. The city that
never sleeps is really about the people who are up right now, and why.

This is the framing Taylor floated to Andy on 2026-07-19 ("making the
profiles about who's awake right now, and why they're awake"). It also
pays off the persona backlog's highest-ranked open item, "schedule → window
lights" ([[personas]] iteration backlog #3: "the fiction becomes visible").

## Rules

1. **Flip the causality.** Today `generateWindowTexture` picks lit cells
   from an archetype `litRatio`, and `WHY_AWAKE` rationalizes the window
   after the fact. In Night Shift the awake bit is decided first and the
   cell is lit because of it. Classic mode keeps the current painter,
   byte-identical.
2. **Pick the hour and freeze it.** The city is at one hour forever (working
   name: 3 a.m.). The existing `ShiftKind` taxonomy (day / evening / night /
   early / irregular / none) already says who is up at that hour: night and
   early shifts, the irregular, the sleepless. Day shift is dark.
3. **Time without a cycle.** Over a session the awake set churns: early
   risers wake one by one, the evening shift finally goes to bed. The sky
   never changes. This gives the near-miss pairs the personas note wanted
   (one light dies as the neighbor's wakes). Shader-side on
   `(windowSeed, uTime)`, like flicker; never stored.
4. **Stationary churn.** As many windows wake as sleep, so each building's
   lit fraction is constant by construction. That keeps the precomputed
   far-field statistics (#82 `meanLitStats`) and the mipped far atlas valid
   without re-upload.
5. **Motive is legible as light.** Reasons to be awake sort into five kinds:
   working, waiting, unable, choosing, passing through. The shader already
   has color and behaviour per cell; the motive drives them. Steady warm =
   working at home. Blue flicker = waiting or unable. Single dim lamp =
   reading. Cool white = the office cleaner's floor.
6. **Lights left on.** Real cities at 3 a.m. run 5 to 10 percent lit; the
   composition needs far more. The gap is a third category with no person
   behind it: the hallway, the lamp left on for someone not home, the
   office nobody turns off. The awake fraction is an art-direction dial;
   "left on" fills to the composition target.
7. **Conservation of the awake.** Every moving light has an awake person and
   every awake person has a light. The 4 a.m. bus has a driver; the
   helicopter has a pilot. Bus routes (#91) and the persona→traffic backlog
   item are the street-level half of the same rule. Later, not phase 1.
8. **The night has a persona.** Aggregate awake motives per seed and each
   night gets a character: a working night, a restless night, a festival
   night. One line beside the seed chip: "A restless night. 3,120 awake."

## Architecture (the overhead argument)

The trap: if the window painter asks the persona directory who is awake,
the city cannot light until the directory builds (341 ms headless, ~1.4 s
in-browser cold per [[persona-gen-performance]]), and the directory is
deliberately deferred to first panel open. Do not couple them.

The cheap way: awake-ness is a **latent-tier** fact. `awake = hash(seed,
buildingId, unit)` shaped by district and archetype priors for the shift
mix. The painter pays one hash per cell. Then invert the persona side:
`shiftFor()` reads the shift from that byte and the profession is chosen to
fit it, instead of the shift following the profession. One-time population
re-roll (professions and shifts change once; `personaCheck` golden updates).

Condition: the household count per building must be derivable from the
building alone. If it comes from the pass-1 persona stream today, hoist it
into a per-building hash first.

| Cost              | Estimate                                                                     |
| ----------------- | ---------------------------------------------------------------------------- |
| CPU at city build | a few ms (one hash per cell, ~360k cells)                                    |
| GPU per frame     | neutral (a handful of ALU per window fragment)                               |
| Memory            | 0 to 0.4 MB (pack motive + phase into alpha's unused range, or one R8 atlas) |
| Persona build     | unchanged                                                                    |
| Classic mode      | byte-identical (mode gate at paint time)                                     |

Data: alpha today encodes kind (0 unlit / 128 TV / 200 band / 255 steady).
Night Shift needs motive (3 bits) and wake/sleep phase (5 bits); either
pack into the unused alpha range or add a second single-channel atlas.

The real cost is **content**. The awake subset becomes the visible cast and
the pools that explain being awake at night are the thinnest: `WHY_AWAKE`
has 14 day lines but 3 to 4 each for night, early and irregular. Those
become the most-read text in the app. Each motive needs on the order of
15 to 25 lines, plus asleep lines and "left on" lines. Writing-lab work,
and the bulk of the effort.

Overlap: [[persona-presence-editorial]] already specifies
`tenancyLayout(building, households, businesses) → Region[]` with a light
signature per region. Night Shift is that machinery plus one awake bit per
region. Porting the tenancy prototype into `lib/seed` is a prerequisite
either way.

## The lab

Taylor: "let's put a modern lighting proposal together. We could greenlight
a lab to do experimentation." And on the window lab: "Could we update or
modernize it? I'd like to revisit lighting options."

Use `/window-lab` ([[window-lab]]). It already has the specimen rack (graze
wall / mid cluster / far forest / suburbs), two side-by-side slots, texture
layer views, and an approach registry (add a file + one entry). Night Shift
becomes **approach 5**: slot A classic, slot B night shift, same seed, with
a motive legend, an awake-fraction dial, a "left on" dial, and a time
scrubber for the churn. The lab answers the composition question (how lit
does 3 a.m. need to be) before any of it touches production.

## Steps

1. Lab approach 5: latent awake hash + motive coloring + churn, on the
   existing rack. Dials: awake fraction, left-on fraction, hour, churn rate.
   Verify the far-field twin stays valid under churn (stationary rule).
2. Decide the composition target from the lab (the number the dials land on).
3. Port: `lib/seed/lightingGen.ts` gains the awake byte behind a
   `lightingMode` gate (`sceneStore.lightingMode` already exists, unread);
   `cityInstanced` decodes it; Windows panel gets the toggle, classic default.
4. Invert `shiftFor()` so persona shifts read from the awake byte. Update
   `personaCheck` goldens. `WHY_AWAKE` gains an asleep pool and motive tags.
5. Writing: grow the night / early / irregular / asleep / left-on pools in
   the writing lab.
6. Later: tenancy regions, conservation of the awake (traffic, bus, heli
   crews), the night's persona line.

## Open questions

- The frozen hour: 3 a.m. reads as the emptiest; 1 a.m. keeps more of the
  evening shift up and needs less "left on" fill. Pick in the lab.
- Churn timescale: minutes (visible in a screensaver session) or tens of
  minutes (only noticed on a second look)?
- Does classic mode stay the default for the deployed page, or does Night
  Shift become the face of 2.0?
