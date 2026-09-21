// Fake request and response objects for testing the router without a socket.
//
// The point is to be able to play both shapes the handler has to survive: the raw
// stream a Node server delivers, and the pre-parsed body and query Vercel attaches.
// Anything the handler touches (statusCode, setHeader, end) is captured here.

import { Readable } from 'node:stream';

/**
 * @typedef {{ statusCode: number, headers: Record<string, string>, body: string,
 *   json: any, writableEnded: boolean, setHeader(name: string, value: any): void,
 *   getHeader(name: string): string | undefined, end(chunk?: any): void }} FakeRes
 */

/**
 * Build a request. A plain object body arrives pre-parsed (the Vercel shape); a string,
 * a Buffer, or a stream arrives as a body to read (the Node shape). Pass `preParsed`
 * to attach a string or a Buffer as req.body instead, which Vercel also does.
 * @param {{ method?: string, url?: string, headers?: Record<string, string>,
 *   body?: any, query?: Record<string, any>, preParsed?: boolean, ip?: string }} [options]
 */
export function fakeReq(options = {}) {
  const { method = 'GET', url = '/', headers = {}, body, query, preParsed = false, ip } = options;

  const lower = /** @type {Record<string, string>} */ ({});
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;

  const streamed = !preParsed && (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Readable);
  const req = /** @type {any} */ (
    streamed && body instanceof Readable ? body : Readable.from(streamed ? [body] : [])
  );

  req.method = method;
  req.url = url;
  req.headers = lower;
  req.socket = { remoteAddress: ip || '127.0.0.1' };
  if (query) req.query = query;
  if (body !== undefined && !streamed) req.body = body;
  return req;
}

/**
 * Build a response that remembers everything written to it.
 * @returns {FakeRes}
 */
export function fakeRes() {
  /** @type {Record<string, string>} */
  const headers = {};
  const res = /** @type {FakeRes} */ ({
    statusCode: 200,
    headers,
    body: '',
    json: null,
    writableEnded: false,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = String(value);
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) res.body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      res.writableEnded = true;
      try {
        res.json = res.body ? JSON.parse(res.body) : null;
      } catch {
        res.json = null;
      }
    },
  });
  return res;
}

/**
 * Send one request through a handler and get the finished response back.
 * @param {(req: any, res: any) => Promise<void> | void} handler
 * @param {Parameters<typeof fakeReq>[0]} [options]
 * @returns {Promise<FakeRes>}
 */
export async function call(handler, options = {}) {
  const res = fakeRes();
  await handler(fakeReq(options), res);
  return res;
}
