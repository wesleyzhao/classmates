# Parlor, for agents and people who work on it

Parlor is a place to make and play small multiplayer games with friends: quizzes, board games, card games. It targets Vercel with a small file-copy build and no browser bundler. Read this file first; it is the map.

## The mental model in ten lines

1. A **kit** is a game mechanic implemented in code (`public/kits/<id>/`): quiz, race, board, cards.
2. A **deck** is reusable content: cards with a prompt, an answer, and optional choices, image, category (`public/decks/`).
3. A **game** binds a kit, decks, settings, and a look (`public/games/<slug>.js`, or a row in the database when made in the browser).
4. A **room** is one table playing one game: a four-letter code, players, and the kit's state, stored as one JSON document with a version number.
5. Rules run only on the server, as pure functions (`setup`, `reduce`, `tick`, `view`, `summary`). Clients send actions and receive per-player views.
6. Clients poll a cheap, CDN-cached version endpoint about once a second and fetch their view when it changes. There are no sockets and no background jobs; deadlines are applied lazily when the next request arrives.
7. The platform (`server/rooms.js`) owns everything that is not a rule: joining, hosts, chat, undo, de-duplication, rate limits, timeouts, redaction.
8. The client is Preact with htm templates, vendored, imported through `public/app/h.js`. No bundler.
9. Two themes, `editorial` and `playful`, are pure CSS token sets in `public/themes/`.
10. Every user-facing sentence follows `docs/VOICE.md`. Every kit follows `docs/KIT-CONTRACT.md`.

## Where things are

```
public/app/        client: screens, components, game-ui primitives, net.js (polling), identity.js, look.js (theme and accent)
public/kits/       kits (quiz, race, board, cards), _lib helpers, _template (copy me)
public/decks/      built-in decks       public/games/   built-in games
public/shared/     code used by both browser and server: schema, match, errors, codes, ids, registry
public/themes/     base.css (tokens + layout), editorial.css, playful.css
server/            router, rooms (the core), games, decks, store/{neon,memory}, dev server
api/index.js       the single Vercel function
tests/             node --test suites; tests/lib has the simulator and the conformance suite; tests/e2e is Playwright
docs/              ARCHITECTURE, KIT-CONTRACT, HOW-TO-MAKE-A-GAME, HOW-TO-MAKE-A-KIT, DESIGN, VOICE, OPERATIONS, DECISIONS
scripts/           scaffolds, generators, lint-copy, smoke, doctor
types/parlor.d.ts  the shared type contracts (JSDoc-checked)
```

## Commands

```
npm run dev                 local server on http://localhost:3000 with an in-memory store
npm test                    unit, simulation, conformance, content, and copy checks
npm run check               type-check the JavaScript with tsc (JSDoc types)
npm run test:e2e            Playwright multiplayer runs against the dev server
npm run kits                print every kit's settings and content schema
npm run new-game -- --kit quiz --slug my-quiz     scaffold a game file
npm run new-deck -- --id my-deck                  scaffold a deck file
npm run new-kit -- --id memory                    scaffold a kit from the template, with a test
npm run doctor              check the environment and the database connection
npm run smoke -- <url>      play a round against a deployment
npm run deploy              vercel --prod
```

## Three recipes

**A new game with an existing mechanic** takes minutes: `npm run new-game -- --kit quiz --slug capitals-of-asia`, edit the generated file (title, description, decks, settings, theme), then `npm test`. The test validates the file against the kit's schema. Register nothing; `public/shared/registry.js` is updated by the script.

**A new deck**: `npm run new-deck -- --id my-deck`, fill in cards, `npm test` (the deck audit checks for duplicates, questions that contain their answer, and repetitive openings).

**A new mechanic**: `npm run new-kit -- --id memory`, then read `docs/HOW-TO-MAKE-A-KIT.md`. The scaffold already passes the conformance suite; make it do something, keep it passing.

## Rules of the road

- Kits are pure and know nothing about rooms, players' names, the network, or the theme. If you find yourself reaching for `Date.now()` or `fetch` inside a kit, stop; the contract has a way.
- Every file opens with a comment that says what it is for and how it fits. Exported functions have JSDoc with types. Comments explain why.
- Copy is human. No em dashes, no fragment stacks, no hype. `npm test` runs the linter; `docs/VOICE.md` has the reasoning.
- Design is token-driven. Never hard-code a color or a font in a component; add a token if one is missing, and check the gallery (`public/dev/gallery.html`) in both themes.
- Room documents stay small. Copy cards into state when drawn; never store a deck in a room.
- Run `npm test` and `npm run check` before you say something is done. For anything a player sees, look at it at phone width and at desktop width.
- Do not add dependencies. The server runtime uses `@neondatabase/serverless` and `@vercel/blob`; browser dependencies are vendored.

## Where to look next

- For forks and private content imports, read `docs/gsb/FORKING.md`, `SECURITY.md` and `docs/gsb/PUBLIC-RELEASE.md`. Keep credentials, real roster input, photos and test outboxes out of Git. Preserve tester accounts and opt-outs.
- For the standalone Classmates profile, start with `docs/gsb/FRONTEND-INTEGRATION.md`. It maps existing game modes, controller/view boundaries, privacy requirements, design handoff and isolated test commands. The focused profile deploys to `gsb-classmates`, separately from Parlor.
- Why things are the way they are: `docs/DECISIONS.md`.
- How a request flows and how a room lives: `docs/ARCHITECTURE.md`.
- Deploying, quotas, and what to do when something is stuck: `docs/OPERATIONS.md`.
- The look: `docs/DESIGN.md` and the gallery.
