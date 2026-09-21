// Choosing which decks a game draws from. It lists the decks that ship with Parlor and the
// decks this device made, and it fetches each one to say how many cards it holds and how it is
// sorted, because "197 cards, sorted into Europe and Asia" is the thing a maker is deciding on
// and a bare title is not.
//
// The fetches are cached for the life of the page and shared through `useDecks`, so the summary
// on the last step and the kit's own editor read the same decks this picker already loaded
// rather than asking for them again.

import { html, useEffect, useState } from '../h.js';
import { api } from '../net.js';
import { listedDeckIds } from '../../shared/registry.js';
import { myDecks } from '../identity.js';
import { deckPath } from '../creator.js';
import { joinWords, plural } from '../lib.js';

/** @typedef {import('../../../types/parlor.js').Deck} Deck */

/** Decks fetched this page load, by id. A deck that would not load is remembered as null. */
/** @type {Map<string, Deck | null>} */
const cache = new Map();
/** @type {Map<string, Promise<Deck | null>>} */
const inflight = new Map();

/**
 * One deck, fetched once. Never rejects: a deck that is gone reads as null, so a game that
 * names a deck somebody deleted still opens in the editor.
 * @param {string} id
 * @returns {Promise<Deck | null>}
 */
export function fetchDeck(id) {
  const key = String(id || '');
  if (cache.has(key)) return Promise.resolve(cache.get(key) || null);
  if (!inflight.has(key)) {
    const pending = api('GET', `/api/decks/${encodeURIComponent(key)}`)
      .then((data) => (data && data.deck) || null)
      .catch(() => null)
      .then((deck) => { cache.set(key, deck); inflight.delete(key); return deck; });
    inflight.set(key, pending);
  }
  return inflight.get(key) || Promise.resolve(null);
}

/** The decks already in hand, by id. @param {string[]} ids @returns {Record<string, Deck>} */
function known(ids) {
  /** @type {Record<string, Deck>} */
  const out = {};
  for (const id of ids || []) {
    const deck = cache.get(id);
    if (deck) out[id] = deck;
  }
  return out;
}

/**
 * The decks behind a list of ids, filling in as they arrive. Screens use it to pass real decks
 * to a kit's own editor and to count cards on the summary card.
 * @param {string[]} ids
 * @returns {Record<string, Deck>}
 */
export function useDecks(ids) {
  const key = (ids || []).join(',');
  const [decks, setDecks] = useState(() => known(ids));
  useEffect(() => {
    let live = true;
    const list = key ? key.split(',') : [];
    if (!list.length) { setDecks({}); return undefined; }
    setDecks(known(list));
    Promise.all(list.map(fetchDeck)).then(() => { if (live) setDecks(known(list)); });
    return () => { live = false; };
  }, [key]);
  return decks;
}

/**
 * @param {{
 *   value: string[],
 *   onChange: (ids: string[]) => void,
 *   max?: number,
 *   cardFields?: string[],
 * }} props
 *   `value` is the chosen deck ids and `onChange` gets the whole new list.
 *   `max` caps how many may be chosen; past it, the rows nobody chose stop responding.
 *   `cardFields` are the fields the kit needs on every card (the quiz kit asks for prompt and
 *   answer); a deck missing one says so on its row rather than failing at the table.
 */
export function DeckPicker({ value, onChange, max, cardFields }) {
  const chosen = Array.isArray(value) ? value : [];
  const mine = myDecks();
  const ids = listIds(chosen, mine);
  const decks = useDecks(ids);
  const full = typeof max === 'number' && chosen.length >= max;

  /** @param {string} id */
  function toggle(id) {
    if (chosen.includes(id)) onChange(chosen.filter((other) => other !== id));
    else if (!full) onChange([...chosen, id]);
  }

  const categories = chosenCategories(chosen, decks);

  return html`
    <div class="stack">
      <ul class="list">
        ${ids.map((id) => {
          const deck = decks[id];
          const picked = chosen.includes(id);
          const title = (deck && deck.title) || titleFor(id, mine);
          return html`
            <li key=${id}>
              <button type="button" class=${picked ? 'list-row list-row-pick is-picked' : 'list-row list-row-pick'}
                      aria-pressed=${picked} disabled=${!picked && full} onClick=${() => toggle(id)}>
                <span class=${picked ? 'pick is-on' : 'pick'} aria-hidden="true">${picked ? '✓' : ''}</span>
                <span class="grow">
                  <span class="title">${title}</span>
                  <span class="sub">${deckLine(deck, cardFields)}</span>
                </span>
              </button>
            </li>`;
        })}
      </ul>

      ${categories.length ? html`
        <div class="row row-wrap">
          <span class="field-help">Sorted into</span>
          ${categories.map((category) => html`
            <span class="tag" key=${category.id}>
              ${category.color ? html`<span class="tag-dot" style=${`background:${category.color}`}></span>` : null}
              ${category.name}
            </span>`)}
        </div>` : null}

      ${full ? html`<p class="field-help">That is the most decks this game takes (${max}).</p>` : null}

      <a class="btn-link" href=${deckPath('new')}>Make a deck</a>
    </div>`;
}

/** Every deck worth offering: the built-ins, this device's own, and anything already chosen. */
function listIds(chosen, mine) {
  const out = listedDeckIds();
  for (const deck of mine) if (!out.includes(deck.id)) out.push(deck.id);
  for (const id of chosen) if (!out.includes(id)) out.push(id);
  return out;
}

/** A deck this device made is named from the list here until its own document arrives. */
function titleFor(id, mine) {
  const saved = mine.find((deck) => deck.id === id);
  return (saved && saved.title) || id;
}

/** A card field, in the word the deck editor uses for it. */
function fieldWord(field) {
  return { prompt: 'question', answer: 'answer', choices: 'choices', image: 'picture', emoji: 'emoji', category: 'category' }[field] || String(field);
}

/** The second line on a deck's row: how much is in it, and anything a kit would miss. */
function deckLine(deck, cardFields) {
  if (!deck) return 'Counting the cards';
  const cards = deck.cards || [];
  const parts = [plural(cards.length, 'card', 'cards')];
  const missing = (cardFields || []).filter((field) => cards.some((card) => !card || !card[field]));
  if (missing.length) parts.push(`some have no ${joinWords(missing.map(fieldWord))}`);
  else if ((deck.categories || []).length) parts.push(plural(deck.categories.length, 'category', 'categories'));
  return parts.join(', ');
}

/**
 * The categories a set of decks brings, without repeats, so a game can filter on them. Kits
 * that let a maker narrow a deck down (the board kit's wedges) want the same list.
 * @param {Record<string, Deck>} decks
 * @returns {Array<{ id: string, name: string, color?: string, emoji?: string }>}
 */
export function deckCategories(decks) {
  /** @type {Map<string, { id: string, name: string, color?: string, emoji?: string }>} */
  const found = new Map();
  for (const deck of Object.values(decks || {})) {
    for (const category of (deck && deck.categories) || []) {
      if (category && category.id && !found.has(category.id)) found.set(category.id, category);
    }
  }
  return [...found.values()];
}

/** The categories behind the decks that are actually chosen. */
function chosenCategories(chosen, decks) {
  /** @type {Record<string, Deck>} */
  const picked = {};
  for (const id of chosen) if (decks[id]) picked[id] = decks[id];
  return deckCategories(picked);
}
