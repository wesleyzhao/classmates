// Flag race: the race kit on the countries deck. Everyone sees the same flag at the same
// moment, so the game is decided by who knows it and who knows it fastest, not by whose turn
// it is. It is the simultaneous answer to Capital race, which takes turns on the board kit.

export default /** @type {import('../../types/parlor.js').GameDefinition} */ ({
  id: 'flag-race',
  slug: 'flag-race',
  title: 'Flag race',
  description: 'Everyone sees the same flag, and the first to name it pulls ahead. Right answers move you down the track, and the first one over the line wins.',
  emoji: '🏎️',
  kitId: 'race',
  config: { trackLength: 12, seconds: 10, answerMode: 'choices', boost: true },
  content: { decks: ['countries'] },
  theme: 'playful',
  accent: '#b8431f',
  builtin: true,
});
