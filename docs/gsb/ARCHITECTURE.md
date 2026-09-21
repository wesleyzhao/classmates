# Classmates architecture

## What is shared with Parlor

The app uses Parlor's `RoomService`, pure kit interface, seeded RNG, platform chat, room codes, lazy timers, versioned compare-and-set writes, Neon store, vendored Preact/htm renderer, and theme tokens. It is a focused app profile selected by `APP_PROFILE=gsb`. The default profile continues to serve Parlor.

`server/rooms.js` adds two optional extension points: `identity(body)` supplies a trusted seat identity, and `guard(doc,type,me)` enforces app policy inside the CAS loop. Existing callers retain random guest seats and the original policy. Same-account rejoin returns the existing seat. CAS allows eight attempts for simultaneous eight-player actions. `server/http.js` also bounds pre-parsed request bodies, matching streamed request limits.

The new recognition kit stays hidden from Parlor's general creator until that creator gains the corresponding image-content workflow. The GSB app supplies its own renderer for the kit. Future flags, artwork, vocabulary, or photo quizzes can reuse `questions.js` and the pure kit with another deck provider.

## Module boundaries

| Location | Responsibility |
| --- | --- |
| public/kits/recognition/questions.js | Question selection, distractors, public redaction, bounded speed scoring |
| public/kits/recognition/name-similarity.js | Optional text-only confusable-name sampling, with no demographic or image classification |
| public/kits/recognition/kit.js | Pure shared-round and independent-position race state machine |
| public/gsb/learning.js | Explainable spaced-review schedule and full-deck ordering |
| public/gsb/practice-reviews.js | Account-scoped, ordered review retries through reload and reconnection |
| public/gsb/tilt.js | Sensor calibration, neutral latch, threshold, dwell |
| public/gsb/components.js | Transport, photos, structured choices, keyboard and tilt adapter, clock |
| public/gsb/media-cache.js | Bounded session-only portrait preloading and synchronous cache lookup |
| public/gsb/app.js | Login, account, play, practice, room, chat, and score screens |
| public/gsb/guest-round.js | Optional lazy-loaded eight-face sprint and refresh/retry state |
| public/gsb/use-sprint-round.js | Continuous solo round lifecycle, private media, keyboard, timing and save recovery |
| public/gsb/sprint-round.js and sprint.css | Restylable speed-round view and accessible screen transitions |
| public/gsb/round-media.js | Complete bounded photo preparation before the solo clock starts |
| public/kits/recognition/sprint.js | Pure accuracy-first solo scoring shared by browser and server |
| server/gsb/sprint.js | Owner-bound solo attempts and comparable score/perfect-time records |
| server/gsb/auth.js | Email delivery adapter, exact-domain validation, origin-bound links and sessions |
| server/gsb/descope.js | Native HTTPS managed email delivery and exact-recipient verification |
| public/gsb/login-link.js | Provider callback normalization without consuming credentials |
| server/gsb/rooms.js | Account seats, fixed competitive policy, live exclusion enforcement |
| server/gsb/leaderboard.js | Complete mode/direction standings, eligibility, tie-aware percentile labels |
| server/gsb/guest.js | Disabled-by-default guest sample, capability cookie, personal result and verified claim |
| server/gsb/db.js | Dedicated database, immutable decks, atomic completion adapter |
| server/gsb/schema.sql | Accounts, sessions, content, progress, match and rating ledger |
| server/gsb/router.js | Same-origin private API, authorization, quotas and private media |
| scripts/gsb | Migration, import, exclusion, cleanup, synthetic test setup |

## Content model

A roster person has an opaque source-derived ID, name, private asset reference, and exclusion flag. A content revision is an immutable deck of `{id,prompt,answer,image}` records. Asset paths are stored in `gsb_assets`; the client gets only an authenticated `/api/media/<asset-id>` route. Reimports retain exclusions. Portraits are downsampled to at most 480 pixels and JPEG quality 75 using macOS sips during import, not at runtime.

The importer resumes existing photo uploads and updates names. To deliberately replace an existing photo, a future refresh option should explicitly fetch a new asset and publish a new revision; automatic reruns currently reuse the cached asset. Do not silently overwrite historical assets.

All 415 names and portraits are private data. They are absent from Git and the static build. Raw BrightCrowd data remains in its original local project. `.private/` and `output/` are ignored. No source email, phone, biography, interests, or employer fields enter the app.

Practice may fetch the complete minimal deck after authentication. Competitive rooms expose only the current question and positional choice IDs. Future question order, seeds, targets, and unrevealed answer correctness stay server-side. This is a friendly learning game: an authorized player can look up names from practice or collaborate with someone else. It is not a proctored competition.

## Practice memory

Practice alone updates spaced repetition. Speed rounds, guest rounds, and multiplayer do not change it. Since the mixed-direction practice, `gsb_progress` holds one memory per person under direction `both` (older `face`/`name` rows only seed its lifetime counts), in the shape of Anki's schedule for a pass-or-fail card: `state` (learning, review, relearning), `step`, `ease` (2.5 to start, never under 1.3), `interval`, `lapses`, `dueAt`, `lastAt`, `lastDirection`, `missed` per direction, `leech` at eight misses, plus `reviews`, `correct` and a derived `stage`. New cards climb one-minute and ten-minute steps and graduate to a day; a correct review multiplies the interval by the ease (capped at half a year); a missed review lowers the ease by 0.2 and relearns from a minute back to a day. Lifetime mistakes are `reviews - correct`; a later correct answer does not erase the miss. Each ask goes the direction missed more often, otherwise the other way from last time, and new cards take turns. A deck traversal prioritizes due cards, then unseen cards, then future reviews, and a missed person returns five cards later in the same session. `public/gsb/learning.js` mirrors the server function for the UI and tests.

The shell owns `createPracticeReviews`, so review writes continue when navigating away from Practice. Each answer is first retained in account-scoped `sessionStorage`, then sent in order without blocking feedback or Next. Reload, verified re-entry by the same account, an `online` event, or manual Retry resumes pending work using the original idempotency ID. Sign-out/session loss suspends sends and ignores late responses. Pending data contains only opaque IDs, direction and correctness; never names or photos. It survives same-tab reload, not closing the tab or clearing browser data. If browser storage is denied, saving continues in memory. A removed card is discarded without blocking other saves. Progress merges retain the newest review count when a GET races a save response. Server-acknowledged progress persists across devices.

## Timing and concurrency

Competitive ranking and points use server time. Every active room snapshot applies due deadlines, so a closed browser cannot freeze a timer. Client clocks animate from the latest server timestamp and monotonic browser time. Polling is 850 ms during play and slower in the lobby or background. Ready and reveal deadlines share that polling loop; overlapping refresh requests are coalesced. Each action has a scoped idempotency ID. A stale question ID cannot answer a later question. A selected-answer outline appears immediately while correctness remains server-authoritative.

The first question has a one-second preparation window; later shared rounds have half a second, following a 1.5-second reveal. Current-question portraits preload during these short windows; the client refreshes at the deadline. Latency still affects close speed finishes; 250 ms scoring buckets reduce small timing differences. Race correctness immediately advances that player's position, with a short cooldown before the next answer.

`gsb_commit_room` updates the room with its expected version, inserts the final match under a unique seed, and updates the multiplayer ledger in one transaction. A small global advisory lock serializes only match finalization, preventing overlapping matches from losing rating updates. No rating depends on a client score or a post-response callback.

Ratings use pairwise Elo with K=24/(players-1), separate mode/direction boards, and exact ties. An unordered pair contributes once per Los Angeles calendar date. The mathematical changes sum to zero; floats are retained internally and rounded only in the UI. Wins and distinct opponents are independent historical statistics. All-zero and solo games do not change Elo. Content invalidation voids a match. Future schema versions should preserve the stored result/rating policy version when changing formulas.

The complete ledger determines percentile badges, including the bottom of the field. Established ratings need ten games and five distinct opponents. At least ten established participants are required; cutoff ties in the displayed rating remain unbadged. The two labels do not change Elo or scoring. See [RANKINGS.md](RANKINGS.md).

## Continuous authenticated speed rounds

The authenticated `/speed` mode is separate from the guest experiment. It prepares 20 questions and every required portrait before timing, advances locally without inter-question HTTP, and submits an ordered answer log once at the end. Its server recomputes points and accepts the first completion only. Records are scoped to direction, length, count, revision, active cohort and scoring version. The browser times these casual solo results; they never enter multiplayer Elo. A speed challenge shares one sequence under a four-letter code so classmates can play the same round whenever they open the link and compare results; it is stored beside the solo runs and stays out of Elo too. See [SPEED-ROUND.md](SPEED-ROUND.md) and [FRONTEND-INTEGRATION.md](FRONTEND-INTEGRATION.md).

## Optional guest experiment, currently disabled

The full deck remains authenticated. The separate guest capability is available only when both a server flag and an explicit 8 to 32 person allowlist are configured. No real sample is enabled. Guest portraits require the run's HttpOnly cookie, an exact assigned asset, and current allowlist/exclusion checks. Disabling the flag revokes every guest route. Client query parameters cannot enable it.

The eight-face sprint calculates immediate feedback locally and saves a validated personal result. Client timing and visible practice answers are deliberately untrusted: guest results never enter competitive matches or Elo. `gsb_guest_runs` stores hashed cookies and first-write-wins results; a verified email account can claim its browser's result once. Cleanup retains claimed personal scores. The guest module downloads only when an enabled visitor opens the experiment. See [GUEST-ROUND.md](GUEST-ROUND.md) for contracts and synthetic test setup.

## Authentication and privacy

Login links contain 256 random bits, are stored only as SHA-256 hashes, expire in fifteen minutes, and are consumed once in an atomic SQL statement. A GET never consumes the link; a landing button posts the fragment token, protecting against ordinary email link scanners. Session cookies are opaque, HttpOnly, SameSite=Lax, host-only, Secure in production, expire after thirty days, and are revoked on sign-out. Nicknames never grant identity.

State-changing requests require the configured exact origin and JSON content type. Auth, room creation, joins, reviews, chat, and answers are rate-limited. Private JSON and images return no-store. No public CDN caches private roster content. Dynamic text is rendered through Preact, not innerHTML. Production never honors the local test outbox or test schema variables.

Descope's free managed sender is active. In addition to the app's random challenge, it supplies a separate one-use email proof. The server verifies that proof directly with Descope and checks `verifiedEmail`, the exact normalized recipient, and that the identity is not a provider test user. A challenge is scoped to APP_ORIGIN, so a local link cannot be consumed on production. Successful proof sets `email_verified_at`. Provider JWTs are not used as app sessions. The native-fetch Resend adapter remains available for a future owned sender domain.

The local operator script can grant an explicitly configured owner a 24-hour `owner-preview` session. It is labelled in the UI, has no public issuing route, and does not set email verification. A second operator switch, the test door (`scripts/gsb/door.js`, a `gsb_settings` row), lets visitors with its link in for a week under unverified `door` accounts, labelled in the UI, and closing it ends those sessions at once; see OPERATIONS.md. Ordinary public sign-in always requires mailbox ownership. Test outbox and schema overrides remain unavailable on Vercel.

## Deliberate scope

There is no general game editor in this focused first release. Mode and direction are the supported variations; Parlor remains the general authoring platform. There is no facial recognition model, image embedding, or inference about personal attributes. Future tilt games should continue to use an input adapter, leaving authoritative rules independent of hardware.

Classmates fixes `distractors: "similar-portraits"` for new games and practice. Reviewed peer IDs are an optional card field; missing or ambiguous visual evidence falls back to improved lexical name similarity. Generic recognition defaults to random choices. Existing rooms keep their pinned question choices. See DISTRACTORS.md for the reusable selector and its limitations.

## Follow-up performance work

`latestDeck` now retrieves the revision and current exclusions in one SQL statement instead of three sequential database round trips. `loadDecks` uses the same single-query pattern, preserving live opt-outs without caching stale authorization decisions. Three warm development-to-Neon samples were 448/224/225 ms for the prior path and 77/80/79 ms for the combined path; this is a development measurement, not a production latency guarantee.

Private portraits preload through authenticated requests into a bounded, twelve-entry in-memory blob URL cache. The cache does not use service workers or persistent browser storage and is cleared on sign-out/session loss. Already downloaded pixels cannot be recalled immediately by an opt-out. Practice generates only the current question and the next two, preserving their option order when advancing and preloading every photo choice. Review writes run separately from immediate local practice feedback; competitive scoring remains server-authoritative.

Cached portraits render on the first paint. Tap, keyboard, and tilt share an immediate submission latch. Equal-priority new study cards retain their shuffled order. Room membership is checked against the already-loaded authoritative room document, saving the router's prior duplicate database lookup on each poll and action. See [RESPONSIVENESS.md](RESPONSIVENESS.md).
