// Trivial Pursuit: the board kit on the classic wheel with six trivia categories. Roll, move, win a
// wedge at each headquarters, then make for the middle and answer one last question chosen by
// your opponents. Wedges to win is a setting for shorter evenings.

export default /** @type {import('../../types/parlor.js').GameDefinition} */ ({
  id: 'trivial-pursuit',
  slug: 'trivial-pursuit',
  title: 'Trivial Pursuit',
  description: 'The classic wheel. Roll, move, win a wedge at each headquarters, then make for the middle. Answer out loud and let the table judge, or tap one of four.',
  emoji: '🎲',
  kitId: 'board',
  config: { win: 'collect', wedgesToWin: 6, answerStyle: 'open', relaxedFinish: true, maxTurns: 300 },
  content: {
    layout: 'wheel',
    categories: [
      { id: 'geo', name: 'Geography', color: '#2f6bff', emoji: '🌍', decks: ['trivia'], filter: 'geo' },
      { id: 'ent', name: 'Entertainment', color: '#ff3d9a', emoji: '🎬', decks: ['trivia'], filter: 'ent' },
      { id: 'hist', name: 'History', color: '#ffc233', emoji: '📜', decks: ['trivia'], filter: 'hist' },
      { id: 'arts', name: 'Arts and Literature', color: '#8b5cf6', emoji: '🎨', decks: ['trivia'], filter: 'arts' },
      { id: 'sci', name: 'Science and Nature', color: '#22c55e', emoji: '🔬', decks: ['trivia'], filter: 'sci' },
      { id: 'sport', name: 'Sports and Leisure', color: '#ff7a1a', emoji: '⚽', decks: ['trivia'], filter: 'sport' },
    ],
  },
  theme: 'editorial',
  accent: '#e0a81a',
  builtin: true,
});
