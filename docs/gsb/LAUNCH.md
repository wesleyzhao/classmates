# Clean repository and ten-face entry

This release keeps the existing Vercel project, production URL, database, portraits, login provider, accounts, tester grants and game modes. The canonical checkout is `parlor-public-source` on public `main`; the old private repository and Claude checkout are retained.

## Release checklist

- [x] Verify the clean source matches the reviewed release and check Claude for new work.
- [x] Add a configurable ten-face entry screen and automatic guest countdown alongside media preload.
- [x] Keep one guest attempt per browser, resume interrupted attempts and require verified email to save or continue.
- [x] Preserve invitations, nickname editing, Practice, Speed, duels, quizzes, races and rankings.
- [x] Run unit, type, API, browser, phone/desktop, privacy and build checks.
- [x] Publish the clean repository and connect it to the existing Vercel project.
- [x] Enable a bounded ten-person guest sample outside Git, deploy to the same URL and verify production.
- [x] Record source/deployment, rollback, preservation evidence and remaining limitations.

The public repository must never acquire the private repository's old Git history. Future agent work belongs in the new repository. Real roster content and guest person IDs remain in private storage/configuration.

## Source and configuration

The public repository is [wesleyzhao/classmates](https://github.com/wesleyzhao/classmates), created from a source-identical clean root (`5ee3ee9`) with a GitHub noreply commit identity. It is connected to the existing `gsb-classmates` Vercel project with production branch `main`. The production URL remains [gsb-classmates.vercel.app](https://gsb-classmates.vercel.app).

All pre-existing production environment values were compared before and after connecting Git and remain unchanged. Sixteen database integration variables were removed from Preview scope while retaining Production and Development. `gitForkProtection` remains enabled. The source configuration enables automatic Git deployment only for `main`. New production settings are `CLASSMATES_LANDING=quick`, `GSB_GUEST_PREVIEW=true`, and a private allowlist of ten active people; no IDs or photos are committed.

No production migration, roster import, account cleanup or tester-door change is part of this release. The previous production deployment is `dpl_JEK2oMg5SocNTRr7ui1PLCtqLpQE`, a rollback target that retains its original environment snapshot. For a future rebuild of that version, also revert the new guest/landing environment settings; rollback alone does not edit project-level environment settings.

## Agent handoff

Work in `/Users/wesley/projects/parlor-public-source`, and start new branches from public `main`. The old `/Users/wesley/projects/parlor-gsb` Claude checkout and `/Users/wesley/projects/parlor-gsb-history` remain untouched historical checkouts. Bring future design edits across as reviewed file changes; never merge their private history into this repository. Read `FRONTEND-INTEGRATION.md` for controller boundaries and `GUEST-ROUND.md` for guest behavior and limits.

The guest limit is per browser, backed by a cookie and server result. A different browser or cleared cookies can obtain another attempt, always from the same small sample. No fingerprinting was added. A claim needs the original browser cookie and a verified eligible email. Physical iPhone tilt and a fresh production inbox delivery are not part of the automated verification.

## Pre-deployment verification (September 21, 2026)

- 506 unit tests; JavaScript type checking; copy lint; both Parlor and Classmates builds.
- 66 Classmates browser checks in Chromium and WebKit, covering Practice, nicknames, invites, rankings, Speed, challenges, duels, quizzes and races.
- 12 guest browser checks in mobile touch contexts (Chromium and WebKit), including countdown visibility, held-key rejection, inline email errors, refresh/resume, claim and media cleanup. Measured tap-to-next transitions stayed below 10 ms locally with no requests between questions.
- 7 original Parlor browser scenarios in Chromium; 2 guest and 8 Speed HTTP/database integration tests in isolated test schemas.
- Phone and desktop screenshots inspected. No physical iPhone test or new production email sent during this release.

The first feature-branch CI run passed all unit tests but failed the documentation voice check. Range/countdown punctuation was corrected. The first branch push also revealed that the Git glob `*` did not cover names containing `/`; the rule now uses `**` with an explicit `main` exception. That preview had no production database, Blob or private authentication credentials. Production remained on the prior deployment throughout testing.

For automatic production smoke checks, set the GitHub repository Actions variable `PRODUCTION_ORIGIN` to your public HTTPS origin. The workflow tests that stable URL because immutable Vercel deployment URLs may require Vercel authentication. It needs no private credentials and never disables preview protection. Manual workflow runs can specify another origin.

## Production verification

The first Git-connected production release is source `0023e3c`, Vercel deployment `dpl_GGpNKmLhMWv96Ji1KdpEtSjrQQq5` (READY). Vercel identifies `wesleyzhao/classmates`, branch `main`, as its source. Documentation-only follow-up commits may create later deployments with identical application code; consult the current Vercel alias for the latest deployment ID.

- GitHub Tests and Production smoke test both pass. Public health/session work; seven full-deck/account/media routes reject anonymous access with 401 and private no-store headers.
- Production reports quick landing, guest enabled with ten faces, and configured email delivery. Served entry, guest, shared artwork and stylesheet files match the reviewed source.
- Fresh mobile Chromium and WebKit sessions each completed a real ten-photo guest round. Both showed 3-2-1, loaded all ten portraits before play, made no HTTP requests between the first nine answers, displayed the email form after completion, denied the full deck and resumed the same completed result after reload. Those test results remain anonymous and unclaimed; no account or competitive score was created.
- The first live browser attempt encountered a network-change error. A later WebKit reload exceeded the initial five-second test limit; its measured recheck restored the result in 409 ms with no browser errors. Production photo loading took roughly a second per image in that check, overlapped by the bounded loader, before the countdown. This does not promise instant first-load network latency.
- The existing signed-in account lands on ten-person Speed with its old best score and fastest-perfect record. Back to games, quizzes, races, Practice, nickname editing and rankings remain available. The account's nickname was not changed.
- Exact comparisons preserved all four account IDs, three tester/owner session grants and two application settings, including the tester door. No production migration, roster reimport or cleanup ran. Existing private checkouts remain clean and untouched.
- A post-release Vercel error-level log scan returned no entries. Phone screenshots of real content were inspected locally and remain ignored by Git. The public source/history scan found no private data or secrets.

Both browser engines verified email-link/claim behavior against the isolated local outbox. No fresh production email was sent and no physical iPhone tilt test was performed in this release. Existing production email configuration and URL are unchanged.

## Countdown-first entry follow-up

The initial live flow was automatic but still showed loading screens before counting down. A fresh WebKit visit measured the first countdown at 3.7 seconds and the first question at 6.8 seconds. The corrected entry removes the guest introduction/loading screen, loads the small guest module as soon as the session confirms eligibility and begins 3-2-1 as the round and photos prepare. The first question still requires every portrait to be decoded. Slow connections hold the final beat; retry, hidden-tab recovery, completed-trial gating and invitation sign-in remain intact. Signed-in users retain their normal Speed controls and existing sessions.

The initial session check is visually quiet on `/` and `/guest`, so it does not flash a title/loading page before eligibility is known. Once guest mode is confirmed, the first visible screen is the countdown. Login and invitation URLs retain their own flows.

Follow-up verification: all 506 unit tests and the 14 guest browser checks passed, along with type, build, copy and privacy checks. Fourteen focused Chromium/WebKit regression scenarios cover nickname/login recovery, disabled guest mode, private-content access, Practice, ten-person Speed, invitations and duels. The disabled-mode check initially caught speculative guest-code loading before the session response; restricting that fetch to confirmed guests fixed it, and both engines passed the recheck. Countdown screenshots were inspected at phone and desktop widths. No database, environment setting, account or tester grant was changed.

## First-login and invitation follow-up

- [x] Confirm that a fresh signed-out root visit starts the ten-face countdown; distinguish the intentional `/door/CODE` tester signup.
- [x] Remove tester-door banner and first-login introduction; place the requested short nickname helper below the input. Keep face history on the normal account page.
- [x] Preserve duel and room invitations through email confirmation in another browser. Show the invite context and omit the guest detour.
- [x] Add a loopback-only first-visit rehearsal with fictional people and a captured inbox. Preserve both production identity and existing localhost cookies.
- [x] Verify 509 unit tests, types, copy, privacy and both builds. Thirty relevant browser scenarios pass across Chromium and WebKit: fourteen guest cases, ten existing login/profile/duel regressions, and six new preview/invitation stories. Review phone and desktop nickname screenshots.

Two initial browser assertions needed correction: textContent omitted the visual line break, and a named email-link target could reuse an existing tab in Chromium. The copy assertion now checks rendered text and preview email links explicitly open a new tab. Both reruns pass. See [ONBOARDING.md](ONBOARDING.md) for the preview command, privacy boundaries and future design contract. Production needs no migration, environment change or tester-account cleanup.

The final provider review caught a pre-existing guest-claim bug: Descope sessions exposed `access: "descope"`, while guest saving expected `"email"`. Authentication now normalizes the public access class after proof verification and on session restoration, preserving the provider purpose in the database. Added tests cover both paths and an HTTP guest claim with a managed-email session. All 510 unit tests and both guest HTTP integration tests pass; type checking also passes. This does not upgrade door or owner-preview grants to email access.


## Two-target default and email follow-up

- [x] Guest root still opens at 3-2-1 with no setup or nickname form, now followed by ten faces and two named drop targets.
- [x] Signed-in quick landing uses the same interaction. Preserve classic four-choice Speed, name/mixed directions, Practice, Together, Race, challenges and duels.
- [x] Share the portrait/body markup and left/right gesture mapping across Guest, solo Speed and Duel; add no dependency.
- [x] Separate records by two/four-choice difficulty; retain prior data, old four-choice guest attempts and pending scores. Preserve both cached halves when changing 20 to 10.
- [x] Put the requested email copy and Log In Now button in the modular custom-sender renderer and local preview. Verify Descope's live System template is locked and clearly document that live copy is not changed.
- [x] Verify current published Descope Free allowance: 1,000 emails/day. Keep the app's stricter 90-request daily limiter unchanged.
- [x] Complete unit/type/build/privacy checks, isolated database tests, Chromium/WebKit guest/speed/duel/onboarding regressions, and phone/desktop visual review.
- [x] Push tested source to main, verify same-URL production deployment, and preserve tester accounts and existing data.


Validation: 512 unit tests, 11 isolated HTTP/database scenarios, and 58 distinct Chromium/WebKit scenarios (16 Guest, 36 Speed/touch/challenge/duel, 6 onboarding/invitation) pass. Focused repeats cover the final shared name-tag styles and left/right drops. An older request-shape assertion was updated to include the explicit `choices` field; both browser reruns passed. Visual review caught clipped long names at 320px; fixed-height name tags with smaller long-name text now keep the full name visible, covered by text bounds as well as button bounds. Guest answer-to-next DOM changes measured at most 6ms locally, and solo at most 7ms; these are local test measurements, not physical iPhone guarantees. The original four accounts, three tester sessions and two settings remain present and unchanged.


Production acceptance: source `276acb3` deployed READY as `dpl_8UnHD7FeMum8qJo2hcgH6mQU7pZ9` on the unchanged `https://gsb-classmates.vercel.app` URL. An isolated WebKit visitor saw 3-2-1, ten real approved portraits, exactly two drop targets, ten successful taps and the email form after completion; no replay button or page errors. The full deck returned 401 without a session. Deployment smoke passed every private-route and cache-policy check. No live email was sent for this release: the Descope System template is still unchanged as documented above.

## Campus capacity follow-up

- [x] Raise the shared login request budget from 90 to 900 per 24-hour window, with a validated operator configuration for forks and other senders.
- [x] Retain the three-per-recipient resend limit and check it before spending shared network capacity.
- [x] Admit the whole class through one shared IP for guest starts, email requests, verification and result saving. Keep the small approved sample and one guest trial per browser.
- [x] Raise the ten-per-hour quick-challenge/rematch ceiling to 120 per account and align join/ready/begin limits.
- [x] Verify 450 synthetic classmates with one resend each; block the 901st send. Verify real database concurrency, expiry, guest resume/save and the eleventh quick duel in an isolated schema.
- [x] Inspect the hosting firewall: no custom active/draft rules, no attack mode and no recorded mitigations in the inspected period.
- [x] Fix a rapid guest keyboard transition: bind the answer handler during DOM commit so the next visible question accepts input immediately. Cover the exact DOM-commit moment in the browser regression.
- [x] Complete browser regressions, phone/desktop visual review, unit/type/build/privacy checks and CI.
- [x] Verify the deployed release at the same production URL.

This change adds no dependency, migration, paid service, roster import or account cleanup. Existing database counters retain their counts; limits take effect with the new deployment. See [OPERATIONS.md](OPERATIONS.md) for exact values and the distinction between rate-limit tests and a real simultaneous-user load test.

Validation: 519 unit tests and four new isolated HTTP/Postgres launch tests pass. Twenty-eight distinct Chromium/WebKit scenarios cover Guest, first-login/nicknames, cross-browser room/duel invitations, two-choice solo, live duels and rematches. The first guest run and focused repeat exposed a dropped key immediately after a question transition. After binding during DOM commit, all eight focused guest/input checks pass, including a deterministic regression at that transition. Measured guest answer transitions were at most 6 ms locally. Phone/desktop result screenshots were inspected. Type checks, both builds, source/history/local-secret scans and GitHub CI pass. Exact read-only comparisons retain the original four accounts, three tester session grants and two settings. No real login emails or 450-browser production load test were run.

Production acceptance: source `3235b2c`, deployment `dpl_AiANs2JoBjqEU12Wz4xeCAcZmSYt`, is READY at the unchanged production URL. The served guest module matches the reviewed source. A fresh WebKit session completed countdown, ten real approved faces and two answer targets, then saw sign-in required; zero page errors and anonymous full-deck access returned 401. Both GitHub Tests and Production smoke test passed. The local onboarding preview was restarted at `http://127.0.0.1:3140/api/preview`. No production environment change was needed: the omitted email-budget setting now defaults to 900. Rollback is the prior `dpl_NE2gVr6qS8kQ3xgNt7sVRCj4zNhL`; it would also restore the old restrictive caps. Later documentation-only deployments preserve this application code.

### Concurrent design deployment

During final verification, Claude deployed private-checkout commit `f34baa5` through the CLI as `dpl_GTfwvpD8cConEe6FSiTuoAU3bqv3`. That checkout predated the public launch work, so it restored the old email/network caps and guest behavior. Its new shared-link previews, invitation wording, score sharing and preview image have been ported as reviewed file changes into this clean repository, preserving the newer launch, email, guest and two-target behavior. No private Git history was imported and Claude's checkout was not edited. Future design and deployment work must start from this repository's current `main`; deploying the historical checkout can restore old behavior even if this repository's CI passes.

The combined source (`1100668`) passes CI, 519 unit tests, all ten Speed HTTP/database tests (including escaped public preview metadata), and all four launch-limit HTTP/database tests. Six first-login/invitation browser scenarios and four shared-challenge/duel scenarios pass in Chromium and WebKit after integration. The new metadata path initially rejected the isolated preview's HTTP `127.0.0.1` origin; it now follows the existing localhost/loopback development policy, with HTTP still rejected on Vercel. Types, both builds and source/history/local-secret scans pass, and the original account/tester/settings preservation check still passes.
