import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Pages deploy gates: set NEXT_PUBLIC_BASE_PATH=/starry-night in CI for GitHub Pages.
// Local dev / preview deploys leave it unset so paths stay at root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isStatic = process.env.NEXT_OUTPUT_EXPORT === "true";

// Git-worktree fix: when node_modules is a junction to another checkout's deps
// (worktrees share the main tree's node_modules to dodge a Windows long-path
// install), Turbopack panics — "Symlink node_modules ... points out of the
// filesystem root". Pointing the Turbopack root at the common parent makes the
// junction target in-root. No-op for a normal clone (real node_modules dir).
let turbopackRoot: string | undefined;
try {
  if (fs.lstatSync(path.join(process.cwd(), "node_modules")).isSymbolicLink()) {
    turbopackRoot = path.resolve(process.cwd(), "..");
  }
} catch {
  /* no node_modules yet — nothing to special-case */
}

const nextConfig: NextConfig = {
  reactStrictMode: false,
  ...(turbopackRoot ? { turbopack: { root: turbopackRoot } } : {}),
  ...(isStatic ? { output: "export" as const } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  // Hide the Next.js dev-indicator badge (lower-left) — it collides with the
  // in-app seed overlay. Dev-only; no effect on the production build.
  devIndicators: false,
  // Next 16 dev blocks cross-origin requests for dev assets/HMR — without the
  // allow-list a phone on the LAN gets the SSR HTML but no hydration (dead
  // taps, no scene, empty console). Dev-only; ignored by production builds.
  allowedDevOrigins: ["192.168.178.120", "10.5.0.2"],
};

export default nextConfig;
