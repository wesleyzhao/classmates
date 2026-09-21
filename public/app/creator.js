// Pure helpers the creator screens share: the draft a reload must not lose, the links a maker
// copies, the lines the summary card reads out, and the parser behind "paste a list of cards".
// Nothing here renders anything or reaches the network, so every sentence and every parse a
// maker depends on is checked in tests/client/creator.test.js.
//
// The one impure corner is the draft mirror at the bottom, which touches sessionStorage the way
// identity.js touches localStorage: every read and write inside a try/catch, because a browser
// that refuses to remember anything should still let someone make a game in one sitting.

import { newId, slugify } from '../shared/ids.js';
import { validate } from '../shared/schema.js';
import { joinWords, settingsSummary } from './lib.js';

/** @typedef {import('../../types/parlor.js').Deck} Deck */
/** @typedef {import('../../types/parlor.js').Kit} Kit */
/** @typedef {import('../../types/parlor.js').GameDefinition} GameDefinition */
/**
 * What the creator is holding between steps. It is not a GameDefinition: the server owns the
 * id, the slug and the timestamps, and it refuses any of them from a client.
 * @typedef {{
 *   kitId: string,
 *   content: Record<string, any>,
 *   config: Record<string, any>,
 *   title: string,
 *   description: string,
 *   emoji: string,
 *   theme: 'editorial' | 'playful',
 *   accent: string,
 * }} Draft
 */

/** Where a half-made game waits out a reload. Session, not local: a draft is one sitting. */
export const DRAFT_KEY = 'parlor:draft';
/** And which of the four steps it was on. */
export const STEP_KEY = 'parlor:draft-step';

/** The four decisions, in the order they are asked. A kit with no content skips the second. */
export const STEPS = ['kind', 'cards', 'look', 'publish'];

/** The heading in the display face at the top of each step. */
export const STEP_TITLES = {
  kind: 'What kind of game?',
  cards: 'Choose the cards',
  look: 'Settings and look',
  publish: 'Publish',
};

/** The sentence under each heading. One line, saying what this step decides. */
export const STEP_LEDES = {
  kind: 'You can change the cards and the look afterwards. This just picks how it plays.',
  cards: 'Pick the decks this game draws from. You can make your own deck instead.',
  look: 'How it plays, what it is called, and how it looks on the screen.',
  publish: 'Here is the game. Publishing gives you a link to share and a link to edit it.',
};

/**
 * A game with nothing to choose content for skips the second step: the cards kit brings its
 * own deck of 52 and has no content schema at all.
 * @param {Kit | null | undefined} kit
 */
export function hasContent(kit) {
  return !!kit && Object.keys(kit.content || {}).length > 0;
}

/**
 * The steps this game actually walks through. Before a kit is chosen the answer is all four,
 * because that is what almost every kit needs and a progress line that grows is a jolt.
 * @param {Kit | null | undefined} kit
 * @returns {string[]}
 */
export function stepList(kit) {
  return kit && !hasContent(kit) ? ['kind', 'look', 'publish'] : [...STEPS];
}

/**
 * What the button at the bottom says. A button names where it goes, so the last one publishes
 * and every other one says which decision comes next.
 * @param {string[]} steps
 * @param {number} index  which step is on screen, from 0
 */
export function nextLabel(steps, index) {
  const next = steps[index + 1];
  if (next === 'cards') return 'Next, choose the cards';
  if (next === 'look') return 'Next, settings and look';
  if (next === 'publish') return 'Next, publish it';
  return 'Publish game';
}

/** The kits a maker may choose. Hidden kits (the template) are not among them. */
export function visibleKits(kits) {
  return Object.values(kits || {}).filter((kit) => kit && !kit.hidden);
}

/** How many people a kit seats, the way the option card says it. @param {Kit} kit */
export function playersLine(kit) {
  if (!kit) return 'Any number of players';
  if (kit.minPlayers === kit.maxPlayers) return `${kit.minPlayers} players`;
  return `${kit.minPlayers} to ${kit.maxPlayers} players`;
}

// ---------------------------------------------------------------------------
// Drafts

/** A blank draft. Editorial is the default look because Parlor's own screens wear it. */
/** @returns {Draft} */
export function emptyDraft() {
  return {
    kitId: '',
    content: {},
    config: {},
    title: '',
    description: '',
    emoji: '\u{1F3B2}',
    theme: 'editorial',
    accent: '',
  };
}

/**
 * A draft that starts from a game that already exists: editing one, or remixing a built-in.
 * A copy takes everything but the name, because two games called the same thing in one list
 * help nobody.
 * @param {Partial<GameDefinition> | null} game
 * @param {{ copy?: boolean }} [opts]
 * @returns {Draft}
 */
export function draftFromGame(game, opts = {}) {
  const base = emptyDraft();
  if (!game) return base;
  const title = String(game.title || '');
  return {
    kitId: String(game.kitId || ''),
    content: { ...(game.content || {}) },
    config: { ...(game.config || {}) },
    title: opts.copy ? `Copy of ${title}`.slice(0, 80) : title,
    description: String(game.description || ''),
    emoji: String(game.emoji || base.emoji),
    theme: game.theme === 'playful' ? 'playful' : 'editorial',
    accent: String(game.accent || ''),
  };
}

/**
 * What goes in the body of POST /api/games and PUT /api/games/:id. The server sets the id, the
 * slug and the times, and refuses anything the shape does not name, so only these nine keys go.
 * @param {Draft} draft
 * @param {string} [owner]  this device's id, so the game is owned by it rather than by an address
 */
export function gameBody(draft, owner) {
  return {
    title: String(draft.title || '').trim(),
    description: String(draft.description || '').trim(),
    emoji: draft.emoji || '\u{1F3B2}',
    kitId: draft.kitId,
    config: draft.config || {},
    content: draft.content || {},
    theme: draft.theme === 'playful' ? 'playful' : 'editorial',
    ...(draft.accent ? { accent: draft.accent } : {}),
    ...(owner ? { owner } : {}),
  };
}

// ---------------------------------------------------------------------------
// Links

/** Where a published game is played. @param {string} slug */
export function gamePath(slug) {
  return `/g/${encodeURIComponent(String(slug || ''))}`;
}

/** Where a deck is edited. `new` is the empty one. @param {string} id */
export function deckPath(id) {
  return `/decks/${encodeURIComponent(String(id || 'new'))}`;
}

/**
 * The edit link, which is the only proof of ownership a game has: the key is in the address
 * because there is no sign-in anywhere in Parlor, and losing the link loses edit rights.
 * @param {string} id
 * @param {string} [editKey]
 */
export function editPath(id, editKey) {
  const base = `/edit/${encodeURIComponent(String(id || ''))}`;
  return editKey ? `${base}?key=${encodeURIComponent(String(editKey))}` : base;
}

/**
 * A path as a link someone can paste into a message.
 * @param {string} path
 * @param {string} [origin]  defaults to this page's origin
 */
export function absolute(path, origin) {
  const base = origin === undefined ? (typeof location === 'undefined' ? '' : location.origin) : origin;
  return `${base}${path}`;
}

/**
 * What the share sheet says about a game. `shareText` in lib.js is the room's version of this;
 * a game link has no code in it, so it needs its own sentence.
 * @param {{ slug: string, title?: string, origin?: string }} game
 * @returns {{ title: string, text: string, url: string }}
 */
export function gameShareText({ slug, title, origin }) {
  const name = String(title || '').trim();
  return {
    title: name ? `Parlor: ${name}` : 'Parlor',
    text: name ? `Play ${name} on Parlor. Open the link and start a room.` : 'Play this on Parlor. Open the link and start a room.',
    url: absolute(gamePath(slug), origin),
  };
}

// ---------------------------------------------------------------------------
// The summary card

/**
 * The decks a game draws from, named. Board games keep their decks inside their categories,
 * so this walks whatever content the kit put together rather than one known key.
 * @param {Record<string, any>} content
 * @returns {string[]}  deck ids, in the order they appear, without repeats
 */
export function deckIdsIn(content) {
  /** @type {string[]} */
  const out = [];
  const walk = (value) => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'decks' && Array.isArray(nested)) {
        for (const id of nested) if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
      } else walk(nested);
    }
  };
  walk(content);
  return out;
}

/**
 * Deck titles, read out the way a person lists things. A deck that has not loaded yet is named
 * by its id, so the line never goes blank while the page catches up.
 * @param {string[]} ids
 * @param {Record<string, Deck>} decks
 */
export function deckNames(ids, decks) {
  return joinWords((ids || []).map((id) => ((decks || {})[id] || {}).title || id));
}

/**
 * How many cards a game has to draw from.
 * @param {string[]} ids
 * @param {Record<string, Deck>} decks
 */
export function cardTotal(ids, decks) {
  let total = 0;
  for (const id of ids || []) total += (((decks || {})[id] || {}).cards || []).length;
  return total;
}

/**
 * The rows of the summary card on the last step: what this game is, in four lines.
 * @param {Draft} draft
 * @param {Kit | null} kit
 * @param {Record<string, Deck>} decks
 * @returns {Array<{ label: string, value: string }>}
 */
export function summaryRows(draft, kit, decks) {
  const ids = deckIdsIn(draft.content);
  const rows = [{ label: 'How it plays', value: kit ? kit.name : draft.kitId }];
  if (ids.length) {
    const total = cardTotal(ids, decks);
    rows.push({
      label: ids.length === 1 ? 'Deck' : 'Decks',
      value: total ? `${deckNames(ids, decks)}, ${total} cards in all` : deckNames(ids, decks),
    });
  }
  const settings = settingsSummary(kit ? kit.config : {}, draft.config);
  if (settings) rows.push({ label: 'Settings', value: settings });
  rows.push({ label: 'Look', value: draft.theme === 'playful' ? 'Playful' : 'Editorial' });
  return rows;
}

// ---------------------------------------------------------------------------
// What a game carries that no kit owns

/**
 * The fields every game has whatever kit it runs on. They are a schema like any other so the
 * same Form draws them and the same validator checks them, which is why the title on the look
 * step behaves exactly like a setting a kit declared.
 * @type {import('../../types/parlor.js').Schema}
 */
export const GAME_FIELDS = {
  title: {
    type: 'text',
    label: 'Title',
    help: 'The name people see on the game page and at the top of the room.',
    maxLength: 80,
  },
  description: {
    type: 'longtext',
    label: 'Description',
    help: 'A sentence or two about what is in it. Two hundred characters at most.',
    maxLength: 200,
    required: false,
  },
  emoji: {
    type: 'emoji',
    label: 'Emoji',
    help: 'It stands in for the game on the home screen and in a room.',
  },
  accent: {
    type: 'color',
    label: 'Accent color',
    help: 'Links, badges and highlights use it. Leave it off to keep the theme as it is.',
    required: false,
  },
};

/**
 * The half of a draft that GAME_FIELDS describes, so the form and the validator see the same
 * object. The theme is not among them: it is two pictures, not a field.
 * @param {Draft} draft
 */
export function lookValue(draft) {
  return {
    title: draft.title,
    description: draft.description,
    emoji: draft.emoji,
    accent: draft.accent,
  };
}

/**
 * What is stopping this step from being finished, in the shape the Form draws under a field.
 * Content is checked with the settings in hand, because a content field may only apply when a
 * setting has a certain value.
 * @param {string} step  one of STEPS
 * @param {Kit | null} kit
 * @param {Draft} draft
 * @returns {import('../../types/parlor.js').ValidationIssue[]}
 */
export function stepIssues(step, kit, draft) {
  if (step === 'kind') {
    return draft.kitId ? [] : [{ path: 'kitId', message: 'Pick how this game plays.' }];
  }
  if (!kit) return [];
  if (step === 'cards') {
    return validate(kit.content || {}, draft.content, { config: draft.config }).issues;
  }
  if (step === 'look') {
    return [
      ...validate(kit.config || {}, draft.config).issues,
      ...validate(GAME_FIELDS, lookValue(draft)).issues,
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Pasting cards

/**
 * One line of a pasted list turned into a card. The shape is the one people already write in
 * a notes app: the question, the answer, and the wrong answers after it.
 *
 *   Which city has the Colosseum? | Rome | Athens; Cairo; Lisbon
 *
 * The answer goes into the choices itself, because a card whose choices leave out its own
 * answer is unplayable, and the kit shuffles them before anyone sees them.
 * @param {string} line
 * @returns {{ prompt: string, answer: string, choices?: string[] } | null}  null when the line is not a card
 */
export function parseCardLine(line) {
  const raw = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const parts = raw.split('|').map((part) => part.trim());
  const prompt = parts[0] || '';
  const answer = parts[1] || '';
  if (!prompt || !answer) return null;
  const wrong = (parts[2] || '').split(';').map((choice) => choice.trim()).filter(Boolean);
  const rest = wrong.filter((choice) => choice !== answer);
  const card = { prompt, answer };
  if (rest.length) return { ...card, choices: [answer, ...rest] };
  return card;
}

/**
 * A pasted block turned into cards, and a count of the lines that were not cards, so the
 * screen can say how many it skipped instead of dropping them in silence.
 * @param {string} text
 * @returns {{ cards: Array<{ prompt: string, answer: string, choices?: string[] }>, skipped: number }}
 */
export function parsePaste(text) {
  const lines = String(text ?? '').split('\n');
  const cards = [];
  let skipped = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const card = parseCardLine(line);
    if (card) cards.push(card);
    else skipped += 1;
  }
  return { cards, skipped };
}

// ---------------------------------------------------------------------------
// Decks

/**
 * A blank card. It carries an id from the start, because the deck editor keys its rows on it
 * and because the server keeps an id it is given, so a card survives being moved and edited.
 * @param {Partial<import('../../types/parlor.js').Card>} [bits]
 * @returns {import('../../types/parlor.js').Card}
 */
export function newCard(bits = {}) {
  return { id: newId(), prompt: '', answer: '', ...bits };
}

/**
 * Categories, tidied, and the cards that point at them, kept pointing at them.
 *
 * A category's id is its name as a slug, so nobody has to invent one, and renaming a category
 * moves every card that was in it. A category that is deleted takes itself off its cards
 * rather than leaving them tagged with something the deck no longer has.
 *
 * @param {Array<{ id?: string, name?: string }>} next  the categories as they now stand
 * @param {Array<Partial<import('../../types/parlor.js').Card>>} cards
 * @returns {{ categories: Array<{ id: string, name: string }>, cards: any[] }}
 */
export function syncCategories(next, cards) {
  const taken = new Set();
  /** @type {Array<{ id: string, name: string }>} */
  const categories = [];
  /** @type {Map<string, string>} */
  const renamed = new Map();

  (next || []).forEach((category, index) => {
    const name = String((category && category.name) || '').trim();
    let id = name ? slugify(name) : `c${index + 1}`;
    while (taken.has(id)) id = `${id}-${taken.size + 1}`;
    taken.add(id);
    categories.push({ id, name: name || `Category ${index + 1}` });
    const before = String((category && category.id) || '');
    if (before && before !== id) renamed.set(before, id);
  });

  const live = new Set(categories.map((category) => category.id));
  const out = (cards || []).map((card) => {
    if (!card || !card.category) return card;
    const moved = renamed.get(card.category) || card.category;
    if (!live.has(moved)) {
      const { category, ...rest } = card;
      return rest;
    }
    return moved === card.category ? card : { ...card, category: moved };
  });
  return { categories, cards: out };
}

/**
 * What goes in the body of POST /api/decks and PUT /api/decks/:id. Empty optional fields are
 * left out rather than sent blank, because the server stores whatever it is handed.
 * @param {{ title: string, description?: string, categories?: any[], cards?: any[] }} deck
 * @param {string} [owner]
 */
export function deckBody(deck, owner) {
  const cards = (deck.cards || []).map((card) => {
    /** @type {Record<string, any>} */
    const out = { id: card.id, prompt: String(card.prompt || '').trim(), answer: String(card.answer || '').trim() };
    if ((card.aliases || []).length) out.aliases = card.aliases;
    if ((card.choices || []).length) out.choices = card.choices;
    if (card.emoji) out.emoji = card.emoji;
    if (card.image) out.image = card.image;
    if (card.category) out.category = card.category;
    return out;
  });
  return {
    title: String(deck.title || '').trim(),
    ...(deck.description ? { description: String(deck.description).trim() } : {}),
    ...((deck.categories || []).length ? { categories: deck.categories } : {}),
    cards,
    ...(owner ? { owner } : {}),
  };
}

/**
 * What is stopping a deck from being saved, as sentences under the thing that is wrong. The
 * server checks all of this too; this is so nobody has to press a button to find out.
 * @param {{ title?: string, cards?: any[] }} deck
 * @returns {import('../../types/parlor.js').ValidationIssue[]}
 */
export function deckIssues(deck) {
  const issues = [];
  if (!String(deck.title || '').trim()) issues.push({ path: 'title', message: 'That deck needs a title.' });
  const cards = deck.cards || [];
  if (!cards.length) issues.push({ path: 'cards', message: 'A deck needs at least one card.' });
  cards.forEach((card, index) => {
    const prompt = String((card && card.prompt) || '').trim();
    const answer = String((card && card.answer) || '').trim();
    if (!prompt || !answer) {
      issues.push({ path: `cards[${index}]`, message: `Card ${index + 1} needs both a question and an answer.` });
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// The draft mirror. Nothing below throws.

/**
 * Keep the draft where a reload can find it. Called on every keystroke, so it stays cheap.
 * @param {Draft} draft
 */
export function saveDraft(draft) {
  write(DRAFT_KEY, JSON.stringify(draft));
}

/**
 * The draft this session left behind, or null when there is none and when what is there is
 * not a draft: a half-written key from an older version of this screen reads as nothing.
 * @returns {Draft | null}
 */
export function loadDraft() {
  const raw = read(DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kitId !== 'string') return null;
    return { ...emptyDraft(), ...parsed };
  } catch {
    return null;
  }
}

/**
 * Which step the draft was on. Kept beside the draft rather than in it, because a step is
 * where somebody is, not part of the game they are making.
 * @param {string} step
 */
export function saveStep(step) {
  write(STEP_KEY, String(step || ''));
}

/** @returns {string} the step a reload should land on, or '' when there is none */
export function loadStep() {
  const saved = read(STEP_KEY);
  return saved && STEPS.includes(saved) ? saved : '';
}

/** Forget the draft and the step, once the game they described is published. */
export function clearDraft() {
  try {
    const store = session();
    if (store) { store.removeItem(DRAFT_KEY); store.removeItem(STEP_KEY); }
  } catch {
    // A store that will not forget is not worth interrupting anyone for.
  }
}

function session() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function read(key) {
  try {
    const store = session();
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    const store = session();
    if (store) store.setItem(key, value);
  } catch {
    // A full or disabled store costs a reload, not a game.
  }
}
