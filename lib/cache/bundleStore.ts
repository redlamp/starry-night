import type { CityBundle } from "@/lib/seed/cityGen";
import { packBundle, unpackBundle, type CityBundleWire } from "@/lib/seed/bundleWire";

// Persistent repeat-visit cache for generated city bundles. Keyed by the full
// fingerprint (bundleFingerprint.ts), so a GEN_VERSION bump or any config change
// yields a new key and old records are simply never read. Values are stored in
// the packed WIRE form (bundleWire.ts) — object arrays flattened to typed
// buffers — which IndexedDB's structured clone stores as compact binary (the
// record drops ~35% vs the object form, and read/write run ~10× faster). The
// API stays CityBundle in/out: putBundle packs, getBundle unpacks. primeCityCaches
// rebuilds the one closure (classify) on load, it is never stored.
//
// A wire-shape change is a GEN_VERSION bump (genVersion.ts) — old-format records
// then have a non-matching fingerprint and are never read; getBundle also fails
// soft if an unexpected record can't be unpacked.
//
// Every operation FAILS SOFT: any unavailability (SSR, private mode, quota, a
// blocked upgrade) resolves to a miss / no-op so the caller falls through to the
// baked asset or live generation. The cache is a performance layer, never required.

const DB_NAME = "starry-night";
const STORE = "city-bundles";
// 2 (#b): the stored value changed from the object CityBundle to the packed wire
// form. The GEN_VERSION-keyed fingerprint already stops old records being READ;
// bumping DB_VERSION lets onupgradeneeded CLEAR them so they don't leak space.
const DB_VERSION = 2;

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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      } else {
        // Version bump → drop records from an older bundle format (the pre-#b
        // object CityBundle) instead of leaking their bytes; they're unreadable
        // anyway (the GEN_VERSION prefix in the key no longer matches).
        req.transaction?.objectStore(STORE).clear();
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  }).catch(() => null);
  return dbPromise;
}

/** The stored bundle for `fp`, or null on miss / any error. Never throws. */
export async function getBundle(fp: string): Promise<CityBundle | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<CityBundle | null>((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(fp);
      req.onsuccess = () => {
        const wire = req.result as CityBundleWire | undefined;
        if (!wire) return resolve(null);
        try {
          resolve(unpackBundle(wire));
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

/** Best-effort persist of `bundle` under `fp`. Swallows quota/other errors. */
export async function putBundle(fp: string, bundle: CityBundle): Promise<void> {
  const db = await openDb();
  if (!db) return;
  let wire: CityBundleWire;
  try {
    wire = packBundle(bundle);
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
