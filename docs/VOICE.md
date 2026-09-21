# Voice

Everything a player reads in Parlor, from a button label to a trivia question, should sound like a friend who is good at hosting a game night wrote it. Warm, plain, specific, unhurried. This applies to platform screens, kit screens, decks, error messages, and documentation shown in the app. `scripts/lint-copy.js` catches the mechanical slips; you catch the tone.

## How it sounds

- Ordinary sentences. Vary their length the way people do when they talk. A screen can carry one sentence or three, but not a stack of three-word fragments.
- Say the real thing. "That's Portugal. Nina and Sam had it." "Sam wins with 1,240 points. Nina was 40 behind." "Your turn. Roll when you're ready."
- Buttons say what happens: "Start game", "Next card", "Share link", "Play again". A button keeps its name through the whole flow, so "Publish" leads to "Published".
- Errors say what to do next and never apologize: "Can't reach the room. Check your signal, then try again." "No room with that code. Codes are four letters."
- Empty states invite the next action: "Nobody has joined yet. Share the link and they will show up here."
- Sentence case everywhere, including titles and buttons.
- Contractions are fine. Exclamation marks are rare, one per screen at most, and only when something happened.

## The two registers

The editorial theme is dry and warm, like a good games editor: precise nouns, no adjectives that sell. The playful theme is upbeat but never sugary; it earns its energy from the game, not from the copy. Both registers use the same words for the same things.

## What to avoid

These are the tells of machine-written copy. The linter flags most of them.

- Em dashes and en dashes used as dashes. Use a comma, a full stop, or parentheses.
- Fragment stacks and headline rhythm: "One card. One minute. Go."
- Hype and filler: "Let's", "Ready?", "Boom", "Nailed it", "Pro tip", "Seamless", "Delightful", "Dive in", "Unleash", "Elevate", "Buckle up", "Get ready", "Simply", "Supercharge", "Game-changer", "Next level", "Awesome", "Amazing", "Exciting". The linter refuses every one of these.
- Rhetorical questions as excitement.
- Ellipses for suspense.
- Emoji inside sentences. Emoji belong in avatars, tiles, and reactions.
- All-caps labels and tracked-out eyebrows.
- Apologizing ("Oops", "Sorry") and blaming ("Invalid input").

## Decks and questions

Write questions the way a quizmaster asks them out loud. Vary the openings; five "What is the capital of" in a row is a pattern the deck audit reports. A question must not contain its own answer. Prefer facts that stay true. Keep answers short and give aliases for the ways people actually say them ("USA", "United States", "America").

## Exceptions

A deliberate exception (a quotation, a proper name with a dash) gets a `// voice-ok` comment on the same line in code, or `<!-- voice-ok -->` in HTML.
