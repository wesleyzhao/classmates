# Public release checklist

Current publication work: [LAUNCH.md](LAUNCH.md). The clean repository is `wesleyzhao/classmates`; the original repo remains private. The following records the earlier release preparation.

Historical working branch: `codex/public-release-prep`, based on the tested `codex/face-history` release. Both app profiles stay in one repository: reusable Parlor kits and the focused Classmates application. This preparation does not change repository visibility, remove tester accounts, or close their sessions.

## Preparation

- [x] Check Claude and Parlor checkouts before editing; both were clean.
- [x] Inspect all locally reachable Git blobs for roster data and likely credentials.
- [x] Run the package vulnerability audit (zero reported vulnerabilities).
- [x] Add a repeatable source/history privacy gate and safe CI defaults.
- [x] Document clone, configuration, database, private Blob and email setup for a new Vercel owner.
- [x] Add a portable, minimal own-roster importer with a dry run and regression tests.
- [x] Make the allowed email domains configurable while preserving Stanford defaults.
- [x] Include font notices and clarify third-party/content licensing.
- [x] Document the reusable recognition components for Parlor builders.
- [x] Verify a clean clone, both profiles, security boundaries, database behavior, phone/desktop UX and rapid answers.
- [x] Record final results and a deployment handoff.

## Publication steps

- [ ] Choose a clean public snapshot or coordinate a scrub of shared history. An old nickname test contains the owner's Stanford email. Current source uses fictional addresses. Do not make the existing repository public while that history remains reachable.
- [ ] Integrate the reviewed release into the selected public default branch. Preserve Claude's newer design work if present.
- [ ] Fetch all remote refs and rerun the history scan immediately before changing visibility.
- [ ] Review repository settings, issues, pull requests, Actions logs/artifacts and commit metadata for content that should remain private. The local Git scan cannot inspect those surfaces.
- [ ] Choose whether existing tester sign-in links should remain active for launch. Preserve their accounts and scores unless the owner explicitly requests deletion.
- [ ] Confirm the intended repository visibility change, then enable public forks.
- [ ] Verify an independent fork uses its own Vercel project, database, Blob store and email provider.

Do not run `gsb:door -- close --purge` or any account cleanup as part of this checklist. Making code public does not make private database rows, email addresses, portraits or credentials public.

## Initial audit evidence

The initial scan examined 771 distinct blobs reachable from all local branches and remote-tracking refs. It found no committed `.env`, `.private`, roster CSV/JSONL, or matching private roster names apart from the copyright holder in `LICENSE`. The targeted credential scan found no private keys, credential-bearing Postgres URLs or recognized provider token formats. This is bounded evidence, not a guarantee against every possible secret pattern.

GitHub's metadata connector returned 404, but authenticated browser inspection succeeded: the repository is private, defaults to `main`, has no tags or releases, and has zero open or closed issues or pull requests. No repository visibility change has been attempted. General settings confirm the private visibility and `main` default branch. The Actions listing had 48 historical runs, mostly skipped production smoke jobs. Historical job logs/artifacts were not exhaustively inspected, so they remain a publication gate for converting this existing repository.


## Regression and deployment evidence, September 19, 2026

Implementation release: `7c23a14` on `codex/public-release-prep`. Later documentation, privacy-scan and fictional-fixture changes do not change deployed app behavior. The existing Claude checkout (`parlor-gsb`, `gsb-classmates`, `1fb62d4`) stayed clean and untouched.

| Check | Result |
| --- | --- |
| Unit, rules, privacy/import/configuration and copy tests | 501 tests pass; copy check passes. |
| JavaScript type check | Pass. |
| Real Postgres / API suites | 33 tests pass: database 10, face history 14, sprint 6, guest 2, importer 1. Synthetic data in dedicated schemas only. |
| Classmates browser flows | 62 pass across Chromium and WebKit. |
| Guest experiment browser flows | 4 pass in the explicitly enabled isolated test configuration. Production remains disabled. |
| Parlor multiplayer / maker / recognition browser flows | 14 pass across Chromium and WebKit; the recognition layout was rechecked after its two-column correction. |
| Speed browser regression after clock fix | All 30 pass across Chromium and WebKit. Measured maximum tap-to-next was 12.4 ms Chromium and 6.0 ms WebKit in this run; no inter-question HTTP requests. These are local test measurements, not a device/network SLA. |
| Clean clone | `npm ci`, 501 tests, type check, both builds, history-pattern scan and a two-player Parlor API round/chat pass without a local env file, private input or Vercel link. |
| Dependency audit | Zero reported vulnerabilities. No application dependencies added. |
| Hosted CI | [Tests run 35470700251](https://github.com/wesleyzhao/parlor/actions/runs/35470700251) passed for the implementation release. |
| Git privacy audit | 330 tracked files and 876 history objects had no known credential-pattern/local-secret findings. A separate comparison to 387 source roster emails found one owner email in the historical nickname fixture; current source was corrected. No other source email matched. |
| Visual checks | Phone and desktop screenshots inspected for Classmates and the generic recognition renderer. The deployed home screen also rendered with an existing tester session. |
| Production boundary | Shell, health and session succeed; anonymous deck, progress, learning, records, leaderboard, rooms and media return 401 with no-store. |
| Preservation | All four existing production accounts and three tester/owner session rows remained; the test door state stayed open. No production migration, importer, cleanup, purge or access-policy change was run. |

The database tests caught an actual clock mismatch: Postgres was about 465 ms ahead of the local app host, so an immediate sprint result could fail as a negative duration. Start/finish validation now uses the database clock returned by the existing lookup, with no extra network request. A test shifts the app clock back one minute and verifies completion, while a genuinely future start still fails. Initial test invocations also hit dedicated-schema guards; the fork guide now gives each suite's exact required schema.

Initial release deployment: [Classmates](https://gsb-classmates.vercel.app), `dpl_9gzZvGyhCNnKeDemYGzkKk27XSBF`, code `7c23a14`. Previous rollback target: `dpl_FCnz67WBoDSay75qgrGboDdMTYyS`. Email configuration and the existing session were verified; inbox delivery was not re-sent in this release pass. Tilt events and denied permission were simulated in browsers, not tested on physical iPhone hardware.

The subsequent Speed reuse review deployed code `0d99a8b` as `dpl_JEK2oMg5SocNTRr7ui1PLCtqLpQE`. A prepared 20 now serves two consecutive tens without another question/photo download. It also preserves fresh records, safe retries and instant readable controls. Verification: 505 unit tests, 22 relevant database/API tests, 66 broader browser cases, then 34 final Speed/touch cases. Live reuse and tester preservation were verified. See [VALIDATION.md](VALIDATION.md) for exact evidence and limits. These changes add no services, dependencies, schema changes or publication-policy changes.

## Reusable UX regression checklist

- [x] Enter an eligible email; reject unrelated/lookalike domains and malformed addresses.
- [x] One-use login, expired-link recovery, nickname default/edit, reload and sign-out.
- [x] Anonymous content denial and live opt-outs; no answer-key leakage in multiplayer views.
- [x] Whole-deck Practice, wrong-answer retention, due-card return, failed-save retries and account isolation.
- [x] Prefer unseen people across modes; balance shared multiplayer sequences without assigning different questions to opponents.
- [x] Speed preloading, rapid taps, held-key protection, missing-photo retry, offline completion and idempotent saves.
- [x] Quiz/race joins, chat, reconnect, wrong-answer blocking, shared duels and challenge results.
- [x] Rankings, perfect-time records and retained tester access.
- [x] Narrow phone and desktop layouts; simulated tilt and permission-denied tap fallback.
- [ ] Physical iPhone tilt and a fresh delivered-email login on the final launch origin.

## Handoff

Start with `FORKING.md` for owner setup and `FRONTEND-INTEGRATION.md` for design work. The release adds server-owned cohort/email labels, private JPEG import, font notices, source/history checks and a generic recognition screen. The Classmates visual language, Practice schedule, rapid-input controller and tester accounts remain intact. Use this branch's tested modules when incorporating future Claude design commits; do not copy ignored credentials or real class media into the public tree.
