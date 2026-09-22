// Exercise the real router with Vercel-shaped requests, synthetic persistence and no outbound email.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../../server/store/memory.js';
import { createGsbHandler } from '../../server/gsb/router.js';
import { hash } from '../../server/gsb/auth.js';
import { loginEmailDailyLimit } from '../../server/gsb/launch-limits.js';

const origin = 'https://classmates.example';
const cards = Array.from({length: 10}, (_, i) => ({id: `fixture-${i}`, answer: `Student ${i}`, image: `/api/media/asset-${i}`}));

/** Restore environment even when an assertion fails. */
function environment(t, values = {}) {
  const settings = {APP_ORIGIN: origin, CLASSMATES_EMAIL_DOMAINS: 'stanford.edu', CLASSMATES_LOGIN_EMAILS_PER_DAY: '900',
    GSB_GUEST_PREVIEW: 'true', GSB_GUEST_PERSON_IDS: cards.map(c => c.id).join(','), ...values};
  const old = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}

/** Minimal persistence adapter: only issuance writes are allowed in this router-level test. */
function harness({send = async () => {}} = {}) {
  const store = createMemoryStore(), sent = [], writes = [];
  const handler = createGsbHandler({
    db: {store, query: async (sql) => {
      assert.match(sql, /^(insert into gsb_links|delete from gsb_links|insert into gsb_guest_runs)/);
      writes.push(sql); return [];
    }},
    latestDeck: async () => ({id: 'synthetic', cards}),
    send: async (email, url) => { sent.push(email); await send(); },
  });
  const request = async (path, body = {}, ip = '203.0.113.1', method = 'POST') => {
    const req = {url: `/api/${path}`, method, body,
      headers: {origin, 'content-type': 'application/json', 'x-forwarded-for': ip}};
    /** @type {any} */
    let data;
    const res = {statusCode: 0, setHeader() {}, end(text) { data = JSON.parse(text); }};
    await handler(req, res);
    return {status: res.statusCode, data};
  };
  return {request, store, sent, writes};
}

test('email budget defaults to 900 and invalid operator configuration fails closed', () => {
  assert.equal(loginEmailDailyLimit({}), 900);
  assert.equal(loginEmailDailyLimit({CLASSMATES_LOGIN_EMAILS_PER_DAY: '80'}), 80);
  for (const raw of ['', '0', '-1', '900.5', 'Infinity', 'NaN', ' 900', '1e3', '9007199254740992'])
    assert.throws(() => loginEmailDailyLimit({CLASSMATES_LOGIN_EMAILS_PER_DAY: raw}), /not configured correctly/);
});

test('450 classmates on one IP can each request a link and a resend; request 901 cannot send', async t => {
  environment(t);
  const {request, sent} = harness();
  for (let round = 0; round < 2; round++) {
    const results = await Promise.all(Array.from({length: 450}, (_, i) =>
      request('auth/request', {email: `classmate-${i}@stanford.edu`})));
    assert.ok(results.every(r => r.status === 200));
  }
  assert.equal(sent.length, 900);
  const rejected = await request('auth/request', {email: 'another@stanford.edu'}, '203.0.113.2');
  assert.equal(rejected.status, 429);
  assert.match(rejected.data.error, /daily limit/);
  assert.equal(sent.length, 900);
  assert.equal((await request('session', {}, undefined, 'GET')).status, 200);
});

test('repeated requests to one recipient do not exhaust the shared IP or global allowance', async t => {
  environment(t);
  const {request, sent, store} = harness();
  for (let i = 0; i < 3; i++) assert.equal((await request('auth/request', {email: ' REPEAT@stanford.edu '})).status, 200);
  const results = await Promise.all(Array.from({length: 100}, () => request('auth/request', {email: 'repeat@stanford.edu'})));
  assert.ok(results.every(r => r.status === 429 && /15 minutes/.test(r.data.error)));
  assert.equal(sent.length, 3);
  assert.equal((await store.bumpLimit(`gsb:email-ip:${hash('203.0.113.1').slice(0,24)}`, 900000, 1800)).count, 4);
  assert.equal((await store.bumpLimit('gsb:email-day', 86400000, 900)).count, 4);
  assert.equal((await request('auth/request', {email: 'next@stanford.edu'})).status, 200);
});

test('450 shared-IP guest starts, finish attempts and email verifications reach their own authorization checks', async t => {
  environment(t);
  const {request} = harness();
  const starts = await Promise.all(Array.from({length: 450}, () => request('guest/start')));
  assert.ok(starts.every(r => r.status === 200 && r.data.count === 10 && r.data.questions.every(q => q.choices.length === 2)));
  const finishes = await Promise.all(Array.from({length: 450}, () => request('guest/finish')));
  assert.ok(finishes.every(r => r.status === 401 && r.data.code === 'guest_cookie'));
  const confirmations = await Promise.all(Array.from({length: 450}, () => request('auth/verify', {token: 'invalid'})));
  assert.ok(confirmations.every(r => r.status === 400 && r.data.code === 'link'));
  assert.equal((await request('deck', {}, undefined, 'GET')).status, 401);
});

test('guest network and global ceilings remain enforced after admitting a whole class', async t => {
  environment(t);
  const {request} = harness();
  for (const ip of ['203.0.113.1', '203.0.113.2']) {
    const starts = await Promise.all(Array.from({length: 1000}, () => request('guest/start', {}, ip)));
    assert.ok(starts.every(r => r.status === 200));
  }
  assert.equal((await request('guest/start')).status, 429);
  const exhausted = await request('guest/start', {}, '203.0.113.3');
  assert.equal(exhausted.status, 429);
  assert.match(exhausted.data.error, /daily limit/);
});

test('failed sends count conservatively, while a fresh 24-hour window restores capacity', async t => {
  environment(t, {CLASSMATES_LOGIN_EMAILS_PER_DAY: '3'});
  let now = 1000000, fail = true;
  t.mock.method(Date, 'now', () => now);
  const {request, sent} = harness({send: async () => { if (fail) throw new Error('synthetic sender outage'); }});
  assert.equal((await request('auth/request', {email: 'first@stanford.edu'})).status, 500);
  fail = false;
  for (let i = 0; i < 2; i++) assert.equal((await request('auth/request', {email: `next-${i}@stanford.edu`})).status, 200);
  assert.equal((await request('auth/request', {email: 'fourth@stanford.edu'})).status, 429);
  assert.equal(sent.length, 3);
  now += 86400000;
  assert.equal((await request('auth/request', {email: 'tomorrow@stanford.edu'})).status, 200);
});

test('unavailable counters cannot bypass the email budget', async t => {
  environment(t);
  const {request, store, sent} = harness();
  t.mock.method(store, 'bumpLimit', async () => { throw new Error('synthetic store outage'); });
  assert.equal((await request('auth/request', {email: 'classmate@stanford.edu'})).status, 500);
  assert.equal(sent.length, 0);
});
