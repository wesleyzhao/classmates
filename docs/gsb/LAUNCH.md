# Clean repository and ten-face entry

This release keeps the existing Vercel project, production URL, database, portraits, login provider, accounts, tester grants and game modes. Work happens in `parlor-public-source` on `launch/ten-face-entry`; the old private repository and Claude checkout are retained.

## Release checklist

- [x] Verify the clean source matches the reviewed release and check Claude for new work.
- [x] Add a configurable ten-face entry screen and automatic guest countdown after media preload.
- [x] Keep one guest attempt per browser, resume interrupted attempts and require verified email to save or continue.
- [ ] Preserve invitations, nickname editing, Practice, Speed, duels, quizzes, races and rankings.
- [ ] Run unit, type, API, browser, phone/desktop, privacy and build checks.
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
