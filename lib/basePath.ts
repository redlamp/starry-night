// Runtime base path for static-export deploys. GitHub Pages serves the site
// under /starry-night (and the /dev preview under /starry-night/dev); local dev
// and root deploys leave it empty. NEXT_PUBLIC_BASE_PATH is inlined into the
// client bundle at build time (see next.config.ts + .github/workflows/deploy-pages.yml).
//
// Next's `assetPrefix` only rewrites its OWN build output (/_next/* chunks,
// next/image, next/script) — it does NOT touch raw runtime fetches. Any code
// that loads a public/ asset by string (useGLTF, fetch, TextureLoader, ...)
// MUST route the path through asset() or it will 404 under a base path.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a root-absolute public/ asset path with the deploy base path. */
export function asset(path: string): string {
  return `${BASE_PATH}${path}`;
}
