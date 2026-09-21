// Flags of the World: the whole countries deck, one flag at a time, four choices. It is the
// game the front page opens with and the one `npm run smoke` plays, so it stays simple:
// every card has a picture, and the answer is always a country.

/** @type {import('../../types/parlor.js').GameDefinition} */
const game = {
  id: 'flags-world',
  slug: 'flags-world',
  title: 'Flags of the world',
  description: 'Every country in the world, one flag at a time. Name it before the timer runs out.',
  emoji: '🌍',
  kitId: 'quiz',
  config: { answerMode: 'choices', choicesFrom: 'deck' },
  content: { decks: ['countries'] },
  theme: 'editorial',
  accent: '#2456f5',
  builtin: true,
};

export default game;
