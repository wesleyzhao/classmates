# Design

Parlor has two looks, chosen per game, built from one set of tokens and one set of components. This document is the reasoning and the rules; `public/themes/base.css` is the implementation and `public/dev/gallery.html` shows every piece in both looks. The reference screens live in the design canvas Wesley reviewed (Home, Lobby, quiz round and reveal, board turn, card hand, results, creator step).

## One memorable thing per screen

Every screen has one element that carries it, and everything else stays quiet: the masthead and the game list on Home, where each game's tile carries its own colour; the room code, set huge in the display face, in the Lobby; the card itself in a quiz round; "That's Portugal." in the reveal; the wheel on a board turn; the fanned hand in a card game; the winner on the results screen. If a screen has two things shouting, one of them is wrong.

## The two looks

**Editorial** is the Sunday paper. Warm white paper (`#fbfaf6`), ink (`#111111`), hairlines (`#e6e1d6`) that separate real sections only, and a serif for anything that matters: titles, the prompt, the room code, numbers on the standings. Buttons are pills in ink. Each game may set an accent (Flags cobalt, Capitals forest, Trivia gold); the platform itself uses accent sparingly, mostly for links and the chat badge. Motion is a single fade and slide when a phase changes.

**Playful** is the arcade. White with a tinted stage (`#f4f6ff`), a rounded face at heavy weights, violet (`#6d4cff`), sun (`#ffc93c`), mint (`#2fc57b`), coral (`#ff5c69`). Buttons and answer tiles have a four-pixel bottom edge and press down when tapped. Choices sit in a two-by-two grid. Rows are soft cards instead of hairline lists. Confetti and a small ding on a win.

Both looks use the system's own fonts: New York (`ui-serif`) and SF Rounded (`ui-rounded`) on Apple devices, Georgia and the system sans elsewhere. Nothing is downloaded.

## Tokens

Components never hard-code a color, a font, a radius, or a shadow. The contract is the `:root` block at the top of `base.css`: surfaces (`--bg`, `--surface`, `--stage`), ink (`--ink`, `--ink-2`, `--muted`), lines (`--rule`, `--rule-strong`), semantic colors (`--accent`, `--good`, `--bad`, `--warn`, each with a `-soft` tint), type (`--font-display`, `--font-ui`, weights), radii, the button edge (`--btn-edge`, 0 in editorial and 4 px in playful), spacing, durations and easings, and the safe-area insets. A theme file sets tokens and a handful of signature rules and nothing else. If a component needs a value that has no token, add the token to `base.css` and set it in both themes.

Two tokens are derived rather than set. A game's accent can be any colour its maker chose, so a room applies it through `public/app/look.js`: `--accent` is used as given where colour is decoration (rings, chips, tiles), `--link` is the accent darkened until it reads as text on the page, and `--accent-ink` is white or ink, whichever reads on top of the accent. Text in the accent always uses `--link`; text on the accent always uses `--accent-ink`. People are circles (`.avatar`) and games are squares (`.tile`, tinted with the game's accent through `.tile-game`).

## Layout

Phones first: one column, `max-width: 480px`, twenty-pixel gutters, the top bar at the top, and the primary action pinned to the bottom in `.actionbar` with the safe-area inset respected. Boards and card tables may use `.page-wide` (560 px). On screens 900 px and wider, room screens use `.with-rail`: the game in the middle, chat in a 340 px rail on the right. Sheets slide up from the bottom on phones and become centered dialogs on wide screens.

## Quality floor

- Text never smaller than 13 px, inputs never smaller than 16 px (iOS zooms otherwise), tap targets at least 44 px.
- Contrast 4.5:1 for text; the muted ink is the lightest allowed on paper.
- Visible focus rings (`:focus-visible`), keyboard operable on desktop.
- `prefers-reduced-motion` turns animation off; `base.css` does this globally.
- Chip strips scroll horizontally and never wrap below the fold.
- No fake device chrome, no gradients as decoration, no all-caps labels, no dot-separated meta strings, no identical cards for everything.

## Motion

Motion answers a person's action and shows what changed; nothing moves for its own sake except the reactions, which are the table making noise at each other. The die (`public/app/game-ui/Die.js`) is a real cube in CSS: it keeps turning from the tap until the server's number comes back, then lands on it over a second, and the board screen holds the sentence about the number and the places to move until it has landed, because a four announced before it lands is not a roll. Runners in a race (`public/app/game-ui/Lanes.js`) slide along their lanes when the answer goes up. A wedge pops once when it is won, a chat line floats in once and leaves, and a token on a board walks its path one space at a time. Everything is a CSS transition or a single keyframe, and `prefers-reduced-motion` cuts all of it to nothing in base.css, so the screens work with the animation gone.

## Sound

A handful of short noises, all made with oscillators in `public/app/sound.js`, and on by default (the room menu turns them off per device). A phone only lets a page make noise after a tap, so the first tap anywhere unlocks the audio context for the noises that arrive on their own. `tick` when somebody answers or joins, `tap` for your own move, `rattle` while a die rolls, `chime` when the game starts waiting on you (a new card, your turn), `pop` for a line in the chat, `ding` when something resolves, and `win` once. The hooks in `public/app/components/Sounds.js` decide from the snapshot, not from a local count, so a phone that missed a poll hears what it missed once. Keep every noise under a quarter of a second and under the speaking voice; a game that is louder than the people playing it is wrong.

## Copy is part of the design

Words follow `docs/VOICE.md`. Buttons say what happens. Empty states invite the next action. Errors say what to do. The results screen writes one sentence about how the game went, not a table of numbers.

## Reviewing a screen

Render it at 390 by 844 and at 1280 by 800 in both themes (`node scripts/screenshot.js` does this; use `BROWSER=webkit` to see the real fonts), then check, in order: is there one memorable thing; does the spacing have a rhythm (the 4 px grid, section gaps of 24 to 32 px); does the type scale read as a hierarchy; is every tap target big enough; does the copy sound like a person; does it still work with a long name, ten players, and a slow connection.
