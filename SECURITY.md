# Security and private content

The code can be public while each Classmates deployment's roster stays private. Names, portraits, histories, accounts and credentials belong in that deployment's private storage, never in this repository, issues, PRs or public build artifacts. Ordinary Parlor catalogs and decks are public by design.

Normal Classmates access requires a one-use email link at an explicitly allowed domain. Session cookies are opaque, HttpOnly and host-only; server writes check origin, rates and identity. Private responses use `no-store`; the media route checks the current account and opt-out state. Operator-granted tester access is separate, unverified and intentionally supported. Public code does not automatically close an existing test door or delete its accounts.

Solo practice and speed scoring are designed for a friendly learning game. A signed-in person can inspect downloaded names/photos and the prepared solo round; client timings cannot prove human play. Shared competitive rules run on the server. Do not treat these leaderboards as tamper-proof high-stakes competitions.

## Before publishing

```bash
npm run security:check
npm run security:check -- --history
# Operator only, with an existing ignored .env.local:
npm run security:check -- --history --local-secrets
npm run security:check -- --history --private-emails /path/to/private/contact-export.jsonl
npm audit
```

The scanner reports paths and rule names, never secret values. It checks tracked working files or all locally reachable Git objects (including old commits), known private paths and common credential patterns. The optional local comparisons read known credential values or extract addresses from a private local source file only in their process. Addresses are compared case-insensitively and reports never contain them. Fetch all relevant remote refs before the history check. It is deliberately small, has a 128 MB Git-read bound, and is not a complete secret/PII detector. Review images, free-form documents, commit metadata and GitHub's non-Git surfaces separately. A `.gitignore` change does not erase old commits. Untracked files are not scanned until staged.

If a credential is ever committed, revoke/rotate it before rewriting history. If personal content is committed, keep the repository private until all reachable copies and external artifacts have been addressed. Never place production secrets in untrusted pull-request workflows. Do not enable anonymous private-content access as part of deployment setup.

## Reporting

Report exploitable issues privately to the repository owner or through GitHub private vulnerability reporting if enabled. Do not open a public issue containing credentials, login links, real portraits, roster rows or an exploit against a live deployment. Use synthetic examples. Each fork owner is responsible for its access policy, consent, exclusions and data retention.
