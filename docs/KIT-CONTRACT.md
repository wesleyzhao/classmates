# The kit contract

A **kit** is one game mechanic: the rules of a quiz, of a roll-and-move board, of a hidden-hand card game. A **game** is a kit plus content (decks), settings, and a look. A **room** is one table playing one game. This document is the contract every kit implements and every platform component relies on. It is normative: the conformance suite in `tests/lib/conformance.js` checks each rule mechanically, and `npm test` runs it against every kit.

If you are adding a mechanic, start with `docs/HOW-TO-MAKE-A-KIT.md`, which walks through this contract with the template kit. If you are adding a game, you do not need this document at all; read `docs/HOW-TO-MAKE-A-GAME.md`.

## The shape

A kit is a folder under `public/kits/<id>/` with two files.

`kit.js` exports one object with five functions and some metadata. It runs on the server for every request and can also run in the browser and in tests, so it imports nothing but `../_lib/*` and `../../shared/*`.

```js
import { KitError } from '../../shared/errors.js';

export default {
  id: 'quiz',
  name: 'Quiz',
  tagline: 'Everyone answers the same card at once.',
  version: 1,                 // bump when the state shape changes incompatibly
  minPlayers: 1,
  maxPlayers: 12,
  joinMidGame: 'next-round',  // 'seat' | 'next-round' | 'spectate' (a copy hint; the rules live in reduce)
  config: { /* schema */ },   // settings a game can choose
  content: { /* schema */ },  // what a game must provide (decks, boards, lists)

  blurb(config, content) {},  // -> string          one sentence about these settings, for the lobby (optional)
  setup(ctx) {},              // -> state           the game begins
  reduce(state, action, ctx) {}, // -> state        a player (or the platform) did something
  tick(state, ctx) {},        // -> state           a deadline passed
  view(state, ctx) {},        // -> view            what one player is allowed to see, and can do
  summary(state) {},          // -> summary         scores and phase for the lobby and results
};
```

`ui.js` exports two Preact components and runs only in the browser.

```js
import { html } from '../../app/h.js';
export function Play({ view, me, players, send, now, sending }) { /* the game screen */ }
export function Editor({ content, config, onChange }) { /* the creator's content step */ }
```

`Play` receives the view the server built for this player, sends actions with `send(type, payload)`, and never computes rules itself. `sending` is the type of the action this device has sent and not yet had a reply to, or `null`; a screen may use it to show the wait (the board's die keeps turning until the number comes back) and may ignore it. `Editor` edits the game's content (a form is generated from `config` automatically, so the editor only needs to cover what a form cannot).

## Context

Every kit function receives a `ctx` object:

| Field | Meaning |
|---|---|
| `config` | the game's settings, already validated against `kit.config` with defaults filled |
| `content` | the game's content, validated against `kit.content` |
| `decks` | every deck referenced by `content`, by id, with its cards (server side) |
| `players` | the seats at the table: `{ id, name, avatar, seat, connected, isHost }` |
| `rng` | a seeded random source: `rng()`, `rng.int(n)`, `rng.pick(list)`, `rng.shuffle(list)` |
| `now` | the current time in epoch milliseconds (in `tick`, exactly `state.wakeAt`) |
| `log(type, data)` | append a public event to the room's activity log |
| `me` | the player an action or view is for; `null` for spectators and platform actions |
| `isHost` | whether `me` is the host |
| `recent` | ids of cards the devices at this table have seen recently (for `_lib/draw.js`) |

## The rules

**R1. Pure.** Kit functions never read the clock, never call `Math.random`, never fetch, and never mutate their inputs. They return new state. Randomness comes from `ctx.rng`, time from `ctx.now`. The platform persists the rng counter so a replay from the same seed makes the same choices. The conformance suite deep-freezes state and scans the source for `Date.now`, `Math.random`, `new Date(`, and `fetch(`.

**R2. Secrets are keys that start with an underscore.** `_deck`, `_hands`, `_answers`. Raw state never leaves the server. `view()` copies out what a player may see (`hand: state._hands[ctx.me]`) and the suite deep-scans every view, including the spectator view (`me: null`), for any key beginning with `_`. Use this for anything one player may not know: draw piles, other hands, submitted answers before the reveal, roles.

**R3. The view carries the affordances.** `view.actions` lists what the viewer may do right now: `{ type, payload?, label, disabled?, confirm?, host?, kind? }`. The platform renders the buttons and the host bar from it (`kind: 'primary'` in the action bar, `secondary` and `danger` beside it). Controls that need a picture (tapping a card, choosing a board space) are drawn by `ui.js` instead; list them with `kind: 'canvas'` so the action bar skips them, or leave them out of `actions` entirely. Never draw an action twice. Legal moves are computed by the kit into the view (`legalMoves`, `playable`), never re-derived in the UI. The suite checks that every offered action is accepted by `reduce`.

**R4. Kits own their phases.** There is no platform notion of rounds or turns. The one shared piece of time is `state.wakeAt`: an epoch millisecond when `tick` must run, or `null`. The platform runs `tick` in a catch-up loop with `ctx.now` clamped to `wakeAt`, so a round that should have ended at T ends at T even if the first request arrives a minute later. Every `tick` must move `wakeAt` forward or clear it.

**R5. Reserved keys.** `$seed`, `$rng` are written by the platform; `wakeAt` is written by the kit and read by the platform. Do not use other keys starting with `$`.

**R6. Lifecycle flows through reduce.** The platform sends these actions with `playerId: null` and `ctx.me: null`:

| Action | Payload | When |
|---|---|---|
| `player/join` | `{ playerId }` | a new player joins after the game started |
| `player/leave` | `{ playerId }` | a player's tab closed (they keep their seat) |
| `player/return` | `{ playerId }` | they came back |
| `player/remove` | `{ playerId }` | the host removed them (free the seat, return their cards) |
| `host/transfer` | `{ from, to }` | the host changed |
| `game/restart` | `{}` | "play again" was pressed; return a fresh `setup(ctx)` or continue |

Unknown `player/*` and `host/*` actions must return `state` unchanged. Any other unknown type throws `new KitError('unknown_action')`.

**R7. Leave is not remove.** A dropped phone keeps its seat and its hand. Only `player/remove` frees the seat.

**R8. Bounded.** State stays under 64 KB after a full game. Keep histories capped, copy cards into state only when drawn, and never store a whole deck.

## Illegal actions

Throw `new KitError(code, message)` where `code` is a short snake_case identifier and `message` is a full sentence the player can read. Codes in `QUIET_CODES` (`not_your_turn`, `stale`, `already_done`, `wrong_phase`) make the client resync silently, because they usually mean someone else got there first. State is unchanged after a throw; the platform discards the attempt.

## Events

`ctx.log('answered', { playerId })` appends `{ n, t, type, ...data }` to the room's activity log. `n` is monotonic, so the client animates and plays sounds for every entry with `n` greater than the last it saw, even across missed polls. The log is public: never put secrets in it. Keep events small and meaningful (`answered`, `revealed`, `moved`, `wedge`, `won`); the UI decides how to show them.

## Views

A view is a plain object with at least `phase` and `actions`. Include `wakeAt` when a countdown is running so the client can show it and poke the server on time, and `waitingOn: [playerId]` when the game is waiting for specific people, so the platform can show "gone quiet" handling. Everything else is the kit's choice. Views are built per player on every read, so keep them cheap.

## The settings sentence

`blurb(config, content)` returns one plain sentence, at most 120 characters, that the lobby and the game page show instead of a list of labels: "Ten cards, fifteen seconds each. Tap one of four answers." It receives the validated settings, so it must read well for every combination the schema allows. The conformance suite checks it for the defaults and the demo settings; it is optional, and a kit without one gets a line assembled from its schema labels.

## Summary

`summary(state)` returns `{ phase: 'playing' | 'over', scores: [{ playerId, score, label?, finish? }], winnerIds, label?, unit?, teams? }`. The platform uses it for the results screen, the lobby's "game in progress" line, and the "play again" flow. Scores are points unless `unit` is `'labels'`, which tells the results screen that each row's `label` is the whole story ("2 cards left", "3 wedges"): the numbers are hidden and the line under the winner reads "Nina finished with 3 wedges." A row may add `finish` to phrase that its own way ("finished on space 24 of 30").

## What the platform does for you

Room codes and links, joining and names and avatars, host and host transfer (including a takeover when the host goes quiet for 60 seconds while the game waits on them), starting and restarting, action de-duplication (every action carries a client id), undo (a snapshot before each player action; restoring shifts `wakeAt` by the elapsed time), rate limits, chat and emoji reactions, presence, themes, share links, the results screen, and the per-device list of recently seen cards.

## Helpers

`public/kits/_lib/` holds small pure helpers, each under a hundred lines and unit-tested:

- `rng.js`: the seeded generator (`makeRng(seed, count)`).
- `rounds.js`: prompt, collect secret submissions, reveal, next; timers; early advance when everyone is in; speed scoring bucketed to 250 ms.
- `turns.js`: turn order with skip and reverse, adding and dropping seats, roles that rotate per round, teams.
- `deck.js`: build, deal, draw, and reshuffle piles.
- `draw.js`: draw cards from decks by category without repeats, honoring `ctx.recent`.
- `vote.js`: open a ballot, cast, tally, quorum, host override.
- `timers.js`: fold several deadlines into one `wakeAt` and tell `tick` which one fired.

## Schemas

`config` and `content` use the schema language in `public/shared/schema.js`. Types: `text`, `longtext`, `number`, `bool`, `choice`, `multi`, `color`, `emoji`, `image`, `list`, `object`, `ref`, `decks`. A `decks` field lists deck ids and may state the card fields the kit needs (`cardFields: ['prompt', 'answer']`).

```js
config: {
  seconds: { type: 'number', label: 'Seconds per card', min: 5, max: 90, default: 15 },
  answerMode: { type: 'choice', label: 'How people answer', options: ['choices', 'text', 'both'], default: 'choices' },
},
content: {
  decks: { type: 'decks', label: 'Cards', min: 1, cardFields: ['prompt', 'answer'] },
}
```

## Testing a kit

`tests/lib/sim.js` plays a kit without a server: `simulate(kit, { config, content, decks }, ['ann', 'ben'])` returns a sim with `.do(player, type, payload)`, `.wait(ms)`, `.view(player)`, `.summary()`, `.state`, `.log`. `tests/lib/conformance.js` runs the rules above against a kit and its `demoScript`. A kit's own test file adds scripted games for its specific rules. Run everything with `npm test`.
