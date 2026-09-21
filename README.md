# Classmates, built with Parlor

Learn faces and names through fast solo rounds and multiplayer games on mobile and desktop browsers.

[Play Classmates](https://gsb-classmates.vercel.app) · [Fork and deploy your own](docs/gsb/FORKING.md) · [Agent guide](AGENTS.md)

Make and play small multiplayer games with the included Parlor engine. This repository contains two applications that share pure game rules and small UI primitives:

| Profile | What it does | Content access |
| --- | --- | --- |
| **Parlor** (default) | Make quizzes, races, board and card games; share rooms and chat. | Catalogs and decks are public. |
| **Classmates** (`APP_PROFILE=gsb`) | Learn faces and names through Practice, Speed rounds, simultaneous quizzes and races. Includes email login, nicknames, spaced repetition, face history and rankings. | The full roster requires a session. An optional ten-face guest sample introduces the game. Each deployment owns its roster and accounts. |

Classmates is a separate Vercel project, not a second public deck in Parlor. Its original Stanford design is included; no real roster, portraits, accounts or credentials are included. See [the fork and deployment guide](docs/gsb/FORKING.md) to use your own people and email domains.

## Run Parlor locally

Use Node.js 22:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000` in two tabs. Local Parlor uses an in-memory store and needs no cloud account. A restart clears its rooms. To deploy, link **your own** Vercel project, provision a Neon database, set `DATABASE_URL`, and deploy with the checked-in `vercel.json`. See [operations](docs/OPERATIONS.md).

## Make a game

```bash
npm run new-game -- --kit quiz --slug my-quiz --title "My quiz"
npm run new-deck -- --id my-deck
npm test
```

A game combines a mechanic (a kit), reusable content (decks), settings and a look. A new mechanic implements a small pure-function contract. The [recognition kit](public/kits/recognition/README.md) supports image/name matching and exposes reusable question, novelty-selection and sprint-scoring helpers.

Start with [make a game](docs/HOW-TO-MAKE-A-GAME.md), [make a kit](docs/HOW-TO-MAKE-A-KIT.md), or [AGENTS.md](AGENTS.md) for coding agents. Frontend designers should read [the Classmates integration guide](docs/gsb/FRONTEND-INTEGRATION.md).

## Engineering and checks

Browser code uses vendored Preact and htm with native ES modules. The build copies the selected app profile and updates its link metadata; there is no browser bundler. The two runtime dependencies, Neon and Vercel Blob, run on the server. Room rules are authoritative, deterministic and committed with compare-and-set. Solo Speed answers advance locally without waiting for a request; completed scores are validated on the server. [Architecture](docs/ARCHITECTURE.md) and [contributing](CONTRIBUTING.md) explain the boundaries.

```bash
npm test
npm run check
npm run security:check
npm run security:check -- --history
npm run build
APP_PROFILE=gsb npm run build
npx playwright install chromium webkit
npm run test:e2e
BROWSER=webkit npm run test:e2e
```

Classmates database/browser tests use synthetic people in isolated test schemas. Setup and exact commands are in the [fork guide](docs/gsb/FORKING.md). Do not supply production credentials to untrusted pull-request workflows. Free service plans are a starting point, not an unlimited hosting guarantee; check current provider allowances for your use.

## License and privacy

Original code is [MIT](LICENSE); vendored libraries and fonts retain their own [notices](THIRD_PARTY.md). This code license grants no rights to someone else's directory or likenesses. Import only content you may use, keep it outside Git, and support removal requests. Read [SECURITY.md](SECURITY.md) and the [public release checklist](docs/gsb/PUBLIC-RELEASE.md) before publishing a fork.
