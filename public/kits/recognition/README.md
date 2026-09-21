# Recognition kit

Match an image to a name or a name to an image. `together` gives everyone the same timed question; `race` advances only after a correct answer. The pure kit is registered in Parlor and has a generic `ui.js`; Classmates supplies its own presentation and private persistence.

Create a game with `npm run new-game -- --kit recognition --slug my-recognition`. Supply at least four cards with stable `id`, `answer` and `image` values. The ordinary Parlor catalog and deck endpoints are public, so use public flags, illustrations or other approved public content there. **Use the Classmates profile for private faces or contacts.** Do not put a private roster in `public/decks/`.

The kit remains hidden in the general maker's mechanic picker because the picker does not yet select compatible image decks. Code-created games can use it. This avoids offering an image mechanic with incompatible text-only decks.

Reusable pieces:

| Module | Purpose |
| --- | --- |
| `questions.js` | Seeded target/distractor generation, direction switching and redacted question views. |
| `selection.js` | Prefer unseen items; balance novelty across participants while keeping one shared sequence. Accepts caller-provided histories. |
| `sprint.js` | Pure whole-round accuracy/speed score. It does not save or authenticate scores. |
| `name-similarity.js` | Lexical name similarity without inferred demographic labels. |
| `portrait-similarity.js` | Optional explicitly reviewed peer IDs, with a lexical fallback. |
| `kit.js` | Authoritative multiplayer rules, timing, first-answer observations and standings. |
| `ui.js` | Ordinary Parlor presentation using the shared theme and game UI components. |

`RoomService.prepareSetup(doc, decks, ctx)` can load history before calling the pure kit and return `{targets:[cardId,...]}`. The hook is optional; Parlor defaults to seeded random selection. Persistence stays outside the kit, and a room update must commit before observations are saved. Never perform network calls or read wall time inside kit rules.

Classmates' spaced repetition and account APIs stay in its application profile. New games can reuse these primitives without adopting its email policy, ratings, branding or database tables. See [fork setup](../../../docs/gsb/FORKING.md) and [face-history contracts](../../../docs/gsb/FACE-HISTORY.md).
