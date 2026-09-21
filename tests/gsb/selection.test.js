// Coverage selection preserves novelty, shared multiplayer fairness, and seeded reproducibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTargets } from '../../public/kits/recognition/selection.js';
import { makeRng } from '../../public/kits/_lib/rng.js';
import { createFaceCheckpoints } from '../../public/gsb/face-checkpoints.js';
const cards = Array.from({length:24},(_,i)=>({id:String(i)}));
const history = ids => Object.fromEntries(ids.map(id=>[String(id),{seen:1,lastSeen:100}]));
test('solo uses unseen across all time, no duplicates, then least exposed and oldest',()=>{
  const h=history(Array.from({length:20},(_,i)=>i));
  h['0']={seen:3,lastSeen:1};h['1']={seen:1,lastSeen:1};
  const result=selectTargets(cards,[h],24,makeRng('solo'));
  assert.deepEqual(new Set(result.slice(0,4)),new Set(['20','21','22','23']));
  assert.equal(result[4],'1');assert.equal(result.at(-1),'0');assert.equal(new Set(result).size,24);
});
test('duel first shares unseen faces then balances novelty when histories are disjoint',()=>{
  const a=history(Array.from({length:10},(_,i)=>i)),b=history(Array.from({length:10},(_,i)=>i+10));
  const result=selectTargets(cards,[a,b],14,makeRng('duel'));
  assert.deepEqual(new Set(result.slice(0,4)),new Set(['20','21','22','23']));
  const aNew=result.filter(id=>!a[id]).length,bNew=result.filter(id=>!b[id]).length;
  assert.ok(Math.abs(aNew-bNew)<=1);
  assert.deepEqual(result,selectTargets(cards,[b,a],14,makeRng('duel')));
});
test('newcomer and experienced player use shared sequence without excluding the latter',()=>{
  const h=Object.fromEntries(cards.map((c,i)=>[c.id,{seen:i+1,lastSeen:i}]));
  assert.deepEqual(selectTargets(cards,[{},h],3,makeRng('new')),['0','1','2']);
  assert.equal(selectTargets(cards,[],100,makeRng('all')).length,24);
});
test('background checkpoint retains newer progress while an older request is in flight',async()=>{
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  let release=()=>{};const sent=[];
  const queue=createFaceCheckpoints('account',{storage:/** @type {any} */(storage),send:async body=>{sent.push(body);await new Promise(r=>{release=()=>r(undefined);});}});
  const round={id:'run',count:10};
  queue.remember(round,[{choice:'0'}]);const flush=queue.flush();
  queue.remember(round,[{choice:'0'},{choice:'1'}]);release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent[1].answers.length,2);release();await flush;
  assert.deepEqual(JSON.parse(map.get('gsb-face-checkpoints:account')),{});
});

test('navigation shares one queue and drains newer runs without erasing their storage',async(t)=>{
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storage});
  t.after(()=>{delete globalThis.sessionStorage;});
  let release=()=>{}; const sent=[];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    sent.push(JSON.parse(options.body));
    if(sent.length===1)await new Promise(resolve=>{release=()=>resolve(undefined);});
    return Response.json({ok:true});
  });
  const first=createFaceCheckpoints('navigation');
  first.remember({id:'first',count:10},[]);const flush=first.flush();
  const second=createFaceCheckpoints('navigation');
  assert.equal(first,second);
  second.remember({id:'second',count:10},[{choice:'2'}]);
  release();await flush;
  assert.deepEqual(sent.map(body=>body.id),['first','second']);
  assert.deepEqual(JSON.parse(map.get('gsb-face-checkpoints:navigation')),{});
});

test('invalid stored checkpoints and unavailable browser storage do not break a round',async(t)=>{
  const sent=[];
  const storage=/** @type {Storage} */(/** @type {unknown} */({getItem:()=>JSON.stringify({bad:{id:'bad',answers:null},good:{id:'good',answers:['1'],seen:2}}),setItem(){}}));
  const queue=createFaceCheckpoints('corrupt',{storage,send:async body=>{sent.push(body);}});
  await queue.flush();assert.deepEqual(sent.map(body=>body.id),['good']);
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw new Error('Storage denied');}});
  t.after(()=>{delete globalThis.sessionStorage;});
  const denied=createFaceCheckpoints('denied',{send:async body=>{sent.push(body);}});
  denied.remember({id:'in-memory',count:10},[]);await denied.flush();
  assert.equal(sent.at(-1).id,'in-memory');
});

test('checkpoint retries a transient failure but discards expired runs',async()=>{
  const map=new Map(),storage=/** @type {Storage} */(/** @type {unknown} */({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}));
  let fail=true;
  const queue=createFaceCheckpoints('retry',{storage,send:async()=>{if(fail)throw new Error('offline');}});
  queue.remember({id:'round',count:10},[]);await queue.flush();
  assert.equal(Object.keys(JSON.parse(map.get('gsb-face-checkpoints:retry'))).length,1);
  fail=false;await queue.flush();assert.deepEqual(JSON.parse(map.get('gsb-face-checkpoints:retry')),{});
  const expired=createFaceCheckpoints('expired',{storage,send:async()=>{throw Object.assign(new Error('expired'),{status:409});}});
  expired.remember({id:'round',count:10},[]);await expired.flush();
  assert.deepEqual(JSON.parse(map.get('gsb-face-checkpoints:expired')),{});
});
