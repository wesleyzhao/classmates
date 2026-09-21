// A small session-only blob cache makes preloaded private portraits reusable despite no-store headers.
const portraits = new Map();
const LIMIT = 12;
let generation = 0;

function forget(src) {
  const entry = portraits.get(src);
  if (!entry) return;
  portraits.delete(src);
  entry.discarded = true;
  if (entry.url) URL.revokeObjectURL(entry.url);
}

function trim() {
  while (portraits.size > LIMIT) {
    const oldest = [...portraits].find(([, entry]) => entry.pins === 0)?.[0];
    if (!oldest) break;
    forget(oldest);
  }
}

/** Return an already fetched URL so a prefetched portrait can paint on the first render. */
export function cachedPortraitUrl(src) {
  const entry = portraits.get(src);
  if (!entry?.url) return null;
  portraits.delete(src);
  portraits.set(src, entry);
  return entry.url;
}

/** Discard a failed decoded image before retrying its same-origin no-store request. */
export function invalidatePortrait(src) {
  forget(src);
}

/** Fetch one private portrait into a bounded memory-only object URL cache. */
function loadPortrait(src, retain = false) {
  if (!src) return Promise.resolve("");
  const existing = portraits.get(src);
  if (existing) {
    if (retain) existing.pins++;
    portraits.delete(src);
    portraits.set(src, existing);
    return existing.promise;
  }
  if (portraits.size >= LIMIT && ![...portraits.values()].some((entry) => entry.pins === 0))
    return Promise.reject(new Error("Portrait cache is full"));
  const started = generation;
  const entry = { discarded: false, url: "", promise: null, pins: Number(retain) };
  entry.promise = fetch(src, { cache: "no-store" })
    .then((response) => {
      if (response.status === 401 && typeof window !== "undefined")
        window.dispatchEvent(new Event("gsb:session-lost"));
      if (!response.ok) throw new Error("Portrait unavailable");
      return response.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      if (entry.discarded || generation !== started) {
        URL.revokeObjectURL(url);
        throw new Error("Portrait cache cleared");
      }
      entry.url = url;
      return url;
    })
    .catch((error) => {
      if (portraits.get(src) === entry) portraits.delete(src);
      throw error;
    });
  portraits.set(src, entry);
  trim();
  return entry.promise;
}

/** Fetch one private portrait into a bounded memory-only object URL cache. */
export function portraitUrl(src) {
  return loadPortrait(src);
}

/** Keep a displayed portrait alive while future questions preload. */
export function retainPortrait(src) {
  const promise = loadPortrait(src, true);
  const entry = portraits.get(src);
  let released = false;
  return {
    promise,
    release() {
      if (released || !entry) return;
      released = true;
      entry.pins = Math.max(0, entry.pins - 1);
      trim();
    },
  };
}

/** Start loading a bounded set of private portraits for the current session. */
export function preloadPortraits(urls) {
  // Do not start requests that would immediately evict other in-flight preloads.
  for (const src of [...new Set(urls.filter(Boolean))].slice(0, LIMIT))
    portraitUrl(src).catch(() => {});
}

/** Release every private portrait blob when the authenticated session ends. */
export function clearPortraits() {
  generation++;
  for (const src of [...portraits.keys()]) forget(src);
}

/** Expose the cache size for bounded-behavior tests. */
export function portraitCacheSize() {
  return portraits.size;
}
