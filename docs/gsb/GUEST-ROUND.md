# Ten-face guest introduction

A deployment opts in with both `GSB_GUEST_PREVIEW=true` and `GSB_GUEST_PERSON_IDS` containing 10 to 32 distinct, approved person IDs. New forks stay disabled. Keep the allowlist outside Git. This launch uses a fixed ten-person sample, so repeated visitors cannot enumerate the full roster. Both target photos and name distractors come from that sample. Turning the flag off disables all guest routes; live opt-outs and removal from the allowlist revoke existing guest media too.

Anonymous `/` and `/guest` open the round automatically when enabled. `/login`, room invites and challenge invites keep their existing sign-in flows. Signed-in `/` opens the ten-face Speed screen when `CLASSMATES_LANDING=quick`; `/games` retains every other game. This landing setting defaults to `games` for forks and is independent of the guest flag.

## One trial and sign-in

Each browser gets one random HttpOnly, SameSite=Lax capability cookie, Secure on Vercel, with a one-year maximum age. Only its hash is stored in `gsb_guest_runs`. The round and its media access expire after seven days. A completed round reloads its result; a valid spent cookie whose row expired or was cleaned up returns `status: expired`, never a new trial. Resume requests do not consume the new-trial rate budget.

This is one trial per browser, not a global identity check. Clearing cookies or using another browser can obtain another trial. Avoid fingerprinting or an IP-only ban: people on the same campus share addresses. The bounded sample and rate limits prevent this convenience limit from becoming full-roster access. A browser may also evict storage before its declared expiration.

The result screen contains the email form directly. Entering an eligible email sends a magic link to that address; verifying the link is required to continue or save. The same-browser cookie claims the result exactly once after verified sign-in. Opening the link in another browser cannot claim the original browser's trial. The nickname step remains, followed by the ten-face Speed screen and a visible saved-score confirmation. Claimed scores remain available under Scores. Existing tester grants remain separate and cannot claim a guest score as verified email accounts.

Guest scores are personal, unranked results. They never enter competitive Speed records or multiplayer ratings. The existing claim trigger records the faces seen/right/wrong in cross-mode history. Practice-only spaced repetition stays separate.

## Controller and media

`public/gsb/guest-round.js` owns media through `prepareRoundMedia`, the same bounded loader used by Speed. All ten images are downloaded and validated before an automatic 3-2-1 countdown. Returning to a hidden countdown restarts it, so no question times out unseen. A failed preload has a retry and releases partial object URLs.

Each question allows eight seconds. A tap, number key (1 through 4), or flick advances immediately. Correct/wrong animation runs independently; no HTTP request or animation timeout separates questions. The displayed question ID is consumed synchronously to reject duplicate events. Held number keys do not repeat. A timeout records a null answer and advances.

The browser keeps only opaque run/question IDs, answer indices, elapsed times and the current timer in localStorage, allowing interrupted attempts to resume after a tab closes. Older sessionStorage attempts still restore. Names, photos and authentication credentials are never persisted there. A failed finish keeps the answer log for retry; success clears it. Media object URLs live only in memory and are revoked on exit.

`sprint-pieces.js` shares the portrait/body and corner answer artwork with signed-in Speed. Keep result feedback and inline form errors inside the full-screen cabinet. Shell-level messages can be obscured by that panel.

## API and authorization

- `GET /api/session` exposes only `{guest:{enabled,count}}`, never allowlist IDs.
- `POST /api/guest/start` creates or resumes one run; `GET /api/guest` reads it.
- `POST /api/guest/finish` accepts ordered `{answers:[{questionId,choice,elapsedMs}]}`. Choices are string indices 0 through 3 or null; elapsed times are bounded integers. The server scores all answers, stores one result atomically and returns that first result on retries/concurrent finishes. Existing eight-question documents remain scoreable by their own length.
- `GET /api/guest/media/ASSET` requires the cookie, the exact assigned target asset, the current allowlist and a non-excluded person. Historical/alternate assets and the full `/api/media` route remain denied.
- Authenticated `POST /api/guest/claim` attaches a completed result once to a verified email account. `GET /api/guest/best` returns its best valid personal guest result.

All guest routes return 404 while disabled. New trials are limited to five per IP per hour and 200 globally per day; finishes to twenty per IP per hour. Email delivery has separate existing limits. These limits are operational settings in the router, not browser controls.

## Verification

`npx playwright test -c playwright.gsb-guest.config.js` uses fictional people on localhost:3139 in `gsb_test_guest`, with a local email outbox. It covers automatic countdown, complete/timeout/refresh flows, direct email claim, invalid-domain feedback, ten-face signed-in entry, the retained game menu, rapid taps, duplicate events, media failure/retry/cleanup, expired-cookie sign-in and invitation precedence. Chromium and WebKit both run at phone width with desktop screenshots.

The ordinary browser suite on 3138 checks disabled guest behavior and existing modes. Real guest HTTP tests use only `gsb_test_guest_api`; they verify media assignment, races between finishes, ownership, expiry and live exclusions. Local timing measurements are not a physical-device performance guarantee. Never publish test outboxes, traces, screenshots of real people or credentials to GitHub.
