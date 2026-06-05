import type { NextConfig } from "next";

// Pages deploy gates: set NEXT_PUBLIC_BASE_PATH=/starry-night in CI for GitHub Pages.
// Local dev / preview deploys leave it unset so paths stay at root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isStatic = process.env.NEXT_OUTPUT_EXPORT === "true";

const nextConfig: NextConfig = {
  reactStrictMode: false,
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
