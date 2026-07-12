// Short, stable content-id hashing for the writing lab. Shared by the sidecar
// generator (scripts/genContentIds.ts, build-time) and the labStore migration
// (lib/writing/labStore.ts, runtime), so both mint byte-identical ids.
//
// The id is a hash of an entry's POSITION KEY — `${poolId}~${ordinal}` for an
// ordinal pool, `${poolId}~${key}` for a keyed (trait) pool — NEVER of its
// text. That's the whole point: editing an entry's wording must not change its
// id (the sidecar exists precisely so an override survives a text edit). The
// position key is exactly the human-readable id the pre-hash scheme used, so
// migrating old ids forward is just `contentHashId(oldId)` (see labStore.ts).
//
// Determinism: cyrb53 is Math.imul + shifts + one exact power-of-two multiply —
// all exact 32-bit/53-bit integer ops, engine- and platform-identical (same
// reasoning lib/seed/rng.ts documents for its own hash). base36 keeps the id
// short and easy to type/search (0-9a-z). NOT a generation input — the writing
// lab never feeds these ids back into a persona/city draw — so this sits
// outside the determinism contract regardless, but being pure-integer makes it
// reproducible across machines anyway.

// Default id width in base36 chars. 6 chars = 36^6 ≈ 2.18e9 slots; for the
// ~1100-entry baseline the birthday-bound collision chance is ~3e-4. The
// generator widens this globally only if an actual collision shows up (and
// records the width it used in the sidecar), so callers that need the exact
// committed width read CONTENT_ID_WIDTH from lib/writing/contentIds.ts rather
// than assuming 6.
export const DEFAULT_CONTENT_ID_WIDTH = 6;

// cyrb53 (bryc, public domain) — a well-distributed 53-bit string hash that
// fits exactly in a JS number. Chosen over a 32-bit hash so widening past 6
// base36 chars (up to 36^10 ≈ 3.6e15 < 2^53) stays collision-meaningful.
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // 53-bit unsigned result.
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// The stable id for a position key at a given base36 width, left-padded so
// every id in a run is the same length.
export function contentHashId(positionKey: string, width: number = DEFAULT_CONTENT_ID_WIDTH): string {
  const space = 36 ** width; // ≤ 36^10, exact in a double
  const code = cyrb53(positionKey) % space;
  return code.toString(36).padStart(width, "0");
}

// Position keys — the pre-hash identity strings. Kept here so the generator and
// any runtime fallback build them the same way.
export function ordinalPositionKey(poolId: string, ordinal: number): string {
  return `${poolId}~${ordinal}`;
}
export function keyedPositionKey(poolId: string, key: string): string {
  return `${poolId}~${key}`;
}
