# Neutral portrait distractors

Private contact sheets are manually reviewed without names. Each portrait receives exactly eight directly visible, neutral labels: hair length, hair texture, eyewear, facial hair, pose, framing, background, and expression. Reviewers do not record identity or protected traits. Unknown values add no match evidence and reduce confidence.

`node --env-file=.env.local scripts/gsb/portrait-review.js` validates all review parts, local image presence, and exact current-deck coverage, then prints a dry-run summary. Add `--publish` only after reviewing that summary. Publishing inserts a new immutable revision; it never updates an old revision. Only sixteen ordered opaque peer IDs per card are stored. Raw labels and images remain under `.private/`.

Hair, eyewear, and facial-hair matches carry the strongest weights. Pose and framing are weaker, while background and expression barely break ties so a shared photo setting cannot dominate. Adjacent hair-length, texture, and facial-hair categories receive partial credit. Lexical name similarity breaks otherwise equal visual scores. At question time, seeded rank-weighted sampling chooses three peers, penalizes recently used choices, and falls back to lexical similarity when peers are absent after an exclusion.

All 415 portraits were inspected by three GPT-5.6 reviewers, followed by independent spot checks and joint name/portrait peer checks. All 415 names and their leading lexical neighbors were also audited. The name audit led to removing initial-letter bonuses, adding separate first/last-token comparisons, and rejecting weak lexical matches. These checks do not establish gender or ethnicity categories, and the resulting choices do not promise those groupings.

Two ambiguous group photos have insufficient subject evidence and use name-based fallback. Covered hair is missing evidence rather than a shared headwear match. The publishing script checks each reviewed image's hash against the current card's protected media URL so changed source photos cannot silently reuse old annotations. The published revision is `mba2027-56f756678e70434a-portraits-544b0e33ef653412`.
