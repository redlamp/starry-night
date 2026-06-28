---
tags:
  - domain/visual-language
  - status/open
  - origin/external-research
---

# Cyberpunk Visual Treatment — Glowing Translucent City

Reference collection (added 2026-06-28). Visual anchors for a possible
"digital / cyberspace" treatment of the cityscape: **glowing translucent cubes**,
fresnel-lit edges, and a green/blue "hacking the Gibson" palette. Sparked by a
Marathon (Bungie) login-rewards card whose hero art reads almost exactly like
Starry Night with a holographic material pass. Filed as ideas to consider later,
not a committed direction.

Spiritual cousins already on file: [[city-life-montages]] (Ghost in the Shell,
Cyberpunk 2077, Blade Runner), [[streets-of-rage-intro]] (palette/skyline anchor),
[[after-dark-starry-night-original]] (ambient pacing). Palette grounding:
[[color-usage-night-skyline]].

> **Link hygiene** (house rule, see [[city-life-montages]]): official-channel
> hosts marked `verified-official`; everything else is a clip re-upload that may
> move or get pulled — re-check before relying on it. Movie stills are linked /
> hotlinked, not committed, since they're copyrighted. No URLs were invented.

## Anchor — Marathon (Bungie) login-rewards card

The trigger image. A low-poly aerial cityscape rendered as **glowing translucent
cubes** in a saturated green/blue duotone against near-black. Structurally this is
*our scene already* — the difference is entirely material treatment.

![[marathon-login-rewards-post.png]]

What the look is doing, decomposed:

- **Translucent bodies** — cubes read as glass/hologram; you sense depth and
  layering through them rather than solid opaque masses.
- **Glowing edges / rims** — brightest light sits on the cube *edges*, strongest
  at grazing angles (a fresnel rim, possibly explicit wireframe edges too).
- **Digital duotone** — heavily pushed green + blue, very saturated, very
  "cyberspace".
- **Window points survive** — the small bright dots are still there; our existing
  shader-painted window system carries straight over.
- **Soft bloom bleed** — the glow halates outward, which sells the neon-glass feel.

## Anchor — Hackers (1995), the "City of Text" / "Hack the Gibson"

The canonical pop-culture rendering of a computer network as a flythrough city —
and uncannily close to this project: a **grid of towers**, a glowing ground, and
an orbiting/diving camera. Named *"City of Text"* in the closing credits.

Visual design (per the [scifiinterfaces breakdown](https://scifiinterfaces.com/2023/12/11/hackers/)):

- **Towers** — rectangular, **blue-tinted glass/plastic**, on a grid like
  skyscrapers; white lettering (directory/file names) on every visible face.
- **Ground plane** — looks like a **printed circuit board with purple traces**;
  **white pulses flow** along the lanes and fly between the towers.
- **Camera** — flies *among* the towers with exaggerated banking, tilting, diving
  (not walking).
- **Attack state** — towers flash **red** sides and the whole palette darkens.
- Notably **no CGI**: motion-control, models, animation, and rotoscoping (dir.
  Iain Softley). "Gibson" is a homage to William Gibson, who coined "cyberspace".

Levers worth stealing: the **glowing-grid ground** (a Tron floor with travelling
pulses), **face-painted text/data** (we already paint faces — see windows), and a
**state-driven palette shift** (their red-alert ↔ our socioeconomic lighting).

**Video (the literal ask):**

- `verified-official` — Hack the Gibson clip (Movieclips):
  <https://www.youtube.com/watch?v=Bmz67ErIRa4>
- `verified-official` — Just the Hacking Scenes compilation, the City-of-Text
  flythroughs (MGM): <https://www.youtube.com/watch?v=IESEcsjDcmM>
- `verified-official` — "The Worm" cyberspace clip (Movieclips):
  <https://www.youtube.com/watch?v=bcAACOrgVKE>
- `verified-official` — Title sequence / NYC flyover, Orbital "Halcyon On and On"
  (ties to our ambient-pacing target): <https://www.youtube.com/watch?v=an7m4gbrw6E>

**Stills** (hotlinked from the scifiinterfaces article; if they fail to load, open
the [article](https://scifiinterfaces.com/2023/12/11/hackers/) directly):

![City of Text flythrough](https://scifiinterfaces.com/wp-content/uploads/2023/11/Hackers_3D_browsing_0400-1.png)

![City of Text towers](https://scifiinterfaces.com/wp-content/uploads/2023/11/Hackers_3D_browsing_0700-1.png)

## Adjacent anchors (for later, if this direction grows)

- **Tron / Tron: Legacy** — the canonical glowing-edge translucent geometry +
  grid floor. The purest reference for the *edge-glow* lever specifically.
- **Ghost in the Shell (1995)** dive sequences and **Cyberpunk 2077** Night City
  — already filed in [[city-life-montages]]; both carry the neon-density + haze
  levers.
- **Search queries** (no trustworthy single link): `Tron Legacy disc arena scene`,
  `Ghost in the Shell 1995 dive sequence`.

## How we'd get this look (feasibility sketch)

From a 2026-06-28 architecture pass over the render stack. **Key correction up
front:** the scene has *no real bloom* today — `cityInstanced` writes
`gl_FragColor` raw and skips tone mapping (see
[[decision-facade-display-space-color]]), so current "glow" is just bright
display-space colour next to black. The soft halation in these references is the
one lever that genuinely needs new pipeline (or a deliberate fake).

The look decomposes into five separable layers:

| Layer | What | Where it plugs in | Difficulty | Risk |
|---|---|---|---|---|
| Fresnel rim-glow | edges glow at grazing angles | `lib/shaders/cityInstanced.ts` frag (~final colour) + pass world normal/pos from vert | Low–Med | Low |
| Edge / wireframe lines | glowing cube outlines | same shader; object-space edge detect (box is unit ±0.5) | Med | Low |
| Duotone grade | push palette to green/blue | remap `aFacadeColor` attribs in `InstancedCity.tsx`, or in-shader | Low | Low |
| Translucency | see-through "glass" cubes | material flags + blending | **Med–High** | **High** ← crux |
| Bloom halation | soft glow bleed | new composer pass on `StarPass`, or faked | **High** | **High** ← crux |

The first three are additive edits to a shader we own — deterministic
(fresnel/edge/duotone are functions of normal, position, seed, `uTime`), reversible
behind a Zustand `digitalMode` flag, and they honour the display-space colour rule.
That bundle alone gets ~60% of the look at low risk.

**Crux 1 — transparency vs. `InstancedMesh`.** Buildings are one instanced
`BoxGeometry` archetype, and Three.js can't depth-sort individual instances (tile
culling reshuffles order per frame anyway). True alpha "glass" → wrong-order
blending artefacts. **Recommendation: keep the opaque core, add an *additive*
glow layer** (order-independent, like our stars/beacons/moon-halo already are).
Look closely at both references — the bodies stay fairly solid; the translucency
is really just glowing *rims and edges*. So the instancing problem evaporates.

**Crux 2 — bloom vs. the custom renderer.** `StarPass` is a 3-pass loop, so
dropping in an `EffectComposer` (probably *selective* bloom so stars don't
double-bloom) is real pipeline surgery. Cheaper alt: a faked **additive "glow
shell"** (the same boxes scaled up slightly, soft fresnel falloff — moon body+halo
precedent). ~80% of the bloom feel for ~20% of the integration cost.

**Suggested phasing if pursued:** (1) in-shader rim + edge-glow + duotone behind a
`digitalMode` flag; (2) additive glow shell for halation; (3) only if needed, real
selective bloom on `StarPass`. Each step independently shippable and abandonable.
Natural iteration vehicle: a throwaway lab route (cf. `/intro`, `/camera-lab`) to
dial fresnel power / edge width / the green-blue ramp before touching the scene.

**Gotchas flagged:** edge-line thickness varies with non-uniform building scale
(compute edge distance in screen/world space, not object space); a glow shell
roughly doubles building draw work, so gate it on quality tier.
