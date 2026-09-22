# First visits, email and invitations

## Entry behavior

An unauthenticated visit to `/` or `/guest`, with the guest experiment enabled, opens directly at 3-2-1. Ten portraits preload during the count. There is no nickname form or start button before that round. The result requires an eligible email link to save or continue.

`/door/CODE` is intentionally different: it grants an unverified tester account while the operator's door is open. That new account still needs a nickname. A tester session is a signed-in session, including in an incognito window that already opened the door. To test the public first visit, use the plain site URL in a fresh browser context. Do not close the door or delete tester accounts just to simulate a new visitor.

After the first email confirmation, nickname setup starts with the email username. It has an accessible, visually hidden heading, the nickname input, the length/privacy note and Save. Face history belongs to the regular account page after a nickname exists. Existing accounts keep their nickname and skip setup. Clicking the account name still permits changes. Tester-door explanation text is no longer shown in the game UI.

Email links are confirmed with a button before the one-use credential is consumed. This protects against mail scanners following links automatically. The heading works for both new and returning users.

The account API reports `access: "email"` for every verified email provider, including Descope, both immediately after confirmation and when restoring a session. The database retains the provider-specific session purpose. Guest-score claims and other features consume the verified access class, not a provider name; tester and owner-preview access remain separate.

## Rehearse without changing a real account

From the canonical checkout with `.env.local` providing the database connection:

```sh
npm run preview:onboarding
```

Open `http://127.0.0.1:3140/api/preview`. Start a fresh visitor, play ten fictional faces, and enter the suggested fresh address on the result. Refresh the test inbox, open the captured link, and save the nickname. The score is claimed through the real application flow. Repeat with Start a fresh visitor.

The inbox is a functional message preview, not a reproduction of Descope's hosted email styling. Production still sends through the configured provider to the entered address. To inspect that actual message, request a link at the production `/login` page and view it in the recipient's mailbox. An existing production account will keep its nickname; do not reset it to test onboarding.

Safety boundaries:

- The preview forces `NODE_ENV=test` and the isolated `gsb_test_onboarding` schema before importing database code. All people are synthetic. No production migration or cleanup runs.
- It binds to loopback and checks the exact Host, Origin and fetch context before any API access. It refuses to start on Vercel.
- Delivery is captured in server memory, limited to thirty messages, with no actual mail sent. Messages disappear when the server stops. No browser or query parameter can enable this adapter on production.
- `127.0.0.1` separates its cookies from the existing `localhost` development game. Cookies ignore ports, so keep other 127.0.0.1 game instances closed while rehearsing. Start a fresh visitor clears only this preview browser's cookies and storage and suggests a new identity. It does not delete accounts or game history.
- Source for the preview page stays in `scripts/`, outside the published static site. `/api/preview` and its inbox/reset routes do not exist in the production handler.

The real guest sample requires only the bounded approved portraits; the full deck remains behind authentication. Never make the real login outbox public to simplify testing.

## Invitations

A signed-out visitor to `/speed/CODE` or `/r/CODE` sees an invitation notice and the email form. There is no guest-round diversion. After email confirmation and, for a new account, nickname setup, the original invitation opens. Duels offer Ready; rooms wait for the host. An invalid, full or unavailable game is still handled by the normal authenticated game API. An invitation never grants access to the roster.

`returnTo` carries the destination through local/Resend links and Descope callbacks. `invite-path.js` accepts only the two four-letter internal invitation routes. It rejects external URLs, query strings and unrelated paths. The browser moves the credential into the fragment, retains the invitation across reloads, and keeps the one-hour local return fallback. Opening an email in another browser retains the invitation. Guest-score claiming still requires the browser containing the original guest cookie; this change does not transfer an anonymous attempt between devices.

## Verification

```sh
npm test
npm run check
npx playwright test -c playwright.gsb-onboarding.config.js
npx playwright test -c playwright.gsb-guest.config.js
npx playwright test -c playwright.gsb.config.js --grep 'email defaults|magic links|an invite link|a duel starts|email links'
```

The onboarding suite starts its own preview on port 3141. It exercises the preview controls and inbox, all ten guest answers, first nickname setup, guest-score claim, independent reset, existing localhost cookie preservation, and duel/room links confirmed in a different browser. Both Chromium and WebKit run at phone sizes; nickname and inbox screenshots are written under ignored `output/gsb-screenshots/`. Unit tests cover email destination validation, both delivery adapters and preview access guards.
