---
tags:
  - domain/ci-cd
  - domain/stack
  - status/adopted
  - scope/m1
---

# Decision: GitHub Pages as the Deploy Target

**Date:** 2026-05-25
**Status:** Adopted

## Context

The project needed a public, no-maintenance deploy surface so the user could test on mobile and share builds. `redlamp/starry-night` was created as a public GitHub repo, and GitHub Pages was the obvious zero-cost target.

## Decision

Deploy main as a static Next.js export to GitHub Pages via Actions.

`next.config.ts` gates the Pages-specific configuration behind env vars so local dev still works at root:

```ts
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isStatic = process.env.NEXT_OUTPUT_EXPORT === "true";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  ...(isStatic ? { output: "export" as const } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
};
```

`.github/workflows/deploy-pages.yml` runs on every push to `main`:

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2`
3. `bun install --frozen-lockfile`
4. `bun run build` with `NEXT_PUBLIC_BASE_PATH=/starry-night` and `NEXT_OUTPUT_EXPORT=true`
5. `touch out/.nojekyll`
6. `actions/upload-pages-artifact@v3` (path: `out`)
7. `actions/deploy-pages@v4`

Pages source was set via the API:

```
gh api -X POST repos/redlamp/starry-night/pages -f build_type=workflow
```

## Why this matters

- Every merge to `main` auto-deploys without manual steps
- Env-gated config means `bun dev` still serves at `localhost:3000/` — no `/starry-night` prefix locally
- Static export is fine for now because the project has no API routes, no server components doing dynamic work, and no `next/image`
- `.nojekyll` stops Pages from rewriting paths starting with `_next/`

## Live URL

`https://redlamp.github.io/starry-night/`

## Constraints carried forward

- If the project later needs API routes or server-side rendering, the deploy target moves to Vercel and the workflow is dropped
- Pages caching is aggressive — hard-refresh required to see new builds on mobile
- Workflow uses Node 20 actions (deprecation warning); GitHub forces Node 24 by 2026-06-02, action upgrade required before then
