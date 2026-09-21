# Recognition distractors

Recognition keeps its general-purpose behavior unless the caller opts into `distractors: "similar-names"`. The opt-in ranks wrong choices using only the text of each card's `answer`: normalized spelling, character overlap, simple phonetic substitutions, first- and last-token similarity, token lengths, and apostrophe or hyphen structure. It does not expand nicknames or infer or store personal identity attributes.

The selector is pure and uses the kit's seeded random source. It samples a weighted top-candidate pool instead of always taking the same nearest three. Names scoring at least `0.36` form the confident pool. When fewer than the requested number meet that threshold, the selector fills the pool from a broader seeded shuffle instead of presenting weak shared-character matches as close names. Callers may override the threshold with `minimumScore`. A rolling recent-choice penalty adds variation across a question sequence while retaining strong lexical matches. Enabling the option never removes cards from the question sequence. Target selection is random unless the caller passes `targets`, an ordered list of card ids; the speed round uses that to ask about recently unseen people first.

For name-to-face questions, this chooses photo cards by the associated name. It does not compare photographs or claim that the people look alike. Visual matching is deliberately outside this selector because backgrounds, lighting, and framing can be misleading proxies.

Callers can enable it with:

```js
questions(cards, count, direction, rng, {
  distractors: "similar-names",
  poolSize: 8,
  minimumScore: 0.36,
  recentLimit: 12,
});
```

`poolSize`, `minimumScore`, and `recentLimit` are optional. Direct spaced-review calls to `questionFor` can pass the same object as its sixth argument. Decks with fewer than four cards remain invalid because every recognition question has four unique card choices.

Classmates now uses `similar-portraits`, which selects from privately reviewed visual peer lists and uses this name selector as a fallback. See [PORTRAIT-REVIEW.md](PORTRAIT-REVIEW.md) for the review and publication process. Generic recognition games still default to random choices.
