---
tags:
  - domain/intro
  - status/verified
  - origin/worktree-merge
---

# Intro Exploration → dev Merge Handoff

> **✅ RESOLVED 2026-06-08.** Merged `intro/exploration` → `dev` (`--no-ff`,
> `a4eb8b2`) and shipped `dev` → `main`. Conflicts resolved as planned (IntroTicker
> reconciled with `autoPlay` + `cityReady`; daily union; ScreenCity call-site fixed).
> Verified tsc + eslint clean; `/intro` + `/` eyeballed. Branch + worktrees torn down.
> Stars-on-`/` follow-ups filed: #75/#76/#77. Kept for the record.

**Date:** 2026-06-08 · **Branch:** `intro/exploration` (worktree
`.claude/worktrees/intro-exploration`) · **HEAD:** `ad07ce7`

Handoff for the agent doing the merge from the **main worktree**. The
`/intro` exploration is complete and self-verified (tsc 0, lint 0, capture
suites passing). This note is the merge/migration plan.

## TL;DR

- 25 commits to merge; **`dev` has moved a lot** since the branch point
  (`8ad35e4`) — the whole `feature/suburbs-v2` / #49 density work plus
  main-app intro-wake fixes landed on dev. This is a **real 3-way merge**,
  not a fast-forward.
- **Only 3 files overlap** dev's changes. Just **one is code** and needs
  real reconciliation: `components/scene/IntroTicker.tsx`. The other two are
  trivial doc appends.
- Almost everything else is **new files under `components/intro/`,
  `scripts/`, `app/intro/`, `public/models/`** — no conflicts.

## Merge strategy (per `CLAUDE.md`)

`feature → dev` with **`--no-ff`**; later `dev → main` with **`--ff-only`**
(tag main per promotion). Merge/push are blocked by
`.claude/hooks/git-gate.sh` until an explicit unblock signal. Branch name is
`intro/exploration` (not `feature/*`) — harmless; **delete after merge** and
`git worktree remove` the exploration tree.

```
# from the main worktree, on dev:
git merge --no-ff intro/exploration
# resolve the 3 conflicts (below), then verify, commit the merge
```

## Conflicts (3 files)

### 1. `components/scene/IntroTicker.tsx` — REAL, needs reconciliation

Both sides rewrote it. They are **complementary, not contradictory** — merge
both prop sets.

- **dev** (`508bd9a`): changed the signature to
  `IntroTicker({ cityReady })`. Stars wake at mount (`playStarIntro`); the
  **city cascade now waits for `cityReady`** and replays on every false→true
  edge (boot + regen); the per-frame cascade clock is gated by `cityReady`.
  Fixes the city popping in mid-cascade while the worker was still generating.
- **mine** (`2e8530c`): added `autoPlay` (default `true`). The `/intro` Mac
  screen passes `autoPlay={false}` so its city boots already-awake and only
  replays on the Apple-badge reroll.

**Reconciled shape** — keep dev's `cityReady` body verbatim, add `autoPlay`
and gate the two play-triggers on it:

```tsx
export function IntroTicker({
  cityReady,
  autoPlay = true,
}: { cityReady: boolean; autoPlay?: boolean }) {
  // mount: stars wake immediately — only on the autoPlay (/) boot
  useEffect(() => {
    if (armed.current || !autoPlay) return;
    armed.current = true;
    useSceneStore.getState().playStarIntro();
  }, [autoPlay]);

  // city cascade on the ready edge — gated by autoPlay so the /intro screen
  // (autoPlay=false, which snaps itself awake) doesn't cascade
  useEffect(() => {
    if (!cityReady || !autoPlay) return;
    const s = useSceneStore.getState();
    s.playIntro();
    if (firstReady.current) firstReady.current = false;
    else s.playStarIntro();
  }, [cityReady, autoPlay]);

  useFrame(...) // dev's version unchanged (cityReady-gated cascade clock)
}
```

**Then fix the two call sites:**
- `components/scene/Scene.tsx` (dev already passes `cityReady`) — fine, gets
  `autoPlay` default `true`. No change needed beyond what dev has.
- `components/intro/ScreenCity.tsx` (mine, ~line 304): currently
  `<IntroTicker autoPlay={false} />`. **Must also pass `cityReady`** — it's
  already in scope (`const { ready: cityReady } = useGeneratedCity(...)`,
  ~line 237). Change to `<IntroTicker autoPlay={false} cityReady={cityReady} />`.

**Sanity after merge:** on `/intro`, windows snap awake via ScreenCity's
mount-snap (`setIntroProgress(1)`, ~line 248), stars fade via IntroStarField's
own local wake, and the Apple badge (`playAllIntros`) still drives replays —
the `cityReady`-gated frame loop advances them because the city is ready.

### 2. `wiki/daily/2026-06-07.md` — trivial

Both appended to the same day. **Keep both sections** (union).

### 3. `wiki/mocs/decisions.md` — trivial

Both added decision links. **Keep both.**

## Non-textual (semantic) risks — verify, don't assume

`dev` heavily changed city-gen (density bands, suburbs, tiers), `sceneStore`
(persist camera, settings reorg), and scene components. `components/intro/`
**composes the main-app scene** (`InstancedCity`, `Roads`, `StarField`,
`Streetlights`, `Beacons`, `Traffic`, `Moon`, `Ground`) and the shared store.
Textual API breaks surface in `tsc`; behaviour changes won't. So after the
merge:

1. `bunx tsc --noEmit` and `bun run lint` — both must be clean.
2. **Visually verify `/intro`** (the capture scripts below). Watch for:
   - The intro pins `citySize` tier 3 (`INTRO_CITY_TIER` in IntroApp); dev's
     density work may change how tier 3 reads on the CRT.
   - My **main-app star twinkle** change (`StarField.tsx`,
     `lib/shaders/starField.ts`, commit `0d4b333`) and dev's star-retrigger-
     on-regen (`508bd9a`) both touch main-app stars but in different files —
     confirm they compose (stars retrigger AND twinkle) on `/`.

## New deps (no conflict — dev didn't touch package.json)

- `@react-three/postprocessing` + `postprocessing` — bloom on `/intro`.
- `gsap` — camera tweens (was already present at base; unchanged).
- `@gltf-transform/core` (dev) — **used** by `scripts/embedModelCredit.ts`
  (embeds the GLB copyright). Keep.

## New asset

`public/models/mac-128k-daz.glb` (3.47 MB, Daz "Macintosh 128K Computer
1984", CC BY-NC 4.0). Attribution in three layers: on-page (`app/intro/page.tsx`),
`public/models/CREDITS.md`, and the GLB's `asset.copyright`. **Enters history
permanently on merge** — fine, just irreversible. Compression is deferred
(#73); the optimization conflicts with the live-screen technique (documented
in the issue).

## Post-merge

- Delete `intro/exploration`; `git worktree remove` the exploration tree.
- Run the project verification gate before `dev → main`.
- Deploy source is `main`; `/intro` perf is untested on real mobile, and
  bloom still needs quality-tier gating (TODO in IntroScene) before a mobile
  ship.

## Verification scripts (port 7828, `bun dev -- -p 7828` then `bunx tsx ...`)

`scripts/captureIntro.ts` (full suite) · `verifyKnob.ts` · `verifyDragLock.ts`
· `verifyOrbitOcclusion.ts` · `verifyStarsOrbit.ts` · `verifyInteractions.ts`
· `verifySKey.ts` · `verifyBadgeReplay.ts`. All use `bunx tsx` (not `bun` —
Playwright launch hangs under bun on Windows).

## Open follow-ups (filed)

- **#71** scanline tuning vs reference photos.
- **#72** studio lighting polish + light/dark theme toggle (next).
- **#73** GLB compression (blocked by the live-screen technique).
- **#74** textured matte molding on the case (Three.js shader, research).
- Reference (stock) Mac parked (`SHOW_REFERENCE_MAC=false` in IntroScene) —
  returns for the #73/#74 material+compression pass. See
  [[decision-intro-mac-viewport]].
