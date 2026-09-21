// Sprint media must be fully usable before play and release private blobs after abort or exit.
import test from "node:test";
import assert from "node:assert/strict";
import { prepareRoundMedia } from "../../public/gsb/round-media.js";

test("a stalled photo fails with recovery and aborts outstanding fetches",async(t)=>{
  const signals=[];
  t.mock.method(globalThis,'fetch',async(_src,{signal})=>{
    signals.push(signal);
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  });
  await assert.rejects(prepareRoundMedia([{image:'/stall',choices:[]}],{stallMs:10}),/Photo loading stalled/);
  assert.ok(signals.every(signal=>signal.aborted));
});

test("navigation cancels even a stuck image decode and releases its blob",async(t)=>{
  const revoked=[];let decoding;
  const entered=new Promise(resolve=>{decoding=resolve;});
  t.mock.method(globalThis,'fetch',async()=>new Response(new Blob(['bytes'])));
  t.mock.method(URL,'createObjectURL',()=> 'blob:stuck');
  t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
  const original=globalThis.Image;
  globalThis.Image=/** @type {any} */(class { decode(){decoding();return new Promise(()=>{});} });
  t.after(()=>{globalThis.Image=original;});
  const controller=new AbortController();
  const pending=prepareRoundMedia([{image:'/decode',choices:[]}],{signal:controller.signal});
  await entered;controller.abort();
  await assert.rejects(pending,/cancelled/);
  assert.deepEqual(revoked,['blob:stuck']);
});

test("a complete round reuses prepared images without requests and releases every private URL", async (t) => {
  const fetched = [], revoked = [];
  let serial = 0;
  t.mock.method(globalThis, "fetch", async (src) => {
    fetched.push(src); return new Response(new Blob([String(src)]));
  });
  t.mock.method(URL, "createObjectURL", () => `blob:prepared-${++serial}`);
  t.mock.method(URL, "revokeObjectURL", url => revoked.push(url));
  const original = globalThis.Image;
  globalThis.Image = /** @type {any} */ (class { src; async decode() {} });
  try {
    const controller = new AbortController();
    const questions = Array.from({ length: 20 }, (_, i) => ({ image: `/portrait/${i}`, choices: [{ image: "/portrait/0" }] }));
    const round = await prepareRoundMedia(questions, { signal: controller.signal });
    assert.equal(round.urls.size, 20);
    assert.equal(fetched.length, 20, "duplicate sources are fetched only once");
    for (let i = 0; i < 20; i++) await round.warm(i);
    assert.equal(fetched.length, 20, "advancement cannot issue image requests");
    controller.abort();
    assert.equal(round.urls.size, 0);
    assert.equal(new Set(revoked).size, 20);
    round.dispose();
    assert.equal(revoked.length, 20, "cleanup is idempotent");
  } finally { globalThis.Image = original; }
});

test("a corrupt later photo rejects preparation and cleans up earlier decoded images", async (t) => {
  let serial = 0;
  const revoked = [];
  t.mock.method(globalThis, "fetch", async () => new Response(new Blob(["bytes"])));
  t.mock.method(URL, "createObjectURL", () => `blob:prepared-${++serial}`);
  t.mock.method(URL, "revokeObjectURL", url => revoked.push(url));
  const original = globalThis.Image;
  globalThis.Image = /** @type {any} */ (class {
    src;
    async decode() { if (this.src === "blob:prepared-12") throw new Error("Corrupt image"); }
  });
  try {
    await assert.rejects(prepareRoundMedia(Array.from({ length: 20 }, (_, i) => ({ image: `/portrait/${i}`, choices: [] }))), /Corrupt image/);
    assert.equal(new Set(revoked).size, serial);
  } finally { globalThis.Image = original; }
});
