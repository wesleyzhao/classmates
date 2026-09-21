# Classmates: approved implementation plan

The user authorized this plan and implementation on September 15, 2026. Work is isolated on the `gsb-classmates` branch and in `/Users/wesley/projects/parlor-gsb`. The original Parlor checkout stays on main. The focused app has a separate Vercel project, Neon database, and private Blob store.

## Product and access

Classmates teaches the MBA 2027 cohort through face-to-name and name-to-face questions. Any verified exact `stanford.edu` address may create an account using an emailed, single-use link. Accounts choose a nickname. Class roster entries are separate from accounts. There are no passwords, public roster exports, or production test logins.

Import only names, a stable opaque identity, and photos from the approved local JSONL. No source emails, phone numbers, biographies, or other profile details are imported. Content lives in the dedicated database and private Vercel Blob storage. Same-origin media requests require an active account. Exclusions persist through imports and apply to media and question generation. An active game affected by an exclusion becomes void.

## Game rules

- Speed round is a separate authenticated solo mode added September 16. It prepares 20 classmates in either direction before timing and advances immediately on every answer. There is no reveal or Next delay. Accuracy outranks speed; separate records track highest score and fastest perfect run. It uses browser timing and does not affect multiplayer Elo. Rounds come in 10 or 20 in either or both directions, and a speed challenge lets classmates play one shared sequence and compare results. See SPEED-ROUND.md for the implemented scoring and persistence contract.
- Practice has no timer and covers every available card. Face-to-name and name-to-face have separate review records. Due cards precede unseen cards, then future reviews; every traversal covers the entire deck. Correct recall advances intervals of one minute, one day, three days, seven days, fourteen days, and thirty days. An error returns the card to one minute. Practice never changes competitive ratings.
- Together has ten shared questions, each with fifteen seconds to answer after a one-second initial preparation window. A correct answer earns 1,000 points plus up to 500 for speed, measured by server receipt in 250 ms buckets. An incorrect or missing answer earns zero. A player submits once per question. All results reveal together, followed by the next question. Solo games use the same rules and can establish personal best scores.
- Race has twenty questions in a common order, a common start, and an independent position for each player. Only a correct answer advances. Incorrect choices are disabled for that question, with a 1.5-second cooldown. A correct answer has a 400 ms transition guard. First completion wins. Other players have at most thirty additional seconds to finish, bounded by five minutes for the whole race. Unfinished players rank by correct progress; equal results tie.
- Multiplayer seats are fixed at start, with at most eight players. Closing a tab retains the account's seat. Rejoining restores the same player. Ranked games cannot be undone, restarted, skipped, host-graded, or reconfigured midgame.
- New distractors use privately reviewed neutral portrait features, with improved lexical name similarity as a tie-breaker and fallback. No inferred demographic categories are used. Tap, keyboard, and optional tilt all produce the same answer action. Tilt requires a user gesture for iOS permission, calibration, a neutral return, a twenty-degree threshold, and a 350 ms dwell. Unsupported or denied motion retains tap controls.

## Persistence and ratings

Reuse Parlor's kit contract, deterministic RNG, room service, chat, lazy deadlines, CAS concurrency, vendored Preact, and CSS tokens. Add a reusable recognition kit and an account-backed room policy. Room documents hold twenty question references rather than the whole class deck. Immutable content revisions keep reimports from changing questions in flight; exclusions remain a live override.

Persist each match exactly once in the same Postgres transaction as the final room state. Multiplayer Elo starts at 1,000, compares all player pairs, and divides K=24 by the number of opponents. Each unordered pair contributes at most once per calendar day in `America/Los_Angeles`. Rating changes sum to zero. Separate boards cover each mode and direction. Track total wins, distinct opponents, and distinct opponents defeated. Ratings remain provisional until ten games and five opponents. Solo and all-zero games do not affect Elo. Repeated games remain in the result history and win statistics even when pairwise rating contributions are capped.

## Deployment and delivery

Use Vercel for the frontend and API, free Marketplace Neon for durable state, and private Vercel Blob for portraits. Add only the server-side Blob SDK; retain the existing Neon driver and vendored browser libraries. Build app profiles with a small native Node file-copy script. No framework, ORM, component library, realtime subscription, or sensor package is required.

Email is a replaceable delivery and proof adapter. Following explicit owner approval, the free Descope Marketplace integration is installed and its managed sender works without an owned domain. The app combines Descope's email proof with its own origin-bound one-use challenge; session storage and game accounts remain independent. Resend at a verified sender domain remains a future alternative. Local test delivery is restricted to a non-Vercel test process and writes only to a private test outbox.

## Verification and handoff

Keep an implementation checklist in TODO.md. Test the pure kit, deadline boundaries, retries, race progress, hidden answers, privacy, account identity, atomic finalization, multiplayer Elo, exclusions, SRS, and sensor permission/failure behavior. Exercise the real API and Postgres in an isolated test schema. Run existing Parlor checks. Test mobile Chromium and WebKit plus desktop layouts, two or more independent browser sessions, invite links, chat, reconnects, and score persistence. Inspect screenshots and fix UX findings. Document physical iPhone motion testing and live email delivery separately from automated tests.

Claude's handoff must identify component contracts, tokens, copy constraints, question and answer states, API contracts, protected behaviors, and a repeatable verification workflow. Deployment is complete only when the production URL is checked, with any remaining external blocker stated plainly.
