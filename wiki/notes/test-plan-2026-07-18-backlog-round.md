# Test Plan - 2026-07-18 - Non-Intro Backlog Round

Multi-agent day: 7 streams off the open non-intro issues, run in parallel worktrees
and landed on named `feat/*` branches. Nothing is merged to `fable`/`dev` - each
section names its branch; merges wait for your signal. Sections marked *in flight*
get filled in when that agent lands.

**One-stop testing**: everything is merged on **`test/2026-07-18-round`** (already
checked out in the main tree) - one `bun dev` at http://localhost:7827 shows all
seven streams together. Gates on the merged branch: typecheck, lint, and build all
pass; merged directory build verified headlessly (41,613 personas unchanged, city
totals intact, warm-city build 661ms). Individual branches remain if you want to
test a stream in isolation.

| Section | Stream | Branch | Status |
|---|---|---|---|
| 1 | #96 listed vs total framing | `feat/full-city-framing` | ready to test |
| 2 | #95 top-down compass rose | `feat/compass-rose` | ready to test |
| 3 | #91 bus-routes design note | `feat/bus-routes-design` | ready to read |
| 4 | #90 regional naming packs | `feat/naming-packs` | ready to test |
| 5 | #94 directory cold-build perf | `feat/directory-perf` | ready to test |
| 6 | #92 companies registry view | `feat/companies-view` | ready to test |
| 7 | #97 demographics panel, phase 1 | `feat/demographics-panel` | ready to test |

## Feedback round 1 - fixes to retest (commit `263ef80` + one agent in flight)

Your feedback mapped to fixes, all on `test/2026-07-18-round` (restart `bun dev` if
it doesn't hot-reload the panel):

1. [ ] (1, 7.4) Panel population = masthead population exactly - the panel was
   summing offices/warehouses into the estimate (now residential-only) and
   rounding differently (now the same `approxCount` string as the masthead)
2. [ ] (1.2) Company card staff reads "9 of 90"
3. [ ] (1.7) District/street stat label shortened to "Listed"
4. [ ] (2.1-2.3) Compass rose: custom two-tone needle, red half = north
   (lucide's Compass icon draws its needle at a fixed 45 degrees - it could
   never read as pointing north). Re-run the Section 2 items with this
5. [ ] (7.3) Pyramid: nonbinary now straddles the center line between men and
   women (two half-bars, one tooltip entry)
6. [ ] (7.6, 7.**) Chart + tooltip animations disabled - no cells jumping rows
   on filter/scope change; tooltip snaps to the hovered bar instead of
   tweening from the left
7. [ ] (7.7, 7.*) Floating panel is glassier (backdrop blur actually visible
   now) and its close control is the shadcn Button
8. [ ] (7.9) Resize lerp: bar re-layout animation was the lerp - disabled. If
   a residual one-frame lag on the chart edges still bothers, flag and I'll
   look at the ResponsiveContainer layer next
9. [ ] (6, 6.*) LANDED - kind tabs rework merged; Section 6 below is rewritten
   for the new design. One call I made over the agent: it kept pills in the
   two-tone work/school colors; I gave each industry its own oklch hue
   (school keeps the Education blue). Icons come from the resident-details
   glyph set, mapped per industry by its dominant profession.

## Feedback round 2 - fixes to retest (commit `5fc8fe1`)

1. [ ] Search results no longer crop at 50: a "Show more" row grows the list
   by 50 (the browse tabs already paged; the crop was search-only)
2. [ ] Companies - sort By Industry: an "All Industries" sub-menu appears,
   items shown with each industry's icon + hue; picking one narrows the
   list. Switching the sort away clears the filter (no invisible narrowing)

## 1. Full-capacity city framing (#96)

Issue: https://github.com/redlamp/starry-night/issues/96 · Branch: `feat/full-city-framing`
Decision note: [[decision-listed-residents-term]] - "listed" chosen for the detailed
sample (phone-book listing); veto is cheap, it's pure UI copy.

Numbers at the default seed/tier: population ~325,900 (41,613 listed) · establishments
~23,200 (7,181 listed) · jobs ~370,600 (~1.1 jobs/resident - reads as a core-city
employment hub with unlisted in-commuters; calibration decision made solo, flag if it
feels off).

1. [x] Directory masthead shows two-line stats: Population `~325,500 · 41,613 listed`, Businesses `~23,000 · 7,181 listed`
2. [x] Company card: Staff reads `N listed of M` (e.g. "9 listed of 90"); M varies believably by kind (clinic ≫ corner shop)
3. [x] Building card: `Est. Population ~N` plus `Listed: X residents · Y households` on residential buildings
4. [x] District card: `Population ~N` + `Listed Residents X` (X ≪ N)
5. [x] Street card: Population estimate appears only on streets with residential buildings
6. [x] Tenancy layout unchanged (unit sizes/positions identical to before - the headcount estimate moved but the math is byte-identical)
7. [ ] Term check: does "listed" read right across masthead/cards, or veto?

## 2. Top-down compass rose (#95)

Issue: https://github.com/redlamp/starry-night/issues/95 · Branch: `feat/compass-rose`
Agent: Sonnet, worktree; diff reviewed, CDP-verified live (store + DOM assertions).

1. [ ] Cam v3: dive to top-down - rose fades in top-center once parked overhead
2. [ ] Orbit while parked - the needle rotates live with heading
3. [ ] Click the rose - heading tweens shortest-way to north-up; elevation/target/distance hold still
4. [x] Tooltip reads "Rotate North-Up"
5. [ ] Manual tilt-away (drag, no `T`) - rose fades out even though the next `T` still re-squares
6. [x] Return to normal flight - rose stays hidden in every other camera mode
7. [x] Placement check: top-center clear of ControlDock (left) and settings gear (right), including with the settings panel open

## 3. Bus-routes design note (#91) - read, no code

Issue: https://github.com/redlamp/starry-night/issues/91 · Branch: `feat/bus-routes-design`
Note: [[design-bus-routes]] (recovered road graph → seeded routes → ribbon overlay →
`lineServing(home, work)`; 3 phases, visual-only first slice).

Info only - the note ends with 6 open questions for you (rail spine geometry, line
count vs tier, name→route-shape mapping, walk radius + "bus" label, coverage vs
shared trunks, overlay default). Answers unblock Phase 1.

## 4. Regional naming packs (#90)

Issue: https://github.com/redlamp/starry-night/issues/90 · Branch: `feat/naming-packs`
Agent: Sonnet, worktree; US path verified byte-identical 3x (name-dump diff over 2
seeds); typecheck/lint/build clean. New persisted setting `namingRegion` (default
"us", back-compat migration). Control lives in Settings - City Details - "Naming
Region". Region switch re-derives names only - no city regen.

1. [ ] Fresh load, default US: street names identical to before (same seed, same names)
2. [ ] Settings - City Details - Naming Region: shadcn Select with US / UK
3. [ ] Switch to UK: names re-derive live - a "High Street" exists, Close/Crescent/Mews/Terrace suffixes, M-numbered motorways, York-style -gate streets (Castlegate, Fishergate...)
4. [ ] No duplicate street names in UK mode (the -gate pool caps at one per root)
5. [ ] Directory reflects the switch (addresses, street cards - no stale US names anywhere)
6. [ ] Switch back to US: original names return exactly
7. [ ] Save Settings persists the region across reload

## 5. Directory cold-build perf (#94)

Issue: https://github.com/redlamp/starry-night/issues/94 · Branch: `feat/directory-perf`
Agent: Opus, worktree. Real culprit: the employment weave re-filtered the whole
business pool per worker (O(employed x businesses)) - the issue's suspects
(family/dating weaves, school enrollment) were all ~30ms and innocent. Fix:
memoized preference-ladder pools + a Fenwick-tree least-staffed tracker,
draw-order-preserving. Weave 911ms -> 40ms; directory build ~1.25s -> 0.39s
(city-geometry gen is separate and was already cached in the app flow).
Output verified byte-identical: SHA-256 snapshot match over 2 seeds.

1. [x] Cold open of the City Directory after a fresh load: skeleton window noticeably shorter (sub-second directory build)
2. [x] Spot-check known residents/companies against `fable` - same names, jobs, employers (nothing re-rolled)
3. [x] "Companies have staff" sanity: least-staffed spread still holds (no crowd of 0-staff businesses)
4. [x] Re-seed a few times - no errors, build stays fast at other seeds

## 6. Companies registry view (#92)

Issue: https://github.com/redlamp/starry-night/issues/92 · Reworked per feedback
round 1 (item 6/6.*): with an EMPTY search box, each kind tab now browses its own
data type - districts tree only under All. Query search behavior unchanged. All
browse lists share one paged Show More mechanic (100 per page). At the default
seed: 577 streets, 14,021 buildings, 7,181 companies, 41,613 people.

1. [ ] All tab, empty search: districts tree (unchanged)
2. [ ] Streets tab, empty search: every road by name, muted building count; click opens the street card
3. [ ] Buildings tab, empty search: every addressed building by street + number, name badge on landmarks; click focuses + opens the building card
4. [ ] People tab, empty search: all residents by family name, age right-aligned; click opens the persona card; paging holds up at 41k
5. [ ] Companies tab: registry as before - By Staff default ("N" + "N listed" beneath), By Name / By Industry / By District sorts, district filter
6. [ ] Industry pills: one hue per industry + the same glyph that industry uses in resident details (hospital=stethoscope red, school=grad-cap blue, restaurant=chef-hat orange...); CompanyColumn's pinned badge matches
7. [ ] Typing a query on any tab switches to kind-filtered search results; clearing returns to that tab's browse
8. [ ] Paging resets to top on sort/filter change; scroll performance fine

## 7. Demographics report panel, phase 1 (#97)

Issue: https://github.com/redlamp/starry-night/issues/97 · Branch: `feat/demographics-panel`
Agent: Opus, worktree. New: `FloatingPanel` primitive (pointer-event drag/resize, no
deps), shadcn chart wrapper over recharts@3.9.2 (new dependency), aggregation module,
"Demographics" button in the directory masthead. Cross-filtering and apply-to-directory
are later phases. On the integration branch I reconciled its jobs stat to the
canonical Section-1 figure (the panel and masthead disagreed ~2x) and renamed its
numeric rounding helper to `approxMagnitude`.

1. [x] "Demographics" button in the directory masthead opens the floating panel
2. [x] Drag by title bar; resize; viewport-clamped; min-size holds; Escape and the close button both close it
3. [ ] Charts render: population pyramid (men left, women + nonbinary right), Work Status, Commute Mode, Commute Distance, Households by Size
4. [ ] Header stats: Population ~, Listed exact, Households ~, Jobs ~ - Jobs matches the masthead's economy figure at All Districts (the reconciliation fix)
5. [ ] Scope toggle: Full City (default, ~ values scaled to city population) vs Listed (exact counts); pyramid shape stays consistent between scopes
6. [ ] District filter re-bins every chart + the header stats
7. [x] Panel sits above the docks; directory stays usable behind it
8. [x] Light and dark themes: chart colors read on both
9. [x] Drag/resize FEEL - synthetic tests can't judge this; your live pass is the gate

## Integration notes

- `test/2026-07-18-round` = fable + all seven branches, merged with --no-ff.
- Conflicts resolved by hand: `lib/utils.ts` (both #96 and #97 added a rounding
  helper - kept #96's `approxCount` string formatter, renamed #97's numeric one to
  `approxMagnitude`) and the demographics jobs figure (see Section 7).
- Follow-up worth filing if Section 7 passes: reconcile the demographics
  aggregation onto `PersonaDirectory.city` wholesale (it still computes its own
  lazy population sums - same source model, so numbers agree, but two code paths).
- The #90 agent left `scratch/namingDump.ts` + `scratch/namingDumpUk.ts` as
  reusable verification scripts - delete or keep at your preference.

## Known / Parked

- #85 (low-spec verify) - parked on hardware sourcing; no code work.
- #60 (/build stepper) - parked on the progressive-gen staged-pipeline refactor.
- Jobs calibration (Section 1): building floor-area rates were dead weight (listed
  headcounts always dominate), so jobs = sum of full headcounts; ratio ~1.1
  jobs/resident. Solo call, veto-able.
- Leftover worktree directories under `.claude/worktrees/` (agent-ac2c9...,
  agent-aa3d8..., agent-a05e0...) - all branches are safe; deletion kept firing
  permission prompts, so they're parked for you to remove whenever
  (`git worktree prune` is already done; the dirs are just files now, except
  agent-a05e0... which is still a registered worktree on a detached HEAD).
- `.git/index.lock` stale-lock incident at 09:17 during 4x parallel worktree
  creation - removed after verifying no live git process; watch for recurrence
  when many agents launch at once.
- All work is commits on `feat/*` + `test/2026-07-18-round` only - nothing merged
  to `fable`/`dev`/`main`, nothing pushed. Merge order suggestion once tested:
  each feat branch -> `fable` with --no-ff, then delete `test/2026-07-18-round`.
