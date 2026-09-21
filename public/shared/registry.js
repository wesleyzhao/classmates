// The list of kits and built-in content the platform knows about. This is the only
// file that names kits; everything else discovers them through it. To add a kit,
// add one line here (scripts/new-kit.js does it for you).

import tally from '../kits/_template/kit.js';
import quiz from '../kits/quiz/kit.js';
import board from '../kits/board/kit.js';
import cards from '../kits/cards/kit.js';
import race from '../kits/race/kit.js';
import recognition from '../kits/recognition/kit.js';

/** @type {Record<string, import('../../types/parlor.js').Kit>} */
export const KITS = { tally, quiz, board, cards, race, recognition };

/**
 * Where a kit's screen module lives, for the few kits whose folder is not their id
 * (the template kit is registered as `tally` but lives in `_template`).
 * @type {Record<string, string>}
 */
export const KIT_FOLDERS = { tally: '_template' };

/** The URL of a kit's `ui.js`, for the client to import lazily. @param {string} id */
export function kitUiPath(id) {
  return `/kits/${KIT_FOLDERS[id] || id}/ui.js`;
}

/**
 * Built-in deck ids to module paths, relative to public/. Loaded lazily on the server.
 * @type {Record<string, string>}
 */
export const BUILTIN_DECKS = {
  demo: 'decks/demo.js',
  countries: 'decks/countries.js',
  capitals: 'decks/capitals.js',
  trivia: 'decks/trivia.js',
  broadway: 'decks/broadway.js',
};

/** Built-in decks that exist for tests and demos, not for people making games. */
const UNLISTED_DECKS = new Set(['demo']);

/**
 * The built-in decks a maker should be offered, in the registry's order.
 * @returns {string[]}
 */
export function listedDeckIds() {
  return Object.keys(BUILTIN_DECKS).filter((id) => !UNLISTED_DECKS.has(id));
}

/**
 * Built-in game ids and slugs to module paths, relative to public/.
 * @type {Record<string, string>}
 */
export const BUILTIN_GAMES = {
  tally: 'games/tally.js',
  'flags-world': 'games/flags-world.js',
  'flags-europe': 'games/flags-europe.js',
  'flag-race': 'games/flag-race.js',
  capitals: 'games/capitals.js',
  'pub-trivia': 'games/pub-trivia.js',
  'trivial-pursuit': 'games/trivial-pursuit.js',
  'race-track': 'games/race-track.js',
  'capital-race': 'games/race-track.js',
  'crazy-eights': 'games/crazy-eights.js',
};

/** @param {string} id */
export function getKit(id) {
  return KITS[id] || null;
}
