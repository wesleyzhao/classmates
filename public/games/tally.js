// The one built-in game that always exists. It is hidden from the catalog: it is there
// so the platform (and the tests, and `npm run smoke`) always has a game to open a room
// with, even before any real game has been written. Its settings are left empty so the
// tally kit's own defaults apply.

/** @type {import('../../types/parlor.js').GameDefinition} */
const game = {
  id: 'tally',
  slug: 'tally',
  title: 'Tally',
  description: 'Tap faster than everyone else.',
  emoji: '👆',
  kitId: 'tally',
  config: {},
  content: {},
  theme: 'playful',
  builtin: true,
  hidden: true,
};

export default game;
