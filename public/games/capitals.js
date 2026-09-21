// Capitals: a country, and the city that governs it. This is the built-in that answers
// either way, so a player can tap a choice or type the name, and the deck carries the
// aliases that make typing fair (Washington for Washington, D.C.).

/** @type {import('../../types/parlor.js').GameDefinition} */
const game = {
  id: 'capitals',
  slug: 'capitals',
  title: 'Capitals',
  description: 'One country at a time, and one question: which city runs it. Type the answer or pick it from four.',
  emoji: '🏛️',
  kitId: 'quiz',
  config: { answerMode: 'both', choicesFrom: 'deck' },
  content: { decks: ['capitals'] },
  theme: 'editorial',
  accent: '#1f7a4d',
  builtin: true,
};

export default game;
