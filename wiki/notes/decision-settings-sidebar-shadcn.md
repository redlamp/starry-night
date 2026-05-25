---
tags:
  - domain/ui
  - status/adopted
  - scope/m1
---

# Decision: Settings Sidebar (shadcn rewire)

**Date:** 2026-05-25
**Status:** Adopted
**Supersedes:** [[decision-debug-panel-architecture]]

## Context

The hand-styled debug panel had grown wide enough that controls felt cramped and inconsistent. Sections shared no visual rhythm; the Debug visibility checkbox hid the bulk of the controls one click in; the popup floated detached from the edge of the screen and clipped against the viewport on short windows. We had also been deferring a shadcn pass for weeks.

User asked for:

1. Bring in shadcn and rebuild the panel with its primitives
2. Each section in a collapsible accordion, **multi-open**
3. Camera-mode header always visible at the top, Reset / Save always visible at the bottom, content between scrolls
4. Drop the "debug" master toggle — everything is reachable all the time
5. Header label → "Settings"; lucide icons left of section labels
6. Light / grey / dark theme cluster

## Decision

`CameraPanel` becomes a full-height right rail:

- Container: `fixed top-0 right-0 bottom-0 w-[26rem]`, left border only, `bg-popover/95 text-foreground`, no top/right/bottom corners — flush with the viewport edge.
- Sticky header: title + `ThemeToggle` + close × (row 1) → Still / Fly / Orbit mode buttons (row 2) → mode-context card (row 3).
- Middle: `<ScrollArea>` wrapping a base-ui `<Accordion multiple>` with 9 sections — Camera / Orbit / Stars / Moon / Fog / Intro / Live readout / Seed / Performance. Defaults open: Camera + Orbit.
- Sticky footer: Reset (left) · Copy · Save (right). The S / F / G / H hotkey line in the footer is gone — hotkeys still work, the hint is just clutter.

Sections share a `<Section>` wrapper so trigger styling, icon size, content padding stay consistent. Each section's chrome is `bg-foreground/[0.04] border-foreground/10` — inverts cleanly under any theme. Vec3 inputs flex-1 across the row with a single shared `X Y Z` header above the first one.

Theme model: a `useTheme()` hook persists `"light" | "grey" | "dark"` to `localStorage` (`starry-night.theme`) and toggles the class on `<html>`. The `.grey` palette is new — defined in `app/globals.css` with mid-tone oklch values between the existing light + dark sets. The panel chrome uses semantic shadcn tokens (`foreground` / `background` / `popover` / `border`) so all three themes look distinct; saturated accent colors (orange / sky / emerald / amber / indigo for mode + fog + intro + moon) stay constant across themes.

shadcn install notes — see [[../../../.claude/memory/tools/shadcn-base-ui-tailwind-v4|global memory]]:

- `bunx --bun shadcn@latest init -y -d` (the `--base-color` flag from older shadcn docs is gone — install asks via `-d` default, neutral)
- shadcn now ships **base-ui** primitives, not Radix. The Accordion API is different: `multiple` is a *boolean* prop with default **false**, where Radix used `type="single" | "multiple"`.
- Components init with light-theme `:root` tokens; the app needs a `dark` (or `grey`) class on `<html>` for the dark surfaces to render — added to `app/layout.tsx`.

## Why this matters

- Multi-open accordion lets the user keep e.g. Orbit + Stars expanded while scrolling between them. That was impossible in the old all-or-nothing Debug block.
- Sticky header + footer means Reset / Save / mode buttons stay one click away no matter how far down the user has scrolled.
- Theme tokens make the panel actually adapt — bulk-replacing every `text-white/X` / `bg-white/X` / `bg-black/X` with `text-foreground/X` / `bg-foreground/X` / `bg-background/X` is mechanical but pays off on every future panel addition.
- Removing the Debug master toggle is a small philosophical shift: every control is "real", not "advanced". Tradeoff is a denser default — counterweighted by the accordion collapse.

## Open

- Light theme on a dark scene leaves a high-contrast white slab against the cityscape. Tolerable but loud; a "panel opacity" slider or a darker scrim might be wanted.
- `bun run lint` is broken (Next 16 removed `next lint` *and* `eslint.config.mjs` imports `@eslint/eslintrc` which isn't installed). Build still works.
- Mode-button accents stay saturated across all themes — worth eyeballing in light mode before declaring the theme story done.
