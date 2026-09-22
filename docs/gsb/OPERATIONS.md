# Classmates operations

## Deployment resources

- GitHub: `wesleyzhao/classmates`, branch `main` (clean public history).
- Checkout: `/Users/wesley/projects/parlor-public-source`.
- Vercel: `wesleyzhaos-projects/gsb-classmates`, same production URL and data.
- Neon: `gsb-classmates-db`, free plan, separate from Parlor.
- Blob: `gsb-classmates-portraits`, private, iad1.
- Time zone for daily rating caps: `America/Los_Angeles`.

Git pushes to `main` deploy automatically. Other branches do not deploy. See [LAUNCH.md](LAUNCH.md) before promoting changes; keep the original private repository's history separate.

Required production variables: `APP_PROFILE=gsb`, `APP_ORIGIN=https://gsb-classmates.vercel.app`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, and a random `AUTH_SECRET` of at least 32 characters. Provider credentials stay in Vercel environment variables and ignored `.env.local`, never in Git or documentation. The first runtime dependencies remain the Neon driver plus the server-only Vercel Blob SDK; browser code adds none.

## Live email delivery

Descope's free Vercel Marketplace integration `gsb-classmates-auth` is installed following the owner's explicit terms approval. `DESCOPE_PROJECT_ID` is connected to the project. The default sender is `noreply@descope.io`; a custom domain is not required for the current setup. Each request is sent to the Stanford address entered in the form. No address is hard-coded into the delivery adapter.

Descope configuration: Magic Link API/SDK enabled, expiration 15 minutes, default redirect `https://gsb-classmates.vercel.app/login`, approved domains `gsb-classmates.vercel.app` and `localhost`. Keep the approved domains explicit. No paid plan or domain purchase was made.

The managed-provider adapter is `server/gsb/descope.js`. The app stores a separate hashed, origin-bound challenge, sends it with the provider redirect, then requires Descope's server verification response to confirm the exact recipient's verified email. A challenge alone cannot sign in. GET requests never consume credentials; the browser removes query credentials into the fragment, then an explicit confirmation posts the two proofs. See [send API](https://docs.descope.com/api/magic-link/email/sign-in-auto-sign-up) and [verify API](https://docs.descope.com/api/magic-link/verification/verify-token).

Resend remains an alternative in `deliverLink(email,url)`: remove `DESCOPE_PROJECT_ID`, set `RESEND_API_KEY` and `EMAIL_FROM` at a verified domain, and redeploy. Provider changes do not replace accounts, progress, ratings, or app sessions. Existing Descope links should expire before removing that provider.

### Email wording and daily limits

Checked September 21, 2026: [Descope's Free plan](https://www.descope.com/pricing) includes up to **1,000 emails per day** and 7,500 monthly active users. The application allows **900 sign-in requests per 24-hour window**, shared across all users and IPs. This replaces the earlier 90-request limit. Set `CLASSMATES_LOGIN_EMAILS_PER_DAY` to a positive integer to use a different sender allowance; omitted configuration defaults to 900 and invalid values fail closed. Keep headroom below the provider allowance. Failed sends consume capacity conservatively because a timeout does not prove the provider failed to send. Provider limits, reset times and throttles still apply independently.

### Campus launch limits

`server/gsb/launch-limits.js` holds the network ceilings. An IP is a shared network, not a player. These defaults admit a 450-person class sharing campus Wi-Fi, including one resend each within the default daily email budget:

| Operation | Limit | Scope |
| --- | --- | --- |
| Login email | 900 per 24 hours | Whole app, configurable as above |
| Login email | 3 per 15 minutes | Normalized recipient |
| Login email | 1,800 per 15 minutes | Shared IP |
| Confirm login link | 1,800 per 15 minutes | Shared IP |
| Start guest trial | 1,000 per hour | Shared IP |
| Start guest trial | 2,000 per 24 hours | Whole app |
| Finish guest trial | 3,000 per hour | Shared IP, including retries |

Counters use the existing atomic database upsert. Each fixed window starts with its first counted request, and restarts after its duration; these limits do not reset at Los Angeles midnight. Increasing a ceiling retains existing counts and does not delete sessions or history. Recipient checks run before network and daily checks, so rejected repeat-recipient requests do not spend everyone else's allowance. Exhausted email capacity does not prevent an already-issued link from being verified or a signed-in person from playing. Existing guest cookies resume their original trial even when new-trial capacity is exhausted. Full roster access and one trial per browser stay unchanged.

Quick challenges and duel rematches share a per-account creation budget of 120 per hour, increased from ten. Join/begin allow 240 per hour and ready allows 480 per hour for toggles/retries. Ordinary gameplay, Practice and room actions already use account/player limits. The private tester door retains its separate ten-per-IP-per-fifteen-minute protection and existing accounts. Never copy a low blanket API/IP rule from generic Parlor deployment advice into a campus deployment: portrait loads and multiplayer polling also share that network.

Launch checks include synthetic 450-person shared-IP routing tests, atomic Postgres boundary/concurrency tests, and Chromium/WebKit guest and email-link journeys. These verify correctness and rate-limit capacity, not 450 simultaneous real browsers or guaranteed free-tier throughput. No bulk real emails are sent by the tests.

The managed **Descope / System** sender locks its email template. Its console explicitly disables New Template until a custom connector is selected; [provider documentation](https://docs.descope.com/auth-methods/magic-link/settings) confirms this restriction. Production still uses that template. Do not claim that editing app files changes managed email copy.

`server/gsb/login-email.js` holds the requested “Hi there,” / “Click on the button below to log-in to the GSB faces game” / **Log In Now** message in HTML and plain text. The Resend adapter and isolated preview share it. `CLASSMATES_EMAIL_NAME` customizes the game name for forks. To activate this copy for real recipients, configure a custom sender with a verified sending domain (or a Descope custom messaging connector). No domain, paid plan or sender switch was made in this release.

## Database and import

Run from this worktree:

```bash
npm ci
npm run gsb:migrate
npm run gsb:import -- /Users/wesley/projects/browser-agent-brightcrowd/data/brightcrowd_mba2027.jsonl
```

The migration is idempotent and uses the direct Neon URL when available. The importer allowlists the source image host, downloads with GET, verifies image content type and size, optimizes using macOS sips, uploads privately, then publishes an immutable content revision. It prints counts and opaque identifiers, never contact details. Failed runs can resume. Existing exclusions persist. Review the importer before running it on a different source shape.

Exclude a profile using its opaque ID:

```bash
node --env-file=.env.local scripts/gsb/opt-out.js PERSON_ID exclude
node --env-file=.env.local scripts/gsb/opt-out.js PERSON_ID restore
```

Exclusion takes effect for new private media requests and question/deck loads. Active rooms containing the profile become void when next accessed. Previously downloaded images cannot be recalled from someone's device. To identify a profile, query its ID by exact name through an authorized database session without copying the roster into tickets or source files.

Run `node --env-file=.env.local scripts/gsb/cleanup.js` for expired links, sessions, old retry IDs, rate-limit rows, inactive thirty-day rooms, and expired unclaimed guest runs. Match/rating history, study progress, and claimed personal guest scores remain. Expired credentials are rejected even before cleanup.

## Tests and local preview

```bash
npm test
npm run check
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_browser node --env-file=.env.local scripts/gsb/test-setup.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_browser node --env-file=.env.local --test tests/gsb/database.integration.js
npx playwright test --config=playwright.gsb.config.js
npx playwright test --config=playwright.gsb-guest.config.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_guest_api node --env-file=.env.local scripts/gsb/test-setup.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_guest_api node --env-file=.env.local --test tests/gsb/guest.integration.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_sprint_api node --env-file=.env.local scripts/gsb/test-setup.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_sprint_api node --env-file=.env.local --test tests/gsb/sprint.integration.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_launch_api node --env-file=.env.local scripts/gsb/test-setup.js
NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_launch_api node --env-file=.env.local --test tests/gsb/launch-limits.integration.js
```

The explicit test setup creates its own Postgres schema with fictional students and silhouettes. Production data stays in `public`; test rows do not affect class scores. The schema override and local email outbox require NODE_ENV=test and are ignored on Vercel. Browser tests write one-time links to `/tmp/gsb-test-mail.jsonl`; treat that local file as private test credentials and delete it when finished.

For the real local deck, run:

```bash
NODE_ENV=development APP_PROFILE=gsb APP_ORIGIN=http://localhost:3137 node --env-file=.env.local server/dev.js 3137
```

The ignored `.env.local` must contain the real database, Blob credentials, AUTH_SECRET, and DESCOPE_PROJECT_ID. Sign in with a real Stanford email. Local and production links are origin-bound even though this preview uses the same accounts and progress. Local practice therefore changes real account progress. Do not set GSB_TEST_SCHEMA for this preview.

An operator-only recovery script can issue the explicitly configured owner's preview link: set `GSB_OWNER_EMAIL` locally and run `node --env-file=.env.local scripts/gsb/owner-link.js http://localhost:3137 .private/owner-local.json`. The link expires in 15 minutes, works once, and grants 24 hours of clearly labelled owner access. It never marks the email verified. No public endpoint can issue such grants. Never commit, deploy, log, or share its private output.

Ordinary browser automation runs on **3138**, separately from the real preview on **3137**. The enabled guest suite runs on **3139** in `gsb_test_guest`, with fictional silhouettes and `/tmp/gsb-guest-mail.jsonl`. Guest HTTP integration uses `gsb_test_guest_api`. Run the browser suites sequentially for predictable screenshots and database load. For a manual synthetic preview, run the webServer command from the relevant Playwright config. Request a test stanford.edu address in the form, retrieve its link from the local test outbox, and open it. No email is sent. Use synthetic accounts only. Do not deploy the test configuration.

Deploy by pushing the reviewed, tested source to the public repository's `main` branch. Use that explicit scope for project and log commands too. Verify `/api/health`, the public login page, protected API denial without a session, and an actual verified email flow. The outbox does not prove real delivery.

The speed-round release requires the additive `gsb_sprint_runs` migration before deploying. `npm run gsb:migrate` applies it idempotently. `/speed` is authenticated and independent of the guest flag. Its result ledger does not change multiplayer Elo or practice progress. Expired unfinished runs are cleaned in bounded batches during preparation; completed records are retained. See [SPEED-ROUND.md](SPEED-ROUND.md) for timing, comparison groups, and Claude's integration contract.

## Guest experiment controls

The production guest experiment is enabled with a fixed approved ten-person sample and `CLASSMATES_LANDING=quick`. Signed-out visitors go directly to 3-2-1, then ten faces with two named drop targets. The result requires verified sign-in to continue. Signed-in visitors default to the same two-choice interaction. Four-choice Speed, other directions, Practice and multiplayer remain available.

Forks default to guest mode off. Enabling requires both `GSB_GUEST_PREVIEW=true` and `GSB_GUEST_PERSON_IDS` with 10 to 32 approved opaque IDs. These server variables stay outside Git. Disabling the flag blocks guest routes/media; the full class deck always requires a session. See [GUEST-ROUND.md](GUEST-ROUND.md) for claims, expiry and live exclusions.

## The test door

For testing with someone who has no Stanford email, an operator can hold a door open. It is a row in `gsb_settings` read at request time, so it changes without a deploy:

- `npm run gsb:door -- open` prints a link of the form `https://gsb-classmates.vercel.app/door/CODE` (pass `--origin=http://localhost:3137` for a local preview). Anyone who opens it gets a week-long session and a fresh account with no email, and goes through the nickname step. The explanatory tester banner is omitted. This link tests signed-in access, not the public guest countdown; see [ONBOARDING.md](ONBOARDING.md) for repeatable first-visit testing.
- `npm run gsb:door -- close` shuts it and ends every door session at once. `close --purge` also deletes the door accounts and everything they scored (sprint runs, challenges they hosted, progress, ratings and pair records), so class standings are clean again. `status` shows the state and who came in.
- The route is `POST /api/auth/door {code}`, rate limited per address; a closed door or a wrong code is a 404. A door account is never marked email-verified, and nothing public can open the door.

## Free-tier constraints

Resources were provisioned on free plans. Free tiers are finite: private Blob reads incur storage operations and transfer, and each room poll executes database work. The 415 optimized portraits occupy 18.8 MB, but repeated uncached media requests can reach operation allowances before storage capacity. Start with a small class pilot, inspect Vercel/Neon usage, and tune polling or authenticated caching with an explicit opt-out policy before scaling. No paid plan, custom domain purchase, realtime provider, or paid email subscription was added. Descope usage is also subject to its free-plan limits.

## Reviewed portrait peers

All 415 approved portraits were reviewed privately by three GPT-5.6 agents for directly visible hair, eyewear, facial hair, pose, framing, background, and expression, followed by independent spot checks and name/photo comparisons. Names were also audited across the whole deck for lexical ranking errors. Two group photos lack an unambiguous subject and receive no visual peer list. No gender, race, ethnicity, nationality, or religion classifications are created.

Run `node --env-file=.env.local scripts/gsb/portrait-review.js --preview` for a dry run and private peer preview. The compiler validates exact annotation coverage and hashes of the local optimized photographs against their deployed media IDs. After review, `--publish` inserts a new immutable revision containing only opaque peer IDs; raw review labels remain in ignored `.private/portrait-review/`. Reimporting changed photographs requires a fresh review; never reuse annotations after a failed hash check. Existing rooms retain their pinned revision, and exclusions still remove candidates at runtime.
