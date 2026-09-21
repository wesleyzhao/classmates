// The request and response plumbing, tested in both shapes it has to survive: the raw
// stream from server/dev.js and the pre-parsed body and rewritten path from Vercel.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { KitError, PlatformError } from '../../public/shared/errors.js';
import { clientIp, errorBody, parsePath, readJsonBody, sendJson } from '../../server/http.js';
import { fakeReq, fakeRes } from '../lib/http.js';

describe('readJsonBody', () => {
  test('reads a body that arrived as a stream', async () => {
    const req = fakeReq({ method: 'POST', body: '{"name":"Wes"}' });
    assert.deepEqual(await readJsonBody(req), { name: 'Wes' });
  });

  test('reads a body Vercel already parsed', async () => {
    const req = fakeReq({ method: 'POST', body: { name: 'Wes' } });
    assert.deepEqual(await readJsonBody(req), { name: 'Wes' });
  });

  test('reads a body Vercel left as a string', async () => {
    const req = fakeReq({ method: 'POST', body: '{"name":"Wes"}', preParsed: true });
    assert.deepEqual(await readJsonBody(req), { name: 'Wes' });
  });

  test('reads a body Vercel left as a buffer', async () => {
    const req = fakeReq({ method: 'POST', body: Buffer.from('{"name":"Wes"}'), preParsed: true });
    assert.deepEqual(await readJsonBody(req), { name: 'Wes' });
  });

  test('an empty body is an empty object', async () => {
    assert.deepEqual(await readJsonBody(fakeReq({ method: 'POST' })), {});
  });

  test('nonsense is a 400, not a crash', async () => {
    const req = fakeReq({ method: 'POST', body: '{oh no' });
    await assert.rejects(() => readJsonBody(req), (/** @type {any} */ err) => {
      assert.ok(err instanceof PlatformError);
      assert.equal(err.status, 400);
      assert.equal(err.code, 'bad_json');
      return true;
    });
  });

  test('a body that is not an object is a 400', async () => {
    await assert.rejects(() => readJsonBody(fakeReq({ method: 'POST', body: '[1,2,3]' })), (/** @type {any} */ err) => {
      assert.equal(err.code, 'bad_body');
      return true;
    });
    await assert.rejects(() => readJsonBody(fakeReq({ method: 'POST', body: [1, 2, 3] })), (/** @type {any} */ err) => {
      assert.equal(err.code, 'bad_body');
      return true;
    });
  });

  test('a body over the cap is a 413, and the cap is honoured mid-stream', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(600) });
    const stream = Readable.from([big.slice(0, 300), big.slice(300)]);
    await assert.rejects(() => readJsonBody(fakeReq({ method: 'POST', body: stream }), { maxBytes: 400 }), (/** @type {any} */ err) => {
      assert.equal(err.status, 413);
      assert.equal(err.code, 'too_large');
      return true;
    });
  });

  test('a pre-parsed body over the cap is a 413 as well', async () => {
    const req = fakeReq({ method: 'POST', body: JSON.stringify({ text: 'x'.repeat(600) }), preParsed: true });
    await assert.rejects(() => readJsonBody(req, { maxBytes: 400 }), (/** @type {any} */ err) => {
      assert.equal(err.status, 413);
      return true;
    });
  });
});

describe('parsePath', () => {
  test('reads the path the dev server sends', () => {
    const { path, segments, query } = parsePath(fakeReq({ url: '/api/rooms/ABCD/v?x=1', query: {} }));
    assert.equal(path, '/api/rooms/ABCD/v');
    assert.deepEqual(segments, ['rooms', 'ABCD', 'v']);
    assert.equal(query.x, '1');
  });

  test('rebuilds the path from the rewrite when only the route param survives', () => {
    const { path, segments, query } = parsePath(fakeReq({
      url: '/api/index?route=rooms/ABCD/v&x=1',
      query: { route: 'rooms/ABCD/v', x: '1' },
    }));
    assert.equal(path, '/api/rooms/ABCD/v');
    assert.deepEqual(segments, ['rooms', 'ABCD', 'v']);
    assert.equal(query.x, '1');
  });

  test('handles a route param that arrives one segment at a time', () => {
    const { segments } = parsePath(fakeReq({
      url: '/api/index?route=rooms&route=ABCD&route=v',
      query: { route: ['rooms', 'ABCD', 'v'] },
    }));
    assert.deepEqual(segments, ['rooms', 'ABCD', 'v']);
  });

  test('a bare /api is no endpoint at all', () => {
    assert.deepEqual(parsePath(fakeReq({ url: '/api' })).segments, []);
    assert.deepEqual(parsePath(fakeReq({ url: '/api/' })).segments, []);
  });
});

describe('clientIp', () => {
  test('takes the first hop of x-forwarded-for', () => {
    const req = fakeReq({ headers: { 'X-Forwarded-For': '203.0.113.4, 70.41.3.18' } });
    assert.equal(clientIp(req), '203.0.113.4');
  });

  test('falls back to the socket', () => {
    assert.equal(clientIp(fakeReq({ ip: '192.0.2.9' })), '192.0.2.9');
  });
});

describe('errorBody', () => {
  test('a kit error keeps its words and its code', () => {
    const { status, body } = errorBody(new KitError('not_your_turn', 'It is not your turn yet.'));
    assert.equal(status, 400);
    assert.deepEqual(body, { error: 'It is not your turn yet.', code: 'not_your_turn' });
  });

  test('a platform error keeps its status', () => {
    const { status, body } = errorBody(new PlatformError(404, 'not_found', 'No room with that code.'));
    assert.equal(status, 404);
    assert.deepEqual(body, { error: 'No room with that code.', code: 'not_found' });
  });

  test('anything else is a 500 that gives nothing away', (t) => {
    t.mock.method(console, 'error', () => {});
    const { status, body } = errorBody(new TypeError('cannot read properties of undefined'));
    assert.equal(status, 500);
    assert.deepEqual(body, { error: 'Something went wrong on our side. Try again.', code: 'internal' });
    assert.equal(JSON.stringify(body).includes('undefined'), false);
  });
});

describe('sendJson', () => {
  test('always says it is JSON and always says how to cache it', () => {
    const res = fakeRes();
    sendJson(/** @type {any} */ (res), 201, { ok: true });
    assert.equal(res.statusCode, 201);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(res.json, { ok: true });
  });

  test('takes a cache header when the endpoint wants one', () => {
    const res = fakeRes();
    sendJson(/** @type {any} */ (res), 200, { v: 3 }, { cache: 'public, s-maxage=1' });
    assert.equal(res.headers['cache-control'], 'public, s-maxage=1');
  });
});
