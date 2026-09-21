// The private portrait preloader reuses blobs, stays bounded, and revokes data on cleanup.
import test from "node:test";
import assert from "node:assert/strict";
import {
  cachedPortraitUrl,
  clearPortraits,
  invalidatePortrait,
  portraitCacheSize,
  portraitUrl,
  preloadPortraits,
  retainPortrait,
} from "../../public/gsb/media-cache.js";

test("portrait blobs are fetched once, bounded, and revoked", async () => {
  const previousFetch = globalThis.fetch,
    previousCreate = URL.createObjectURL,
    previousRevoke = URL.revokeObjectURL;
  const fetched = [],
    revoked = [];
  globalThis.fetch = async (src, options) => {
    fetched.push({ src, options });
    return new Response(new Blob([String(src)]));
  };
  URL.createObjectURL = () => `blob:test-${fetched.length}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    assert.equal(
      await portraitUrl("/api/photo/a"),
      await portraitUrl("/api/photo/a"),
    );
    assert.equal(fetched.length, 1);
    assert.equal(fetched[0].options.cache, "no-store");
    assert.equal(cachedPortraitUrl("/api/photo/a"), "blob:test-1");
    invalidatePortrait("/api/photo/a");
    assert.equal(cachedPortraitUrl("/api/photo/a"), null);
    await portraitUrl("/api/photo/a");
    assert.equal(fetched.length, 2);
    preloadPortraits(Array.from({ length: 20 }, (_, i) => `/api/photo/${i}`));
    await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => portraitUrl(`/api/photo/${i}`)),
    );
    assert.equal(portraitCacheSize(), 12);
    clearPortraits();
    assert.equal(portraitCacheSize(), 0);
    assert.ok(revoked.length >= 12);
  } finally {
    clearPortraits();
    globalThis.fetch = previousFetch;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});

test("visible portraits survive in-flight future preloads and release on unmount", async () => {
  const previousFetch = globalThis.fetch,
    previousCreate = URL.createObjectURL,
    previousRevoke = URL.revokeObjectURL;
  const revoked = [];
  let resolveFetch = () => {};
  const gate = new Promise((resolve) => { resolveFetch = () => resolve(undefined); });
  let serial = 0;
  globalThis.fetch = async (src) => {
    await gate;
    return new Response(new Blob([String(src)]));
  };
  URL.createObjectURL = () => `blob:held-${++serial}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const visible = [0, 1, 2, 3].map((i) => retainPortrait(`/shown/${i}`));
    preloadPortraits(Array.from({ length: 12 }, (_, i) => `/future/${i}`));
    assert.equal(portraitCacheSize(), 12);
    resolveFetch();
    const urls = await Promise.all(visible.map((item) => item.promise));
    assert.equal(new Set(urls).size, 4);
    assert.ok(urls.every((url) => !revoked.includes(url)));
    visible.forEach((item) => item.release());
    preloadPortraits(Array.from({ length: 12 }, (_, i) => `/later/${i}`));
    await Promise.resolve();
    assert.equal(portraitCacheSize(), 12);
    assert.ok(urls.some((url) => revoked.includes(url)));
  } finally {
    clearPortraits();
    globalThis.fetch = previousFetch;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});
