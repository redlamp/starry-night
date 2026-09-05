# Starry Night Charter

One page. What this project is, what it refuses to be, and how we know it is
working. The living spec is the product map in the wiki
(`wiki/mocs/product.md`) plus the decision notes it links. GitHub milestones
hold the gates for each full-number release. The 2026-05 PRD (`docs/PRD.md`)
is the v1 record and is not maintained.

## Thesis

A modernized homage to the After Dark "Starry Night" screensaver: a seeded,
deterministic night city that feels inhabited. Small city, vast sky, quiet
wonder. Something you leave running on a second monitor and look at for a
long time.

v1 proved the still frame. 2.0 proves the city is lived in: residents you can
find in the world, windows that follow their lives, a camera that serves both
the toy and the directory.

It is a city of perpetual night. There is no clock. What matters is who is
awake, and why.

## Bars

- **The still frame carries the mood.** If a seed does not feel right as a
  static image, motion will not save it. Every scene change is judged on a
  capture first.
- **Every city is a pure function of its seed.** Same seed, same city, down
  to each lit window and each resident. No wall clock, no `Math.random`, no
  frame timing feeds generation. Golden gates enforce this.
- **Feel is judged live.** Synthetic drag tests measure geometry, not feel.
  Camera and touch work is not done until Taylor has driven it.
- **Apophenia over exposition.** Residents get the least text that implies
  the most life. Story hooks point at drama; they never resolve it. Written
  text is human-authored or flagged as AI until replaced.
- **Runs on the web, from a static host.** No backend. Quality tiers adapt
  to the device; the mid tier is the mobile default.
- **Lived-in, not spectacular.** Closer to Stalenhag and Hopper than Blade
  Runner. Sodium and LED, not neon.

## Not this

- No day/night cycle. The night is the setting, not a phase.
- No persistence backend. Sharing is a seed in a URL.
- No gameplay loop inside the simulation for now. Game ideas are explored
  separately and woven in later, if ever.
- No bulk AI-generated content as final text.
- No new mesh per building variant. Buildings extend the instanced
  archetypes; windows are painted by the shader.

## Versions

- Date tags (`vYYYY.MM.DD`) mark deploys, one per day.
- `package.json` carries a milestone version and bumps only at milestones.
  A point release is a named batch of work; a full number is a new thesis
  and gets a written plan before it is built.
- Main is a bookmark on dev's line and deploys on push. Ship signals cover
  the whole chain.

## Workflow

- Features branch `feat/<name>` off `dev`, merge `--no-ff` on a ship signal,
  `dev` to `main` `--ff-only`. The `fable` branch is retired history.
- Agents do well-specified work in parallel; the lead architects, reviews
  every diff, and takes the hard problems.
- Decisions are notes in the wiki, one concept per file, linked from the
  product map. State lives in the wiki; rules live in `CLAUDE.md`; formal
  artifacts live in `docs/`.

Adopted 2026-09-05. Supersedes the PRD's status table, non-goals, and
milestone list.
