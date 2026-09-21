# Frontend integration entry point

This is a working application, not a set of static mockups. Apply the approved visual design to the existing behavior and keep the same accounts, content, progress and result ledgers.

Worktree: `/Users/wesley/projects/parlor-gsb`, branch `gsb-classmates`. Production: `https://gsb-classmates.vercel.app`. Original Parlor is a different worktree and deployment. Inspect `git status` before editing and preserve other agents' changes. Do not force-reset this branch or overwrite the whole application with a mockup. Runtime browser dependencies are vendored Preact and htm; there is no bundler or UI framework to introduce.

Read `AGENTS.md`, [CLAUDE-DESIGN-HANDOFF.md](CLAUDE-DESIGN-HANDOFF.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [VALIDATION.md](VALIDATION.md). `PLAN.md` is product intent; `VALIDATION.md` is the evidence of what has actually been exercised. The user is developing the final visual direction with Claude; the current editorial styling is replaceable.

The isolated `codex/face-history` branch also contains the [responsiveness and recovery review](PERFORMANCE-REVIEW.md): bounded/cancellable API requests, fewer setup requests, shared checkpoint draining and monotonic duel progress. Preserve those controller contracts when merging styling work. No visual redesign or new dependency is required.

The canonical source is now [wesleyzhao/classmates](https://github.com/wesleyzhao/classmates), locally `/Users/wesley/projects/parlor-public-source`. Use branches from its `main` for new design work. The original private repo and Claude checkout remain historical references; never merge their Git history into the clean public repository. This source already includes Claude's reviewed design and the Speed buffer fixes. See [LAUNCH.md](LAUNCH.md).

## Mode map

| Mode | Entry and view | What moves it forward | Persistence and timing |
| --- | --- | --- | --- |
| Practice | `/practice`, `Practice` in `app.js`, common `Answers` | Correctness immediately, then Next | Spaced repetition by person and direction, queued idempotent review writes, no Elo |
| Speed round | `/speed`, `SprintRound` plus `useSprintRound` | Every tap immediately, including wrong answers | One completed log, browser time, accuracy-first score and fastest-perfect records, no Elo |
| Together | Home / Start a quiz, room view in `app.js` | Server moves every player through shared phases | Server scores accuracy and speed, server-only answer key before reveal, multiplayer Elo |
| Race | Home / Start a race, same room view | Correct answer only; mistakes remain on that question | Server timing/order, fixed account seats, multiplayer Elo |
| Guest introduction | `/` and `/guest`, `GuestRound` | Ten preloaded faces, automatic 3–2–1, immediate taps or flicks | One browser attempt, inline email sign-in to save or continue; operator-configured sample only |

`/profile` edits the current nickname without changing identity; `/scores` renders the server's rating and badge decisions. Keep room sharing, chat, rejoin, sign-out, used-link recovery and browser-back navigation reachable. Home must retain the speed entry in addition to practice and both multiplayer modes.

## What to restyle

- `public/gsb/style.css`: shell and existing screens. Use theme tokens from `public/themes/`; keep selectors scoped to avoid breaking Parlor.
- `public/gsb/app.js`: shell and existing views. It also currently owns application routing and practice/room behavior, so preserve its effects and action handlers when changing markup.
- `public/gsb/components.js`: shared answer/photo/input primitives. `Answers` calls `onAnswer(choiceId)`; it does not decide scores. Its image cache, input latch, permission flow and accessible labels are functional behavior.
- `public/gsb/sprint-round.js` and `sprint.css`: speed presentation and screen-boundary focus. Keep `/speed` lazy loading and the stylesheet in `index.html`.
- `public/gsb/use-sprint-round.js`: reusable speed controller. Reuse it in a new presentation rather than copying its logic into animations.
- `public/gsb/practice-reviews.js`: Practice save queue, owned by the shell. Preserve `add`, `retry`, `pending` status and account lifecycle when restyling. Wrong answers are retained just like correct ones, including retries after same-tab reload. Do not move this queue into an individual question component or await a save before enabling Next. Only Practice updates spaced repetition.

## Speed controller contract

Mount a view using `key=account.id`, then call `useSprintRound(account)` once. Do not mount a second controller for a decorative preview: mounting reads pending results and can retry a save.

| Returned data | Meaning |
| --- | --- |
| `phase` | `setup`, `loading`, `ready`, `arming`, `playing`, `result`, or `expired` |
| `direction`, `round`, `question`, `answers` | Chosen direction, issued round, current question, completed ordered choices |
| `loaded` | `[finishedPhotoCount, totalPhotoCount]` during preparation |
| `photoUrls` | Round-owned Map from protected source to prepared blob URL; only use while ready/playing |
| `elapsed`, `result`, `records` | Whole-round milliseconds, calculated/persisted result, comparable personal/class records |
| `error`, `saving`, `saved`, `unsavable` | Recovery status. A terminal rejection permits a fresh round; a transient error retains retry |

Actions: `changeDirection(value)` and `changeLength(value)` in setup/ready/loading, `prepare()`, `start()` when ready, `choose(question.id, choice.id)` while playing, and `save()` to retry a completed result. `onExit` remains a view/shell callback that unmounts the controller. Never mutate returned answers, result, round or media maps. Never revoke its URLs in the view.

A prepared 20-person solo sequence includes two independently issued 10-person runs. `sprint-buffer.js` selects the requested length without fetching questions or photos. Switching 20/10/20 before starting keeps the same sequence; after playing the first 10, Play again uses the second 10. The shared media stays owned by the controller until the batch is exhausted or the screen unmounts. `round.mediaOffset` translates that run's lookahead into the full photo sequence; it is not a question index to display or send. Each half has a separate server run ID, ordered answer log, timer, records and face history. Starting consumes overlapping alternatives in the local buffer; a failed start keeps the selected run retryable. Changing length while a compatible 20 is downloading retains that download. Direction changes still prepare new questions. Challenges and duels keep their fixed shared sequence.

A choice ID is a string `0` through `3`. Pass the ID of the question that was actually rendered so stale queued clicks cannot answer a new question. The controller handles keys 1 to 4 and suppresses held keys; retain `data-sprint-answer` on answer buttons so native Enter suppression remains independent of CSS class names. Use native buttons, retain focus styles, and do not intercept shortcuts while typing.

No loading, animation or network request may lock the next answer. Prepare every photo before starting. The timer starts after the server start acknowledgment and first question render, stops on the final input, and counts background time. Display results immediately while saving. Do not write an optimistic result to Elo or build another score formula in the view.

Keep a stable prompt area for short and long names, fixed answer targets, `object-fit: contain` for portraits, and at least 44px touch areas. The current view scrolls the play region into view once at the start and moves focus to the result heading at completion. Do not move focus or scroll between questions. Do not put a person's answer/name in a portrait's alt text before answering.

## Required recovery states

Implement these in the final design, even if they are visually quieter than the happy path:

- Email requested, invalid/used/expired link, explicit Continue, request-new-link, expired session.
- Failed nickname save with the draft retained.
- Practice progress pending/failed with safe retry, failed image, no due reviews and end of full deck.
- Room unavailable, reconnecting, occupied/fixed seats, waiting for others, reveal, race wrong-answer cooldown and final standings.
- Speed photo preparation, missing photo with Retry, starting handshake failure, unfinished round abandoned, one-hour expiry, result saving, failed save with Retry, and terminal save rejection with Play again.
- Empty personal/class records. Guest disabled must remain absent, including direct API access.

Completed speed retries survive same-tab reload in account-scoped sessionStorage. An unfinished round does not resume. Photo blobs stay in memory and are revoked on exit or session loss. Solo client timing is intentionally casual and does not attest a cheat-proof record.

## Verification workflow

Use the commands in [OPERATIONS.md](OPERATIONS.md). The database test schemas and local mail outbox are isolated from production; never substitute `public` for a test schema. Do not use real classmates or real score accounts for automated completions.

```bash
npm test
npm run check
npx playwright test -c playwright.gsb.config.js
npx playwright test -c playwright.gsb-guest.config.js
```

Run the two browser suites sequentially. The first starts its own synthetic server on port 3138; the guest suite uses 3139 and a fictional enabled sample. Port 3137 is the real signed-in local preview. Test login delivery is a local outbox, not a real email delivery claim. Targeted speed verification is `npx playwright test -c playwright.gsb.config.js tests/gsb/sprint.browser.spec.js tests/gsb/sprint-touch.browser.spec.js`.

For changes to backend contracts, rerun the corresponding isolated HTTP/Postgres suites documented in OPERATIONS.md. `sprint.integration.js` must use `gsb_test_sprint_api`, and covers ownership, completion races, records and opt-outs. `database.integration.js` covers account identity, rooms and ratings. `guest.integration.js` covers the disabled gate and claims.

Inspect fresh screenshots in `output/gsb-screenshots/{chromium,webkit}/` at 390px phone and 1365px desktop widths. Speed tests additionally inspect 320x568, both directions, a long name, fixed button rectangles and a real browser offline/reconnect cycle. The separate touch spec uses mobile browser emulation to check 20 taps, no unintended zoom and no in-round portrait requests. The speed timing assertion measures click-to-DOM update below 100ms, not actual physical-device paint latency. Preserve semantic roles, input labels, `data-question-id` and `Photo`'s `data-source`, or intentionally update matching test selectors without weakening behavior assertions.

After styling, inspect every major state above, narrow widths and larger text. Test native Safari on a physical iPhone for browser chrome, actual tilt permission/sensitivity and haptics before claiming device verification. Desktop WebKit and simulated motion are useful but do not cover those hardware checks.

## Release checklist

1. Run unit/type checks and both browser suites; inspect screenshots and console errors.
2. Review the diff for bundled private data, accidental guest enablement, duplicate score writes or changes to authoritative game rules.
3. Update VALIDATION.md and TODO.md with exact evidence and remaining limits.
4. Commit and push `gsb-classmates`; apply only necessary additive schema migrations before deployment.
5. Deploy from this worktree with `vercel deploy --prod --yes --scope wesleyzhaos-projects`. Shared-repo automatic deployment is intentionally disconnected.
6. Verify live health/session, unauthenticated private-API denial, the configured guest behavior, a real signed-in page and private portraits, then scan Vercel errors. Avoid creating fabricated scores in the real class ledger.

## Cross-mode face history (Codex branch after `1fb62d4`)

See [FACE-HISTORY.md](FACE-HISTORY.md) for the selection policy, personal history component, partial-run checkpoint lifecycle, database migration and API changes. Duels now require the loaded `selectionVersion` for Ready and Start. Preserve the controller's refresh/preload flow while styling. Only Practice updates spaced repetition. The visual changes are confined to an expandable account history panel; the arcade and duel artwork are unchanged.

## Ten-face entry contract

`CLASSMATES_LANDING=quick` makes signed-in `/` open Speed with `initialLength="quick"`; `/games` retains the complete game menu. Direct Practice, account, scores, room, challenge and login links take precedence. The default fork setting stays `games`. The guest flag and approved sample are separate from the signed-in landing choice.

`GuestRound` owns its media through `prepareRoundMedia`. Its countdown starts only after decoding succeeds and restarts if the page becomes visible during the countdown. Answers update synchronously, check the displayed question ID and never wait for an animation or HTTP. `sprint-pieces.js` supplies the same portrait and choice artwork to both guest and signed-in Speed. Keep guest input and result prompts inside the full-screen cabinet: shell-level notices sit behind it. The shared `Login` supports a compact inline email form and displays its own errors.

Preserve the server-issued guest cookie on email login so the completed result can be claimed. Never send guest attempts to rated multiplayer or Practice repetition. The existing claim trigger adds observed faces to cross-mode history. See [GUEST-ROUND.md](GUEST-ROUND.md) for storage, expiry and replay limits.
