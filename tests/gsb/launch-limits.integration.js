// Real HTTP and atomic Neon counters near launch ceilings, isolated from all class data and senders.
import test, {after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../../server/gsb/db.js';
import {createGsbHandler} from '../../server/gsb/router.js';
import {hash} from '../../server/gsb/auth.js';
import {startDevServer} from '../../server/dev.js';

if (process.env.VERCEL || process.env.NODE_ENV !== 'test' || process.env.GSB_TEST_SCHEMA !== 'gsb_test_launch_api')
  throw new Error('Launch tests require the isolated gsb_test_launch_api schema.');

const db = database(), links = new Map(), ip = '203.0.113.45';
const ipHash = hash(ip).slice(0,24);
const cards = Array.from({length: 12}, (_, i) => ({id: `fixture-${i}`, answer: `Student ${i}`, image: `/api/media/asset-${i}`}));
const server = await startDevServer({port: 0, quiet: true, handler: createGsbHandler({
  db, latestDeck: async () => ({id: 'launch-synthetic', cards}),
  send: async (email, url) => { links.set(email, url); },
})});
const origin = `http://localhost:${server.port}`;
Object.assign(process.env, {APP_ORIGIN: origin, CLASSMATES_LOGIN_EMAILS_PER_DAY: '900',
  GSB_GUEST_PREVIEW: 'true', GSB_GUEST_PERSON_IDS: cards.slice(0,10).map(c => c.id).join(',')});
after(() => server.close());
beforeEach(async () => { await db.query('delete from limits'); links.clear(); });

/** Requests all share one simulated campus address unless the test explicitly overrides it. */
async function request(path, body = {}, cookie = '', client = ip) {
  const response = await fetch(origin + '/api/' + path, {method: 'POST',
    headers: {Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': client, Cookie: cookie},
    body: JSON.stringify(body)});
  return {status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] ?? ''};
}

async function seed(key, count) {
  await db.query('insert into limits(key,count,window_start) values($1,$2,now()) on conflict(key) do update set count=excluded.count,window_start=excluded.window_start', [`gsb:${key}`, count]);
}
const tokenFrom = url => new URLSearchParams(new URL(url).hash.slice(1)).get('token');

test('concurrent sends stop at 900 across IPs; previously sent links can still establish sessions', async () => {
  await seed('email-day', 895);
  await seed(`email-ip:${ipHash}`, 445);
  const responses = await Promise.all(Array.from({length: 10}, () =>
    request('auth/request', {email: `launch-${randomUUID()}@stanford.edu`})));
  assert.equal(responses.filter(r => r.status === 200).length, 5);
  assert.equal(responses.filter(r => r.status === 429 && /daily limit/.test(r.data.error)).length, 5);
  assert.equal(links.size, 5);
  assert.equal((await request('auth/request', {email: `other-${randomUUID()}@stanford.edu`}, '', '203.0.113.46')).status, 429);
  await seed(`verify:${ipHash}`, 1799);
  const verified = await request('auth/verify', {token: tokenFrom(links.values().next().value)});
  assert.equal(verified.status, 200);
  assert.equal(verified.data.account.access, 'email');
  assert.ok(verified.cookie);
  assert.equal((await request('auth/verify', {token: 'invalid'})).status, 429);
});

test('recipient throttling does not spend shared capacity, and window expiry restores sends', async () => {
  const email = `repeat-${randomUUID()}@stanford.edu`;
  for (let i = 0; i < 3; i++) assert.equal((await request('auth/request', {email})).status, 200);
  const repeats = await Promise.all(Array.from({length: 6}, () => request('auth/request', {email: email.toUpperCase()})));
  assert.ok(repeats.every(r => r.status === 429));
  assert.equal(Number((await db.query('select count from limits where key=$1', ['gsb:email-day']))[0].count), 3);
  assert.equal(Number((await db.query('select count from limits where key=$1', [`gsb:email-ip:${ipHash}`]))[0].count), 3);
  await seed('email-day', 900);
  await db.query("update limits set window_start=now()-interval '24 hours' where key=$1", ['gsb:email-day']);
  assert.equal((await request('auth/request', {email: `next-${randomUUID()}@stanford.edu`})).status, 200);
  assert.equal(Number((await db.query('select count from limits where key=$1', ['gsb:email-day']))[0].count), 1);
});

test('a guest can resume and save after new-trial ceilings are reached; no extra trial or private deck is granted', async () => {
  await seed('guest-start-day', 1999);
  await seed(`guest-start:${ipHash}`, 999);
  const started = await request('guest/start');
  assert.equal(started.status, 200);
  assert.equal(started.data.count, 10);
  assert.equal((await request('guest/start')).status, 429);
  assert.equal((await request('guest/start', {}, '', '203.0.113.46')).status, 429);
  const resumed = await request('guest/start', {}, started.cookie);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.id, started.data.id);
  await seed(`guest-finish:${ipHash}`, 2998);
  const body = {answers: started.data.questions.map(q => ({questionId: q.id, choice: q.correctChoice, elapsedMs: 250}))};
  const finished = await request('guest/finish', body, started.cookie);
  assert.equal(finished.status, 200);
  assert.equal(finished.data.correct, 10);
  const retry = await request('guest/finish', body, started.cookie);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data, finished.data);
  assert.equal((await request('guest/finish', body, started.cookie)).status, 429);
  assert.equal((await request('guest/start', {}, started.cookie)).data.status, 'complete');
  assert.equal((await fetch(origin + '/api/deck', {headers: {Cookie: started.cookie}})).status, 401);
});

test('a player can create an eleventh quick duel, while the new account-level ceiling still applies', async () => {
  const email = `duelist-${randomUUID()}@stanford.edu`;
  assert.equal((await request('auth/request', {email})).status, 200);
  const verified = await request('auth/verify', {token: tokenFrom(links.get(email))});
  assert.equal(verified.status, 200);
  assert.equal((await request('profile', {nickname: 'Launch duelist'}, verified.cookie)).status, 200);
  const key = `challenge-create:${verified.data.account.id}`;
  await seed(key, 10);
  const settings = {mode: 'duel', direction: 'face', length: 'quick', choices: 2};
  assert.equal((await request('sprint/challenge', settings, verified.cookie)).status, 201);
  await seed(key, 120);
  assert.equal((await request('sprint/challenge', settings, verified.cookie)).status, 429);
});
