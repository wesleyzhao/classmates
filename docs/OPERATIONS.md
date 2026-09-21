# Operations

Running Parlor: local development, deploying, the database, quotas, and what to do when something is stuck.

## Local

```
npm install
npm run dev              # http://localhost:3000 with an in-memory store shared by every tab
npm test                 # everything but browsers
npm run check            # type-check the JavaScript
npm run test:e2e         # Playwright, real browsers against the dev server
npm run doctor           # environment and database check
```

To develop against the real database, pull the environment once (`npx vercel env pull .env.local`) and run with it: `node --env-file=.env.local server/dev.js`. Never commit `.env.local`.

## Deploying

The project is `parlor` in the Vercel team `wesleyzhaos-projects`, linked from this folder (`.vercel/project.json`, not committed). Production is https://parlor-virid.vercel.app (also https://parlor-wesleyzhaos-projects.vercel.app).

```
npx vercel               # a preview deployment
npx vercel --prod        # production
```

There is no build step: `public/` is served as static files and `api/index.js` is the one function (`vercel.json` rewrites `/api/*` to it and every other path to `public/index.html`). Pushing to `main` on GitHub deploys production once the repository is connected (`npx vercel git connect`). After a production deploy, run the smoke test: `node scripts/smoke.js https://parlor-virid.vercel.app` plays a round through the API.

Deployment protection is off for this project so friends can open preview links without a Vercel login.

## The database

Neon Postgres, provisioned through the Vercel Marketplace as the resource `parlor-db` and connected to all three environments (`DATABASE_URL` and friends arrive automatically). Tables are created on first use by `server/store/neon.js`; there are no migrations to run. `npm run doctor` writes and reads a throwaway room to prove the connection.

Free-plan limits per project (verified September 2026): 0.5 GB storage, 100 compute-hours a month, 5 GB of data transfer out a month, compute suspends after five idle minutes. Parlor keeps within them by polling a version number (no document bytes) and by keeping room documents small. If a limit is exceeded, Neon suspends the project's compute until the next month; the app then answers every room request with a 503 and the message that the game store is not responding. Options in that case: upgrade the Neon plan, or attach a different store (`server/store/` takes a new backend; `STORE=` selects it).

Two guard rails worth setting once in the Neon console: cap the compute size at 0.25 or 0.5 CU (so a runaway loop cannot burn the month in days) and keep scale-to-zero on.

The first request after five idle minutes takes a few hundred milliseconds longer while the compute wakes. The home page sends a warm-up request as soon as it loads, so by the time someone has typed a name the database is awake.

## Quotas on Vercel (Hobby)

1,000,000 function invocations a month, 100 GB of transfer, one WAF rate-limit rule. A four-player twenty-minute game costs about 2,000 invocations. The rule to set once in the dashboard: rate-limit `/api/*` at about 600 requests a minute per IP.

## Rooms

A room lives for 30 days after its last write and is then swept the next time someone creates a room. Stuck rooms fix themselves: if the host leaves the page mid-game, any player can take over after twenty seconds, and after a minute of silence when the game is waiting on the host; if a player disappears on their turn, the host can skip them after half a minute (anyone after ninety seconds); every action is applied once even if the phone retried it.

## When something is wrong

- **"Can't reach the room" on every phone**: check `GET /api/health` (it reports which store is configured without touching it) and `npm run doctor` locally with the pulled environment.
- **A game froze after an update**: rooms started on an older kit version freeze to the results screen and say so; "Play again" starts fresh.
- **Cold starts feel long**: confirm the home page warm-up request is being sent (network tab), and that the Neon compute is not suspended for quota.
- **Rate limited**: per-player limits are 60 actions and 20 chat lines a minute; per-address limits are 20 room creates, 60 joins, and 10 game or deck creates an hour.
