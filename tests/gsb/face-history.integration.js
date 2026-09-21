// Real Postgres checks for history durability, first-answer accuracy, and fair shared lobby revisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, latestDeck } from '../../server/gsb/db.js';
import { faceHistories, faceSummary } from '../../server/gsb/face-history.js';
import { prepareSprint,startSprint,finishSprint,checkpointSprint,createChallenge,joinChallenge,readyChallenge,beginChallenge,challengeView } from '../../server/gsb/sprint.js';
import { classRooms } from '../../server/gsb/rooms.js';
import { roomIdentity } from '../../server/gsb/auth.js';
if (process.env.NODE_ENV!=='test' || process.env.GSB_TEST_SCHEMA!=='gsb_test_history' || process.env.VERCEL) throw new Error('Isolated history schema required');
const db=database(),deck=await latestDeck();
async function account() {
  const id=randomUUID();await db.query('insert into gsb_accounts(id,email,nickname) values($1,$2,$3)',[id,`${id}@stanford.edu`,'History tester']);return {id,nickname:'History tester'};
}
async function observe(a,id,source='fixture',correct=false) {
  await db.query("select gsb_observe($1,$2,$3,$3,'practice','face',1,$4,$5,1,$5,now()-interval '30 days')",[a.id,source,id,Number(correct),Number(!correct)]);
}
async function rawRun(id) {return (await db.query('select * from gsb_sprint_runs where id=$1',[id]))[0];}

test('Practice is once-only, feeds cross-mode selection, and preserves separate memory',async()=>{
  const a=await account(),args=[randomUUID(),a.id,'fixture-0','face',false,Date.now()];
  await Promise.all([db.query('select gsb_review($1,$2,$3,$4,$5,$6)',args),db.query('select gsb_review($1,$2,$3,$4,$5,$6)',args)]);
  const stats=await faceSummary(db,a.id,deck);
  assert.equal(stats.seen,1);assert.equal(stats.wrong,1);
  const run=await prepareSprint(db,a,deck,'name','quick');
  assert.ok(!(await rawRun(run.id)).doc.questions.some(q=>q.target==='fixture-0'));
  assert.equal((await faceSummary(db,a.id,deck)).seen,1,'preloading is not exposure');
});

test('partial speed history is monotonic and replay-safe, and finish counts only new outcomes',async()=>{
  const a=await account(),run=await prepareSprint(db,a,deck,'mixed','quick');
  await assert.rejects(checkpointSprint(db,a,run.id,[],1));
  await startSprint(db,a,run.id);
  const answers=run.questions.map(q=>({questionId:q.id,choice:q.correctChoice}));
  answers[0].choice=String((Number(answers[0].choice)+1)%4);
  const prefix=answers.slice(0,2).map(a=>a.choice);
  await Promise.all([checkpointSprint(db,a,run.id,prefix,3),checkpointSprint(db,a,run.id,prefix,3)]);
  let stats=await faceSummary(db,a.id,deck);assert.equal(stats.seen,3);assert.equal(stats.correct,1);assert.equal(stats.wrong,1);
  await checkpointSprint(db,a,run.id,prefix.slice(0,1),2);
  assert.equal((await faceSummary(db,a.id,deck)).seen,3);
  await assert.rejects(checkpointSprint(db,a,run.id,['9'],2));
  await assert.rejects(checkpointSprint(db,a,run.id,[run.questions[0].correctChoice],2));
  const unused=(await rawRun(run.id)).doc.questions.slice(3).map(q=>q.target);
  const history=(await faceHistories(db,[a.id]))[0];assert.ok(unused.every(id=>!history[id]));
  const finished=await Promise.all([finishSprint(db,a,run.id,answers,1),finishSprint(db,a,run.id,answers,1)]);
  assert.deepEqual(finished[0],finished[1]);
  await checkpointSprint(db,a,run.id,prefix,3);
  stats=await faceSummary(db,a.id,deck);assert.equal(stats.seen,10);assert.equal(stats.correct,9);assert.equal(stats.wrong,1);
  assert.equal((await db.query('select * from gsb_progress where account_id=$1',[a.id])).length,0);
  const next=await prepareSprint(db,a,deck,'face','quick'),previous=new Set((await rawRun(run.id)).doc.questions.map(q=>q.target));
  assert.ok((await rawRun(next.id)).doc.questions.every(q=>!previous.has(q.target)));
});

test('duel combines differing histories, invalidates stale readiness and locks one shared sequence',async()=>{
  const a=await account(),b=await account();
  for (let i=0;i<10;i++) await observe(a,`fixture-${i}`);
  for (let i=10;i<20;i++) await observe(b,`fixture-${i}`);
  const host=await createChallenge(db,a,deck,'face','quick','duel');
  const guest=await joinChallenge(db,b,deck,host.code);
  const updated=await joinChallenge(db,a,deck,host.code);
  assert.notEqual(updated.selectionVersion,host.selectionVersion);
  assert.deepEqual(updated.questions,guest.questions);
  const order=(await rawRun(guest.id)).doc.questions;
  assert.deepEqual(new Set(order.slice(0,4).map(q=>q.target)),new Set(['fixture-20','fixture-21','fixture-22','fixture-23']));
  const noveltyA=order.filter(q=>Number(q.target.split('-')[1])>=10).length;
  const noveltyB=order.filter(q=>Number(q.target.split('-')[1])<10 || Number(q.target.split('-')[1])>=20).length;
  assert.ok(Math.abs(noveltyA-noveltyB)<=1);
  await assert.rejects(beginChallenge(db,a,host.code,host.selectionVersion),e=>/** @type {any} */(e).code==='challenge_version');
  await assert.rejects(beginChallenge(db,a,host.code,updated.selectionVersion),e=>/** @type {any} */(e).code==='challenge_not_ready');
  await readyChallenge(db,b,host.code,guest.selectionVersion);
  const start=await beginChallenge(db,a,host.code,updated.selectionVersion);
  assert.ok(start.startsAt>Date.now());
  const c=await account(),late=await joinChallenge(db,c,deck,host.code);
  assert.deepEqual(late.questions,updated.questions);assert.equal(late.selectionVersion,updated.selectionVersion);
});

test('simultaneous duel join and start either waits for newcomer or keeps the locked sequence',async()=>{
  const a=await account(),b=await account(),host=await createChallenge(db,a,deck,'face','quick','duel');
  const [joined,started]=await Promise.allSettled([joinChallenge(db,b,deck,host.code),beginChallenge(db,a,host.code,host.selectionVersion)]);
  assert.equal(joined.status,'fulfilled');
  const view=await challengeView(db,host.code),runs=await db.query('select doc from gsb_sprint_runs where challenge_code=$1',[host.code]);
  assert.deepEqual(runs[0].doc.questions,runs[1].doc.questions);
  if (started.status==='fulfilled') assert.ok(view.startsAt);
  else {assert.equal(view.startsAt,null);assert.ok(['challenge_not_ready','challenge_version'].includes(started.reason.code));}
});

test('async challenge stays immutable for later players with different histories',async()=>{
  const a=await account(),b=await account();
  const host=await createChallenge(db,a,deck,'face','quick');
  for (const q of (await rawRun(host.id)).doc.questions) await observe(b,q.target);
  assert.deepEqual((await joinChallenge(db,b,deck,host.code)).questions,host.questions);
});

test('room first-answer mistakes survive correct-to-advance retries and CAS replay',async()=>{
  const a=await account(),rooms=classRooms(db.store),identity=roomIdentity(a);
  const created=await rooms.create({gameId:'race:face',account:a});
  const code=created.code;
  await rooms.act(code,identity,{id:randomUUID(),type:'room/start'});
  let stored=await db.store.getRoom(code);
  // Advance only this synthetic room's deadline, then let the real service tick it.
  stored.doc.s.wakeAt=0;stored.doc.s.startedAt=Date.now()-1000;
  await db.store.casRoom(code,stored.v,stored.doc);
  await rooms.act(code,identity,{id:randomUUID(),type:'room/hello'});
  stored=await db.store.getRoom(code);const q=stored.doc.s._order[0],right=String(q.options.indexOf(q.target)),wrong=String((Number(right)+1)%4);
  await rooms.act(code,identity,{id:randomUUID(),type:'answer',payload:{questionId:q.id,choice:wrong}});
  stored=await db.store.getRoom(code);stored.doc.s.players[a.id].blockedUntil=0;await db.store.casRoom(code,stored.v,stored.doc);
  const action={id:randomUUID(),type:'answer',payload:{questionId:q.id,choice:right}};
  await rooms.act(code,identity,action);await rooms.act(code,identity,action);
  const stats=await faceSummary(db,a.id,deck),face=stats.faces.find(f=>f.id===q.target);
  assert.equal(face.wrong,1);assert.equal(face.correct,0);assert.equal(face.attempts,2);assert.equal(face.mistakes,1);
  assert.equal(stats.seen,2);assert.equal((await db.query('select * from gsb_progress where account_id=$1',[a.id])).length,0);
});

test('a third duel arrival clears prior readiness, and parallel joins cannot lose a seat',async()=>{
  const [a,b,c,d]=await Promise.all([account(),account(),account(),account()]);
  const host=await createChallenge(db,a,deck,'face','quick','duel');
  const guest=await joinChallenge(db,b,deck,host.code);
  await readyChallenge(db,b,host.code,guest.selectionVersion);
  await Promise.all([joinChallenge(db,c,deck,host.code),joinChallenge(db,d,deck,host.code)]);
  const view=await challengeView(db,host.code);
  assert.equal(view.standings.length,4);assert.ok(view.standings.every(s=>!s.ready));
  await assert.rejects(readyChallenge(db,b,host.code,guest.selectionVersion));
  const runs=await db.query('select doc from gsb_sprint_runs where challenge_code=$1',[host.code]);
  assert.ok(runs.every(r=>JSON.stringify(r.doc)===JSON.stringify(runs[0].doc)));
});

test('guest claim records once, timeouts are unanswered, excluded people stay out of summaries',async()=>{
  const a=await account(),hash=randomUUID();
  const doc={questions:[{id:'q1',target:'fixture-0'},{id:'q2',target:'fixture-1'}],result:{answers:[{choice:'0',correct:false},{choice:null,correct:false}]}};
  await db.query("insert into gsb_guest_runs(hash,doc,expires_at,finished_at) values($1,$2::jsonb,now()+interval '1 day',now())",[hash,JSON.stringify(doc)]);
  assert.equal((await faceSummary(db,a.id,deck)).seen,0);
  await db.query('update gsb_guest_runs set claimed_account_id=$2 where hash=$1',[hash,a.id]);
  await db.query('update gsb_guest_runs set claimed_account_id=$2 where hash=$1',[hash,a.id]);
  const stats=await faceSummary(db,a.id,deck);assert.equal(stats.seen,2);assert.equal(stats.wrong,1);assert.equal(stats.correct,0);
  const filtered=await faceSummary(db,a.id,{...deck,cards:deck.cards.filter(c=>c.id!=='fixture-0')});
  assert.equal(filtered.wrong,0);assert.ok(!filtered.faces.some(f=>f.id==='fixture-0'));
});

test('receipts and totals cascade with an account, keeping operator door cleanup possible',async()=>{
  const a=await account();await observe(a,'fixture-0');
  await db.query('delete from gsb_accounts where id=$1',[a.id]);
  assert.equal((await db.query('select * from gsb_face_totals where account_id=$1',[a.id])).length,0);
  assert.equal((await db.query('select * from gsb_face_observations where account_id=$1',[a.id])).length,0);
});

test('history backfill preserves combined Practice counts without double-counting legacy directions',async()=>{
  const a=await account();
  await db.query("insert into gsb_progress values($1,'fixture-0','face',$2::jsonb),($1,'fixture-0','both',$3::jsonb)",
    [a.id,JSON.stringify({reviews:3,correct:1,lastAt:10000}),JSON.stringify({reviews:5,correct:2,lastAt:20000})]);
  // One already-recorded modern review is part of those five, not a sixth.
  await observe(a,'fixture-0','modern',true);
  const {readFile}=await import('node:fs/promises');
  const sql=await readFile(new URL('../../server/gsb/face-history-backfill.sql',import.meta.url),'utf8');
  await db.query("delete from gsb_settings where key='face-history-v1'");
  await db.query(sql);await db.query(sql);
  const summary=await faceSummary(db,a.id,deck),face=summary.faces.find(f=>f.id==='fixture-0');
  assert.equal(face.seen,5);assert.equal(face.correct,2);assert.equal(face.wrong,3);assert.equal(face.attempts,5);
});

test('a direct solo start cannot bypass duel readiness and split the shared sequence',async()=>{
  const a=await account(),b=await account(),host=await createChallenge(db,a,deck,'face','quick','duel');
  await assert.rejects(startSprint(db,a,host.id),e=>/** @type {any} */(e).code==='challenge_not_started');
  const guest=await joinChallenge(db,b,deck,host.code);
  await readyChallenge(db,b,host.code,guest.selectionVersion);
  await beginChallenge(db,a,host.code,guest.selectionVersion);
  const answers=guest.questions.map(q=>({questionId:q.id,choice:q.correctChoice}));
  await assert.rejects(finishSprint(db,b,guest.id,answers,1));
});

test('restarting an asynchronous challenge isolates its abandoned attempt history',async()=>{
  const a=await account(),run=await createChallenge(db,a,deck,'face','quick');
  await startSprint(db,a,run.id);await checkpointSprint(db,a,run.id,[run.questions[0].correctChoice],2);
  const resumed=await joinChallenge(db,a,deck,run.code);
  assert.notEqual(resumed.historyEpoch,run.historyEpoch);
  await startSprint(db,a,run.id);
  await assert.rejects(checkpointSprint(db,a,run.id,[],1,run.historyEpoch));
  const answers=resumed.questions.map(q=>({questionId:q.id,choice:q.correctChoice}));
  await assert.rejects(finishSprint(db,a,run.id,answers,1,run.historyEpoch));
  await finishSprint(db,a,resumed.id,answers,1,resumed.historyEpoch);
  const stats=await faceSummary(db,a.id,deck);
  assert.equal(stats.seen,10);assert.equal(stats.faces.reduce((n,f)=>n+f.seen,0),12);assert.equal(stats.correct,11);
});

test('fast sprint completion uses the database clock and still rejects a genuinely future start',async t=>{
  const a=await account(),run=await prepareSprint(db,a,deck,'face','quick');
  await startSprint(db,a,run.id);
  const answers=run.questions.map(q=>({questionId:q.id,choice:q.correctChoice}));
  const actualNow=Date.now.bind(Date);
  t.mock.method(Date,'now',()=>actualNow()-60000);
  const result=await finishSprint(db,a,run.id,answers,1);
  assert.equal(result.correct,10);
  t.mock.restoreAll();
  const future=await prepareSprint(db,a,deck,'face','quick');await startSprint(db,a,future.id);
  await db.query("update gsb_sprint_runs set started_at=clock_timestamp()+interval '5 seconds' where id=$1",[future.id]);
  await assert.rejects(finishSprint(db,a,future.id,future.questions.map(q=>({questionId:q.id,choice:q.correctChoice})),1),e=>/** @type {any} */(e).code==='sprint_time');
});

test('legacy completed room backfill recovers offered targets without inventing accuracy',async()=>{
  const a=await account(),code=randomUUID().slice(0,8),seed=randomUUID();
  const doc={phase:'over',updatedAt:Date.now(),game:{kitId:'recognition'},s:{$seed:seed,mode:'race',void:false,
    players:{[a.id]:{index:1}},_order:[0,1,2].map(i=>({id:String(i),target:`fixture-${i}`,direction:'face'}))}};
  await db.store.createRoom(code,doc);
  const {readFile}=await import('node:fs/promises');
  const sql=await readFile(new URL('../../server/gsb/face-history-backfill.sql',import.meta.url),'utf8');
  await db.query("delete from gsb_settings where key='face-history-v1'");await db.query(sql);
  const summary=await faceSummary(db,a.id,deck);
  assert.equal(summary.seen,2);assert.equal(summary.correct,0);assert.equal(summary.wrong,0);
});
