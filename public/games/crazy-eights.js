// Crazy Eights: the cards kit with the usual house rules on. Two to six players, hidden hands,
// first to empty their hand wins.

export default /** @type {import('../../types/parlor.js').GameDefinition} */ ({
  id: 'crazy-eights',
  slug: 'crazy-eights',
  title: 'Crazy Eights',
  description: 'Match the suit or the number, or play an eight and name the suit. Twos make the next player draw, queens skip, aces turn the table around.',
  emoji: '🃏',
  kitId: 'cards',
  config: { handSize: 5, houseRules: ['twos', 'queens', 'aces'], maxTurns: 300 },
  content: {},
  theme: 'playful',
  accent: '#c9366b',
  builtin: true,
});
