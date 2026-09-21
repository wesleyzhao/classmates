# How to make a kit

A kit is a game mechanic: the rules of a quiz, of a board game, of a card game. This walks through building one from the template, using Tally (`public/kits/_template/`) as the worked example. Read `docs/KIT-CONTRACT.md` alongside it; that document is the rules, this one is the path.

## 1. Scaffold it

```
npm run new-kit -- --id memory --name "Memory"
```

You get `public/kits/memory/kit.js` (the rules), `public/kits/memory/ui.js` (the screen), `public/kits/memory/README.md`, a test file `tests/kits/memory.test.js` wired to the conformance suite, and a line in `public/shared/registry.js`. Run `npm test` now: the scaffold passes as it is, because it is a copy of Tally.

## 2. Decide the state

Write down what the game needs to remember, and mark what players may not see. Anything secret goes under a key that starts with an underscore; the platform strips those from every view and the tests fail if one leaks.

For Memory: `grid` (card ids in a fixed order), `_faces` (which card is which, secret until matched), `revealed` (indices currently face up), `matched` (pairs found, public), `turns` (whose turn, from `_lib/turns.js`), `scores`, and `wakeAt` (when the two wrong cards flip back).

Keep it small. Copy a card into state when it is drawn; never store a whole deck. State must survive `JSON.stringify` unchanged, so no `undefined` values and no class instances.

## 3. Write `setup`

`setup(ctx)` returns the first state. `ctx.players` is who is at the table, `ctx.config` the validated settings, `ctx.content` the validated content, `ctx.decks` the referenced decks with their cards, `ctx.rng` the only randomness you may use, `ctx.now` the only clock. Log the start: `ctx.log('started', { first: seats[0] })`.

## 4. Write `reduce`

`reduce(state, action, ctx)` returns a new state; never mutate the old one (tests freeze it). `action.type` is either one of your own (`flip`, `answer`, `roll`) or a lifecycle event from the platform (`player/join`, `player/leave`, `player/return`, `player/remove`, `host/transfer`). Handle the lifecycle events you care about and return `state` unchanged for the rest of the `player/*` and `host/*` family; throw `new KitError('unknown_action')` for anything else you do not know.

For a player's action, check who is acting (`ctx.me`, `ctx.isHost`) and what phase you are in, and throw a `KitError` with a short code and a full sentence when it is not allowed: `throw new KitError('not_your_turn', 'It is not your turn.')`. The codes `not_your_turn`, `stale`, `already_done`, and `wrong_phase` make the client resync quietly; use them for "someone else got there first" situations.

Log what happened with `ctx.log('flipped', { playerId })`. Never put a secret in the log.

## 5. Write `tick`

If your game has deadlines, set `state.wakeAt` to the time and put in `tick(state, ctx)` what should happen then. The platform calls it with `ctx.now` equal to the deadline, possibly several times in a row when more than one has passed, so each tick must move `wakeAt` forward or clear it. Games with no deadlines return `{ ...state, wakeAt: null }`.

## 6. Write `view`

`view(state, ctx)` is what one player (`ctx.me`, or `null` for a spectator) may see, plus `actions`: the things they may do right now, as `{ type, payload?, label, kind?, host?, confirm?, disabled? }`. The platform renders those as buttons, so labels are real copy ("Roll", "Next card"). Include `wakeAt` when a countdown is running and `waitingOn` (player ids) when the game waits on specific people. Compute legal moves here (which spaces, which cards) so the screen never re-derives rules.

## 7. Write `summary`

`summary(state)` returns `{ phase: 'playing' | 'over', scores: [{ playerId, score }], winnerIds, label }`. The platform ends the game when `phase` becomes `'over'`.

## 8. Write the settings sentence

`blurb(config, content)` returns the one line the lobby shows under the players: "First to 10 taps wins, or the most taps after 30 seconds." Write it in words, keep it under 120 characters, and make it read well for every setting the schema allows. Without it the lobby falls back to a list of labels.

## 9. Write a demo script and the tests

`demoScript` is a short scripted game (`['p1', 'flip', { index: 0 }]`, `['@wait', 2000]`, `['@join', 'p4']`, `['@check', (sim) => ...]`). The conformance suite plays it, plays it again to check determinism, tries every offered action, scans every view for leaks, and throws players in and out mid-game. Add your own tests with the simulator for the rules that make your game yours: `simulate(kit, { config, content, decks }, ['ann', 'ben'])`, then `sim.do('ann', 'flip', { index: 0 })`, `sim.wait(2000)`, `sim.view('ben')`, `sim.summary()`.

## 10. Write the screen

`ui.js` exports `Play({ view, me, players, send, now })` and `Editor({ content, config, onChange })`. Build the screen from `public/themes/base.css` classes and the primitives in `public/app/game-ui/` (a prompt card, a choice grid, a timer ring, a board, a hand of cards). Send actions with `send('flip', { index })`. Do not render buttons for actions the platform already renders from `view.actions` (the host bar and the primary action); render the in-game controls that need a picture: tapping a card, choosing a space. Look at it at 390 by 844 and 1280 by 800 in both themes (`public/dev/screens.html` renders any kit with fixture views; `node scripts/screenshot.js` takes the pictures).

## 11. Ship it

`npm test`, `npm run check`, `npm run kits` (prints your schemas), then `npm run new-game -- --kit memory --slug flag-pairs` to make the first game that uses it.

## The five ways kits break

1. Reading the clock or `Math.random` (use `ctx.now` and `ctx.rng`).
2. Mutating state instead of returning a new object.
3. Putting a secret in a view or in the log (use underscore keys; copy out only what this viewer may know).
4. Offering an action in `view.actions` that `reduce` then refuses.
5. A `tick` that leaves `wakeAt` where it was.
