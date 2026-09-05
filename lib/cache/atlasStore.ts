import { fingerprintCurrent } from "@/lib/seed/bundleFingerprint";
import { ATLAS_VERSION, type PackEntry } from "@/lib/scene/atlasPacker";
import type { CityShapeSetting } from "@/lib/seed/cityShape";

// Persistent repeat-visit cache for the packed window ATLAS (InstancedCity's
// buildMeshes paint + pack step: generateWindowTexture per building, then
// packWindowAtlas + meanLitStats folding). Measured ~190ms paint + ~10ms pack
// on a Metro-tier city, paid on every mount even though the CityBundle it's
// derived from is already cached (bundleStore.ts). See
// wiki/notes/plan-light-distance-model-v2.md.
//
// generateWindowTexture's only inputs are `masterSeed` and each `Building`
// (seedrandom(`${masterSeed}::lighting::${building.id}::${building.windowSeed}`)
// — no live store reads, no Math.random/Date.now) — buildings themselves are
// the deterministic output of generateCity(masterSeed, shape, 1) (buildMeshes
// always partitions the full scale=1 set, #70). So the SAME fingerprint that
// keys a stored CityBundle (bundleFingerprint.ts) also uniquely determines the
// painted atlas — atlasFingerprint below just reuses it, prefixed with
// ATLAS_VERSION so a painter/packer change (bumped independently in
// atlasPacker.ts) invalidates stored atlases without needing a GEN_VERSION
// bump (which would also toss the much larger, unrelated bundle cache).
//
// Sibling to bundleStore.ts: same fail-soft contract (any unavailability is a
// miss/no-op) and the same typed-array wire packing rationale — a separate
// IndexedDB database, though, so a schema change here never touches the
// bundle store's DB_VERSION/upgrade path (and vice versa).

export type AtlasRecord = {
  atlas: Uint8Array; // RGBA8, length = width * height * 4
  width: number;
  height: number;
  entries: Map<number, PackEntry>; // building id -> atlas placement
  meanLitById: Map<number, [number, number, number, number]>; // building id -> [r, g, b, onFraction]
};

// Synchronous, in-memory warm cache for the CURRENT page session, keyed by
// atlasFingerprint. atlasMemCache holds a CONFIRMED entry (an IDB hit, or a
// freshly-painted-this-session record); atlasChecked marks a fingerprint whose
// IDB read has completed (hit or miss). InstancedCity's buildMeshes reads
// atlasMemCache synchronously and never awaits IDB itself — primeAtlas below
// is called from useGeneratedCity's CityBundle warm-up path, BEFORE its
// readiness flag flips, so the round-trip is paid there instead of gating
// InstancedCity's own mount (see wiki/notes/plan-light-distance-model-v2.md).
export const atlasMemCache = new Map<string, AtlasRecord>();
export const atlasChecked = new Set<string>();

/** Warms atlasMemCache/atlasChecked for `fp` from IndexedDB, unless this
 * fingerprint was already checked this session. Call alongside the CityBundle
 * warm-up (useGeneratedCity.ts), before its `ready` flag flips true. Never
 * throws — getAtlas is fail-soft; a miss just marks `fp` checked with nothing
 * cached, so buildMeshes' cache lookup falls through to a synchronous paint. */
export async function primeAtlas(fp: string): Promise<void> {
  if (atlasChecked.has(fp)) return;
  const rec = await getAtlas(fp);
  if (rec) atlasMemCache.set(fp, rec);
  atlasChecked.add(fp);
}

/** The fingerprint an atlas is stored/read under: the bundle fingerprint (same
 * seed/shape/global-gen-state key a CityBundle is cached under), prefixed with
 * ATLAS_VERSION so painter/packer-only changes get their own invalidation. */
export function atlasFingerprint(masterSeed: string, shape: CityShapeSetting): string {
  return `a${ATLAS_VERSION}::${fingerprintCurrent(masterSeed, shape, 1)}`;
}

// --- wire (storage) form: object Maps flattened to typed arrays, per building,
// index-aligned across ids/offsetX/offsetY/cols/rows/meanLit (see bundleWire.ts
// for the precedent — structured-cloning typed arrays is far cheaper than
// re-serialising a Map's entries). Uint32 throughout: an atlas placement is
// small in practice, but nothing here is worth truncating over.
type AtlasWire = {
  width: number;
  height: number;
  atlas: Uint8Array;
  n: number;
  ids: Float64Array; // building id (Float64 like bundleWire's b.id — lossless)
  offsetX: Uint32Array;
  offsetY: Uint32Array;
  cols: Uint32Array;
  rows: Uint32Array;
  meanLit: Float32Array; // n * 4: r, g, b, onFraction
};

function packAtlas(rec: AtlasRecord): AtlasWire {
  const n = rec.entries.size;
  const ids = new Float64Array(n);
  const offsetX = new Uint32Array(n);
  const offsetY = new Uint32Array(n);
  const cols = new Uint32Array(n);
  const rows = new Uint32Array(n);
  const meanLit = new Float32Array(n * 4);
  let i = 0;
  for (const [id, entry] of rec.entries) {
    ids[i] = id;
    offsetX[i] = entry.offsetX;
    offsetY[i] = entry.offsetY;
    cols[i] = entry.cols;
    rows[i] = entry.rows;
    const ml = rec.meanLitById.get(id);
    if (ml) {
      meanLit[i * 4 + 0] = ml[0];
      meanLit[i * 4 + 1] = ml[1];
      meanLit[i * 4 + 2] = ml[2];
      meanLit[i * 4 + 3] = ml[3];
    }
    i++;
  }
  return {
    width: rec.width,
    height: rec.height,
    atlas: rec.atlas.slice(), // own copy — never share the live render buffer with the DB write
    n,
    ids,
    offsetX,
    offsetY,
    cols,
    rows,
    meanLit,
  };
}

function unpackAtlas(w: AtlasWire): AtlasRecord {
  const entries = new Map<number, PackEntry>();
  const meanLitById = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < w.n; i++) {
    const id = w.ids[i];
    entries.set(id, {
      offsetX: w.offsetX[i],
      offsetY: w.offsetY[i],
      cols: w.cols[i],
      rows: w.rows[i],
    });
    meanLitById.set(id, [
      w.meanLit[i * 4 + 0],
      w.meanLit[i * 4 + 1],
      w.meanLit[i * 4 + 2],
      w.meanLit[i * 4 + 3],
    ]);
  }
  return { atlas: w.atlas, width: w.width, height: w.height, entries, meanLitById };
}

const DB_NAME = "starry-night-atlas";
const STORE = "atlases";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  }).catch(() => null);
  return dbPromise;
}

/** The stored atlas for `fp` (see atlasFingerprint), or null on miss / any error. Never throws. */
export async function getAtlas(fp: string): Promise<AtlasRecord | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<AtlasRecord | null>((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(fp);
      req.onsuccess = () => {
        const wire = req.result as AtlasWire | undefined;
        if (!wire) return resolve(null);
        try {
          resolve(unpackAtlas(wire));
        } catch {
          resolve(null); // unexpected/foreign record — treat as a miss, regenerate
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Best-effort persist of `rec` under `fp`. Swallows quota/other errors. */
export async function putAtlas(fp: string, rec: AtlasRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  let wire: AtlasWire;
  try {
    wire = packAtlas(rec);
  } catch {
    return; // never let a packing fault break the (already-rendered) scene
  }
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(wire, fp);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
