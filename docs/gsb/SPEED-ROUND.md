# Continuous solo speed rounds

Speed round is a separate Classmates mode at `/speed`, reusing the recognition question factory, reviewed distractors, and account system. Practice retains its feedback and spaced repetition. Together and Race retain their multiplayer rules. The unsigned guest experiment remains off.

## Player experience

The UI offers 10 or 20 classmates, face to name, name to face, or both directions alternating. A round is prepared as soon as the speed screen opens and again shortly after a setting changes, and the next round is prepared behind the result screen, so Start the clock and Play again are usually ready before the tap; only a failed prepare leaves a prepare button. Preparation fetches and validates every required photo before Start the clock becomes available. Loading and the initial server handshake are outside the player's measured time. Once the first question is rendered, tapping or pressing 1 to 4 immediately replaces it with the next question. There is no reveal delay, Next button, per-answer request, polling, or network dependency during the round. Wrong answers also advance. Choice positions and the timer area have fixed dimensions to avoid moving tap targets.

The round ends on the final answer, shows the result immediately, and saves in the background. A failed save keeps the completed log in sessionStorage under the account ID. Retry or reload resubmits the same run; the database accepts its first completion only. An unfinished round is abandoned on navigation or refresh and creates no score. Background time counts, and a run expires after an hour. No full roster or photo blobs are stored in browser persistence.

The API also supports a whole-class length for future variations; the UI exposes quick (10) and short (20). Records are separated by direction, length, count, immutable deck revision, active-content fingerprint, and scoring version. Each prepare asks about people the account has not been asked about in its last twelve started runs of the past twelve hours first, then the least recently seen (a round prepared and never started counts for nothing), so consecutive rounds repeat as few faces as the deck allows. New exclusions change the comparable group instead of making older runs look equivalent.

## Scoring and records

For `C` correct answers out of `N`, and whole-run elapsed time `T` in milliseconds:

`score = C * 1000 + round(999 * (C / N) * max(0, 1 - T / (N * 8000)))`

One more correct answer always beats the largest possible speed advantage. There is no wrong-answer cooldown. The separate fastest-perfect record requires every answer correct and compares elapsed milliseconds; an imperfect score never replaces it. Class lists contain each account's best score or fastest perfect time, up to ten accounts. Current account nicknames are joined at read time.

These are casual solo speed records measured by the browser. The server creates the exact question sequence and recomputes correctness and points; it checks ownership, expiration, live exclusions, time bounds, and replay behavior. It cannot attest a device's clock or prevent a modified client from reading its answer key. Do not fold these results into multiplayer Elo or describe them as cheat-proof competitive times. Random short rounds share a cohort but can differ in difficulty.

## Integration for Claude

- `public/gsb/use-sprint-round.js` exports `useSprintRound(account)`. It owns preparation, ready/start/play/expiry states, input guards, timing, private media and result recovery. Mount the view with `key=account.id`.
- `public/gsb/sprint-round.js` exports `SprintRound({account,onExit})`. It renders the controller state and moves focus only when entering play or results, never between answers. This is the file to redesign.
- `public/gsb/sprint.css` only styles sprint elements. Existing Parlor tokens and the common answer-grid classes are reused.
- `public/gsb/round-media.js` preloads with six concurrent requests and owns its object URLs; the controller revokes them when the next round is prepared or adopted and on exit, so the result screen can review every pairing with its portrait. Decoded image objects are kept only for the next six questions. The shared twelve-portrait practice cache is unaffected.
- `public/kits/recognition/sprint.js` exports the pure `scoreSprint` function shared by browser and server.
- `server/gsb/sprint.js` stores run documents separately from rooms, practice reviews, guest results, and multiplayer ratings.
- The shell changes are limited to recognizing `/speed`, lazy-loading the component, and adding the home entry. Preserve these while redesigning the main frontend.

Preserve immediate advancement, synchronous stale-input rejection, held-key suppression (including native Enter activation on buttons), monotonic timing with a wall-clock suspension fallback, preloading before the clock, and result-save recovery. Changes to animation must never lock the next question or delay the timer stop. Keep names out of portrait alt text before the player answers. There is no tilt input in the first speed screen; existing practice/multiplayer tilt remains available.

## Authenticated API

- `POST /api/sprint/prepare {direction,length}` returns `{id,direction,length,count,revision,questions,records}`. `direction` is `face|name|mixed`; `length` is `quick|short|class` (10, 20, or the whole class). Questions contain `correctChoice` for local result computation, within the same authenticated content boundary as the class deck.
- `POST /api/sprint/start {id}` arms the run idempotently and returns `{id,startedAt}`.
- `POST /api/sprint/finish {id,answers,elapsedMs}` returns the first persisted result. Each answer is `{questionId,choice}` in the issued order. Extra client score fields are ignored.
- `GET /api/sprint/records?direction=face&length=short` returns `{bestScore,fastestPerfect,leaders,perfectLeaders}` for the current comparable cohort.
- `POST /api/sprint/challenge {direction,length}` makes a shared sequence under a four-letter code, good for seven days, and joins it as the host. `POST /api/sprint/challenge/CODE/join` returns this account's run for that code (created on first join, replayable from the top if it was abandoned, or its result once finished) with `standings`. `GET /api/sprint/challenge/CODE` returns the settings, host and standings for polling. Challenge runs start and finish through the ordinary start and finish routes, count toward the normal speed records, and never touch multiplayer ratings. Standings rank finished players by score, then elapsed time; nicknames are joined at read time.

All routes require the existing account session and POST origin checks. The additive `gsb_sprint_runs` table is provisioned by the normal migration script. Preparation opportunistically removes a bounded number of expired unfinished runs. Completed records remain available without a cron service. No dependency, external service, paid tier, or realtime connection was added.

## Validation

Unit tests cover accuracy priority, exact answer ordering, invalid choices and time bounds. Isolated HTTP/Postgres tests exercise ownership, start/finish lifecycle, concurrent replay, scoring, records, opt-outs, and separation from multiplayer ratings. Browser tests cover both directions, preloaded portrait choices, held-key rejection, missing-image recovery, failed saving followed by reload recovery, and measured tap-to-next DOM latency with no inter-question HTTP. Browser measurements are local engineering checks, not a guarantee for every physical phone.

## Duels

A duel is a challenge with `mode: "duel"`: ten classmates, face to name, two choices a question (the person and their most confusable classmate), everyone on one count. `POST /api/sprint/challenge {direction:"face",length:"quick",mode:"duel"}` makes one; the usual join route enters it. `POST .../CODE/ready` marks a player ready; `POST .../CODE/begin` (host only) sets `starts_at` four seconds out and stamps it as `started_at` on every run in the room, so the finish check measures everyone from the same instant; `POST .../CODE/progress {index,right}` is fire-and-forget live progress that never counts for the score; `POST .../CODE/rematch` makes a new duel with the same settings and stores it as `next_code` on the old one so the others can follow. `GET .../CODE` carries `mode`, `choices`, `startsAt`, `nextCode`, `now` (for clock offset) and per-player `ready`, `progress` and, once finished, `missed` (question positions), since a result now stores the choices made. A player who joins after the count plays from then on their own clock. Clients poll every second during a duel. The result counts toward the normal quick speed records; ratings are untouched.
