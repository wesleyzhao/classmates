# Classmates validation

## Current release

The clean public repository and ten-face landing are live. See [LAUNCH.md](LAUNCH.md) for the current source, deployment, completed checklist, production checks and rollback. This release passed 506 unit tests, 66 Classmates browser checks, 12 guest browser checks, 7 original Parlor browser scenarios and 10 focused HTTP/database integration cases, plus type, build and privacy checks. Live Chromium and WebKit guest flows and existing signed-in access were also verified. The guest feature is now enabled with a fixed ten-person sample; older entries below describe earlier releases.

## Earlier verification

- Existing Parlor plus recognition/SRS/tilt/domain/cache/distractor/guest/ranking/nickname/speed tests: 475 passing tests. JavaScript type checks pass.
- Real Postgres integration: ten passing tests, including nickname propagation and stale-write rejection, concurrent one-use link consumption, fixed seats, atomic completion, idempotent study reviews, stored mistakes and review resets, live exclusions, and eight simultaneous join/answer requests. The membership case also rejects an outsider snapshot and action through the optimized room path.
- Two additional real HTTP/Postgres guest integration cases cover the disabled gate, restricted assets, live opt-outs, atomic completion, verified claims, account ownership, retained personal bests, and unchanged competitive ratings.
- Forty-six ordinary browser cases (twenty-three stories in Chromium and WebKit) pass, covering sign-in through a local email outbox, nickname, practice in both directions, private-content access checks, sign-out, complete-deck traversal, browser back navigation, two-person room, chat, shared answers, rejoin, race mistake/correct progression, used/expired-link recovery, simulated tilt/permission behavior, delayed/failed background progress saves with idempotent retry, missed-review recovery through reload, preloading all photo choices for the next practice question, rapid direction changes with delayed images, top/bottom ranking badges, the disabled guest boundary, and continuous speed rounds.
- Four enabled-guest browser cases use a separate fictional sample. They cover eight questions, a wrong answer, timeout, refresh recovery, failed finish and retry, completion without replay, same-browser email sign-in, saved confirmation, and personal best display.
- Screenshots inspected at 390px phone width and 1365px desktop width. Corrected inherited card styles, header height, answer grid width, and Safari select sizing.
- All 415 real portraits imported successfully. Optimized local total: 18,834,998 bytes; largest portrait: 120,800 bytes. Data in Git/static build contains no real roster records.

## Evidence boundaries

The four enabled-guest browser cases also passed after the Practice queue changes. The real guest experiment remains disabled.

Practice recovery deployment: `cd5a654` is live at `https://gsb-classmates.vercel.app`, Vercel deployment `dpl_C7zkG8pb1LJrCFwC2Z2LmqfjkqQo` (READY, five-second build). The authenticated live Practice page loaded the real 415-person deck, a portrait, existing review counts and due reviews. This smoke check did not submit a review or game result. Public health/session and the new queue module returned 200; unauthenticated deck/progress returned 401; guest returned 404 with the flag disabled. The five-minute production error scan returned no entries.

Practice mistake follow-up: all 475 unit tests, type checks, ten real Postgres integration cases in `gsb_test_learning`, and all 46 ordinary browser cases pass. The new browser story deliberately misses a card, loses a request before it reaches the server, reloads and verifies one saved miss. It repeats with the server committing before its response is lost, then verifies the original action ID prevents double-counting. Advancing only the client clock by 61 seconds verifies saved missed cards lead the next traversal. New queue tests cover ordering, account isolation, sign-out during a request, unavailable browser storage, live exclusions and stale progress merges. Phone/desktop recovery screenshots were inspected in Chromium and WebKit. No new schema migration or dependencies are needed; only Practice updates learning progress.

Frontend integration review: the full 42-case ordinary suite, two additional mobile-touch cases, and all four enabled-guest cases passed after the controller extraction and UX fixes. The eight affected focus, layout, latency and touch cases passed again after separating the input marker from CSS and refining programmatic focus styling. Unit/type checks and both sprint HTTP/Postgres cases were rerun successfully. Coverage now includes native held-Enter rejection, result-heading focus, identical answer rectangles across short/long names at 320x568, leaving during media loading, fresh re-entry, and completing offline then saving after reconnection. Touch cases send 20 mobile browser taps and verify no accidental zoom or additional portrait requests. This is browser emulation, not a physical iPhone test. The 42-case run measured maximum click-to-next DOM updates of 2.8 ms in Chromium and 3.0 ms in WebKit. Screenshots were inspected at 320, 390 and 1365 pixels.

Speed-round follow-up: all 34 ordinary browser cases and all four enabled-guest cases passed on the final implementation. Eight speed cases cover immediate advancement in both directions, all-photo preparation, zero inter-question HTTP, held-key suppression, missing-photo recovery, fastest-perfect eligibility, failed-save recovery through reload, and expired completion recovery. Maximum measured click-to-next DOM update was 14.1 ms in Chromium and 2.0 ms in WebKit during these local runs; this is not a physical phone paint measurement. Phone and desktop screenshots were inspected in both engines.

Two new HTTP/Postgres cases in `gsb_test_sprint_api` passed. They cover authenticated ownership, start idempotency, malformed submissions, concurrent first-completion wins, score recomputation, per-account class records, exact comparison groups, whole-class API length, live exclusions, and unchanged multiplayer ratings. These records are client-timed casual solo results, not attested competitive timings. No real account received a synthetic completion.

Nickname follow-up: four targeted browser cases passed across Chromium and WebKit (first-login/email default/edit/persistence plus the existing login/profile/practice/sign-out story). Verified a nickname longer than 16 characters in existing and new rooms, failed-save draft retention, native length validation, unchanged account ID, and reload persistence. Screenshots were inspected at 320px and 1365px. The full previous 24-case ordinary suite and four enabled-guest cases were not rerun for this focused follow-up; the new nickname story brings the ordinary suite to 26 cases.

Browser tests use synthetic people in a separate `gsb_test_browser` Postgres schema. The local test outbox exercises link generation, expiry rules, one-use consumption, cookies, and the UI, but does not prove that a real email was delivered. No synthetic test records enter the production class ledger.

Enabled guest browser and HTTP tests use `gsb_test_guest` and `gsb_test_guest_api`, with fictional people and local test media. The real guest experiment stays disabled. Tests do not expose real classmates to unsigned visitors.

Real data has been imported into the dedicated production database and private Blob store. Private delivery requires the same verified session as the rest of the app. Production smoke checks returned 200 for health and session, and 401 for unauthenticated deck, progress, leaderboard, room, and media requests. All API responses used no-store. Three sampled private Blob objects returned valid JPEGs with authorized reads and denied direct unauthenticated access. Vercel returned no runtime error entries during the smoke window.

Automated tilt tests cover calibration, dwell, neutral reset, sensor gaps, missing readings, beta-angle wraparound, and calibration retained between questions. Chromium and WebKit browser tests simulate the iPhone permission gesture, four sensor directions, held-tilt suppression across questions, disabling controls, and denied-permission tap fallback. Physical iPhone permission UX and actual tilt direction/sensitivity are still unverified; WebKit desktop does not substitute for a device check.

## Bugs and revisions

- Frontend integration review reproduced native held-Enter activation answering multiple speed questions. The controller now suppresses repeated Enter/Space activation as well as held number shortcuts. The browser regression failed before the fix and passes after it.
- A new 320x568 WebKit check found a long reverse-question name shifting all four photo choices by about 25px. Reserving a three-line name area keeps button rectangles identical across short and long names. The targeted test passes in both engines.
- Speed-round behavior is extracted to `use-sprint-round.js`; the view retains screen-boundary focus and scroll behavior. Completion focuses the result heading, while rapid answer transitions preserve focus and position. New coverage also exercises cancellation/re-entry and real browser offline/reconnect saving.
- Extended CAS retries to handle the supported eight-player burst, then verified all eight seats and all answers persist.
- Added pre-parsed JSON body size enforcement to match the existing stream limit.
- Kept shared answers and correctness private until reveal, and rejected stale race question IDs.
- Preserved opt-outs across imports and voided active affected games to keep ratings fair.
- Prevented room undo, restart, settings changes, late joins, and account duplication in competitive rooms.
- Fixed CSS collisions with Parlor's playing-card and masthead classes.
- Made phone answer grids fill the available width and explicitly sized native Safari selects.
- Added browser history navigation for the standalone app routes.
- Fixed a Safari-visible practice transition race by computing the new question in the same render as its counter.
- Redacted opponent wrong-choice/cooldown data from room summaries.
- Prevented overlapping answer submissions and retained chat text after failed sends.
- Corrected a browser test to wait for sign-out completion before checking authorization; the server's revocation behavior passed afterward.
- Moved the tilt listener and per-question reset into layout effects, so WebKit cannot paint enabled controls before their sensor handler is ready.
- Isolated browser-test network identities after the larger suite correctly hit the production email-per-IP limit; production rate limits remain unchanged.
- Fixed same-tab fragment-only sign-in links: an already-open login page now reacts to the incoming credential and displays confirmation without requiring a reload.
- Added immediate multiplayer selected state while a deliberately delayed answer request is pending, without revealing correctness prematurely.
- Removed the duplicate room membership query while retaining checks inside the authoritative read/action and every CAS retry.
- Restored shuffled new-card ordering when review priorities tie, and allowed number shortcuts on focused answer buttons.
- A final browser run caught a portrait disappearing after a direction change even though its HTTP response was 200. Mounted photos now retain their cache entry, future preloads evict only unmounted entries, and rendering checks the current cache URL rather than an old resolved URL. Deterministic unit coverage holds four visible loads while twelve future portraits arrive; the cache remains capped at twelve.

## Remaining release gates

1. Local and production email round trips have succeeded. A second physical device remains a manual check.
2. Test tilt on an actual iPhone before presenting it as fully device-verified. Tap and keyboard remain available.
3. Claude's final visual design is still a separate design pass, as requested by the owner.

The ordinary login flow requires email ownership. An explicitly configured operator can grant a labelled, one-day owner preview; it does not mark the email verified and has no public issuing endpoint.

## Published deployment

Production URL: https://gsb-classmates.vercel.app. The app protects the full real cohort. Descope is live. The delivered production link signed into the account, loaded a real private portrait, and was rejected on reuse. Unauthenticated private APIs remain 401; health and session are 200. No production runtime error logs appeared in the smoke window.

Current production release, September 16, 2026 (America/Los_Angeles): frontend integration review at code commit `b0273e2`, Vercel deployment `dpl_2vCvkbYerjnvAm43k8SLXJPuQkiE`, READY and aliased to the production URL. Build took five seconds; no migration or dependency changes were required. Verified the new controller module serves as JavaScript and `/speed` loads for the existing verified production session. Prepared a real name-to-face round, inspected all four live portraits, started timing, answered once, then exited without adding a synthetic score. Health/session returned 200; private deck and sprint records returned 401 without a session. Guest remained disabled and returned 404. The five-minute production error-log scan found no entries. All 469 unit tests, type checks, two sprint HTTP/database cases and 48 distinct browser cases passed. The expired local owner preview correctly returned to sign-in on reload; synthetic localhost verification uses its separate test schema.

Previous speed-round release: code commit `19915d2`, Vercel deployment `dpl_Cqj9RUMCtdhpAxP9PuwvshaWMaNK`. The additive schema migration completed before deployment. Verified face-to-name play and private portrait preparation locally and in production, unauthenticated denial for every sprint endpoint, and disabled guest access. All 469 unit tests, type checks, two new HTTP/database cases, and 38 browser cases passed.

Previous nickname release: code commit `d86fce0`, Vercel deployment `dpl_7M4x6jSGSAG6jDxzQrooAwapePNa`. Verified the live masthead Edit nickname button and `/profile` editor without changing the owner's saved name. All 465 unit tests and type checks passed, as did nine database integration cases and four targeted browser cases. The nickname database case was additionally rerun with a populated rating row to verify rating/games/wins remain unchanged.

Previous rankings/guest release: code commit `31108b9`, Vercel deployment `dpl_5R4ePicC8Y9BVLrrQW37BgY1WBue`. Public health/session and private API denial checks passed. Guest read/start/finish/claim/best/media routes all returned 404, including attempts to enable through a query parameter. No real public sample is configured. An initial CLI authorization failure was resolved by specifying `--scope wesleyzhaos-projects`; that explicit scope is in the operations instructions.

Previous responsiveness/review release: code commit `3c45244`, Vercel deployment `dpl_Fb7Yt3bqC5QhWCDJMX6QXF2jF5RT`. That release introduced the compact prompt/choice UI and reviewed portrait/name peers.

## Email follow-up

A real Descope email arrived at the owner's confirmed Stanford mailbox on September 15, 2026 (America/Los_Angeles). Following its localhost link and pressing Continue created a normal email-verified app session. The real 415-card deck is available locally. The adapter tests require exact verified recipient matching, reject provider test users and provider errors, require the provider proof in addition to the app challenge, and remove pending challenges after delivery failure. Database tests verify origin binding, one-use owner preview, one-day expiration, and later verified-email upgrade.

## Distractor follow-up

Classmates opts into reviewed portrait peers for practice, Together, and Race, with lexical name similarity as a tie-breaker/fallback. Three GPT-5.6 reviewers inspected all 415 portraits, with independent spot checks and joint name/portrait checks. All 415 names and their leading lexical neighbors were audited, leading to improved token-aware name scoring. Two ambiguous group photos use lexical fallback. No inferred gender, ethnicity, nationality, or identity labels are stored. Raw neutral annotations remain private; only opaque peer IDs are published in the immutable deck revision. Other recognition games still default to random choices.

Focused tests cover unknown/covered features, evidence thresholds, deterministic peer selection, exclusions, hash verification, lexical normalization, weak-match fallback, uniqueness, random correct positions, redaction, and unchanged target coverage. The real deck has 415 distinct names for 415 people.

## Responsiveness follow-up

Practice displays correctness and enables Next immediately while progress saves in the background. Failed saves retain their original action ID for retry. Up to twelve authenticated portrait blobs are kept in session memory, including current choices and a small upcoming window; sign-out/session loss revokes them. No persistent browser cache is introduced.

Practice generates a rolling window of the current and next two questions, pruning older generated questions. Advancing reuses the generated options, so preloaded name-to-face choices are the exact ones displayed next. The regression checks that all four sources were fetched before advancement and that none are requested again afterward. The full sixteen-case suite passed before this final enhancement; the ten affected practice/tilt cases, including the new preload regression, then passed across both browser engines. The tightened no-refetch assertion also passed separately in both engines.

Browser checks found and corrected a stale-photo transition: a resolved blob is now rendered only when its original source matches the current question. Full-deck tests wait for the visible save indicator to clear before checking persisted progress. Phone/desktop screenshots and the real local deck were inspected again after compacting the practice header. Save indicators sit below the game to prevent answer-button movement during a background request.

Redundant visible question wording is removed. Shared games use a one-second initial preparation, a half-second between-question preparation, and a 1.5-second reveal. Readiness triggers a targeted refresh rather than waiting for the next regular poll. Deck loading and current exclusions now use one database request instead of three: three warm development-to-Neon samples changed from 448/224/225 ms to 77/80/79 ms. These are development observations, not production or iPhone latency guarantees.


## Cross-mode face history, September 18, 2026

Branch `codex/face-history` starts at Claude's `1fb62d4` in the isolated `/Users/wesley/projects/parlor-gsb-history` worktree. Claude's original checkout was kept clean.

- `npm test`: 483 passing tests; copy checks passed.
- `npm run check`: passed. `APP_PROFILE=gsb npm run build`: passed.
- Existing database integration: 10 passed in an isolated schema.
- `face-history.integration.js`: 13 passed in `gsb_test_history`. Covers cross-mode novelty, duplicate reviews, partial prefixes, overlapping saves, first-answer race accuracy, multiplayer history balancing, stale readiness, concurrent joins/start, fixed asynchronous sequences, claim idempotency, exclusions, account deletion, backfill, and restart epochs.
- Sprint HTTP integration: 6 passed in `gsb_test_sprint_api`, including the revised versioned duel flow.
- Existing browser suite: 54 passed across Chromium and WebKit.
- New face-history browser story: 2 passed, verifying partial-round save on Leave, accurate personal totals, and a fresh face when switching to Practice. Phone and desktop screenshots inspected; no horizontal overflow or page errors.
- Enabled synthetic guest experiment: 4 browser tests passed, with production configuration unchanged.
- WebKit continuous-round test observed a worst tap-to-next of 11 ms; its assertion confirms no inter-question HTTP. This is a local synthetic measurement, not a guarantee for every device. Physical iPhone sensor hardware was not tested; existing simulated tilt and WebKit flows passed.

New history screenshots live under `output/gsb-screenshots/{chromium,webkit}/face-history-{phone,desktop}.png` (local, not committed). The new test initially attempted to click the account header under the full-screen game, then raced nickname-save navigation; it now uses Leave round and waits for the home screen. Neither required changing Claude's design.


Production verification for `5487906`: deployed as `dpl_BBfgM5c9p9JdRiN3akaf875VvXJT` and aliased to `https://gsb-classmates.vercel.app`. Migration completed with existing account, Practice memory/review, rating, match and completed-sprint counts unchanged. The live authenticated account screen displayed real coverage and accuracy history. Health returned 200 with email ready; unauthenticated history/deck returned 401; disabled guest API returned 404; new browser modules returned 200 with revalidation caching. No production scores or Practice answers were generated by verification. Claude's original checkout remained clean at `1fb62d4`; merge `origin/codex/face-history` before the next design deployment.

## Responsiveness and reliability review, September 18, 2026

Implementation and merge contracts: [PERFORMANCE-REVIEW.md](PERFORMANCE-REVIEW.md). Same isolated worktree and branch; Claude's checkout remains unchanged.

- `npm test`: 491 passed; copy check passed for 194 files.
- `npm run check` and `APP_PROFILE=gsb npm run build`: passed.
- Database/history integration: 23 passed in `gsb_test_history`.
- Sprint HTTP integration: 6 passed in `gsb_test_sprint_api`, including stale, duplicate and inconsistent duel progress packets.
- Full signed-in browser suite: 60 passed across Chromium and WebKit in 7.0 minutes, including phone touch, keyboard, simulated tilt, Practice wrong-answer persistence, partial history, shared challenges and synchronized duels.
- Enabled synthetic guest experiment: 4 browser tests passed across Chromium and WebKit. The production experiment stays disabled.
- New transport/queue/media tests cover timeouts, response-body cancellation, non-JSON server failures, session loss, navigation during save, newer in-flight prefixes, corrupt/unavailable storage, stalled photo requests and stuck decoding.
- Continuous solo rounds measured worst tap-to-next DOM updates of 4.5 ms in Chromium and 6.0 ms in WebKit, with zero inter-question HTTP. These are synthetic local browser measurements; physical iPhone/mobile-network latency was not measured.
- Phone gameplay and desktop result screenshots inspected. Existing answer positions and Claude's visual design remain intact.

All 64 browser cases passed, including the separate guest suite. Raw local test logs are `/tmp/parlor-performance-{unit,api,db,browser,guest}.log`; screenshots and failure traces remain under ignored `output/`. Production verification follows below.

Production code `4de31ba` deployed as `dpl_FCnz67WBoDSay75qgrGboDdMTYyS`, READY and aliased to `https://gsb-classmates.vercel.app`. The build completed in four seconds. Compared deployed `api.js`, `face-checkpoints.js`, `round-media.js` and `use-sprint-round.js` byte-for-byte with the tested local sources; all matched. Health returned 200 with email ready; unauthenticated deck, learning and speed records returned 401 with no-store; disabled guest API returned 404. The existing verified production session prepared a real 20-person round and displayed Start the clock with records. No answers, scores or Practice reviews were submitted. The temporary verification tab was closed. No database migration or environment-variable change was needed.

Merge `origin/codex/face-history` into Claude's design branch before another design deployment. The original `/Users/wesley/projects/parlor-gsb` checkout was kept clean at `1fb62d4`; this release and its documentation are in the isolated `/Users/wesley/projects/parlor-gsb-history` worktree.

## Ready-round reuse, September 19, 2026

Code `0d99a8b`, branch `codex/public-release-prep`, worktree `/Users/wesley/projects/parlor-gsb-history`. See [PERFORMANCE-REVIEW.md](PERFORMANCE-REVIEW.md) for the design and [FRONTEND-INTEGRATION.md](FRONTEND-INTEGRATION.md) for Claude's merge contract.

- `npm test`: 505 tests pass, with the copy check passing. JavaScript type checking and both Parlor/Classmates builds pass. No dependencies or schema migrations added.
- Real database/API tests: 22 pass, comprising 8 sprint HTTP tests in `gsb_test_sprint_api` and 14 history tests in `gsb_test_history`. New cases verify independent halves, concurrent start retries, owner isolation, ordered answers, separate 10-person records, first-answer history, Practice isolation, small imported decks and live opt-outs.
- Full Classmates browser regression: 66 pass across Chromium and WebKit in 7.5 minutes. After the final buffer-record, expired-batch and button-transition fixes, all 34 focused Speed/touch cases pass again in 4.8 minutes.
- A ready 20/10/20/10 switch measured at most 0.7 ms in Chromium and 1 ms in WebKit. Both tens reused the original questions and photos, with no prepare/media requests. The second ten retained the newly earned personal record; all portrait URLs were revoked on exit.
- Continuous solo click-to-next DOM updates measured a maximum of 10.7 ms in Chromium and 7 ms in WebKit. No inter-question HTTP. These are local synthetic browser measurements, not physical-device paint or mobile-network guarantees.
- Slow preparation, length changes during HTTP/photo loading, failed-start retry, missing portraits, expired-result recovery, offline completion, held keys, actual browser touch events, fixed narrow-phone targets, shared challenges and synchronized duels pass. The first setup frame after Play again maintains at least 4.5:1 button text contrast. Phone and desktop screenshots inspected under ignored `output/gsb-screenshots/`.
- Source/privacy comparison against configured local credentials: 332 tracked files scanned, no findings. All real portraits and credentials remain outside Git. Claude's local checkout and remote design branch remain at `1fb62d4`.

Deployment `dpl_JEK2oMg5SocNTRr7ui1PLCtqLpQE` is READY at [Classmates](https://gsb-classmates.vercel.app). The deployed controller, buffer and stylesheet match the tested source byte for byte. Live health/session succeed; unauthenticated deck/progress/history/records/leaderboard/room/media are denied with no-store. Email reports ready and the guest experiment remains disabled. A real existing tester session preloaded 20 protected portraits and switched to 10 and back to 20 with Start still ready and the matching records shown. No answers or scores were submitted. All four existing accounts and three tester/owner sessions were preserved, with the door setting unchanged. The deployment error-log query returned no entries during verification.

Rollback target: `dpl_9gzZvGyhCNnKeDemYGzkKk27XSBF`. Raw local logs are `/tmp/parlor-speed-{unit,api,history,browser,final-browser}.log`. Fresh email inbox delivery and physical iPhone tilt were not retested in this pass. Merge `origin/codex/public-release-prep` before the next Claude design deployment.
