// Pub Trivia: twelve questions from the general knowledge deck, twenty seconds each, four
// answers printed on the card. The deck writes its own choices, so this game sets
// choicesFrom to 'card' and never invents a wrong answer of its own.

/** @type {import('../../types/parlor.js').GameDefinition} */
const game = {
  id: 'pub-trivia',
  slug: 'pub-trivia',
  title: 'Pub trivia',
  description: 'Twelve questions across six categories, the way a good pub quiz runs them. Twenty seconds each, four answers to choose from.',
  emoji: '🍻',
  kitId: 'quiz',
  config: { cards: 12, seconds: 20, answerMode: 'choices', choicesFrom: 'card' },
  content: { decks: ['trivia'] },
  theme: 'editorial',
  accent: '#e0a81a',
  builtin: true,
};

export default game;
