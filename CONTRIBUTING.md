# Contributing

Read `AGENTS.md` and the relevant profile guide before editing. Keep rule modules pure and dependencies minimal. A shared mechanic belongs in `public/kits/`; Classmates authentication, storage and account policy belong in `server/gsb/`. Keep visual changes separate from timing, scoring and persistence contracts so designers can iterate safely.

Use synthetic content for tests, screenshots and bug reports. Never commit a real directory, photo, email outbox, `.env.local`, `.vercel/` or database export. New content adapters should produce the minimal private-roster manifest described in `docs/gsb/FORKING.md`, then use its validated importer.

Run `npm test`, `npm run check`, `npm run security:check` and both profile builds. For user-visible changes, run the relevant browser suite and inspect phone and desktop screenshots. For persistence/auth changes, run the isolated database tests. Keep answer selection immediately responsive; do not add requests between solo Speed answers or reinterpret failed requests as wrong guesses.

Describe the problem, resulting behavior and actual verification in a PR. Preserve active tester accounts and existing exclusions. If another agent is editing the design, use an isolated worktree and recheck its changes before merging. Do not change repository visibility or production resource ownership as incidental maintenance.
