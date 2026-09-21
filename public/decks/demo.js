// The demo deck: six cards of common knowledge, written here rather than drawn from
// anywhere, so the quiz kit's tests, the conformance suite, and `npm run smoke` always have
// content that never changes and never needs the network. Real decks live beside it.
//
// It is registered as `demo` in public/shared/registry.js. Keep it small: it is loaded by
// every test run, and its job is to exercise the kit, not to be a good quiz.

/** @type {import('../../types/parlor.js').Deck} */
const deck = {
  id: 'demo',
  title: 'Demo',
  description: 'Six easy cards, for trying a game out.',
  language: 'en',
  version: 1,
  categories: [
    { id: 'sky', name: 'Sky', emoji: '🌙' },
    { id: 'shapes', name: 'Shapes', emoji: '🔺' },
    { id: 'colours', name: 'Colours', emoji: '🎨' },
    { id: 'counting', name: 'Counting', emoji: '🔢' },
  ],
  cards: [
    {
      id: 'demo-sun',
      prompt: 'Which star do the planets go round?',
      answer: 'The Sun',
      aliases: ['Sol'],
      choices: ['The Sun', 'Sirius', 'Polaris', 'Betelgeuse'],
      emoji: '☀️',
      category: 'sky',
    },
    {
      id: 'demo-moon',
      prompt: 'What is the only natural satellite of Earth?',
      answer: 'The Moon',
      aliases: ['Luna'],
      emoji: '🌙',
      category: 'sky',
    },
    {
      id: 'demo-triangle',
      prompt: 'How many sides does a hexagon have?',
      answer: '6',
      aliases: ['six'],
      emoji: '⬡',
      category: 'shapes',
    },
    {
      id: 'demo-square',
      prompt: 'A shape with four equal sides and four right angles goes by what name?',
      answer: 'Square',
      choices: ['Square', 'Rhombus', 'Trapezium', 'Kite'],
      emoji: '🟦',
      category: 'shapes',
    },
    {
      id: 'demo-green',
      prompt: 'Mixing yellow paint into blue paint gives you which colour?',
      answer: 'Green',
      choices: ['Green', 'Orange', 'Purple', 'Brown'],
      emoji: '🟢',
      category: 'colours',
    },
    {
      id: 'demo-week',
      prompt: 'How many days are there in a week?',
      answer: '7',
      aliases: ['seven'],
      reject: ['5'],
      emoji: '📅',
      category: 'counting',
      note: 'Five is the answer people give when they are thinking about work.',
    },
  ],
};

export default deck;
