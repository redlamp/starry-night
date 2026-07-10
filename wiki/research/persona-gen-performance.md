---
tags:
  - domain/procgen
  - status/open
  - origin/external-research
---

# Persona Generation Performance

Perf survey run 2026-07-10 on `feat/persona-perf` (off `dev`), triggered by the #93 multi-household re-roll growing the directory from 23.5k to ~39.4k personas. Feeds the deferred-build + lazy-deep-tier round landing on this branch. Architecture: [[decision-persona-architecture]]. Quality-bar research: [[procgen-character-design-games]].

## Baseline (2026-07-10)

Measured with `scripts/personaTime.ts` at the default 6 km tier:

- `generateCity` cold: 1002 ms
- `buildCityNames` cold: 262 ms
- `buildPersonaDirectory` cold: **2246 ms**
- warm (any of the above, cache hit): 0 ms

[[decision-persona-architecture]] previously documented "~500 ms cold at the 6 km tier (23.5k personas)" — stale since the #93 re-roll (round 10, 2026-07-09/10) grew the population to 39.4k. The 2246 ms figure is also worse than a linear scale-up would predict (23.5k→39.4k is ~1.68×; 500 ms→2246 ms is ~4.5×), consistent with per-persona work (story weave, dating) that isn't strictly linear.

Separately: the 2246 ms build was running **synchronously at page mount**, not on first directory/columns panel open as documented. Root cause: `EntityColumns` called `useEntityIndexes()` (which triggers the directory build) unconditionally before its `if (!open) return null` early return — a React hooks-before-conditional pattern that made the "expensive hook" run every mount regardless of whether the panel was ever opened. This directly contradicts the "Directory builds on the main thread on first panel open" line in [[decision-persona-architecture]]'s Known Simplifications. Stage A of this round's fix moves the build behind the actual open-gate with a shadcn Skeleton placeholder while it runs.

## Internal pipeline profile

`buildPersonaDirectory` runs 7 sequential passes: households/people → businesses → schools → employment → commutes → cross-building family → dating → story weave (the story weave is really the 7th/8th; passes are chained, not parallel, and each fully materializes before the next starts).

Notable cost centers:

- **~56k `seedrandom` (ARC4) instantiations per cold build** — one per household (~17.2k) plus one per persona story stream (~39.4k). ARC4 setup (key schedule) is not free per-instantiation; at this call volume the constructor overhead is comparable to the work done with each stream.
- **Dating pass** is a greedy pairing that is O(seekers²) worst case, but most seekers early-exit on the first compatible match scanned; the unmatched tail (orientation/age-band edge cases) pays the full quadratic scan. Not the dominant cost at current pool sizes, but scales badly if the seeker pool grows disproportionately (e.g. via demographic changes).
- **Story weave** ran ~18 chained regex-based template-fill substitutions per persona, eagerly, across all ~39k personas — this is the single biggest identified cost, since template filling was previously "free" at 23.5k but is inherently O(n) in persona count with a non-trivial per-persona constant (18 regex passes each).
- **Caches** (`dirCache`, `namesCache`, `popCache`) clear wholesale on overflow rather than evicting LRU — a cache-key miss under memory pressure or multi-seed browsing pays a full rebuild instead of a partial one.
- The **geometry path** (roads/buildings/districts) has a worker + IndexedDB + packed-typed-array wire format for offloading heavy generation off the main thread. The **persona path has none of that** — it is 100% synchronous main-thread JS, which is why it is the one that shows up as a mount-time hitch.

## External best practices (2024-2026 research)

**Tiered/lazy population records.** Watch Dogs: Legion's "Census" system fills in NPC detail on demand via tag cascades (occupation → income → neighborhood), so the ambient crowd stays cheap until a given NPC is "uprezzed" into a recruitable character ([gamedeveloper.com](https://www.gamedeveloper.com/design/how-watch-dogs-legion-s-play-as-anyone-simulation-works)). Dwarf Fortress's eager whole-history worldgen is the documented cautionary tale for the opposite choice — world-gen time balloons with history length because every event for every historical figure is simulated up front ([dwarffortresswiki.org](https://dwarffortresswiki.org/index.php/World_generation)). No Man's Sky and Minecraft both use hierarchical seeding, where a child seed is `hash(parentSeed, childId)` so any entity can be generated on demand without walking a parent stream ([rambus.com](https://www.rambus.com/blogs/the-algorithms-of-no-mans-sky-2/), [alanzucconi.com](https://www.alanzucconi.com/2022/06/05/minecraft-world-generation/)). Recommended record tiers for our directory: **latent** (seed only, no draws) → **shallow** (name + one line, enough for a list row) → **deep** (full story, generated on selection). This is exactly the shape of Stage A/B of the current round.

**PRNG choice.** seedrandom's default ARC4 algorithm is, per the library's own README, several times slower than `Math.random`, and roughly an order of magnitude slower than modern seeded PRNGs. bryc's canonical PRNG benchmark ([github.com/bryc](https://github.com/bryc/code/blob/master/jshash/PRNGs.md)) puts mulberry32 at ~10.4M ops/s and sfc32 at ~7.5M ops/s (sfc32 also passes PractRand and BigCrush, unlike mulberry32). Recommendation: a vendored sfc32 seeded via an xmur3/cyrb128 avalanche hash. Two hazards to note: seedrandom's non-`new` call form silently replaces the global `Math.random` (a determinism hazard if any code elsewhere still calls bare `Math.random`), and short string seeds can cycle. A PRNG swap changes every downstream draw — it is worldgen-breaking and must be batched with an intentional re-roll, not slipped into a perf patch. Corroboration: [simblob.blogspot.com](https://simblob.blogspot.com/2022/05/upgrading-prng.html).

**Determinism traps.** The core risk in any perf refactor here is PRNG call-count coupling: one sequential stream means adding a single draw anywhere upstream re-rolls everything downstream of it. The fix is per-entity/per-purpose *derived* streams via an avalanche hash rather than sequential offsets — Slay the Spire 2's 2026 postmortem on correlated randomness is the sharpest writeup of this failure mode ([tck.mn](https://tck.mn/blog/correlated-randomness-sts2/)); JAX's key-splitting PRNG model is the clean positive pattern ([docs.jax.dev](https://docs.jax.dev/en/latest/jep/263-prng.html)). Concretely: `seed + offset` fed into a linear generator correlates streams — always hash-mix, never just add. Separately, `Math.sin`/`Math.cos`/`Math.pow` are not precisely specified in ECMA-262 and have documented cross-engine drift ([macwright.com](https://macwright.com/2020/02/14/math-keeps-changing.html)) — keep transcendentals out of any seed-critical path. And: neither Minecraft nor Dwarf Fortress guarantee cross-version seed stability, which argues for adopting a generation-version tag plus a seed→output-hash regression test rather than assuming byte-identical output forever ([minecraft.wiki](https://minecraft.wiki/w/World_seed)).

**Scheduling.** The long-task threshold is 50 ms; heavy main-thread work should be sliced at roughly 5-8 ms chunks. The yield-primitive preference order is `scheduler.yield()` → MessageChannel self-post → `setTimeout(0)`, because Safari still lacks both `requestIdleCallback` and the Scheduler API ([caniuse.com/requestidlecallback](https://caniuse.com/requestidlecallback), [caniuse.com/mdn-api_scheduler_posttask](https://caniuse.com/mdn-api_scheduler_posttask)). React's `useTransition`/`useDeferredValue` schedule *renders* — they do not chunk synchronous JS, so they cannot by themselves fix a long synchronous build ([react.dev](https://react.dev/reference/react/useTransition)). If we ever move the directory build to a worker: pack results into a few large typed arrays and transfer them, since thousands of tiny transferables is a documented anti-pattern ([joji.me](https://joji.me/en-us/blog/performance-issue-of-using-massive-transferable-objects-in-web-worker/)); postMessage payloads up to ~100 KiB are cheap regardless ([infoq.com](https://www.infoq.com/news/2019/08/postMessage-performance-study/)). SharedArrayBuffer needs COOP/COEP headers, which GitHub Pages can't set natively (a coi-serviceworker workaround exists — [blog.tomayac.com](https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/)), but this isn't needed for a one-shot transfer pattern.

**Directory UI.** Our linear substring filter with a 50-result cap is the right default at ~40k records — fuzzy-match libraries are the trap here: Fuse.js's own docs show ≈963 ms per search at 50k items ([fusejs.io](https://www.fusejs.io/performance.html)); uFuzzy is faster but still unnecessary overhead for a filter this size ([github.com/leeoniya/uFuzzy](https://github.com/leeoniya/uFuzzy)). Precomputing lowercase search keys plus `useDeferredValue(query)` on a memoized list is the standard React pattern ([react.dev](https://react.dev/reference/react/useDeferredValue)). Virtualization (react-window v2, TanStack Virtual, react-virtuoso) is only mandatory if we ever render thousands of rows at once — our existing caps avoid that case.

**Memory.** ~40k compact records is low tens of MB in V8 given pointer compression ([v8.dev](https://v8.dev/blog/pointer-compression)). The one lever with 90%-class impact in production is avoiding per-record closures — TanStack Table v9 went from 273 MB to 27 MB for 100k rows purely by removing per-row closures ([tanstack.com](https://tanstack.com/blog/tanstack-table-v9-memory-performance)). Lazy display-string materialization is the same idea applied to UI, per Figma's file-load writeup ([figma.com](https://www.figma.com/blog/speeding-up-file-load-times-one-page-at-a-time/)). And at the object-shape level: fixed shape, one construction site per record type, and `null` over `delete`/property omission keeps V8's inline caches stable ([mathiasbynens.be](https://mathiasbynens.be/notes/shapes-ics), [v8.dev](https://v8.dev/blog/fast-properties)).

## Results (this round, measured 2026-07-10)

After the lazy split, same `scripts/personaTime.ts` tier as the baseline:

- `buildPersonaDirectory` cold: **2246 → 1376 ms (−39%)** — the story weave no longer runs eagerly.
- `ensureBuildingStories` first building (incl. one-time lore/legend/street-index init): **6 ms**; subsequent buildings sub-ms. This is what a card open pays.
- `ensureAllStories` whole city (writing lab / audit scripts only): 777 ms.
- Page mount pays **zero** persona work — the build runs behind the directory/columns open gate under a Skeleton.
- `personaCheck` full PASS; `cityGolden` GOLDEN PASS (geometry untouched); population re-rolled once as predicted.

The remaining 1376 ms cold build is the weave-free passes (households, businesses, schools, employment, dating); the parked PRNG swap and worker offload below are the next levers if it still shows.

## Gap analysis & actions

| Finding | Action | Status |
|---|---|---|
| Directory build ran at page mount, not on first panel open (hooks-before-conditional bug) | Mount-gate fix: `useEntityIndexes()` moved behind the actual `open` check | This round |
| 2246 ms cold synchronous build with no loading state | shadcn `Skeleton` placeholder behind the directory/columns open gate | This round |
| Deep-tier fields (moon/rising sign, birth hour, MBTI, height/build) built eagerly for all 39.4k personas | Lazy per-persona `personaFlavor()` stream, materialized on card open | This round |
| Story content (hooks/epithets/whyAwake/relations) woven eagerly for every building | Lazy per-building `ensureBuildingStories()`, materialized on selection | This round |
| ARC4 seedrandom is an order of magnitude slower than modern seeded PRNGs; ~56k instantiations per cold build | Vendored sfc32 via xmur3/cyrb128 avalanche hash, swapped in batched with the next intentional re-roll (worldgen-breaking on its own) | Parked, priority 1 |
| No worker/offload path for the persona pipeline (unlike geometry) | Worker offload + typed-array transfer, revisit only if post-lazy cold build still hitches on re-measurement | Parked, priority 2 |
| `dirCache`/`namesCache`/`popCache` clear wholesale on overflow | LRU eviction instead of full clear | Parked, priority 3 |
| No guarantee of cross-version persona output stability | Generation-version tag + persona output-hash golden test | Parked, priority 4 |

## Consequences of this round's split

One-time population re-roll: moving deep-tier trait draws out of the eager pass-1 household stream and into `personaFlavor()` changes draw order, so trait values change once on this branch's landing (documented in [[decision-persona-architecture]] and the test plan). Relations also re-roll once, since the global relations stream is now re-keyed per persona rather than drawn inline during the eager story weave. Story *output* per building is otherwise byte-identical to the old eager weave, because all de-dupe state (per-household hook/whyAwake, per-building epithet) was already scoped correctly and doesn't depend on eager-vs-lazy timing.
