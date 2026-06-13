// Schema / canonical version for STORED city realizations (the IndexedDB cache in
// lib/cache/bundleStore.ts). It is prepended to the fingerprint used as the
// IndexedDB record key (see bundleFingerprint.ts).
//
// A stored bundle is a cached *realization* of a seed, not a second source of
// truth — the seed remains the definition. This stamp governs which stored
// realization we trust, and bumps in exactly two situations:
//
//   1. REQUIRED — the `CityBundle` *structure* changes. Old stored bundles would
//      be structurally incompatible with current code; bumping rejects them
//      (their fingerprint no longer matches, so they are never read).
//   2. OPTIONAL — you deliberately want to invalidate cached realizations and have
//      returning visitors regenerate.
//
// Do NOT bump on routine generator tweaks. A stored bundle is just a cached
// realization; leaving the version steady lets returning visitors keep their
// already-generated city through minor gen changes.
//
// History:
//   1 → 2  stored form changed from the object CityBundle to the packed wire
//          form (lib/seed/bundleWire.ts). Old v1 records are object bundles and
//          would not unpack — the version prefix keeps them from ever being read.
export const GEN_VERSION = 2;
