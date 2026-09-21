// Request and response plumbing that works the same in both places the router runs:
// Vercel's Node runtime and server/dev.js. It touches only the parts of the Node
// request and response that both share (statusCode, setHeader, end, the body stream),
// never Vercel's res.status().json() helpers, so one handler can serve both.

import { KitError, PlatformError } from '../public/shared/errors.js';

/**
 * Vercel pre-parses the body and the rewrite's captured params onto the request; the
 * dev server does not. Both shapes are handled here.
 * @typedef {import('node:http').IncomingMessage & { body?: unknown, query?: Record<string, any> }} ApiRequest
 * @typedef {import('node:http').ServerResponse} ApiResponse
 */

const DEFAULT_MAX_BYTES = 262144;

/**
 * Write a JSON response. Always JSON, always with a Cache-Control, because a missing
 * one on Vercel means a CDN somewhere gets to decide.
 * @param {ApiResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {{ cache?: string }} [options]
 */
export function sendJson(res, status, body, options = {}) {
  const text = JSON.stringify(body === undefined ? null : body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(Buffer.byteLength(text)));
  res.setHeader('Cache-Control', options.cache || 'no-store');
  res.end(text);
}

/**
 * Read a JSON object from the request, whatever shape the platform left it in.
 * An empty body reads as `{}` so endpoints with only optional fields still work.
 * @param {ApiRequest} req
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<Record<string, any>>}
 */
export async function readJsonBody(req, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const pre = req.body;

  if (pre !== undefined && pre !== null && pre !== '') {
    if (typeof pre === 'string') return parseJson(pre, maxBytes);
    if (Buffer.isBuffer(pre)) return parseJson(pre.toString('utf8'), maxBytes);
    if (typeof pre === 'object') return parseJson(JSON.stringify(pre), maxBytes);
    throw badShape();
  }

  if (typeof req[Symbol.asyncIterator] !== 'function') return {};

  let size = 0;
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw tooLarge();
    chunks.push(buf);
  }
  if (!size) return {};
  return parseJson(Buffer.concat(chunks).toString('utf8'), maxBytes);
}

/**
 * The address to rate limit by. Behind Vercel the socket is the proxy, so the first
 * hop of x-forwarded-for is the closest thing to the player's address.
 * @param {ApiRequest} req
 * @returns {string}
 */
export function clientIp(req) {
  const raw = req.headers['x-forwarded-for'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value) {
    const first = String(value).split(',')[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Work out which endpoint was asked for, under both routing shapes.
 * `segments` has the leading 'api' removed: /api/rooms/ABCD/v gives
 * ['rooms', 'ABCD', 'v'].
 * @param {ApiRequest} req
 * @returns {{ path: string, segments: string[], query: Record<string, string> }}
 */
export function parsePath(req) {
  const url = new URL(String(req.url || '/'), 'http://parlor.invalid');

  /** @type {Record<string, string>} */
  const query = {};
  for (const [key, value] of url.searchParams) {
    if (query[key] === undefined) query[key] = value;
  }
  if (req.query && typeof req.query === 'object') {
    for (const [key, value] of Object.entries(req.query)) {
      if (query[key] === undefined) query[key] = Array.isArray(value) ? value.join('/') : String(value);
    }
  }

  let path = url.pathname;
  // vercel.json rewrites /api/:route* to the single function. The original path usually
  // survives on req.url, but when it does not, the captured route param is all we have.
  if (path === '/api' || path === '/api/' || path === '/api/index' || !path.startsWith('/api/')) {
    const route = routeParam(req, url.searchParams);
    if (route) path = `/api/${route}`;
  }

  const segments = path
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => safeDecode(part));

  return { path, segments, query };
}

/**
 * Turn any thrown thing into the response the player sees. Kit and platform errors
 * carry their own words; everything else is a bug, so it gets logged here and the
 * player gets one plain sentence rather than a stack trace.
 * @param {unknown} err
 * @returns {{ status: number, body: { error: string, code: string } }}
 */
export function errorBody(err) {
  const known = /** @type {KitError | PlatformError} */ (err);
  if (known instanceof KitError || known instanceof PlatformError) {
    return { status: known.status, body: { error: String(known.message), code: known.code } };
  }
  console.error('[parlor] unhandled error', err);
  return { status: 500, body: { error: 'Something went wrong on our side. Try again.', code: 'internal' } };
}

/** @returns {Record<string, any>} */
function parseJson(text, maxBytes) {
  if (Buffer.byteLength(text) > maxBytes) throw tooLarge();
  if (!text.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PlatformError(400, 'bad_json', 'That request was not valid JSON.');
  }
  return asObject(parsed);
}

/** @returns {Record<string, any>} */
function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badShape();
  return /** @type {Record<string, any>} */ (value);
}

function badShape() {
  return new PlatformError(400, 'bad_body', 'That request should send a JSON object.');
}

function tooLarge() {
  return new PlatformError(413, 'too_large', 'That request is too big. Send a little less and try again.');
}

/** The rewrite may hand back one joined value or one value per path segment. */
function routeParam(req, searchParams) {
  const fromQuery = req.query && typeof req.query === 'object' ? req.query.route : undefined;
  const value = fromQuery === undefined ? searchParams.getAll('route') : fromQuery;
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .map(String)
    .join('/')
    .replace(/^\/+|\/+$/g, '');
}

/** A malformed escape should read as a missing room, not crash the request. */
function safeDecode(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
