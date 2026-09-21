# Board

Take turns, roll, move, and answer a question where you land. Trivial Pursuit is this kit on the wheel with six categories, and a race with one deck is the same kit on the track.

## How it plays

You roll one die and choose one of the spaces that roll can reach, never doubling back on yourself. The space asks a question from its category: a right answer keeps your turn, a wrong one passes it to the next seat. A headquarters space awards a wedge, and once you hold enough of them you make for the middle (or for the finish line) and answer one last question, whose category the other players choose.

The board itself is data. `graph.js` defines a layout as spaces and their neighbours, and `reachable` returns every space exactly `n` steps away without visiting a space twice inside one move, plus the end space when the relaxed finish is on. `layouts/wheel.js` builds the classic wheel in a 1000 by 1000 box: 42 ring spaces (six headquarters, twelve roll again, twenty four category), six spokes of five, and the hub, and it needs exactly six categories. `layouts/track.js` builds a one way race track of 12 to 60 spaces that snakes through rows so it fits a phone, cycling through however many categories the game has. The screen draws from the same coordinates the rules use.

## State

```
{ layout: 'wheel' | 'track', trackLength, cats: [{ id, name, color, emoji }], turns,
  turnCount, pos: { [playerId]: spaceId }, wedges: { [playerId]: [bool] }, turn,
  winnerId, wakeAt, _used: [cardId] }
```

`turn` walks one player through `roll`, `move`, `pick` or `final-pick`, `ask`, `judge`, `result`, and `done`, and holds the roll, the legal moves, the drawn card, and the answer under the secret key `_answer`. `_used` is every card id this room has asked, so questions come round again only when the pool runs dry. There are no timers here: `wakeAt` stays null, and a quiet player is handled by `skip`.

## Views

A player's view carries the layout and its `viewBox`, the categories, everyone's position and wedges, `wedgesToWin`, the win condition and the answer style, `turnCount`, `winnerId`, the turn, `isActive`, `canPick`, `canJudge`, `waitingOn`, and `actions`. The turn carries the step, the roll, the legal moves as `options`, and the card without its answer. `answer` and `correctIndex` are filled in at the result, and during an open question for the players who are marking it, so the person answering never sees them. `_answer` and `_used` never leave the server. `turn.nextId` says who is up once the result is dismissed: nobody after a win, the same player after a right answer, the next seat after a wrong one.

## Actions

| Type | Who | Effect |
|---|---|---|
| `roll` | the active player, at the roll step | rolls one die; a single option moves at once, and no options ends the turn |
| `move` | the active player | moves to one of the offered spaces and lands there |
| `pick` | the active player at `pick`, the other players at `final-pick` | chooses the category of the question |
| `answer` | the active player, when answers are choices | taps one of four |
| `submit` | the active player, when answers are typed or spoken | typed answers are marked by the game, spoken ones go to the table |
| `judge` | any other player, or a solo player | marks a spoken answer right or wrong |
| `continue` | any player in the game, at the result | ends the turn and names who is up next |
| `skip` | the host after half a minute, anyone else after ninety seconds | drops a quiet player's turn |
| `player/join` | platform | seats them at the start with no wedges |
| `player/remove` | platform | frees the seat, and hands the turn on when it was theirs |

## Settings and content

`win` (`collect` or `reach`, default `collect`), `wedgesToWin` (1 to 12, default 6, when the game is collecting), `answerStyle` (`choices`, `open`, or `typed`, default `choices`), `relaxedFinish` (default on), and `maxTurns` (20 to 999, default 300). Content is the `layout` (`wheel` or `track`), `trackLength` (12 to 60, default 30) for the track, and 1 to 12 categories, each with an id, a name, an optional color and emoji, its decks, and an optional filter that keeps only one deck category. Run `npm run kits` to print both schemas.

## The screen

`ui.js` draws whose turn it is, the board (`public/app/game-ui/Board.js`), one status block that changes with the step, and everyone's wedges or places underneath. The die (`public/app/game-ui/Die.js`) is a cube that keeps turning while this device's `roll` is on its way (the platform passes `sending`, see docs/KIT-CONTRACT.md) and lands on the number over a second; the sentence about the number, the numbered rings on the board, and the destination chips wait for it to land. Roll, Go again, Right, Wrong and Skip are in `view.actions`, so the platform's action bar draws them. `public/dev/board.html` renders every step without a server.

## Demo script

`demoScript` in kit.js plays one turn on a short track, through the roll, the move, the question, the marking, and the result.

## Tests

`tests/kits/board.test.js`: the conformance suite on both layouts and all three answer styles, plus wedges, the final question, skipping, removals, and what the views carry. `tests/kits/board-layouts.test.js` covers the shapes and the movement rules. Run `npm test`.
