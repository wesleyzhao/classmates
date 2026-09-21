# Clean repository and ten-face entry

This release keeps the existing Vercel project, production URL, database, portraits, login provider, accounts, tester grants and game modes. Work happens in `parlor-public-source` on `launch/ten-face-entry`; the old private repository and Claude checkout are retained.

## Release checklist

- [x] Verify the clean source matches the reviewed release and check Claude for new work.
- [x] Add a configurable ten-face entry screen and automatic guest countdown after media preload.
- [x] Keep one guest attempt per browser, resume interrupted attempts and require verified email to save or continue.
- [x] Preserve invitations, nickname editing, Practice, Speed, duels, quizzes, races and rankings.
- [x] Run unit, type, API, browser, phone/desktop, privacy and build checks.
- [x] Publish the clean repository and connect it to the existing Vercel project.
- [ ] Enable a bounded ten-person guest sample outside Git, deploy to the same URL and verify production.
- [ ] Record source/deployment, rollback, preservation evidence and remaining limitations.

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
