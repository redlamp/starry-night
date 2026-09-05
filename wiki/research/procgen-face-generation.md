---
tags:
  - domain/procgen
  - domain/visual-language
  - status/open
  - origin/external-research
---

# Procgen Face Generation — Systems, Art Direction, Heritability

Research for the resident-portrait layer: giving every persona in [[personas]] a face. Researched
2026-07-28. Companion notes: [[procgen-character-design-games]] (how shipped games make procgen
characters players care about), [[after-dark-starry-night-original]] (the primary visual anchor),
[[decision-persona-architecture]] (the data layer a portrait hangs off).

Live probe: `docs/prototypes/portrait-style-probe.html` — four treatments over one seeded genome,
plus a three-generation inheritance strip and a 48-face repetition sheet. Everything drawn in code,
no image files.

## The one finding that shapes everything else

**Nobody hand-draws N portraits.** Every shipped system either composes a small library of parts, or
renders one asset and pushes it through a stylization filter. Part counts are much lower than
intuition suggests — Shadows of Doubt gets a city of distinguishable citizens out of voxel features
measured in *single voxels* (masculine brow 5 wide, feminine 3; masculine nose 2 deep, feminine 1).
Variation comes from proportion and recombination, not from asset volume.

## Prior art

| System                      | Construction                                                                                                                                                          | Takeaway                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Return of the Obra Dinn** | Real 3D rendered at 800x450, converted to 1-bit in a post shader. Bayer for accuracy, blue noise for organic feel, pattern warped on camera motion so it doesn't swim | The "vintage look computed live" proof. Pope's rule: outline first for legibility, then dither *as little as possible*                                           |
| **Papers, Please**          | Hand-drawn faces with marked parts, jumbled to make new faces. ~3 tone bands, muddy aged palette                                                                      | Document framing: portrait sits inside a form next to text fields. Same anatomy as a character-sheet card                                                        |
| **Shadows of Doubt**        | Voxel faces: structural parts (head shape, brow width, chin, jaw, hairline, nose) + cosmetic layers (hair, skin) applied as shader colour                             | The closest structural analog — procedural city, every citizen has a face and a case file. Structure carries age/gender read; colour is an independent parameter |
| **Mii / Tomodachi Life**    | Layered 2D parts with position/size/rotation/colour sliders per part, plus skin-coloured "cover-up" layers above base features to reshape them                        | Z-order as a design tool. Everyone rendered at the same level of caricature (kokeshi-doll abstraction) so no group is singled out as "the simplified one"        |
| **Wildermyth**              | Hand-painted face/hair/body tiles, independently colourable, all drawn in one papercraft style                                                                        | How hand-drawn parts stay coherent under random recombination: one style bible, one light direction, one line weight                                             |
| **CK3**                     | Gene-vector DNA; congenital traits carry active *and* inactive (recessive) forms, so traits skip generations                                                          | The heritability model to copy — see below                                                                                                                       |
| **Watch Dogs: Legion**      | Richest profile data of any system here; failed because voice was decoupled from it                                                                                   | Cautionary: rich data + generic presentation = spreadsheet                                                                                                       |

## Style directions — decided 2026-07-28

Seven surveyed, four built into the probe, **two chosen: Line Art and Flat Vector** (user call after
reviewing the probe).

1. **Line Art** — strokes and light cross-hatch on paper, HyperCard clip-art lineage. Most
   period-accurate, cheapest to render, bulletproof silhouette.
2. **Flat Vector** — Kare icon discipline, flat fills, no tone. Best small-size legibility, and the
   only direction carrying skin and hair colour as real information rather than pattern density.

Both are flat-shape directions, so they share one part library and differ only in stroked vs filled.
Authoring once and rendering twice is close to free; the final pick can stay open until real art exists.

Rejected, recorded so they don't get re-proposed:

- **1-Bit Dither** — rejected for moiré. Root cause was a resampling artifact, not the technique: the
  probe was CSS-scaling a canvas, so the Bayer pattern beat against the resample grid. Fixed by
  rendering at intrinsic pixel size with nearest-neighbour. Kept in the probe for reference only. This
  is the same class of bug as the DPR-resampling moiré fixed in the scene earlier.
- **Green phosphor CRT** — rejected. Replaced with **Compact Mac**: 1-bit black on paper white with the
  9-inch screen falloff, no colour. The black-and-white all-in-one is the machine actually being
  homaged; green phosphor is a different (VT/terminal) lineage.

Set aside earlier: risograph duotone (halftone aliases badly small), isometric voxel bust (native to
our stack but borrows Minecraft/PS1 lineage, not Mac lineage), painterly low-poly (Citizen Sleeper
register — reads as 2020s prestige indie, not vintage).

## Part budget — spend it on hair

Exact-duplicate combinatorics are irrelevant: even a modest budget needs ~24k residents before a
50-face grid has a 5% chance of an exact repeat. What binds is **repetition in the most salient slot**.
Expected count of the most common hairstyle in a grid, by hair count H (measured, 20k trials):

| H | 6 | 8 | 12 | 16 | 20 | 24 | 32 |
|---|---|---|---|---|---|---|---|
| in 50 faces | 12.1 | 10.0 | 7.8 | 6.6 | 5.8 | 5.3 | 4.6 |
| in 100 faces | 22.0 | 17.7 | 13.3 | 11.0 | 9.6 | 8.6 | 7.3 |

**16-24 hair silhouettes** is where the modal repeat drops below about 6 in a 50-grid. Below 12 there's
a visibly dominant hairstyle. Compton's "10,000 Bowls of Oatmeal" problem: huge combinatorial space,
low perceived variety.

At 96px and below, hair silhouette + hair colour + skin tone carry essentially all identity. In one
research run the interior features were accidentally mispositioned entirely and the contact sheets
*still* read as varied faces. DiceBear's `avataaars` allocates the same way: 34 hair, **one nose**, 60%
of raw art bytes in the hair slot. Our probe reproduces it from the other side — 8 hair silhouettes,
and repetition is obvious at 64px.

Proposed budget (~92 parts): hair 24, mouth 10, eyes 10, head/jaw 8, brows 8, facial hair 8, nose 6,
headwear 6, glasses 5, ears 3. Ramps: skin 12, hair 14, eyes 8 — free variety, spend here first.

## Palette and coherence discipline

- **Pick a colour count and hold it.** The constraint is the signature, not a budget cut. Dither and
  line-art directions: two colours plus at most one UI accent for state. Flat/riso: 4-8 flat colours
  shared across every persona, so any random combination looks drawn from one box.
- **Skin tone: authored values, not a hue rotation.** Hue-shifting one base tone produces the
  purple/orange-person failure familiar from cheap avatar generators, because skin's *value* range
  differs by tone, not just its hue. Author 5-8 perceptually spaced steps as first-class palette
  entries and run the same treatment over each. This is the same discipline as
  [[decision-facade-display-space-color]]: author the finished-looking value, don't derive it and hope.
- **One construction grid.** Shared anchors for eye line, nose baseline, jaw width band, ear position,
  plus one light direction and one line weight across the whole part library. Any part drawn to the
  grid composes with any other. Test the *worst* pairings (widest face + smallest hair) before
  greenlighting a library, not the flattering ones.
- **A period palette as a heritable gene.** The probe carries a second palette mode using the classic
  Mac OS 8-bit system palette (6x6x6 cube on 255/204/153/102/51/0, plus 10-step red/green/blue/grey
  ramps on the multiples of 17 the cube skips — 216 + 40 = 256). Skin, hair and shirt each hold a
  continuous RGB gene that blends midparent-style and snaps to the nearest palette entry at render, so
  a lineage drifts through the palette rather than jumping between two ancestral colours. Hair rejects
  any entry within 48 luminance of the skin under it, which is the `contrastTo` rule applied. Worth
  considering as an unlockable or an alternate mode rather than the default — it reads as a deliberate
  period artifact, not as naturalism, and it makes family resemblance far more legible at 24px than
  skin-tone steps do.
- **Silhouette reads first.** Build the silhouette (head + hair + accessory mass) as a separable pass
  and check it alone, flat black, at 48px. If two residents are indistinguishable as silhouettes, no
  interior linework will rescue them at small size. The probe has a section for exactly this test.

## Representation at low fidelity

Miis and Shadows of Doubt reach the same answer from opposite registers. Miis flatten *everyone* to the
same level of caricature, which is fair precisely because it's total, and expose diversity as
independent sliders rather than a handful of preset "ethnic" face templates. Shadows of Doubt keeps one
face-shape library for everyone and moves only the numbers, treating skin and hair colour as
independent shader parameters layered on top.

**The rule this project needs**, extending the existing "ethnicity influences surname only" discipline
from [[procgen-character-theory-literature]]: skin tone and hair type draw from their own namespaced
streams, and *nothing* may condition them — not district wealth or character, not profession, not
income band, not the story pool. The risk here is sharper than in a generic game, because Starry
Night's whole premise is socioeconomic logic keyed to districts. Two streams drawn near each other in
the same sequence could end up correlated without anyone noticing in review. Structural fix, not a
style choice: separate named streams, flat weighting, and a check in `personaCheck.ts` that asserts no
correlation between skin-tone index and district character across the city.

## Heritability

The family tree ([[personas]], `FamilyTree.tsx`) makes this a requirement rather than a flourish: a
child shown next to their parents and grandparents has to look related, and *not* look like a
50/50 average of two faces, which reads as mush.

The working model, implemented in the probe:

- **Continuous genes** (jaw width, brow height, eye spacing, eye size, nose length/width, mouth width,
  ear size, hairline) blend to the **midparent value plus a bell-shaped deviation** — sum-of-three
  uniforms, scaled to about a quarter of the gene's range, clamped to that range. Most children land
  near the parent average; the occasional one is a visible outlier, which is what makes a sibling set
  read as siblings rather than as clones.
- **Categorical genes** (head shape, eye shape, hair style, hair colour) are **diploid**: every person
  carries two alleles and expresses one. A child takes one allele at random from each parent, with the
  expressed/carried order re-rolled. This is what produces a genuine grandparent skip — a trait can sit
  hidden in a parent and resurface in a grandchild. A dominant/recessive table isn't needed; random
  expression order gets the effect with far less authoring.
- **Discrete slots take the dominant allele outright.** Averaging two part indices yields a meaningless
  middle part. Only continuous morphs blend.
- **Skin tone is polygenic**, not an allele: a continuous value that rounds to a palette step. Two
  mid-tone parents cannot produce a child outside their range, which a naive dominant/recessive model
  allows and which would look like a bug.
- **Personal traits are never inherited**: glasses, facial hair, clothing, head tilt. These are choices
  and circumstances, not genes, and inheriting them makes families look like uniformed teams.

Three traps found by prototyping, all worth carrying into the implementation:

- **Maternal-line bias.** Reading "dominant genes tend to stay dominant" as one coin flip per linkage
  group produced children tracing 6/6, 5/6, 6/6, 6/6 to the mother. Dominance must be decided *between
  the two inherited alleles*, biased by whether each was dominant in its own parent:
  `lean = (fromA === 0) - (fromB === 0); aDominant = r() < 0.5 + 0.28 * lean`. After the fix: 5/1, 4/3,
  3/3, 5/2. Needs a parent-share balance assertion so it can't regress silently.
- **Linkage groups.** Genes must segregate in bundles — `[head, ears, jawWidth, headHeight]`,
  `[brows, eyes, eyeSpacing, eyeSize, browHeight]`, `[nose]`, `[mouth]`, `[hair]`, each ramp — or
  features arrive as incoherent mixes.
- **Hair and skin ramps need a joint constraint.** Several prototype faces read as bald because a pale
  hair value landed on a pale skin value. DiceBear models this as `contrastTo` / `notEqualTo`.

Open question: cross-building family links exist as of the round-2 work, so a portrait genome must be
derivable for *any* persona independently, without walking the tree first. Two candidate resolutions —
(a) every persona gets a base genome from their own stream, and children overwrite it by blending
parents on demand; (b) genomes are always resolved through the tree with a depth cap. (a) keeps the
lazy-per-persona pattern from [[persona-gen-performance]]; (b) is more correct but risks a cascade.
Leaning (a) with the blend cached per persona.

## Runtime — inline SVG sprite

Measured against the same 84-part art set:

| | inline SVG `<symbol>` + `<use>` | PNG atlas |
|---|---|---|
| wire size | **34 KB gzip** | 55 KB @64px, 121 KB @128px, 268 KB @256px |
| decoded RAM | negligible | 1.4 / 5.6 / 22.5 MB |
| crisp at 400px | yes, free | no — needs 800px cells, past the 4096 mobile texture limit |
| recolour per instance | verified: `--skin` and `currentColor` both cross the `<use>` shadow boundary | mask-image per layer, or baked variants |
| 100 blinking portraits | 60 fps sustained, p95 frame 16.8 ms | JS redraw per canvas per frame |
| git | text, diffable, zero binaries | binary churn per art tweak |

GitHub Pages serves gzip, not brotli, so 34 KB is the shipped number. Inlining full markup per portrait
(DiceBear's default) costs 412 KB of DOM at 100 portraits and 1637 KB at 400 — it doesn't scale to our
lists. WebGL is disqualified for UI: 100 rows can't each hold a context (cap ~16).

Three rules, verified: author every part on the **same canvas** (a `<symbol>` with its own viewBox
scales to the parent viewport, sending features flying off the head); recolour via `style=`, never a
presentation attribute (`var()` legality in presentation attributes is unresolved — SVG WG issue 1031,
Chromium diverges from Firefox/WebKit); prefix all ids at build time or two portraits on one page break
each other's `url(#…)` refs.

## Morph targets

Transforms about a named anchor cover size, spacing and position for free. They can't change a shape's
*character* — thin line mouth into full lips, straight brow into arched. That needs path interpolation.

- **The constraint**: two paths interpolate only when their `d` strings share the same number and types
  of commands in the same order. So a line mouth must be authored as **the lip shape with both contours
  collapsed onto each other**, not as a separate simpler shape. Verified in the probe's Morph Axes tab
  off a single 26-number template.
- **Multi-target blending** is solved — `svg-path-morph` compiles N same-structure paths to a mean path
  plus deltas and blends by weight array (3D blend-shape logic in 2D). Libraries that morph *arbitrary*
  paths (flubber, GSAP MorphSVG) resample into many points, inflating the path and defeating the
  compact sprite. Author compatible instead.
- **Figma doesn't guarantee structural stability.** Duplicating and moving points usually preserves
  count and order, but nothing documents it and Figma is known to introduce duplicate points on paste.
  The build must assert an identical command sequence per morphable slot and fail otherwise.
- **Morphed paths break `<use>`** — a `<use>` references a static symbol, so `d` can't vary per
  instance. Fix: quantize each axis and bake the stops as symbols at build time. Five stops on four
  slots is 20 extra symbols and zero runtime cost. At 24-40px the difference between adjacent stops is
  sub-pixel anyway.
- **The payoff**: a morph weight is a continuous gene, so it inherits *by degree*. A discrete part swap
  can't — a child either gets the parent's mouth or doesn't. Lip fullness and brow arch passing down as
  gradients is a large part of what will make the tree read as a family.
- **No gender assumption smuggled in**: the morph weight is independent of the proportion cues that
  carry the masculine/feminine read. The probe's grid crosses both; a wide jaw with full lips and a
  narrow jaw with a line mouth are equally reachable.

## Pipeline

**DiceBear 10** is the most interesting find on the authoring side. It is an open-source deterministic
SVG avatar library whose **Figma exporter plugin** turns a Figma file into a single JSON style
definition with the paths inlined — no binary assets at all. Layer convention is `<group>/<option-name>`
(`skin/light`, `eyes/variant02`); every component in a group must share dimensions; one instance of
each group goes into a square frame.

Critically, variants and colours can be **forced** (`eyesVariant: 'variant02'`, `skinColor: '#...'`)
rather than left to its PRNG. So our own seeded streams stay the source of truth and DiceBear is only a
renderer plus an asset container — the determinism contract in `CLAUDE.md` is unaffected. Worth
evaluating against a hand-rolled equivalent; the format is simple enough that adopting the *convention*
without the dependency is also viable.

Three non-obvious build traps: SVGO's default preset **silently deletes an entire
`<svg style="display:none">` sprite** via `removeHiddenElems`, so run it per-part before assembly, never
on the assembled sprite; `cleanupIds` deletes every id in the default preset; SVGO v4 removed
`removeViewBox` from `preset-default`, so older advice about disabling it is obsolete. Verified live:
`svgo` 4.0.2 (MIT), `@figma-export/cli` 6.4.1 (MIT). Avoid `free-tex-packer-cli` (untouched since 2022).

**Affinity is a dead end for automation** — no CLI, no headless mode, v2 or v3. **Aseprite's EULA
forbids redistributing binaries**, so it can't run in CI; you'd commit PNG + JSON and have CI validate
only, reintroducing binary churn. That is the real cost of a pixel direction, and it is worth stating
before the tool choice is made rather than after.

Repo context that constrains the choice (survey 2026-07-28): `public/` holds **zero raster images** —
11 hand-authored SVGs for control glyphs (loaded via `asset()`, editable in Figma) and one attributed
`.glb`. There is no sprite-sheet, no SVGR codegen, and no build step that produces images. Lucide is
the icon convention. A portrait system that ships one JSON or one SVG sprite fits this repo; one that
ships a folder of PNGs does not.

## Where a portrait would land

- `PersonaColumn.tsx` — the character sheet, `w-72` (288px). Today the only per-persona visual identity
  is `GenderIcon`, a single tinted Lucide glyph. The natural home for a full-size portrait.
- `FamilyTree.tsx` `PersonBox` — `w-44` (176px), two text rows. No image slot; a portrait either
  replaces the `GenderIcon` position at ~16-20px or forces a box-height change that cascades through
  the measured layout. **This is the surface that makes heritability visible**, so it matters most.
- `DirectoryPanel.tsx` — resident marquee, people list, search hits. All plain text rows today.
- `BuildingColumn.tsx` — occupants grouped by household, text rows.

## Sources

**Era and technique**
- [After Dark (software) — Wikipedia](https://en.wikipedia.org/wiki/After_Dark_(software))
- [Ditherpunk — the article that named the aesthetic](https://surma.dev/things/ditherpunk/)
- [Dithering, ditherpunk, and Bill Atkinson — FontLab](https://blog.fontlab.com/2026/03/24/dithering-ditherpunk-and-bill-atkinson/)
- [Atkinson dithering — interactive tool](https://atkinson.franzai.com/)
- [MacPaint: The Genesis of Mac Artwork — Low End Mac](https://lowendmac.com/2016/macpaint-the-genesis-of-mac-artwork/)
- [Chicago (typeface) — Wikipedia](https://en.wikipedia.org/wiki/Chicago_(typeface))
- [The collected Art Bits from HyperCard — Adafruit](https://blog.adafruit.com/2022/04/22/the-collected-art-bits-from-hypercard-hypercard-mac-vintagecomputing/)
- [Lucas Pope and the rise of 1-bit dither-punk — Game Developer](https://www.gamedeveloper.com/design/lucas-pope-and-the-rise-of-the-1-bit-dither-punk-aesthetic)

**Games**
- [How Lucas Pope created Obra Dinn's art style — PlayStation Blog](https://blog.playstation.com/archive/2019/10/17/lucas-pope-on-return-of-the-obra-dinns-art-style/)
- [Shadows of Doubt DevBlog 26: Sculpting Faces](https://colepowered.itch.io/shadows/devlog/278805/shadows-of-doubt-devblog-26-populating-the-population-sculpting-faces)
- [Shadows of Doubt DevBlog 27: Clothing](https://colepowered.com/shadows-of-doubt-devblog-27/)
- [Ask the Developer Vol. 21: Tomodachi Life — Nintendo](https://www.nintendo.com/us/whatsnew/ask-the-developer-vol-21-tomodachi-life-living-the-dream-part-2/)
- [Mii — Wikipedia](https://en.wikipedia.org/wiki/Mii)
- [Wildermyth — Wikipedia](https://en.wikipedia.org/wiki/Wildermyth)
- [CK3 characters modding (DNA / genes) — Paradox wiki](https://ck3.paradoxwikis.com/index.php?title=Characters_modding)

**Pipeline**
- [DiceBear — introduction](https://www.dicebear.com/introduction/)
- [DiceBear — create a style with Figma](https://www.dicebear.com/guides/create-an-avatar-style-with-figma/)
- [DiceBear — JS library options (forcing variants and colours)](https://www.dicebear.com/how-to-use/js-library/)
