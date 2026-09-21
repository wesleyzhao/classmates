# Quiz

The first real mechanic on the platform, and the one most games use: one card, everyone at once, then the answer together.

## How it plays

A card goes up with a prompt and, unless the game asks for typed answers, four choices. Everyone answers at the same time, and the card turns over when the timer runs out or when everyone who is at the table has answered. A correct answer scores by how soon it came in, bucketed to a quarter of a second, with 25 more points for every card in a row after the first. The answer stays up for five seconds and the next card follows, or it waits for the host when automatic advancing is off.

## State

```
{ phase: 'card' | 'reveal' | 'over', index, round, scores: { [playerId]: points },
  streaks: { [playerId]: run }, history, wakeAt, _order: [{ deckId, cardId }] }
```

`round` holds the card as players may see it (`n`, `card`, `startedAt`, `endsAt`, `answeredIds`) and three secrets: `_card` with the answer and the index of the right choice, `_answers` with what everyone submitted and what it scored, and `_late` with the players who arrived while this card was up. `_order` is the cards still to come. Scores move only at the reveal.

## Views

A player's view carries the phase, the answer mode, the seconds a card runs for, `progress`, the round, `scores`, `standings`, `wakeAt`, `waitingOn`, and `actions`. Before the reveal the round says which card is up, who has answered, whether this player may answer, and what they themselves submitted. At the reveal it adds `answer`, `correctChoice`, and `results` for the whole table. The secret keys stay on the server, so no view carries the answer, another player's submission, or the cards still to come until the card turns over.

## Actions

| Type | Who | Effect |
|---|---|---|
| `answer` | any player in the game, while a card is up | grades the answer out of sight, and turns the card over once everyone here has answered |
| `next` | the host, at the reveal | opens the next card, or ends the game after the last one |
| `skip` | the host, while a card is up | shows the answer early |
| `player/join` | platform | seats them on zero, and they play from the next card |
| `player/leave` | platform | a closed tab stops holding the card up |
| `player/remove` | platform | drops their score and their answer |

`tick` fires at `round.endsAt` to show the answer, and five seconds later to open the next card when the game is moving on by itself.

## Settings and content

`cards` (3 to 50, default 10), `seconds` (5 to 90, default 15), `answerMode` (`choices`, `text`, or `both`, default `choices`), `autoAdvance` (default on), and `choicesFrom` (`card` or `deck`, default `deck`). Content is one or more decks whose cards carry a prompt and an answer, plus an optional list of categories to play one corner of them. Run `npm run kits` to print both schemas.

## Demo script

`demoScript` in kit.js runs three cards with two people tapping and one typing, and the conformance suite replays it.

## Tests

`tests/kits/quiz.test.js`: the conformance suite twice, tapped and typed, plus speed scoring, streaks, typo matching, joining mid card, and the rule that no view carries the answer before the reveal. Run `npm test`.
