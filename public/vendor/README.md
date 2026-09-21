# Vendored libraries

These files are copied from npm so the site needs no build step and no CDN.
Update by copying the new `dist/*.module.js` files here and bumping the versions below.

| File | Package | Version | Notes |
|---|---|---|---|
| `preact.mjs` | preact | 10.29.8 | `dist/preact.module.js`, unchanged |
| `preact-hooks.mjs` | preact/hooks | 10.29.8 | `hooks/dist/hooks.module.js` with `from "preact"` rewritten to `./preact.mjs` |
| `htm.mjs` | htm | 3.1.1 | `dist/htm.module.js`, unchanged |

Licenses: `LICENSE-preact.txt`, `LICENSE-htm.txt` (both MIT).
Application code never imports these directly; it imports `public/app/h.js`.
