# Face history and coverage

Work branch: `codex/face-history`, based on Claude's `1fb62d4`. Worktree: `/Users/wesley/projects/parlor-gsb-history`. Claude's original checkout remains separate. No new packages or services.

Production is running implementation commit `5487906`. Before Claude deploys again from `/Users/wesley/projects/parlor-gsb`, merge `origin/codex/face-history` into its branch, preserving any newer design changes. Alternatively, continue design work in this worktree. The original checkout was deliberately not modified underneath Claude.

## Behavior

Every mode now selects from lifetime account history, across devices and question directions. Solo rounds prefer unseen classmates, then those played least, then least recently. Prepared rounds and prefetched portraits do not mark a whole sequence as seen. Distractor thumbnails do not count as target encounters.

Practice retains its due-first spaced-repetition schedule. Within new-to-Practice cards, people unseen across all games come first. Wrong answers still return a few cards later. Speed, duel, challenge, room and guest results never update Practice's memory schedule. Practice records an encounter when an answer is submitted, including later repeated reviews.

Together and race choose one sequence from the entire seated roster's history at start. Duels choose from the players present in the lobby. Selection prefers faces unseen by everyone; when that pool runs out, it balances novelty across players, then prefers lower exposure and older encounters. Both competitors always receive the same questions and choices.

An asynchronous challenge remains fixed after creation because future players are unknown. Its creator's history determines the initial sequence. A duel refreshes when another player joins before the count, clears previous readiness, and preloads the new sequence. Readiness and Start include a sequence version. A stale client cannot start with different questions. Once the count starts, the sequence is immutable, including for late arrivals. Rematches use fresh history.

## What gets counted

- `seen`: target encounters recorded by the app, not a claim that someone looked at the screen. For rooms this means a question offered to that seat; disconnected seats may still be offered timed questions.
- `correct` / `wrong`: the first answer to an encounter. Unanswered questions are neither.
- `attempts` / `mistakes`: all accepted taps. A race wrong-then-right has one first-answer mistake, two attempts and one wrong tap. It never becomes first-answer correct.
- `last_seen`: the recorded encounter's time. A speed round uses its start time; accuracy updates preserve that time.

Counts retain mode and actual question direction. Selection combines them by person. Stats are personal by default: open your nickname, then **Your face history**. The panel shows coverage, most missed, most right, and denominators. Rankings are counts, not claims about statistical confidence.

Speed/challenge/duel taps update a small account-scoped `sessionStorage` prefix synchronously. A background request flushes it on screen exit, tab hiding, page hiding, reconnect, or before preparing another round. Completing a run commits its whole history atomically with its score. Nothing waits for the network between answers. An abrupt device/process kill can leave unflushed history; the same tab retries stored prefixes next time. Offline activity on another device cannot influence selection until it syncs. Simultaneously prepared rounds can overlap; preparation does not reserve faces.

Restarting an unfinished asynchronous challenge keeps its fixed sequence but uses a new attempt epoch. The abandoned attempt's history remains; stale requests cannot rewrite the new attempt. Claimed, completed guest rounds contribute once after verification. The anonymous experiment remains disabled unless explicitly enabled by the operator. This change does not alter the separate test-door switch.

## Storage and transaction boundaries

`gsb_face_observations` is an idempotent cumulative receipt per account, source attempt and question. `gsb_face_totals` is a compact indexed rollup per account, person, mode and direction. A database trigger adds only the receipt delta, so retries and concurrent updates do not inflate counts. Foreign keys cascade both tables when an account is removed, including test-door cleanup.

- Practice: `gsb_review` records history in the same transaction as the existing deduplicated review ID and schedule.
- Sprint variants: a trigger records validated prefix/final-answer changes in the same transaction as the run update. `gsb_checkpoint_sprint` locks the run, validates its epoch and rejects conflicting prefixes.
- Rooms: the recognition kit maintains private `_history` and `_seen` fields. The room trigger records only changes after a successful room CAS. These fields are not in public views. Correctness remains server-authoritative.
- Guest: a trigger records the verified account claim once.

No separate analytics service, browser SDK, scheduled job or per-tap network request was added. Receipt storage grows with questions played; totals reads stay bounded by class size and modes. Do not delete receipts alone: totals would then disagree with the idempotency ledger. Future retention can compact old receipts only after source attempts can no longer be replayed.

## Reusable code and Claude handoff

- `public/kits/recognition/selection.js`: pure, seeded selector; works for other image/name decks too.
- `server/rooms.js`: optional async `prepareSetup` hook, inside the existing CAS retry. Default is empty. The GSB subclass loads roster histories and supplies private `ctx.targets`; kits remain pure.
- `public/gsb/face-checkpoints.js`: persistence and background flushing, independent of presentation.
- `public/gsb/use-sprint-round.js`: lifecycle integration, sequence refresh/preload, ready/start versioning. Keep these safeguards when restyling. Next-round prefetch waits for the finished result to be saved, ensuring it uses that history.
- `public/gsb/learning-summary.js`: small account details panel, using existing classes. Safe to restyle independently.
- `server/gsb/face-history.js`: account exposure loading, shared selection, personal summary.
- `server/gsb/face-history.sql`: observations, rollup, source triggers and prefix validation.
- `server/gsb/challenge-lobby.sql`: row-locked join, ready and start operations.

Claude's arcade artwork, CSS, flick gestures, sound and duel component remain intact. The app shell only imports the summary panel and seeds Practice's order from exposure. The controller changes are functional; avoid reverting them while adjusting the visuals.

## API additions

All endpoints require the current authenticated account; there is no client-supplied account selector.

- `GET /api/learning`: `{ total, seen, unseen, correct, wrong, faces, mostMissed, mostCorrect }`. Faces include `{id,name,image,seen,correct,wrong,attempts,mistakes,lastSeen}`. Live exclusions are applied.
- `GET /api/progress`: existing `progress` plus `exposure`, a person-keyed map of `{seen,lastSeen}`.
- `POST /api/sprint/history`: `{id,epoch,answers:[choice],seen}`. Only a started, unexpired owned run; the prefix must match the stored questions. `seen` is at most answered count plus one.
- Challenge join/view responses carry `selectionVersion`; `ready` and `begin` accept `{version}`. Existing legacy challenges without a version continue accepting a null version.
- Joined runs carry `historyEpoch`; finish and history calls pass it (default `"0"` for ordinary/new runs).

For an operator-only aggregate report:

```sh
node --env-file=.env.local scripts/gsb/face-report.js
node --env-file=.env.local scripts/gsb/face-report.js practice
```

This reports classmate names and aggregate counts, distinct players and first-answer accuracy. It exposes no player identities and creates no public analytics endpoint.

## Migration and historical limitations

Run `npm run gsb:migrate` before deploying this branch. Migrations are additive and repeatable. One-time `face-history-v1` backfill imports existing Practice lifetime counts, completed speed/challenge/duel answers, claimed guest results, and recoverable target exposure from completed older rooms. Combined Practice memories take precedence over old per-direction rows, avoiding double-counting; unrecoverable Practice direction is labeled `unknown`.

Older completed speed runs without individual answers contribute exposure only. Completed old room documents lacking per-question history contribute exposure up to their recorded progress, with unknown accuracy; their aggregate scores are left intact. Unfinished historic runs are not assumed fully seen. Backfill subtracts already-recorded modern Practice counts and is safe to run again without changing totals.

## Validation checklist

- [x] Shared coverage-first selector and multiplayer balancing.
- [x] Atomic, retry-safe history across modes.
- [x] Personal history and operator aggregate report.
- [x] Practice scheduling remains Practice-only.
- [x] Background partial-round reporting without waiting between answers.
- [x] Duel sequence versioning and readiness protection.
- [x] Final unit, type, database and browser checks.
- [x] Production verification.

Focused tests are `tests/gsb/selection.test.js`, `face-history.integration.js` and `face-history.browser.spec.js`. Use `NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_history` for the database suite, after running `scripts/gsb/test-setup.js`. Browser tests use the existing isolated `playwright.gsb.config.js`, Chromium and WebKit. Never use real class accounts as test fixtures.


Production deployment: `dpl_BBfgM5c9p9JdRiN3akaf875VvXJT`, [live app](https://gsb-classmates.vercel.app), implementation commit `5487906`. Migration and backfill completed on September 18, 2026 (America/Los_Angeles). Existing account, memory, review, rating, match and completed-sprint counts were unchanged. The authenticated production account panel loaded real coverage and right/wrong counts. No production questions were answered during verification.
