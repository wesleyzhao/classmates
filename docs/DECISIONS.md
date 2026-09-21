# Decisions

Dated records of the choices that shape Parlor, so nobody has to rediscover why. Add a new entry when you change direction; do not rewrite old ones.

## 2026-09-13: One kit contract, games as data

A game mechanic is a kit: five pure functions (`setup`, `reduce`, `tick`, `view`, `summary`) over a plain state object. A game is data: a kit id, decks, settings, and a look. This split is what makes the platform reusable: a new quiz is a file or a wizard run, a new mechanic is a folder that passes a conformance suite, and the platform never learns a kit's name. Rejected: a class hierarchy of game types (leaks platform concerns into games), and a "rules engine" DSL (never general enough, and agents write JavaScript better than a bespoke language).

## 2026-09-13: Rules run only on the server

Clients send actions and receive per-player views. There is no client-side prediction in version one. Reasons: it cannot cheat, hidden information (hands, answers) stays hidden by construction, and every kit author writes one reducer instead of two. The cost is a round trip per action, which at about 100 ms on a phone is fine for quiz, board, and card games.

## 2026-09-13: Polling, not sockets

Vercel functions cannot hold connections, and the free tier has no background jobs. Clients poll a cheap, CDN-cached version endpoint about once a second and fetch their own view when it changes; deadlines are applied lazily by whichever request arrives next, with the clock clamped to the deadline so replays are exact. Server-sent events remain a documented later option behind `net.js`. Rejected: a third-party realtime service (an extra vendor and SDK for something the poll handles well at this pace).

## 2026-09-13: Neon Postgres as the single store

Rooms are hot JSON documents; games and decks are durable records that want slugs, ownership, and listing. Postgres does both, compare-and-set is one `UPDATE ... WHERE v = $expected`, and the free plan is metered by compute time rather than per query, so polling is cheap. Upstash Redis was the alternative (always warm, per-command billing capped at about 300 games a month for this pattern). Neon's cold start after five idle minutes is hidden by a warm-up request from the home page. The store sits behind a small interface (`server/store/`) with a memory backend, so swapping later is one file.

## 2026-09-13: Preact and htm, vendored

The client needs a renderer that survives a re-render every second without losing focus or animations, and kit authors (people and agents) write React-style components fluently. Preact plus htm is about 14 KB, needs no build step, and is copied into the repo so there is no CDN and no install for the browser. Rejected: plain DOM code (every screen reinvents diffing), and a build step (slows every contributor and every agent down for no gain at this size).

## 2026-09-13: System fonts only

New York (`ui-serif`) and SF Rounded (`ui-rounded`) are already on every iPhone and Mac, which is where Parlor is played, and they are excellent. Georgia and the system sans stand in elsewhere. No web font downloads, no layout shift, nothing to license.

## 2026-09-13: Decks by reference, cards copied on draw

A deck is referenced by id from a game and loaded by the server per request (cached, since deck versions are immutable). A room copies a card into its state only when the card is drawn. This keeps room documents small (the database's egress budget is the binding free-tier limit) and lets one deck serve many games.

## 2026-09-13: No accounts

Identity is per device: a player id and secret per room, a name and an emoji avatar in local storage, and a "my games" list of edit links. Anyone with a room link can join; anyone with an edit link can edit a game. This is enough for friends and family and removes a whole class of screens. Accounts can be added later (Neon Auth lives on the same project) without changing the room model.

## 2026-09-13: A human voice, linted

Every sentence a player reads follows `docs/VOICE.md`, and `scripts/lint-copy.js` fails the build on the mechanical tells (dashes, hype words, fragment stacks, ellipses). The rule exists because generated copy drifts toward the same tics, and a game night should not sound like a press release.

## 2026-09-13: Reference material, not a template

Wesley's earlier Trivial Pursuit and cube-quest were read for what worked (fact-checked questions, wheel geometry, an e2e approach, the no-repeat card drawing) and for what broke (a host whose phone died froze the table). Their architecture was not copied.
