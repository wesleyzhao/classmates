// The dev server, started the way tests and Playwright start it: in this process, on a
// port the operating system picks. What matters is that static files, the client-side
// routes, and the API all come from the one server, and that closing it really closes.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer } from '../../server/dev.js';

process.env.STORE = 'memory';

describe('dev server', () => {
  test('serves files, client routes, and the api', async () => {
    const server = await startDevServer({ port: 0, quiet: true });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      assert.ok(server.port > 0, 'the operating system handed out a port');

      const file = await fetch(`${base}/index.html`);
      assert.equal(file.status, 200);
      assert.match(file.headers.get('content-type') || '', /text\/html/);
      assert.equal(file.headers.get('cache-control'), 'no-store');
      assert.match(await file.text(), /<div id="app">/);

      // A path with no extension is a client route, so the shell comes back instead.
      const route = await fetch(`${base}/r/ABCD`);
      assert.equal(route.status, 200);
      assert.match(route.headers.get('content-type') || '', /text\/html/);
      assert.match(await route.text(), /<div id="app">/);

      const missing = await fetch(`${base}/nothing.css`);
      assert.equal(missing.status, 404);

      const health = await fetch(`${base}/api/health`);
      assert.equal(health.status, 200);
      const body = await health.json();
      assert.equal(body.ok, true);
      assert.equal(body.store.name, 'memory');

      const unknown = await fetch(`${base}/api/nothing`);
      assert.equal(unknown.status, 404);
      assert.equal((await unknown.json()).code, 'not_found');
    } finally {
      await server.close();
    }

    await assert.rejects(() => fetch(`${base}/api/health`), 'the port is free again');
  });
});
