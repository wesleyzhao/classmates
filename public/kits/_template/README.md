# Tally (the template kit)

The smallest complete kit. `scripts/new-kit.js` copies this folder to start a new mechanic, the platform tests use it as a stand-in for any kit, and `docs/HOW-TO-MAKE-A-KIT.md` walks through it.

## How it plays

Everyone taps. The first player to reach the target wins on the spot; if the time runs out first, the most taps wins, with ties going to the earlier seat.

## State

```
{ phase: 'playing' | 'over', target, taps: { [playerId]: count }, endsAt, wakeAt, winnerId, reason: 'target' | 'time' | null }
```

Nothing is secret, so there are no underscore keys.

## Actions

| Type | Who | Effect |
|---|---|---|
| `tap` | any player, while playing | adds one tap; reaching the target ends the game |
| `player/join`, `player/return` | platform | seats a new player with zero taps |
| `player/remove` | platform | drops their count |

`tick` fires at `endsAt` and ends the game on time.

## Settings

`target` (3 to 100, default 10) and `seconds` (5 to 120, default 30). No content.

## Tests

`tests/kits/tally.test.js`: the conformance suite plus the rules above. Run `npm test`.
