// Capital Race: the board kit on the track layout with the capitals deck split by continent.
// First to the finish line wins, after one last question. Proves the board kit is not only the wheel.

export default /** @type {import('../../types/parlor.js').GameDefinition} */ ({
  id: 'race-track',
  slug: 'capital-race',
  title: 'Capital race',
  description: 'A race to the finish line, one capital city at a time. Get it right and roll again; get it wrong and the next player takes over.',
  emoji: '🏁',
  kitId: 'board',
  config: { win: 'reach', answerStyle: 'choices', relaxedFinish: true, maxTurns: 300 },
  content: {
    layout: 'track',
    trackLength: 30,
    categories: [
      { id: 'europe', name: 'Europe', color: '#2456f5', emoji: '🏰', decks: ['capitals'], filter: 'europe' },
      { id: 'asia', name: 'Asia', color: '#ff5c69', emoji: '🏯', decks: ['capitals'], filter: 'asia' },
      { id: 'africa', name: 'Africa', color: '#ffc93c', emoji: '🌍', decks: ['capitals'], filter: 'africa' },
      { id: 'americas', name: 'The Americas', color: '#2fc57b', emoji: '🗽', decks: ['capitals'], filter: 'north-america' },
    ],
  },
  theme: 'playful',
  accent: '#0b7a7a',
  builtin: true,
});
