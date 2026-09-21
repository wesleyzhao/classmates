// Network recovery must preserve mutations, bound waits and tolerate non-JSON edge errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../../public/gsb/api.js';

test('busy retry preserves the exact payload and no other failure retries a mutation',async(t)=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options});
    return calls.length===1 ? Response.json({code:'busy'},{status:409}) : Response.json({ok:true});
  });
  assert.deepEqual(await api('progress',{id:'stable-review',correct:false}),{ok:true});
  assert.equal(calls.length,2);assert.equal(calls[0].options.body,calls[1].options.body);
  let failures=0;
  t.mock.method(globalThis,'fetch',async()=>{failures++;return new Response('<html>Unavailable</html>',{status:503});});
  await assert.rejects(api('sprint/finish',{id:'saved-run'}),/** @param {any} e */e=>e.status===503 && /server could not respond/.test(e.message));
  assert.equal(failures,1);
});

test('a stalled request times out without retrying a possibly committed write',async(t)=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(_url,{signal})=>{
    calls++;
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
  });
  await assert.rejects(api('sprint/finish',{id:'run'},{timeoutMs:10}),/Connection took too long/);
  assert.equal(calls,1);
});

test('caller cancellation aborts pending work and also covers response decoding',async(t)=>{
  const controller=new AbortController();let signal=controller.signal;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    signal=options.signal;
    return /** @type {Response} */(/** @type {unknown} */({ok:true,status:200,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancel'))))}));
  });
  const pending=api('sprint/prepare',{}, {signal:controller.signal});
  await Promise.resolve();controller.abort();
  await assert.rejects(pending,/Request cancelled/);assert.equal(signal.aborted,true);
});

test('non-JSON session rejection still clears authenticated UI and retains HTTP status',async(t)=>{
  const events=[];
  globalThis.window=/** @type {any} */({dispatchEvent:event=>events.push(event.type)});
  t.after(()=>{delete globalThis.window;});
  t.mock.method(globalThis,'fetch',async()=>new Response('Unauthorized',{status:401}));
  await assert.rejects(api('learning'),/** @param {any} e */e=>e.status===401);
  assert.deepEqual(events,['gsb:session-lost']);
});
