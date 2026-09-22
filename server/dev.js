// The development server: `npm run dev`, or `node server/dev.js 4000`.
//
// It serves public/ as it is (no build step, no bundler, the same files the browser gets
// in production) and hands /api/* to the very same handler Vercel runs, so a request that
// works here works there. Static paths that do not exist fall back to index.html, which
// is how /r/ABCD reaches the client router. Everything is no-store: in development,
// seeing yesterday's file is never what you wanted.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import api from '../api/index.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/** The types the client actually serves. Anything else downloads as bytes. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};



/**
 * Start the server. Port 0 asks the operating system for a free one, which is how the
 * tests and Playwright run several servers at once without agreeing on numbers.
 * @param {{ port?: number, host?: string, quiet?: boolean, handler?: (req:any,res:any)=>Promise<void> }} [options]
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export function startDevServer(options = {}) {
  const quiet = options.quiet ?? process.env.QUIET === '1';
  const server = createServer((req, res) => {
    const started = Date.now();
    if (!quiet) {
      res.on('finish', () => {
        console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      });
    }
    handle(req, res, options.handler).catch((err) => {
      console.error('[parlor] dev server error', err);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end('Something went wrong in the dev server.');
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        port,
        close: () => new Promise((done) => {
          // Keep-alive sockets would otherwise hold the process open after a test ends.
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

async function handle(req, res, handler = api) {
  const url = new URL(req.url || '/', 'http://localhost');

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    // Vercel fills these in; the dev server must not pretend to have parsed a body.
    req.query = {};
    await handler(req, res);
    return;
  }
  // Classmates' shared links get their preview tags from the function, the way vercel.json rewrites them.
  const invite = process.env.APP_PROFILE === 'gsb' && url.pathname.match(/^\/(speed|r)\/([a-z]{4})$/i);
  if (invite) {
    req.url = `/api/index?shell=${invite[1] === 'r' ? 'room' : 'speed'}&code=${invite[2].toUpperCase()}`;
    req.query = {};
    await handler(req, res);
    return;
  }

  await serveStatic(res, decodePath(url.pathname));
}

async function serveStatic(res, pathname) {
  const file = resolveFile(pathname);
  if (file) {
    const body = await readFile(file).catch(() => null);
    if (body) return send(res, 200, MIME[extname(file)] || 'application/octet-stream', body);
  }

  // A path with no file extension is a client route, so hand back the app shell.
  if (!extname(pathname)) {
    const shell = await readFile(join(PUBLIC_DIR, process.env.APP_PROFILE==='gsb'?'gsb/index.html':'index.html')).catch(() => null);
    if (shell) return send(res, 200, MIME['.html'], shell);
  }

  return send(res, 404, MIME['.txt'], 'Not found.');
}

/** @returns {string | null} an absolute path inside public/, or null when it escapes. */
function resolveFile(pathname) {
  const relative = normalize(pathname).replace(/^([/\\])+/, '');
  if (relative.split(/[/\\]/).includes('..')) return null;
  const file = join(PUBLIC_DIR, relative === '' || relative === 'index.html' ? (process.env.APP_PROFILE==='gsb'?'gsb/index.html':'index.html') : relative);
  if (!file.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) return null;
  return file;
}

function send(res, status, type, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(Buffer.byteLength(body)));
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function decodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

// `node server/dev.js [port]`, but not when a test imports startDevServer.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] || process.env.PORT || 3000);
  startDevServer({ port }).then(({ port: bound }) => {
    console.log(`Parlor is running at http://localhost:${bound}`);
  }).catch((err) => {
    console.error('[parlor] could not start the dev server', err);
    process.exit(1);
  });
}
