# Race

The quiz turned into a footrace. One card, everyone at once, and a right answer carries you down a track instead of into a scoreboard. The first player over the finish line ends the game there and then.

## How it plays

A card goes up with a prompt and, unless the game asks for typed answers, four choices. Everyone answers at the same time, and the card turns over when the timer runs out or when everyone at the table has answered. At the reveal every right answer moves one space, and with the boost on the first right answer moves two. A wrong answer or no answer stays put. The answer stays up for four seconds and the next card follows by itself; there is no button between cards, though the host can show the answer early.

Positions run from space 0 to space `trackLength`, and the finish is space `trackLength`. The moment anyone reaches it the race is over. When several cross together, the one who answered fastest that round wins alone; a dead heat, two answers stamped on the same millisecond, is shared. If the cards run out before anyone finishes, the race stops where it is and whoever got furthest wins, ties allowed. Nobody wins a race nobody ran.

## State

```
{ phase: 'card' | 'reveal' | 'over', index, trackLength, round,
  pos: { [playerId]: space }, winnerIds, wakeAt, _order: [{ deckId, cardId }] }
```

`round` holds the card as players may see it (`n`, `card`, `startedAt`, `endsAt`, `answeredIds`), what the reveal decided (`moves`, `firstId`), and three secrets: `_card` with the answer and the index of the right choice, `_answers` with what everyone submitted and whether it was right, and `_late` with the players who arrived while this card was up. `_order` is the run of cards the race draws from, three for every space on the track and at most sixty, and the ones still to come are nobody's business until they come up. Positions move only at the reveal.

## Views

A player's view carries the phase, the answer mode, the seconds a card runs for, whether the boost is on, `trackLength`, the round, `pos` for everyone, `wakeAt`, `waitingOn`, and `actions`. Before the reveal the round says which card is up, who has answered, whether this player may answer, and what they themselves submitted. At the reveal it adds `answer`, `correctChoice`, `firstId`, and `results`: one row a player with whether they had it, what they said, how far they moved, and how long they took. The secret keys stay on the server, so no view carries the answer, another player's guess, or the cards still to come until the card turns over.

## Actions

| Type | Who | Effect |
|---|---|---|
| `answer` | any player in the race, while a card is up | grades the answer out of sight, and turns the card over once everyone here has answered |
| `skip` | the host, while a card is up | shows the answer early |
| `player/join` | platform | seats them on space 0, and they race from the next card |
| `player/remove` | platform | drops their place on the track and their answer |
| `player/leave` | platform | keeps the seat and the place, and turns the card over if everyone still here has answered |
| `player/return`, `host/transfer` | platform | nothing changes |

`tick` fires at `round.endsAt` to show the answer, and four seconds later to open the next card.

A phone that closes its tab while it is the last one still to answer no longer holds the card: the platform's `player/leave` re-checks who is here, the same way every answer does.

## Settings and content

`trackLength` (8 to 40, default 15), `seconds` (5 to 60, default 10), `answerMode` (`choices`, `text`, or `both`, default `choices`), and `boost` (default on). Content is one or more decks whose cards carry a prompt and an answer, plus an optional list of categories to race through one corner of them. Run `npm run kits` to print both schemas.

## The screen

`ui.js` draws the race as lanes with the shared `Lanes` component (`public/app/game-ui/Lanes.js`): one line per runner, a token on the space they have reached, a checkered flag at the end, and the exact count beside it. Lanes rather than a board of squares because the card underneath has ten seconds on it and has to sit above the answers on a phone, whatever the length of the track. At the reveal the tokens slide to where they have got to. Under the lanes sits the round, in the same order a quiz player already knows. `public/dev/race.html` renders every state without a server.

## Demo script

`demoScript` in kit.js runs a short race over the demo deck, with a card everyone answers, a card that times out, and a player joining halfway through. The conformance suite replays it.

## Tests

`tests/kits/race.test.js`: the conformance suite twice, tapped and typed, plus a race won at the finish line, the boost on and off, a card nobody answers, a late joiner, a removed player, a finish split by speed, a dead heat, and the deck running out. Run `npm test`.
