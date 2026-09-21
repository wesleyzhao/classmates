// Flags of Europe: the same deck as Flags of the World, filtered to one continent. It is
// the worked example of a game that is a category filter and a change of mood, nothing
// more, which is the point docs/HOW-TO-MAKE-A-GAME.md makes with it.

/** @type {import('../../types/parlor.js').GameDefinition} */
const game = {
  id: 'flags-europe',
  slug: 'flags-europe',
  title: 'Flags of Europe',
  description: 'Forty-six flags, from the ones everyone knows to the three that look alike. Name each country before the timer runs out.',
  emoji: '🇪🇺',
  kitId: 'quiz',
  config: { answerMode: 'choices', choicesFrom: 'deck' },
  content: { decks: ['countries'], categories: ['europe'] },
  theme: 'playful',
  accent: '#5b3fd6',
  builtin: true,
};

export default game;
