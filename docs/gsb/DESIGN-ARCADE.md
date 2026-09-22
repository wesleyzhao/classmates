# The arcade speed round

The speed round (`/speed`) is the first screen in the approved visual direction. It keeps `useSprintRound` exactly as documented in FRONTEND-INTEGRATION.md and replaces only the presentation.

## What the player sees

A full-screen dark cabinet with pixel type. On a face question the player holds a whole person: the portrait in a gold frame on a cardinal pixel body. The four corners are name plates, each with a faint body under it, so the task reads as matching a face-and-body to a name-and-body. On a name question the player holds a headless body with the name on a tag across its chest, and the corners are framed portraits with faint bodies under them.

Drag or flick the piece toward a corner; the plate or frame lights up and its faint body brightens. Let go and the answer is chosen the same instant. Tapping a corner or pressing 1 to 4 works exactly as before.

Feedback never blocks the next question. A copy of the piece flies into the corner, hops twice and fades within half a second on a hit, or shakes and fades within a third of a second on a miss, while the corner flashes green or red. A label floats up with the first name. A strip at the bottom keeps the last three answers with a small portrait and the name, so a miss can still be learned from. The stack behind the piece shows the next two questions in silhouette. The result screen adds the names that were missed.

## Second pass, September 17, 2026

- Rounds come in 10 or 20, in one direction or both. A round is prepared when the screen opens, again shortly after a setting changes, and the next one behind the result screen, so Start and Play again are immediate. Play again pressed while the next round is still loading waits for it rather than starting over. Only a failed prepare shows a prepare button.
- Corner targets are head-sized boxes on a faint body, so they read as the same figure as the centre piece; the centre piece is a little smaller to fit.
- The first question opens with a short tour: the piece leans toward each corner and that corner lights up. Any pointer or key cancels it.
- The result screen reviews every pairing with its portrait, the misses first, with the name or face that was picked.
- The server prefers people the account has not been asked about lately (`freshTargets` in `server/gsb/sprint.js`).

## Speed challenges, September 17, 2026

- "Challenge classmates" on the speed screen makes a four-letter code with the current settings and opens `/speed/CODE`; anyone who opens that link plays the same sequence whenever they like. The challenge screens show the code, a copy-link button, who has joined and the standings (score first, then time), polled every few seconds while not mid-round. A challenge is one run per account, never touches multiplayer ratings, and counts toward the normal speed records.
- The strip at the bottom of the round is tappable: a chip opens a peek at that classmate's portrait and full name, with what was picked on a miss.

## The whole app, September 17, 2026

- `public/gsb/style.css` is now the arcade layer for every screen. It sets the Parlor tokens on `html[data-theme="arcade"]` (dark panels, gold accent, Press Start 2P for headings and labels, VT323 for names and body text, square corners) and hosts the two vendored fonts, so base.css components darken with the theme. `index.html` switches to `data-theme="arcade"` and a dark theme colour.
- `Answers` in `public/gsb/components.js` renders the arena everywhere it is used (practice, rooms, the guest round): the prompt is the piece in the middle, the four choices are corner figures, and a flick answers through the same input latch as a tap, keys 1 to 4 or tilt. The piece docks on the chosen corner until the next question; the corner turns green or red only when the caller says so (practice at once, rooms on the server's reveal). Call sites no longer render the portrait or the prompt heading themselves; the name-direction prompt is the `h2.prompt` inside the chest tag.
- The arena's rules in `sprint.css` apply to both the speed cabinet and `.arena-host`; the shared body sprites are defined for both.

## Files

- `public/gsb/sprint-round.js`: the view. Same controller destructuring, same focus rules, same strings and controls for setup, ready, result and expired.
- `public/gsb/sprint-arcade.js`: the flick gesture (`useFlick`), the dealt copy (`dealPiece`), the corner flash and floating label, and `answerSummary` for the strip and the missed list. It never calls the controller.
- `public/gsb/sprint.css`: the cabinet, tokens for the arcade palette and fonts, the two body frames as inline SVG backgrounds, and every play-screen rule.
- `public/gsb/fonts/`: Press Start 2P and VT323 as woff2, both SIL Open Font License, so the private app makes no third-party requests. See `OFL.txt`.

## Rules the view keeps

- `choose(question.id, choice.id)` is called synchronously on release, tap or key. The flown copy lives in an fx layer that Preact never renders into, and every timer only removes nodes from that layer.
- The four answer buttons keep `class="answer"`, `data-sprint-answer`, native button semantics, `aria-label` with the name or "Photo n", and fixed boxes. Their rectangles do not change between questions, in either direction, with short or long names.
- Sizes scale with `--u: min(1px, 100svh / 724, 100vw / 332)`, so the arena fits a 320 by 568 viewport and reaches full size on a 390 by 844 phone. Nothing in the play screen scrolls.
- Portraits use `object-fit: contain`. No name appears in image alt text. The strip and the missed list only use `photoUrls` while the round is playing; the result screen shows names only, because media is released at result.
- Keys 1 to 4 still answer through the controller's window listener; the view's document listener only draws the deal for the question that was on screen.
- The view shows the correct count, stage and clock. It computes no score of its own.

## Evidence, September 17, 2026

- `npm test` and `npm run check` pass.
- `tests/gsb/sprint.browser.spec.js` and `tests/gsb/sprint-touch.browser.spec.js` pass in Chromium and WebKit (18 cases) against a private schema and port so other agents' runs are undisturbed. Tap-to-next DOM update stayed under 4 ms in both engines.
- Screenshots reviewed at 390 by 844, 320 by 568 and 1365 by 900 in both directions: setup, play, a drag hit, a drag miss, the strip, and the result.
- Still to do: a physical iPhone pass for drag feel, and the same look for Home, Practice, Together and Race. VALIDATION.md and TODO.md were not edited in this pass because another agent had them open; fold this section in when convenient.

## Legibility pass (2026-09-17, evening)

- The centre head is 168u on a 128u body and the corner faces fill their 150u frame, so a real head-and-shoulders portrait shows the face itself larger; the answer boxes are 150 by 216u and `--u` divides the height by 800. The arena on ordinary pages (`.arena-host`) also shrinks to the height left under the page head on short phones, and the practice verdict with its Next button sticks to the bottom of the screen after an answer.
- Names on plates, chest tags, chips and the review carry `--pixel-bold` (a one-pixel text shadow that doubles the pixel font's strokes). Body text is antialiased again.
- Parlor's base theme has `.tag` and `.chip` classes (a nowrap pill); the arena's rules now reset them, so a long name wraps on the chest tag instead of overflowing it.
- The strip scrolls sideways when three chips do not fit; a long chip name ends in an ellipsis and the peek carries the whole of it.
- A docked piece (practice and rooms) cannot be picked up again unless another answer is allowed; when it can (a race retry), the drag starts from where it sits.
- An invite link (`/speed/CODE` or `/r/CODE`) opened while signed out is kept in `localStorage` for an hour and honoured after the sign-in link and the nickname step; the sign-in screen names the challenge.
- Repeat avoidance counts only runs that were started: a round prepared and never played showed nobody.

## Name, sound, tour and practice (2026-09-17, late)

- The game is called by the `<title>` and `og:title` in `public/gsb/index.html` (`public/gsb/brand.js` reads it): the masthead, share sheets and the link preview (`public/gsb/og.png`, rendered from the vendored fonts) all follow one edit there. "Classmates" remains the short name in buttons and copy.
- Sound, from Parlor's sound design (`public/gsb/sound.js`): a ding for a right answer, a buzz for a wrong one, a chime at the end of a speed round, four notes for a perfect one, a pop when somebody joins a room. The footer switch remembers the choice per device.
- The opening tour is a quick springy hop toward each corner (230 ms with an overshoot, 300 ms a step, 220 ms in).
- Practice is multiple choice both ways round, one memory per person (see ARCHITECTURE.md), with a missed person back five cards later marked "Again" and a "Names you keep missing" list under the head.

## The duel (2026-09-17, night)

Two doors instead of four corners (`public/gsb/duel-round.js`, the `.sprint-duel` rules): the face is held high and dropped bottom-left or bottom-right onto a headless body wearing the name on its chest, no box. Along the top, each player's ten heads line up and vanish as they clear, with a line saying who is ahead. The lobby lists seats with Ready; the host's "Start the count" fires a 3-2-1 for everyone through the server's start instant; the result ranks the room and the host can call a rematch the others follow. Chosen from the four studies at https://claude.ai/artifact/C98TQybNRJETFvNWFpaUsA.

Second pass on the duel (same night): the piece is the whole person again (150u head, 120u body); each door carries its name on a white plate above the head's place, in 30u pixel type; the lanes' heads are 38u with the leader in green and the lead line 24u; the result shows the other player's misses and gets from this player's copy of the round; anyone can call the rematch (the first press wins, the rest follow it). Sound: `setLevel(2.4)` on Parlor's design, a silent looping media element on the first tap so an iPhone's ring switch does not mute the noises, and a switch on the speed screen and the duel lobby.

## The game is the two doors (2026-09-21)

The home (`/games`) offers Practice and the Speed round in ten or twenty, nothing else; quizzes, races, room codes and the return-to-room link are hidden, though `/r/CODE` links still open their screens. The speed screen has no match setting: face to name, two doors, ten by default; "Start the clock" is a solo round and "Challenge classmates" makes a duel of the chosen length (ten or twenty) on the same 3-2-1. The four-corner round with its match settings is kept at `/speed/classic` for its tests and as a fallback, with no link to it. Practice says "Spaced repetition learning of names" under its head.
