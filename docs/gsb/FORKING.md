# Fork and deploy your own Classmates

This is a single-cohort application per deployment. A fork gets the engine and design, not the original class data or accounts. Keep Parlor's public catalog and Classmates' private roster in separate projects and databases. The legacy `gsb` folder and profile names are internal identifiers and can stay unchanged.

## 1. Clone and choose your project

Fork the repository to your account, clone your fork, and use Node.js 22:

```bash
npm ci
cp .env.gsb.example .env.local
```

The repository has no `.vercel` link or credentials. Run `vercel link` (or the connected Vercel agent tool) and select or create **your own** project. Retain the checked-in build, output and routing settings from `vercel.json`. Do not copy another deployment's `.vercel/` or environment file. On Vercel, set `APP_PROFILE=gsb` for both build and runtime.

The Vercel CLI is an operator tool, not an application dependency. Initial account authentication and provider terms may require the owner's authorization. Once credentials and access are available, an authorized coding agent can perform project setup, environment configuration, import, migration, deployment and checks with tools/CLI. Do not silently accept a paid plan.

## 2. Provision private resources and configuration

Use a dedicated Neon database and a **private** Vercel Blob store. Existing resources can be connected instead of creating new ones. In a newly linked project, current CLI entry points are:

```bash
vercel integration add neon
vercel blob create-store my-class-portraits --access private
vercel integration add descope
```

Choose the available plans appropriate to your use, connect resources only to this project, and confirm environment variables were attached. CLI flags and plan availability can change; consult the official [integration CLI](https://vercel.com/docs/cli/integration) and [private Blob instructions](https://vercel.com/docs/vercel-blob/private-storage). A code fork does not include cloud service quotas or paid services.

Set these values through Vercel environment management and in ignored `.env.local` for local operation:

| Variable | Value |
| --- | --- |
| `APP_PROFILE` | `gsb` |
| `APP_ORIGIN` | Your exact HTTPS deployment origin, with no path, query or credentials. Locally, `http://localhost:3137`. |
| `DATABASE_URL` | This project's Neon URL. |
| `DATABASE_URL_UNPOOLED` | Optional direct URL for migrations. It must target the same database. |
| `BLOB_READ_WRITE_TOKEN` | The token attached to your private store. Never put it in browser code. |
| `AUTH_SECRET` | A unique random value of at least 32 characters. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. |
| `DESCOPE_PROJECT_ID` | Your own configured Descope project, or use the Resend alternative below. |
| `CLASSMATES_EMAIL_DOMAINS` | Comma-separated exact domains, e.g. `example.edu,alumni.example.edu`. Defaults to `stanford.edu`. No wildcards; subdomains require an explicit entry. |
| `CLASSMATES_COHORT_LABEL` | A short display label. Defaults to the original Stanford class label for the Stanford policy, otherwise `Classmates`. |

Choose a stable project URL before configuring email. An `APP_ORIGIN` shared with production makes preview login point to production; use a separate preview project/origin and data resources for independent previews. Never expose production database credentials to fork PR builds.

The build updates link-preview URLs from `APP_ORIGIN` and their description from the cohort configuration. Customize the game title in `public/gsb/index.html`, the share image `public/gsb/og.png`, and any class-specific ranking language in `public/gsb/app.js` and `server/gsb/leaderboard.js`. The included share image is an illustration, not a real portrait. Check the rendered labels before launch. Keep the font licenses when changing the artwork. Search `public/gsb/` for remaining Stanford/GSB copy if your audience differs.

## 3. Enable real login email

Descope supplies a default messaging connector, so this adapter can work without buying a sender domain. In your own Descope project, enable Magic Link API/SDK authentication, use a 15-minute expiry, and allow only your intended app/localhost redirect domains. Set the default redirect to `https://YOUR-APP/login`; the adapter supplies a recipient-bound callback for each request. Configuration can be performed with provider tools or management APIs when the agent has the required access. See [Magic Link settings](https://docs.descope.com/auth-methods/magic-link/settings) and [project settings](https://docs.descope.com/management/project-settings).

Alternatively, remove `DESCOPE_PROJECT_ID` and set `RESEND_API_KEY` and `EMAIL_FROM` for a sender domain you control and have verified. Do not configure both providers expecting automatic failover: Descope takes precedence. Delivery always uses the address entered by the user. The app requires verified provider proof, not a decoded JWT or a client-provided email.

The normal login flow asks only for email, then lets the user choose a nickname (default: email username). Removing a domain prevents its normal sessions and pending links from signing in; explicit operator tester grants remain separate. New forks start with no tester grants. The guest experiment stays disabled unless you deliberately configure it; read `docs/gsb/GUEST-ROUND.md` before considering it.

## 4. Prepare your own roster locally

Put the following in ignored `.private/roster/manifest.json`, with images below the same folder. `examples/classmates/manifest.json` contains fictional rows only; it is a schema example, not a ready-to-play roster.

```json
{
  "cohort": "my-class-2027",
  "people": [
    {"id": "person-001", "name": "Alex Example", "photo": "photos/001.jpg"},
    {"id": "person-002", "name": "Blair Example", "photo": "photos/002.jpg"},
    {"id": "person-003", "name": "Casey Example", "photo": "photos/003.jpg"},
    {"id": "person-004", "name": "Devon Example", "photo": "photos/004.jpg"}
  ]
}
```

Use 4 to 600 people. IDs must remain stable when a name or photo changes; keep the cohort slug stable too. Do not use names or emails as IDs. The only allowed row fields are `id`, `name`, `photo`; keep emails, biographies, phone numbers and other contact details out. If starting with a contact export, have an authorized agent transform it locally into this minimal shape and do not commit either export.

Each photo must be an upright, 8-bit sRGB or grayscale JPEG, at most 1024 pixels on each side and 512 KB. About 480 pixels is sufficient. Bake orientation into the pixels and export to sRGB **before** import: the importer removes EXIF and other application metadata, including orientation and color profiles. It does not rotate, resize or perform color conversion. It rejects paths outside the manifest folder, including symlink escapes. It never downloads a remote URL. The prepared set is capped at 50 MB and the manifest at 1 MB.

```bash
# Local validation only. No credentials or cloud calls needed.
node scripts/gsb/import-roster.js .private/roster/manifest.json --dry-run

# After configuring your own resources:
npm run gsb:migrate
npm run gsb:import-roster -- .private/roster/manifest.json --publish
npm run dev:gsb -- 3137
```

Publishing uploads sanitized JPEGs to private Blob and stores only opaque IDs, names and private asset paths in Postgres. A revision becomes visible after all uploads succeed. Same-input retries reuse assets; existing opt-outs, accounts, progress and ratings are preserved. Changed photos get a new asset ID, and changed names/content get a new immutable revision. Removing a row changes the new deck; **use the opt-out command too** to revoke its older media/revisions. Failed imports can leave resumable assets, not a partially published deck.

```bash
node --env-file=.env.local scripts/gsb/opt-out.js OPAQUE_PERSON_ID exclude
```

An opt-out blocks subsequent authenticated media loads and excludes the person from decks; active matches containing that person become void on their next request. It cannot recall a portrait already downloaded to a device. `restore` reverses an exclusion. There is no upload-to-public-Git step.

The older `gsb:import` command is the original BrightCrowd/macOS adapter. New forks should use `gsb:import-roster`. Do not edit provider-specific parsing into the reusable rules.

## 5. Test and deploy

Run `npm test`, `npm run check`, `npm run security:check` and both profile builds. Public CI runs these without any cloud secrets. Then use your own test database (or disposable Neon branch); the following commands additionally isolate synthetic fixtures under explicitly named schemas. They must never be pointed at an unreviewed credential file. Tests reject production Vercel mode and use only `gsb_test_*` schemas.

```bash
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_release node --env-file=.env.local scripts/gsb/test-setup.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_release node --env-file=.env.local --test tests/gsb/database.integration.js
# Other suites require their exact dedicated schemas:
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_history node --env-file=.env.local scripts/gsb/test-setup.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_history node --env-file=.env.local --test tests/gsb/face-history.integration.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_sprint_api node --env-file=.env.local scripts/gsb/test-setup.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_sprint_api node --env-file=.env.local --test tests/gsb/sprint.integration.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_guest_api node --env-file=.env.local scripts/gsb/test-setup.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_guest_api node --env-file=.env.local --test tests/gsb/guest.integration.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_import node --env-file=.env.local scripts/gsb/test-setup.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_import node --env-file=.env.local --test tests/gsb/import.integration.js
npx playwright install chromium webkit
npx playwright test --config=playwright.gsb.config.js
npx playwright test --config=playwright.gsb-guest.config.js
```

The browser configs reserve localhost 3138 and 3139, use synthetic rosters, and send login messages to a local test outbox. They do not send email to real classmates. Screenshots/traces and outboxes contain test credentials and must stay out of Git and public CI artifacts. Test outbox delivery is disabled on Vercel regardless of its environment flags.

Deploy from the reviewed checkout with `vercel --prod`, then run:

```bash
npm run smoke:deployment -- https://YOUR-APP
```

This detects the profile. For Classmates it checks the shell and unauthenticated access boundaries without creating accounts or deleting anything. Complete a real delivered-email login on the deployed origin separately; a smoke check cannot prove inbox delivery. Use the [release regression checklist](PUBLIC-RELEASE.md) for practice, rapid input, nicknames, multiplayer, privacy and opt-outs. Verify phone Safari on actual hardware before claiming tilt support is hardware-tested.

## Instructions for an agent importing a roster

Read `AGENTS.md`, this guide and `FRONTEND-INTEGRATION.md`. Verify the linked project and database belong to the requester before any import or migration. Keep private input, credentials, login links, photos and screenshots outside Git. Start with the dry run, publish only the requested roster, and check authenticated access plus anonymous rejection. Do not remove tester accounts, rotate active access codes or purge records as incidental cleanup. Keep scoring/selection pure, Practice-only spaced repetition separate from cross-mode face history, and Speed's answer-to-next path independent of network calls. Report precisely which automated, browser, delivery and hardware checks ran.
