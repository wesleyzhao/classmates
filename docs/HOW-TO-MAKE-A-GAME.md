# How to make a game

A game is a kit (how it plays) plus decks (what it asks), settings, and a look. No rules code is involved. This takes minutes.

## The sixty-second version

```
npm run new-game -- --kit quiz --slug capitals-of-asia --title "Capitals of Asia"
```

Open `public/games/capitals-of-asia.js`, set the decks and the settings, pick a theme, run `npm test`, and it is live on the next deploy under `/g/capitals-of-asia`.

## Game, deck, kit

- A **kit** is a mechanic: `quiz` (everyone answers the same card at once), `board` (take turns, roll, move, answer), `cards` (hidden hands). `npm run kits` prints each one's settings and what content it needs.
- A **deck** is cards: `{ id, prompt, answer, aliases?, choices?, image?, emoji?, category? }`. Built-in decks live in `public/decks/`; `npm run new-deck -- --id my-deck` scaffolds one.
- A **game** binds them: `public/games/<slug>.js`.

```js
export default /** @type {import('../../types/parlor.js').GameDefinition} */ ({
  id: 'capitals-of-asia',
  slug: 'capitals-of-asia',
  title: 'Capitals of Asia',
  description: 'Name the capital before the clock does. Asia only, so no hiding behind Paris.',
  emoji: '🏯',
  kitId: 'quiz',
  config: { cards: 10, seconds: 15, answerMode: 'both', autoAdvance: true, choicesFrom: 'deck' },
  content: { decks: ['capitals'], categories: ['asia'] },
  theme: 'editorial',
  accent: '#1f7a4d',
  builtin: true,
});
```

`npm test` validates every game against its kit's schemas, checks that every deck it references exists, and audits the decks (no duplicate prompts, no question that contains its own answer, no dashes, choices that include the answer).

## Writing a deck

Cards are copy a player reads; follow `docs/VOICE.md`. A prompt asks one thing plainly. Give aliases for the ways people actually say the answer ("USA", "United States", "America"). Choices, when you provide them, should be plausible; when you do not, the quiz kit builds them from other cards in the same category. Emoji and images are optional: a flag card carries both an emoji flag and an image address, and the screen uses the image when the device cannot draw flag emoji.

A deck may declare categories (`categories: [{ id: 'europe', name: 'Europe' }]`) and tag cards with one; games can then filter (`categories: ['europe']`), and the board kit maps its categories onto them.

## Choosing settings and a look

Every kit's `config` schema has labels, ranges, and defaults; `npm run kits` prints them. `theme` is `editorial` or `playful`; `accent` is an optional hex color the theme uses for links, badges, and highlights. Pick the theme that fits the mood: editorial for a quiet quiz, playful for a party.

## Board games

A board game names a layout (`wheel` needs exactly six categories, `track` takes any number) and maps each category to decks: `categories: [{ id: 'geo', name: 'Geography', color: '#2f6bff', decks: ['trivia'], filter: 'geo' }, ...]`. `filter` keeps only cards tagged with that deck category. Settings choose how to win (`collect` wedges or `reach` the finish), how people answer (tap choices, say it and be marked, or type it), and whether an exact roll is needed to finish.

## In the browser

The creator at `/create` walks through the same four choices (kind of game, decks, settings and look, publish) and stores the result in the database instead of a file. Games made there have an edit link; built-in games can be remixed into a copy you own.

## Checklist

- `npm test` passes (schemas, decks, voice).
- The game appears on the home screen with its emoji, a tile in its accent, and the first sentence of its description, so open with the hook and put the rest after it.
- Played once with two phones or two tabs (`npm run dev`).
