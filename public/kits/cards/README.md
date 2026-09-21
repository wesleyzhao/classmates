# Cards

Crazy Eights: hidden hands, a draw pile, and a race to empty your hand. It is the kit that proves hidden information on the platform.

## How it plays

Everyone is dealt a hand from a standard 52 card deck, and one card that is not an eight starts the discard pile. On your turn you play a card that matches the top of the pile by suit or by rank, or an eight, which is wild and names the suit that follows. If you have nothing to play, you draw one card and either play it or pass. The first player to empty their hand wins. With the house rules on, a two makes the next player draw two and the twos stack, a queen skips a player, and an ace reverses the direction.

## State

```
{ _draw: [cardId], _hands: { [playerId]: [cardId] }, discard: [cardId], suit, turns,
  turnAt, drew, pendingDraw, winnerId, lastPlay, turnCount, wakeAt }
```

`_draw` is the pile in order and `_hands` is every hand, both secret. `discard` is public, `suit` is the suit in force, which an eight can make different from the top card, `pendingDraw` is how many cards a standing two owes, and `drew` is the card the active player took this turn, which is why they may not draw twice. There are no timers here: `wakeAt` stays null, and a quiet player is handled by `skip`.

## Views

A player's view carries the phase, whose turn it is, the seats and the direction, the top card and the suit in force, the size of both piles, `handCounts` for everyone, `playable`, `pendingDraw`, `lastPlay`, `winnerId`, `isActive`, `waitingOn`, and `actions`. `hand` holds this player's own cards, sorted by suit and rank, and nobody else's: a spectator gets null. `_draw` and `_hands` never leave the server, so the order of the pile and the other hands stay unknown, and `drew` is sent only to the player who drew it.

## Actions

| Type | Who | Effect |
|---|---|---|
| `play` | the active player | plays a matching card, or an eight with a named suit; an empty hand wins |
| `draw` | the active player | takes one card, or the whole pending draw when a two is standing, reshuffling the discards when the pile runs out |
| `pass` | the active player, once they have drawn | ends the turn |
| `skip` | the host after half a minute, anyone else after ninety seconds | moves a quiet player's turn on |
| `player/join` | platform | seats them and deals them a hand |
| `player/remove` | platform | returns their cards to the pile; with fewer than two players left, the last one wins |

## Settings and content

`handSize` (3 to 8, default 5), `houseRules` (any of `twos`, `queens`, and `aces`, none by default), and `maxTurns` (20 to 999, default 300, after which the smallest hand wins). There is no content: the kit builds its own deck and needs no decks from the game. Run `npm run kits` to print the settings schema.

## Demo script

`demoScript` in kit.js plays six turns, with the player whose turn it is playing a legal card when they hold one and drawing when they do not.

## Tests

`tests/kits/cards.test.js`: the conformance suite plus the deck helpers, the rules of play, the house rules, reshuffling, joining and leaving, and what the views hold back. Run `npm test`.
