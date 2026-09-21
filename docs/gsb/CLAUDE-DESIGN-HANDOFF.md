# Claude frontend handoff

Start in `/Users/wesley/projects/parlor-gsb` on branch `gsb-classmates`. Read [FRONTEND-INTEGRATION.md](FRONTEND-INTEGRATION.md) first for the mode map, controller contract and verification commands, then PLAN.md, ARCHITECTURE.md, and VALIDATION.md. The user's preference is for Claude to own the final visual design. This implementation supplies working behavior and a conservative editorial layout to design against. The visual direction below describes this baseline; the user's approved ongoing design work takes precedence.

## Visual direction

A quiet, well-made class game with the restraint of a newspaper games page. Warm paper, crisp ink, a Stanford cardinal accent, serif headings, and clear system-font controls. It should feel welcoming and playful through interaction, not through a dashboard full of switches. The home page prioritizes practice, then the two multiplayer formats. Keep one direction selector and obvious room sharing. Mobile Safari is the primary target; desktop should have room to breathe.

`public/gsb/style.css` is the visual layer. It imports Parlor tokens through base.css and editorial.css. Use those tokens or add profile-specific tokens. Do not add a frontend framework, UI kit, animation dependency, font package, or bundler without a clear benefit. `public/gsb/app.js` is native Preact + htm. The few generic surface class names were prefixed to prevent collisions with Parlor's playing-card styles.

## Components you can redesign

The continuous solo Speed round is mounted at `/speed`. Its behavior is isolated in `use-sprint-round.js`; `sprint-round.js` and `sprint.css` are the view to restyle. Preserve the small shell integration and home entry when editing `app.js`. See [SPEED-ROUND.md](SPEED-ROUND.md) for its APIs, scoring, preload/timer guarantees, and result recovery. The interaction must stay free of reveal delays and per-answer network requests.

- App: masthead, main navigation, global errors, private-content footer.
- Login: email form, sending state, inbox instructions, expired/used-link error, explicit link confirmation, direct request-new-link recovery, truthful email-pending state.
- Profile: nickname and private email, save, sign-out. First sign-in suggests the email username for confirmation or editing; no full-name field. Existing nicknames stay unchanged. The masthead name includes a visible “Edit nickname” hint and opens `/profile`.
- Home: practice entry, Together and Race cards, room code join.
- Practice: direction, coverage, due count, current card, feedback, next, end-of-deck.
- Room: shareable lobby, player list, preparation window, active question, reveal, race progress, finish, reconnect notice, results.
- Answers: text or image choices with optional keyboard or tilt input. The choice IDs are strings `0` through `3`; never infer a target from an image URL.
- Chat: collapsed by default, accessible message field, bounded message history.
- Scores: mode/direction filter, ratings, provisional labels, wins, unique opponents beaten, personal bests.

## Behavior to preserve

1. Do not reveal shared-round correctness or points before the reveal phase.
2. A wrong race answer stays on the same question and enters cooldown; only a correct answer advances.
3. Ignore double taps, stale question actions, and held tilt positions. Respect disabled/blocked choices.
4. Keep both image directions usable with long names and varied portrait aspect ratios. Use contain rather than face-cropping assumptions. No names in image alt text before an answer is revealed. Provide recovery for failed images.
5. Keep touch controls at least 44 pixels, a visible focus ring, logical keyboard order, reduced-motion support, and an explicit motion-permission gesture. Keys 1 to 4 should not intercept typing in chat.
6. Keep the entire deck accessible in practice. Progress belongs to account, person, and direction; it is not a competitive score. Wrong answers reset the interval to one minute, and lifetime misses remain counted after a later success. Due cards lead the next traversal. Preserve the shell-owned `practice-reviews.js` save queue and visible retry states through navigation/reload. Speed and multiplayer do not update spaced repetition.
7. Keep private class content behind authenticated API routes. Never bundle a roster or external BrightCrowd URLs into browser files.
8. Rejoining a room restores the same account seat. The game should remain legible during connection failure and after refresh.
9. Emailed links are one-use; do not turn the confirmation page into an automatic GET login. Keep `login-link.js` callback normalization and submit both token and provider proof. Never expose those in error text.
10. Keep useful error states visible and preserve user-entered text after a failed request.
11. Nicknames support 2 to 48 Unicode characters. Use the shared rules in `public/gsb/profile.js`, and wrap long names at phone widths. Saving updates current room names atomically without changing account IDs, scores, ratings, or chat authorship. Parlor's default room-name limit remains 16; Classmates opts into 48.

## Stable API surface

All requests are same-origin, with HttpOnly session cookies. POST uses JSON and an Origin header. GET `/api/session` gives the current account; POST `/api/auth/request`, `/api/auth/verify`, `/api/auth/logout`, and `/api/profile` handle identity. GET `/api/deck` and `/api/progress` support practice. POST `/api/progress` is idempotent by review ID. POST `/api/rooms` creates a room from `together|race:face|name|mixed`; POST `/api/rooms/CODE/join` joins or restores a seat. GET `/api/rooms/CODE` returns `{v,now,room,view,summary}`. POST `/api/rooms/CODE/actions` sends `{id,type,payload}`. Competitive answer payload is `{questionId,choice}`. GET `/api/leaderboard?mode=together&direction=mixed` returns ratings and best scores.

`Answers` consumes a question `{id,prompt,image,direction,choices}` and calls `onAnswer(choiceId)`. Its other props describe disabled, picked, correct, and blocked states. Keep this rendering boundary stable when redesigning.

## Running design checks

Real classmates are available at localhost:3137 using a real email sign-in; synthetic browser tests use localhost:3138. Use the synthetic test schema and local outbox setup in OPERATIONS.md. No real email or class content is needed to develop the design. Existing browser tests cover actual HTTP and database behavior, not static mocks. Screenshots are in `output/gsb-screenshots/`; they are test artifacts and should not be committed. Test at 390px and 1365px, then a narrow 320px viewport and increased text size. WebKit is an approximation of Safari; actual iPhone motion permission, orientation changes, browser chrome, and haptics still need a device check.

When finished, rerun unit/check/browser suites and inspect each major state. Do not merge this branch into Parlor main just to deploy the focused app. Deployment targets the separate `gsb-classmates` Vercel project.

Tilt retains its calibration across questions and requires return to neutral before another answer. Invalid sensor readings break dwell. Blocked wrong answers cannot be chosen with tilt or keyboard. Automated Chromium/WebKit tests cover four directions and both permission outcomes; physical iPhone testing is still outstanding.

New Classmates questions favor reviewed portrait peers by default, with no extra UI toggle. Preserve the `distractors: "similar-portraits"` option in practice and the server game config. The new peer lists come from a private neutral-feature portrait review. Name similarity is a tie-breaker/fallback. This does not infer gender or ethnicity. See DISTRACTORS.md.

Responsiveness pass: face-to-name questions have no redundant visible question heading (an accessible heading remains), and name-to-face headings show the name alone. Keep feedback and Next immediate while practice progress saves asynchronously, and retain visible pending/error recovery. Current images use session-only blob URLs, so `Photo` preserves its protected source in `data-source` for test/debug checks. Do not restore long round-preparation messages or reintroduce network-blocking practice feedback. See PORTRAIT-REVIEW.md for the reviewed distractor data boundary.

Practice uses a compact title/direction row so the answer grid fits on a phone. The direction label remains accessible. Save status sits below the question and feedback so asynchronous saves cannot shift answer buttons while a player taps them. A photo resolves together with its original source; never display an old blob under a new question.

## GSB additions and disabled guest experiment

Scores now render Arjay Miller Track and FOAM Stars badges alongside qualifying nicknames, plus a small legend. These are game labels for top/bottom 10% in the full selected rating field. Preserve the server's eligibility and tie decisions; do not recompute percentiles from the visible rows. The current account is highlighted, and the bounded scrolling table keeps low-ranked rows reachable. Details are in RANKINGS.md.

GuestRound is a separate, dynamically loaded component in `public/gsb/guest-round.js`. The experiment is OFF in the real deployment. When explicitly enabled with a fixed guest sample, it presents eight faces, eight seconds each, immediate feedback, automatic advance, and a Stanford sign-in/save screen. Preserve the server flag, sample restriction, cookie-bound completion barrier, and separate personal-score status. GUEST-ROUND.md describes APIs and the synthetic preview on port 3139. Do not enable real unauthenticated content as part of a visual design pass.

Room selections now react immediately to a tap, but only server results may reveal correctness, move a race forward, or affect standings. Keep this distinction while adding animation. Respect the input latch and prefetched-photo fast path described in RESPONSIVENESS.md.

Email confirmation also listens for fragment changes in an already-open login tab. Keep this listener when reorganizing routing; links must work without a forced page reload. A guest result is attached only after email verification, including an owner-preview session upgraded to verified access.
