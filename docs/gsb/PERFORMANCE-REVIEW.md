# Responsiveness and recovery review

## Prepared-round reuse, September 19, 2026

Worktree `/Users/wesley/projects/parlor-gsb-history`, branch `codex/public-release-prep`. Claude's existing styling and checkout are preserved.

The reported 20-to-10 switch discarded a finished preload, then waited for a new prepare request and a second set of private photo downloads. Solo preparation now issues the full run and both 10-person halves in one database insert. The response contains only compact segment descriptors and the quick-record snapshot; question/photo metadata is not duplicated over HTTP. This adds two small, unused run rows for a 20-person preparation. They have the same one-hour expiry as the original, and do not record face exposure until played. No migration, new dependency, cache service or per-answer request is needed.

`public/gsb/sprint-buffer.js` holds the available, non-overlapping alternatives. The controller reuses the existing media for length changes and retains the second half for Play again. Only a successful start consumes an alternative. The first 10 and second 10 have their own server IDs, so the existing ownership, ordered-answer validation, idempotent completion, opt-outs, history and comparable 10-person records remain authoritative. A fork with fewer than 20 people gets only complete quick segments, with no duplicated padding. Shared challenges remain immutable.

The review also fixes failed-preload cleanup so a partially loaded batch can never be mistaken for ready media, and rejects inherited object keys or non-string JSON values as round lengths. A failed/expired start keeps retry or fresh preparation available. The buffer never stores private portraits beyond the current controller's lifetime.

Visual inspection caught a brief gold-on-gold button label when Preact reused a primary button as a secondary button after Play again. Speed buttons now change foreground/background colors together rather than fading only the background. The browser regression measures text contrast on the first committed setup frame; gameplay animation and the arcade style remain intact.

The retained second half also retains newly confirmed personal records. After a successful save, its best score and fastest-perfect snapshot update immediately; a class-records response can replace the snapshot later. Play again therefore cannot restore the older "No completed round yet" snapshot from the initial preload.

Regression coverage includes 20/10/20 switching, both consecutive tens, changes during HTTP and photo loading, start failure/retry, overlapping alternatives, narrow touch gameplay, records, partial history, ownership and live exclusions. See [VALIDATION.md](VALIDATION.md) for the completed run and deployment evidence.

September 18, 2026. Worktree `/Users/wesley/projects/parlor-gsb-history`, branch `codex/face-history`. This continues Claude's `1fb62d4` design without changing its markup, CSS, artwork or animation. Merge this branch into the design branch before its next deployment. There are no new dependencies, schema migrations or hosting services.

## Changes and reasons

| Finding | Correction | Regression coverage |
| --- | --- | --- |
| Speed setup fetched records independently even though preparation already includes them. | Use preparation's records; refresh separately only after a confirmed result. | Browser asserts zero separate records requests during setup and settings changes. |
| Preparing a round awaited cleanup, history, insert and records in sequence. | Run independent cleanup/history/records work concurrently, then insert the selected run. All work is awaited before responding. | Real database and HTTP preparation/completion tests, plus cross-mode selection tests. |
| Changing settings discarded stale responses but left their requests running. | Pass an abort signal to preparation, prefetch, records and standings. Recheck the generation after waiting for history. | Superseded preparation cannot replace the new playable round; leaving during photo load releases blobs. |
| JSON requests could wait indefinitely or expose a JSON parser exception on an HTML gateway error. | A small independent `api.js` bounds the entire request/body read to 20 seconds, supports cancellation, preserves HTTP status and emits readable errors. | Timeout, response-body cancellation, HTML error, session rejection and stable busy-retry tests; browser score-save recovery. |
| An image request or decode could leave the pre-game loader stuck. | Fail preparation after 20 seconds without a newly decoded photo, release all round blobs, and expose the existing Retry control. Abort also interrupts stuck decoding. | Fetch stall, decode cancellation, corrupt-photo cleanup and existing browser retry tests. |
| A history flush could finish with newer prefixes unsent. A previous screen's response could overwrite the new screen's persisted queue. | Share one account-scoped queue per tab. Drain newer values during a flush; attempt each failed value only once per flush. Checkpoints use an 8-second request bound and keepalive. | Navigation during a save, newer prefixes during a save, transient failure, invalid stored data and unavailable storage. |
| Delayed duel progress packets could move the opponent backward. | Atomically accept only increasing, internally consistent prefixes within the started, unexpired run's length. | Real HTTP tests send stale, duplicate and impossible updates after an accepted prefix. Final standings still come from verified results. |

## Contracts for the design agent

- `components.js` still exports `api`, so existing imports remain valid. Pure background modules can import `api.js` directly. The optional third argument is `{ signal, timeoutMs, keepalive }`.
- A timeout does not prove a mutation failed on the server. Keep the existing stable review/run IDs and retry recovery. The transport automatically retries only the explicit `busy` response, once, with the identical payload. It does not replay writes after timeout or connection loss.
- Photo preparation still completes before the clock starts. Its timeout measures lack of progress, not total round download time. Slow but progressing downloads remain valid.
- Speed answers still update local state synchronously. No new HTTP request, loading state or awaited save sits between answers. Duel progress requests remain cosmetic and do not determine scoring.
- History flushes happen at lifecycle boundaries. A failed checkpoint stays in session storage for later retry. There is no infinite retry loop or per-answer upload.
- Shared queue memory contains opaque run IDs and answer positions only. It is scoped by account and by the current tab; it is not a persistent portrait cache. The server still verifies run ownership.
- Practice alone changes spaced repetition. Shared novelty history, personal stats, scores and ratings retain their separate meanings.

## Limits

This review reduces avoidable work and fixes concrete failure cases; it does not guarantee zero initial load time. Authentication, database startup, private photo downloads and device decoding still take time. Photos remain protected, and starting a round still waits until its portraits are usable. A browser timeout can cancel the client request without undoing server work already committed.

The browser performance tests measure the DOM changing after a real tap on synthetic local rounds in Chromium and WebKit. They do not substitute for testing a physical iPhone on a mobile connection. See [VALIDATION.md](VALIDATION.md) for current results and release verification.
