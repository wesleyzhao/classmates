// `npm run new-deck -- --id capitals-of-asia`: a deck file with three cards in it that show
// the three shapes a card can take (plain, multiple choice, picture), and a registry entry
// so the deck is loadable straight away.
//
// The sample cards are real, answerable questions rather than lorem ipsum, so `npm test`
// passes on a fresh deck and the audit has something honest to check.
//
//   node scripts/new-deck.js --id capitals-of-asia --title "Capitals of Asia"
//   node scripts/new-deck.js --id try-me --dry-run

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Plan, ROOT, guard, parseArgs } from './lib/scaffold.js';
import { renderDeck } from './lib/deck-file.js';
import { REGISTRY_PATH, has, readRegistry, withDeck } from './lib/registry.js';

const USAGE = 'Usage: node scripts/new-deck.js --id <id> [--title "..."] [--dry-run]';

/**
 * A starting deck: three cards, one of each shape, all of them true.
 * @param {{ id: string, title: string }} deck
 * @returns {import('../types/parlor.js').Deck}
 */
export function sampleDeck(deck) {
  return {
    id: deck.id,
    title: deck.title,
    description: 'Say in one line what is in this deck and who it is for.',
    language: 'en',
    version: 1,
    categories: [{ id: 'sample', name: 'Sample', emoji: '🃏' }],
    cards: [
      {
        id: 'sample-1',
        prompt: 'Which ocean lies between Africa and Australia?',
        answer: 'The Indian Ocean',
        aliases: ['Indian'],
        category: 'sample',
      },
      {
        id: 'sample-2',
        prompt: 'Which of these is a woodwind instrument?',
        answer: 'Clarinet',
        choices: ['Clarinet', 'Trumpet', 'Cello', 'Timpani'],
        category: 'sample',
      },
      {
        id: 'sample-3',
        prompt: 'Which country flies this flag?',
        answer: 'Japan',
        image: 'https://flagcdn.com/w320/jp.png',
        emoji: '🇯🇵',
        category: 'sample',
      },
    ],
  };
}

const HEADER = `// A deck: a list of cards a game can draw from. Replace the three sample cards with real
// ones, keep the ids short and stable (players' devices remember them), and read
// docs/VOICE.md before you write a question.
//
// Run node scripts/audit-decks.js <id> as you go; npm test runs it over every deck.`;

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}  a process exit code
 */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const id = String(args.id || '');
  if (!id) { console.error(USAGE); return 1; }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    console.error(`"${id}" cannot be a deck id. Use lowercase letters, digits and dashes, starting with a letter.`);
    return 1;
  }

  const title = typeof args.title === 'string' && args.title ? args.title : titleFrom(id);
  const path = join(ROOT, 'public/decks', `${id}.js`);
  const plan = new Plan({ dryRun: Boolean(args['dry-run']) });
  plan.write(path, renderDeck(sampleDeck({ id, title }), HEADER));

  const registry = readRegistry();
  if (has(registry, 'BUILTIN_DECKS', id)) plan.note(`leave the registry alone; ${id} is already in BUILTIN_DECKS`);
  else {
    plan.note(`add ${id} to BUILTIN_DECKS in public/shared/registry.js`);
    if (!plan.dryRun) writeFileSync(REGISTRY_PATH, withDeck(registry, id));
  }

  const code = plan.run();
  if (!plan.dryRun) console.log(`Write the cards, then run node scripts/audit-decks.js ${id}.`);
  return code;
}

/** "capitals-of-asia" as a title: sentence case, because docs/VOICE.md says so. */
function titleFrom(id) {
  const words = id.split('-').filter(Boolean);
  if (!words.length) return 'New deck';
  return words[0][0].toUpperCase() + words[0].slice(1) + (words.length > 1 ? ` ${words.slice(1).join(' ')}` : '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await guard(() => main()));
}
