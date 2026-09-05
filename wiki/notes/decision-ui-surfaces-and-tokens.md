---
tags:
  - domain/ui
  - status/adopted
---

# Decision: UI Surfaces and Tokens

**Date:** 2026-09-05. Related: [[decision-settings-look-studio]], [[decision-card-front-is-the-person]].

## Context

A presentation-only pass (no IA changes — that shipped separately in the Look/Studio split and the card-front reorder) found the chrome had drifted off the theme system in several places: the HUD chips (`SeedControls`, `FpsHud`, `PerfOverlay`, `ViewModeChip`) hardcoded raw Tailwind palette classes (`bg-black/NN`, `border-white/10`, `amber-950`, `sky-950`) instead of the `--popover`/`--foreground` tokens `app/globals.css` defines for `:root` / `.grey` / `.dark`, so the theme toggle couldn't reach them. `dialog.tsx` was built on a literal `zinc-700` / `#0b1020` / `sky-400` palette, off the token system entirely. Several surfaces had converged on nearly-identical glass/card recipes by hand, copy-pasted with small drifts (`/65` here, `/70` there, `blur-md` vs `blur-xl`). Sub-12px type (`text-[9px]`/`text-[10px]`/`text-[11px]`) had crept into a couple dozen files below the shadcn default floor. Tooltip delay was set in three different places (100ms, 150ms, 300ms) with no single source. Several raw `<button>` elements in the entity-column cards and the City Directory had no visible focus ring. The seed chip — the app's share handle — read at low contrast on white text over black at 40% opacity, and carried no version stamp.

## Choice

**Two surface recipes**, exported as shared className constants from `components/ui/FloatingPanel.tsx`:

- `GLASS = "border-foreground/10 bg-popover/70 backdrop-blur-md shadow-lg"` — HUD chips, the dock, and drawers. Thin, translucent chrome you look *through* at the scene.
- `CARD = "border-border bg-popover/95 backdrop-blur-md shadow-lg"` — reading surfaces: entity cards, the City Directory, the Demographics tooltip. Denser, closer to opaque — text you read for a while, not chrome you glance past.

Applied to `FloatingPanel`, `ControlDock` (round buttons + the directory dock), `CameraPanel`'s settings drawer, `EntityColumns`' card surfaces (including the loading skeleton and `StandaloneEntityCard`), and `DemographicsPanel`'s pyramid tooltip. Radii stayed as the existing convention: `rounded-full` for round buttons, `rounded-xl` for panels, `rounded-md`/`rounded-sm` inside. No opacity numbers changed beyond what the two recipes specify.

**HUD chips moved onto theme tokens.** `SeedControls`, `FpsHud`, `PerfOverlay` now use `GLASS` + `text-foreground`/`text-muted-foreground`; `ViewModeChip` keeps its GLASS surface but drives the skyline/aerial hue distinction from an inline oklch pair (`oklch(0.79 0.14 75)` amber, `oklch(0.78 0.12 230)` sky-blue) instead of the raw `amber-950`/`sky-950` classes, so the tint itself is unaffected by the theme toggle (as designed — it's a semantic status color, not chrome) while the surface now is.

**`dialog.tsx` rebuilt on tokens** — `bg-popover`/`text-popover-foreground`/`border-border`/`text-muted-foreground`/`ring-ring` throughout, replacing the literal zinc/navy/sky palette.

**Nothing below 12px.** Every `text-[9px]`/`text-[10px]`/`text-[11px]` in `components/` became `text-xs` (shadcn's floor) — 24 files, including `tooltip.tsx`'s HelpHint, `CameraPanel`, `AtmospherePanel`, `PerformancePanel`, the entity columns, and the camera/writing/vignette lab pages. No place needed a smaller mark badly enough to keep one.

**One tooltip delay.** `TooltipProvider`'s own default (150ms) is now the single source; `HelpHint` no longer overrides it with 100ms, and `IconTip`'s default parameter changed from 300ms to 150ms. Callers that need instant feedback (fly-to camera buttons, the deck's "Return to Card" hint) still pass `delay={0}` explicitly.

**Focus rings on raw buttons.** Every plain `<button>` in `components/ui/columns/*.tsx` and `DirectoryPanel.tsx` (34 across `BuildingColumn`, `CompanyColumn`, `DistrictColumn`, `StreetColumn`, `PersonaColumn`, `FamilyFan`, `FamilyTree`, `EntityColumns`, `DirectoryPanel`) now carries `focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none` — matching `button.tsx`'s own ring treatment exactly — plus a radius class (`rounded-sm`, or the button's existing considered radius where one was already deliberate, e.g. `FamilyFan`'s round avatar button, `FamilyTree`'s `rounded-md` boxes). These stay plain `<button>`s, not the shadcn `Button` primitive — several are deliberately not "real" buttons (nested inside another trigger, or an SVG-adjacent overlay) per the existing code comments.

**Reduced-motion guards.** `motion-reduce:transition-none` added to the dock's round-button fade, `CameraPanel`'s drift-transport and hidden-state Settings buttons, `ControlsGuide`'s "?" button, `ViewModeChip`, and `SeedControls`' expand/collapse fade.

**Seed chip is the share handle.** `SeedControls` now reads `text-foreground` on the `GLASS` surface, with the seed itself in monospace on a `bg-foreground/10` chip and a `text-muted-foreground` "seed" label — legible even at the dimmed/collapsed 40% opacity. The app version now rides beside it (`v0.1.0` style, `text-muted-foreground`), imported at build time from `package.json` (`resolveJsonModule` was already on in `tsconfig.json`); the version itself was not bumped by this batch.

**Footer labels** (the settings drawer's Reset/Revert/Clear/Link/Copy/Save row) were already icon+text from the 2026-09-05 Look/Studio work — verified, left alone.

## Why

The theme toggle (light/grey/dark) is supposed to reach every visible surface; hardcoded HUD colors and a hand-rolled dialog palette were the last holdouts. Two named recipes instead of ad-hoc `bg-popover/NN` per file stop the slow drift every new panel was introducing. The 12px floor, one tooltip delay, and consistent focus rings are small accessibility/legibility floors that cost nothing to hold uniformly. The seed chip is the thing people screenshot and share — it needed to read clearly even when collapsed, and the version stamp answers "which build is this" without another control.

## Verification

- `bun run lint`, `bun run typecheck`, `bun run build`, and `bunx prettier --check` on every touched file all pass clean.
- Screenshots (CDP, `scripts/cdpShot.ts`, `bun dev -p 7897`) under `samples/presentation-batch/`: home at rest showing the new seed chip + version, the City Directory open with a resident card (verifying the CARD surface and the single-column Details ID block), and the same home shot with the light theme active (confirming the HUD chips now follow the theme toggle).

## Rollback

The owner may roll this back. Scope is strictly presentation/tokens across the files named above — no controls moved, no section renamed, no information architecture changed. A revert needs no data migration; `GLASS`/`CARD` are pure className constants and the version import is inert if removed.
