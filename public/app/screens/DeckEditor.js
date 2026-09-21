// Making and editing a deck: a title, some categories, and the cards. It is the longest form
// in Parlor and the only one somebody sits with for half an hour, so three things matter more
// here than anywhere else.
//
// Typing has to be cheap: a question and an answer are always on screen and everything else on
// a card is behind one tap, because most cards only ever need those two. Pasting has to work,
// because anyone with twenty questions already has them in a list somewhere. And the checks
// that would fail `npm test` for a built-in deck (a repeated question, a question that gives
// away its answer) run here, live, from public/shared/audit.js, so they are found while the
// card is still on the screen.

import { html, useEffect, useState } from '../h.js';
import { api } from '../net.js';
import { navigate } from '../main.js';
import { cardHints } from '../../shared/audit.js';
import { BUILTIN_DECKS } from '../../shared/registry.js';
import { addMyDeck, me, myDecks } from '../identity.js';
import { Icon } from '../components/Icon.js';
import { ListEditor } from '../components/ListEditor.js';
import { toast } from '../components/Toast.js';
import { revealFirstProblem } from '../components/Form.js';
import { deckBody, deckIssues, deckPath, newCard, parseCardLine, syncCategories } from '../creator.js';
import { plural } from '../lib.js';

/** @typedef {import('../../../types/parlor.js').Card} Card */
/** @typedef {{ title: string, description: string, categories: Array<{ id: string, name: string }>, cards: Card[] }} DeckDraft */

/** What the paste box explains about the shape of a line. */
const PASTE_HELP = 'One card per line: the question, the answer, then the wrong answers. '
  + 'Separate the three with a bar and the wrong answers with semicolons.';

/**
 * @param {{ id: string }} props  `new` means a deck that does not exist yet
 */
export function DeckEditor({ id }) {
  const fresh = !id || id === 'new';
  const [deck, setDeck] = useState(/** @type {DeckDraft} */ ({ title: '', description: '', categories: [], cards: [] }));
  const [loading, setLoading] = useState(!fresh);
  const [problem, setProblem] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(/** @type {{ id: string, editKey: string } | null} */ (null));

  const editKey = saved ? saved.editKey : keyFor(id);
  const deckId = saved ? saved.id : (fresh ? '' : id);

  useEffect(() => {
    if (fresh) return undefined;
    let live = true;
    setLoading(true);
    api('GET', `/api/decks/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!live) return;
        const loaded = data.deck || {};
        setDeck({
          title: loaded.title || '',
          description: loaded.description || '',
          categories: (loaded.categories || []).map((category) => ({ id: category.id, name: category.name })),
          cards: (loaded.cards || []).map((card) => ({ ...card })),
        });
        setReadOnly(!!BUILTIN_DECKS[id]);
        setLoading(false);
      })
      .catch((err) => {
        if (!live) return;
        setProblem(err.message || 'That deck would not load. Check the link.');
        setLoading(false);
      });
    return () => { live = false; };
  }, [id]);

  const issues = deckIssues(deck);
  const hints = cardHints(deck.cards);
  const shown = showIssues ? issues : [];

  /** @param {Partial<DeckDraft>} patch */
  function change(patch) {
    setDeck((old) => ({ ...old, ...patch }));
    setShowIssues(false);
    setProblem('');
  }

  /** Categories and cards move together: renaming one takes its cards with it. */
  function changeCategories(next) {
    const synced = syncCategories(next, deck.cards);
    change({ categories: synced.categories, cards: synced.cards });
  }

  async function save() {
    if (issues.length) { setShowIssues(true); revealFirstProblem(); return; }
    setBusy(true);
    setProblem('');
    try {
      const body = deckBody(deck, me().id);
      const result = deckId
        ? await api('PUT', `/api/decks/${encodeURIComponent(deckId)}`, { body, editKey })
        : await api('POST', '/api/decks', { body });
      const made = result.deck;
      const key = result.editKey || editKey;
      addMyDeck({ id: made.id, title: made.title, editKey: key });
      setSaved({ id: made.id, editKey: key });
      setBusy(false);
      // A new deck moves to its own address, which is also where a reload will find it.
      if (deckId) toast('Saved');
      else navigate(deckPath(made.id), { replace: true });
      return;
    } catch (err) {
      setProblem(err.message || 'That deck would not save. Try again.');
    }
    setBusy(false);
  }

  if (loading) return html`<main class="page"><${TopBar} /></main>`;
  if (problem && !deck.cards.length) return html`<${Trouble} line=${problem} />`;

  const count = deck.cards.length;

  return html`
    <main class="page">
      <${TopBar} />

      <div class="stack">
        <h1 class="display-hero">${fresh ? 'Make a deck' : deck.title || 'Edit a deck'}</h1>
        <p class="lede">A deck is a pile of cards. Any game that draws cards can use it, and a
          game you make can mix it with the decks that ship with Parlor.</p>
      </div>

      ${readOnly ? html`
        <p class="notice">This deck ships with Parlor, so it cannot be changed. Use it in a game
          of your own, or make a deck beside it.</p>` : null}
      ${problem ? html`<p class="notice notice-bad">${problem}</p>` : null}

      <section class="stack">
        <div class=${errorFor(shown, 'title') ? 'field is-invalid' : 'field'}>
          <label class="field-label" for="deck-title">Title</label>
          <input class="input" id="deck-title" value=${deck.title} maxLength="80" disabled=${readOnly}
                 onInput=${(e) => change({ title: e.currentTarget.value })} />
          ${errorFor(shown, 'title') ? html`<p class="field-error">${errorFor(shown, 'title')}</p>` : null}
        </div>

        <div class="field">
          <label class="field-label" for="deck-about">Description</label>
          <p class="field-help">A sentence about what is in it. It is what somebody reads before choosing it.</p>
          <textarea class="input" id="deck-about" rows="2" maxLength="300" value=${deck.description}
                    disabled=${readOnly} onInput=${(e) => change({ description: e.currentTarget.value })}></textarea>
        </div>
      </section>

      <section class="stack">
        <div class="section-head"><h3>Categories</h3></div>
        <p class="field-help">Optional. Tag cards with a category and a game can play only part
          of the deck. The id is made from the name, and renaming one moves its cards with it.</p>
        <${ListEditor}
          items=${deck.categories}
          onChange=${changeCategories}
          max=${12}
          addLabel="Add a category"
          empty="No categories. Every card is in play whenever this deck is used."
          newItem=${() => ({ id: '', name: '' })}
          rowKey=${(category, index) => category.id || `new-${index}`}
          rowLabel=${(category) => category.id || 'new'}
          renderItem=${(category, index, patch) => html`
            <div class="field">
              <label class="field-label" for=${`category-${index}`}>Name</label>
              <input class="input" id=${`category-${index}`} value=${category.name} maxLength="40"
                     disabled=${readOnly} onInput=${(e) => patch({ ...category, name: e.currentTarget.value })} />
            </div>`} />
      </section>

      <section class="stack">
        <div class="section-head">
          <h3>Cards</h3>
          <span class="num small ink-2">${plural(count, 'card', 'cards')}</span>
        </div>
        ${hints.length ? html`
          <div class="notice">
            <p>Worth a look before you publish.</p>
            <ul class="stack-tight stack">
              ${hints.map((hint, i) => html`<li class="small" key=${i}>${hint}</li>`)}
            </ul>
          </div>` : null}
        ${errorFor(shown, 'cards') ? html`<p class="field-error">${errorFor(shown, 'cards')}</p>` : null}
        <${ListEditor}
          items=${deck.cards}
          onChange=${(cards) => change({ cards })}
          max=${500}
          addLabel="Add a card"
          noun=${['card', 'cards']}
          empty="No cards yet. Add one, or paste a list."
          pasteLabel="Paste cards"
          pasteHelp=${PASTE_HELP}
          parseLine=${(line) => { const card = parseCardLine(line); return card ? newCard(card) : null; }}
          newItem=${() => newCard()}
          rowKey=${(card) => card.id}
          rowLabel=${(card, index) => `card ${index + 1}`}
          renderItem=${(card, index, patch) => html`
            <${CardRow} card=${card} index=${index} categories=${deck.categories} readOnly=${readOnly}
                        issue=${errorFor(shown, `cards[${index}]`)} onChange=${patch} />`} />
      </section>

      ${deckId && !readOnly ? html`<${AfterSaving} id=${deckId} />` : null}

      ${readOnly ? null : html`
        <div class="actionbar">
          <button class="btn btn-primary btn-block btn-tall" disabled=${busy} onClick=${save}>
            ${deckId ? 'Save changes' : 'Publish deck'}
          </button>
          <p class="actionbar-note">${showIssues && issues.length
            ? issues[0].message
            : 'Decks are not listed anywhere. This one is shared by its id.'}</p>
        </div>`}
    </main>`;
}

/**
 * One card. The question and the answer are always there; everything else is behind "More on
 * this card", because a deck of two hundred cards is mostly two hundred questions and answers.
 * @param {{ card: Card, index: number, categories: any[], readOnly: boolean, issue: string,
 *   onChange: (card: Card) => void }} props
 */
function CardRow({ card, index, categories, readOnly, issue, onChange }) {
  const [open, setOpen] = useState(false);
  const [aliasText, setAliasText] = useState(() => (card.aliases || []).join(', '));
  const [wrongText, setWrongText] = useState(() => wrongOf(card).join('; '));

  /**
   * Everything a card holds is rebuilt from the fields on screen, so a changed answer takes
   * the choices with it and an emptied field leaves rather than being stored blank.
   * @param {Partial<Card>} patch
   * @param {{ aliases?: string, wrong?: string }} [text]
   */
  function push(patch, text = {}) {
    const base = { ...card, ...patch };
    const answer = String(base.answer || '').trim();
    const aliases = splitOn(text.aliases === undefined ? aliasText : text.aliases, ',');
    const wrong = splitOn(text.wrong === undefined ? wrongText : text.wrong, ';').filter((one) => one !== answer);
    /** @type {any} */
    const next = { id: base.id, prompt: base.prompt, answer: base.answer };
    if (aliases.length) next.aliases = aliases;
    if (wrong.length && answer) next.choices = [answer, ...wrong];
    if (base.emoji) next.emoji = base.emoji;
    if (base.image) next.image = base.image;
    if (base.category) next.category = base.category;
    onChange(next);
  }

  const prefix = `card-${card.id || index}`;
  return html`
    <div class=${issue ? 'field is-invalid stack' : 'stack'}>
      <div class="field">
        <label class="field-label" for=${`${prefix}-prompt`}>Question</label>
        <input class="input" id=${`${prefix}-prompt`} value=${card.prompt} maxLength="200" disabled=${readOnly}
               onInput=${(e) => push({ prompt: e.currentTarget.value })} />
      </div>
      <div class="field">
        <label class="field-label" for=${`${prefix}-answer`}>Answer</label>
        <input class="input" id=${`${prefix}-answer`} value=${card.answer} maxLength="200" disabled=${readOnly}
               onInput=${(e) => push({ answer: e.currentTarget.value })} />
      </div>
      ${issue ? html`<p class="field-error">${issue}</p>` : null}

      <button type="button" class="btn btn-ghost btn-sm" aria-expanded=${open} onClick=${() => setOpen(!open)}>
        ${open ? 'Less on this card' : 'More on this card'}
      </button>

      ${open ? html`
        <div class="stack">
          <div class="field">
            <label class="field-label" for=${`${prefix}-aliases`}>Other ways to say it</label>
            <p class="field-help">Separated by commas. A typed answer counts if it matches any of them.</p>
            <input class="input" id=${`${prefix}-aliases`} value=${aliasText} disabled=${readOnly}
                   onInput=${(e) => { setAliasText(e.currentTarget.value); push({}, { aliases: e.currentTarget.value }); }} />
          </div>
          <div class="field">
            <label class="field-label" for=${`${prefix}-choices`}>Wrong answers</label>
            <p class="field-help">Separated by semicolons. The right answer joins them, and the game shuffles them.</p>
            <input class="input" id=${`${prefix}-choices`} value=${wrongText} disabled=${readOnly}
                   onInput=${(e) => { setWrongText(e.currentTarget.value); push({}, { wrong: e.currentTarget.value }); }} />
          </div>
          <div class="field">
            <label class="field-label" for=${`${prefix}-emoji`}>Emoji</label>
            <input class="input input-emoji" id=${`${prefix}-emoji`} value=${card.emoji || ''} maxLength="8"
                   disabled=${readOnly} onInput=${(e) => push({ emoji: e.currentTarget.value })} />
          </div>
          <div class="field">
            <label class="field-label" for=${`${prefix}-image`}>Picture</label>
            <p class="field-help">A full https address. The card shows it above the question.</p>
            <input class="input" id=${`${prefix}-image`} type="url" inputMode="url" placeholder="https://"
                   spellcheck="false" value=${card.image || ''} disabled=${readOnly}
                   onInput=${(e) => push({ image: e.currentTarget.value })} />
            ${/^https:\/\/\S+$/i.test(String(card.image || ''))
              ? html`<img class="thumb" src=${card.image} alt="" loading="lazy" />` : null}
          </div>
          ${categories.length ? html`
            <div class="field">
              <span class="field-label" id=${`${prefix}-cat-label`}>Category</span>
              <div class="chip-wrap" role="group" aria-labelledby=${`${prefix}-cat-label`}>
                ${categories.map((category) => {
                  const on = card.category === category.id;
                  return html`
                    <button type="button" key=${category.id} class=${on ? 'chip chip-lg is-active' : 'chip chip-lg'}
                            aria-pressed=${on} disabled=${readOnly}
                            onClick=${() => push({ category: on ? '' : category.id })}>${category.name}</button>`;
                })}
              </div>
            </div>` : null}
        </div>` : null}
    </div>`;
}

/** Once a deck exists it has an id, and the id is how a game reaches it. */
function AfterSaving({ id }) {
  return html`
    <section class="stack">
      <div class="section-head"><h3>This deck is published</h3></div>
      <div class="link-box"><span class="link-text num">${id}</span></div>
      <p class="small muted">That is the id a game uses to draw from this deck. It is saved on
        this device, so it turns up in the deck list when you make a game.</p>
      <a class="btn btn-secondary btn-block" href=${`/create?deck=${encodeURIComponent(id)}`}>Make a game with it</a>
    </section>`;
}

function TopBar() {
  return html`
    <div class="topbar">
      <a class="btn btn-ghost" href="/my"><${Icon} name="back" />Your games</a>
    </div>`;
}

function Trouble({ line }) {
  return html`
    <main class="page">
      <${TopBar} />
      <div class="stack">
        <h1>No deck here</h1>
        <p class="lede">${line}</p>
      </div>
      <div class="actionbar">
        <a class="btn btn-primary btn-block btn-tall" href=${deckPath('new')}>Make a deck</a>
      </div>
    </main>`;
}

/** The wrong answers on a card: its choices, without the one that is right. */
function wrongOf(card) {
  return (card.choices || []).filter((choice) => choice !== card.answer);
}

/** @param {string} text @param {string} separator */
function splitOn(text, separator) {
  return String(text || '').split(separator).map((part) => part.trim()).filter(Boolean);
}

/** @param {any[]} issues @param {string} path */
function errorFor(issues, path) {
  const found = (issues || []).find((issue) => issue.path === path);
  return found ? found.message : '';
}

/** The key that lets this device change this deck: the link it was given, or its own list. */
function keyFor(id) {
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const fromLink = params.get('key');
  if (fromLink) return fromLink;
  const mine = myDecks().find((deck) => deck.id === id);
  return (mine && mine.editKey) || '';
}
