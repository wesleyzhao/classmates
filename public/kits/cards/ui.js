// The Crazy Eights screen: who is holding what, the two piles, one sentence about what you
// can do, and your hand fanned across the bottom.
//
// Every rule lives in kit.js. This file never works out whether a card is legal; it draws
// `view.playable` and sends `play`. The one piece of state it keeps is which eight is
// waiting for a suit, because naming a suit is a question the server cannot ask.
//
// Draw, Pass, and Skip are in `view.actions`, so the platform draws them under the screen
// (docs/KIT-CONTRACT.md, rule R3) and they are deliberately missing here.

import { html, Fragment, useEffect, useRef, useState } from '../../app/h.js';
import { Sheet } from '../../app/components/Sheet.js';
import { Avatar } from '../../app/components/Avatar.js';
import { Hand } from '../../app/game-ui/Hand.js';
import { Piles } from '../../app/game-ui/Pile.js';
import { RANK_WORDS, SUITS, cardWords, suitOf } from '../../app/game-ui/Card.js';
import { parseCard } from '../_lib/deck.js';
import { playerName, plural } from '../../app/lib.js';
import { tap as tapSound } from '../../app/sound.js';

/** How long a card you just drew stays lifted out of the hand. */
const DREW_MS = 1400;

/** Small numbers read as words in a sentence, the way a person says them. */
const COUNT_WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight' };

/**
 * The in-game screen. There is no clock in this kit, so `now` goes unused.
 * @param {{
 *   view: any,
 *   me: string | null,
 *   players: import('../../../types/parlor.js').PlayerInfo[],
 *   send: (type: string, payload?: any) => void,
 *   now?: number,
 * }} props
 */
export function Play({ view, me, players, send }) {
  // The eight that is waiting for a suit. Nothing is sent until the sheet is answered.
  const [naming, setNaming] = useState(/** @type {string | null} */ (null));
  const drew = view.drew && view.drew !== 'none' ? view.drew : null;
  const lifted = useDrawn(drew);
  useTableSounds(view);

  const byId = new Map((players || []).map((player) => [player.id, player]));
  const seats = (view.seats && view.seats.length ? view.seats : Object.keys(view.handCounts || {}));
  const others = seats.filter((id) => id !== me);
  const watching = view.hand === null;
  const over = !!view.winnerId || (!view.turn && !view.isActive);
  const note = aside(view, byId, me);

  /** A tap on a card. An eight asks for a suit first; everything else goes straight out. */
  function playCard(card) {
    if (parseCard(card).rank === '8') { setNaming(card); return; }
    send('play', { card });
  }

  function nameSuit(letter) {
    const card = naming;
    setNaming(null);
    if (card) send('play', { card, suit: letter });
  }

  return html`
    <${Fragment}>
      ${others.length ? html`
        <ul class="seats">
          ${others.map((id) => seatTile(id, byId.get(id) || null, view, me, over))}
        </ul>` : null}

      <${Piles} drawCount=${view.drawCount} top=${view.top} suit=${view.suit} suitName=${view.suitName} />

      <div class="stack-tight center table-status">
        <h2>${heading(view, byId, me, over)}</h2>
        ${over
          ? html`
            <${Fragment}>
              ${view.winnerId ? null : html`<p class="lede">The turn limit ran out, so the smallest hand wins.</p>`}
              <div class="score-chips" style="justify-content: center">
                ${[...seats].sort((a, b) => count(view, a) - count(view, b)).map((id) => countChip(id, byId.get(id) || null, view, me))}
              </div>
            <//>`
          : html`
            <${Fragment}>
              <p class="lede">${line(view, byId, me, watching)}</p>
              ${note ? html`<p class="small muted">${note}</p>` : null}
            <//>`}
      </div>

      ${watching
        ? null
        : html`
          <${Hand}
            cards=${view.hand}
            playable=${view.playable || []}
            selected=${naming || lifted}
            onPlay=${playCard}
          />`}

      ${naming ? html`
        <${Sheet} title="Name a suit" onClose=${() => setNaming(null)}>
          <p class="lede">An eight plays on anything, and you say what the next player has to follow.</p>
          <div class="suit-picker">
            ${SUITS.map((suit) => html`
              <button type="button" class="choice" key=${suit.letter} onClick=${() => nameSuit(suit.letter)}>
                <span class=${suit.red ? 'suit-glyph is-red' : 'suit-glyph'} aria-hidden="true">${suit.glyph}</span>
                <span>${suit.name}</span>
              </button>`)}
          </div>
        <//>` : null}
    <//>`;
}

/** One other player: their face, their name, and how much they are still holding. */
function seatTile(id, player, view, me, over) {
  const cards = count(view, id);
  const turn = !over && view.turn === id;
  return html`
    <li class=${turn ? 'seat is-turn' : 'seat'} key=${id}>
      <${Avatar} player=${player} size="sm" />
      <span class="who">${playerName(player, me)}</span>
      ${cards === 1
        ? html`<span class="count note">one card</span>`
        : html`<span class="count num">${plural(cards, 'card', 'cards')}</span>`}
    </li>`;
}

/** What is left in one hand, for the line of chips at the end of a game. */
function countChip(id, player, view, me) {
  return html`
    <span class="chip" key=${id}>
      <span class="chip-face" aria-hidden="true">${(player && player.avatar) || ''}</span>
      <span class="sr-only">${playerName(player, me)}</span>
      <span class="num">${plural(count(view, id), 'card', 'cards')}</span>
    </span>`;
}

function count(view, id) {
  return (view.handCounts || {})[id] || 0;
}

/** The one line at the top of the status block. */
function heading(view, byId, me, over) {
  if (view.winnerId) return view.winnerId === me ? 'You win.' : `${nameOf(byId, view.winnerId, me)} wins.`;
  if (over) return 'The game is over.';
  if (view.hand === null) return 'Watching.';
  if (view.isActive) return 'Your turn.';
  return `Waiting for ${nameOf(byId, view.turn, me)}.`;
}

/** The sentence under it: what you can play, or what the table is waiting on. */
function line(view, byId, me, watching) {
  if (view.isActive) return playLine(view);
  const last = playedLine(view, byId, me);
  if (last) return last;
  if (watching) return `${nameOf(byId, view.turn, me)} is choosing a card.`;
  return `${nameOf(byId, view.turn, me)} plays first.`;
}

/** On your own turn the last play is still worth knowing, so it goes underneath. */
function aside(view, byId, me) {
  if (!view.isActive) return '';
  const last = playedLine(view, byId, me);
  return view.lastPlay && view.lastPlay.playerId !== me ? last : '';
}

/** "You can play a seven, a heart, or an eight, or draw a card." */
function playLine(view) {
  if (view.pendingDraw > 0) {
    const many = COUNT_WORDS[view.pendingDraw] || String(view.pendingDraw);
    return (view.playable || []).length
      ? `Draw ${many}, or pass it on with a two.`
      : `Draw ${many}. You have no two to pass it on with.`;
  }
  if (view.drew === 'none') return 'The draw pile is empty, so pass to the next player.';
  if (view.drew) {
    const drawn = `You drew the ${cardWords(view.drew)}.`;
    return (view.playable || []).length ? `${drawn} Play it, or pass.` : `${drawn} Nothing matches, so pass.`;
  }
  const suit = suitOf(view.suit).one;
  const top = parseCard(String(view.top || ''));
  // An eight on top has already had its suit named, so its own rank is the only rank that matches.
  if (top.rank === '8') return `You can play ${article(suit)} ${suit} or an eight, or draw a card.`;
  const rank = RANK_WORDS[top.rank] || top.rank;
  return `You can play ${article(rank)} ${rank}, ${article(suit)} ${suit}, or an eight, or draw a card.`;
}

/** "Nina played the eight of clubs and called hearts." */
function playedLine(view, byId, me) {
  const last = view.lastPlay;
  if (!last || !last.card) return '';
  const who = last.playerId === me ? 'You' : nameOf(byId, last.playerId, me);
  const called = last.suit ? ` and called ${suitOf(last.suit).name.toLowerCase()}` : '';
  return `${who} played the ${cardWords(last.card)}${called}.`;
}

function nameOf(byId, id, me) {
  return playerName(byId.get(id) || null, me);
}

/** "an eight", "a seven". Only ace and eight start with a vowel among the words we use. */
function article(word) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** A card you just drew stays lifted for a moment, so you can see what arrived. */
function useDrawn(drew) {
  const [lifted, setLifted] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    if (!drew) { setLifted(null); return undefined; }
    setLifted(drew);
    const timer = setTimeout(() => setLifted(null), DREW_MS);
    return () => clearTimeout(timer);
  }, [drew]);
  return lifted;
}

/**
 * A click for every card that lands, and the win once. Which play is new is decided by
 * comparing the last play between renders, so a device that missed a poll hears one click
 * rather than one for each play it slept through.
 */
function useTableSounds(view) {
  const last = view.lastPlay;
  const key = last ? `${view.discardCount}:${last.playerId}:${last.card}` : '';
  const heard = useRef(/** @type {string | null} */ (null));
  useEffect(() => {
    if (heard.current === null) { heard.current = key; return; }
    if (key && key !== heard.current) tapSound();
    heard.current = key;
  }, [key]);
  // The win itself is the platform's sound: Play.js plays it for the `won` log entry.
}

/**
 * The creator's content step. Crazy Eights has no cards to write: the deck is 52 cards and
 * the rules are settings, so this step only says where to look next.
 */
export function Editor() {
  return html`<p class="lede">This game has no cards to write. The hand size and the house rules are on the next step.</p>`;
}
