# GSB implementation checklist

Status: implemented, tested, pushed and deployed on branch `gsb-classmates`, in worktree `parlor-gsb`. Email, portrait/name review, responsiveness improvements, and GSB ranking labels are verified live. The eight-face guest experiment is built and tested but disabled on real localhost and production. Physical iPhone testing and Claude's final visual design remain separate follow-ups.

- [x] Inspect Parlor and source data; establish 397-test baseline.
- [x] Finalize the plan, scoring, full-deck practice, multiplayer ratings, tilt and access rules.
- [x] Create an isolated worktree without changing the original Parlor checkout.
- [x] Provision separate Vercel, free Neon and private Blob resources.
- [x] Implement reusable recognition questions and together/race rules.
- [x] Add account-backed room identity, immutable content revisions and atomic result persistence.
- [x] Implement magic-link verification, secure sessions, nicknames and modular email delivery.
- [x] Import all 415 MBA 2027 names/photos privately, with persistent backend exclusions.
- [x] Implement full-deck spaced repetition and account progress.
- [x] Implement server-verified scores, multiplayer Elo and unique-opponent/win statistics.
- [x] Build mobile/desktop UI, room chat and optional tilt controls.
- [x] Add unit, conformance, database concurrency and browser tests.
- [x] Inspect phone and desktop screenshots; revise UX findings.
- [x] Write architecture, operations, validation and Claude's design handoff.
- [x] Complete type checks and deployed authentication-boundary smoke checks.
- [x] Finish browser regression checks: fourteen cases across Chromium and WebKit.
- [x] Commit and push the isolated branch; deploy the standalone Vercel project.
- [x] Activate and prove real production email delivery with the free Descope managed sender.
- [ ] Verify tilt on a physical iPhone. Automated detector and browser fallback checks are complete.

## Follow-up verification and distractors

- [x] Connect the free Descope integration with explicit owner approval.
- [x] Deliver a real email to the confirmed Stanford inbox and complete local email sign-in.
- [x] Open real classmates in the local preview on port 3137.
- [x] Separate synthetic browser tests onto port 3138.
- [x] Test four simulated tilt directions and granted/denied motion permission in Chromium and WebKit.
- [x] Fix held-tilt carryover, invalid-reading dwell, and blocked-answer selection.
- [x] Add direct used/expired-link recovery and origin-bound auth challenges.
- [x] Add lexical name similarity to distractors without inferred identity labels.
- [x] Deploy email login and verify actual production delivery, sign-in, private portrait loading, and rejection of link reuse.

- [x] Review all 415 portraits for neutral visible features, with independent spot checks.
- [x] Review actual names and photo/name peer sets together; correct ambiguous labels.
- [x] Publish immutable portrait peers and enable them in all game modes.
- [x] Reduce waiting, preload images, simplify prompts, and make practice feedback immediate.
- [x] Run final UX/regression checks and deploy the responsiveness follow-up.
- [x] Confirm next-question photo preloads are reused without another fetch in Chromium and WebKit.
- [x] Verify the production email session, real deck, private API boundary, and error logs after deployment.

## GSB rankings and guest experiment

- [x] Independently audit rendering, input response, preloading, and practice ordering.
- [x] Add immediate multiplayer tap feedback and verify deadline transitions.
- [x] Add Arjay Miller Track / FOAM Stars percentile badges with fair tie and sample-size rules.
- [x] Implement an eight-face guest sprint behind a server flag that defaults off.
- [x] Restrict experimental guest content to an explicit sample, respect exclusions, and require sign-in to save a personal result.
- [x] Test both feature-off and synthetic feature-on paths, including completion, retries, sign-in, and claim ownership.
- [x] Run unit, database, phone/desktop browser checks; document, deploy, and verify the guest feature remains off.

## Nickname follow-up

- [x] Suggest the email username at first sign-in, with direct editing and confirmation.
- [x] Make editing discoverable from the masthead name.
- [x] Support longer nicknames consistently and synchronize existing room names without touching scores or identity.
- [x] Verify failed-save recovery, persistence, room concurrency, phone/desktop layouts, and production deployment.

## Continuous solo speed round

- [x] Reuse recognition questions with accuracy-first scoring and fastest-perfect records.
- [x] Add authenticated preparation, start, completion, and comparable records APIs.
- [x] Build an isolated screen with complete photo preparation and immediate answer advancement.
- [x] Preserve completed attempts through save failure and reload; document Claude's integration points.
- [x] Finish browser latency/UX and regression checks, migrate, deploy, and verify live.

## Frontend integration review

- [x] Review speed scoring, ownership, records, timing, media lifecycle and save recovery.
- [x] Reproduce and fix held-Enter advancement and WebKit long-name answer movement.
- [x] Separate the speed controller from presentation without adding dependencies.
- [x] Add screen-boundary focus and initial game scrolling, preserving still answer targets.
- [x] Document all game modes, stable controller contracts, recovery states and release checks for other agents.
- [x] Complete the final browser/phone-touch regression pass, inspect screenshots, deploy and verify live.

## Practice mistake tracking

- [x] Confirm missed recalls persist per account, person and direction, reset scheduling, and retain lifetime mistake counts.
- [x] Keep learning limited to Practice, as requested.
- [x] Retain unsaved reviews through same-tab reload, serialize retries, and recover without duplicate reviews.
- [x] Preserve immediate feedback/Next and document the save queue for the design agent.
- [x] Finish all 50 browser regressions and inspect phone/desktop recovery.
- [x] Deploy and verify the Practice save-recovery change (`cd5a654`, Vercel `dpl_C7zkG8pb1LJrCFwC2Z2LmqfjkqQo`).


### Cross-mode coverage and history

- [x] Lifetime unseen-first selection across directions and modes.
- [x] Shared multiplayer selection that balances different player histories.
- [x] Versioned duel lobbies; stale readiness cannot start mismatched decks.
- [x] Retry-safe first-answer counts and separate race retry mistakes.
- [x] Background partial-round history, personal account panel, operator report.
- [x] Preserve Practice-only spaced repetition and due/wrong-card behavior.
- [x] Additive historical backfill and unit/database/browser coverage.

Handoff: [FACE-HISTORY.md](FACE-HISTORY.md). Claude can restyle the account panel while retaining the controller, API version and persistence contracts.

### Responsiveness and reliability review

- [x] Review loading, local answers, prefetch, history saves and duel progress.
- [x] Remove duplicate setup reads and overlap independent server work.
- [x] Cancel obsolete loads and bound stalled API/photo waits.
- [x] Preserve newer checkpoint prefixes across requests and navigation.
- [x] Keep delayed duel updates from moving progress backward.
- [x] Add focused unit and browser regressions and integration assertions.
- [x] Complete browser/UX checks, document evidence, deploy and verify (`4de31ba`).

Design handoff: [PERFORMANCE-REVIEW.md](PERFORMANCE-REVIEW.md).

### Reuse ready rounds, September 19

- [x] Keep a prepared 20 reusable as the first and second 10, including loaded private photos.
- [x] Preserve compatible downloads during length changes and retain start-failure retry.
- [x] Keep server ownership, separate records, exposure history, opt-outs and fixed shared challenges.
- [x] Document the buffer/controller contract for Claude without changing the visual design.
- [x] Complete broad regression and visual checks, deploy, and verify live reuse (`0d99a8b`).
