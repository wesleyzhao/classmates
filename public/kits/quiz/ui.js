// The quiz screen. It draws exactly what the server said and sends taps back; every rule,
// every score, and the answer itself live in kit.js, so nothing here can be wrong about the
// game, only about how it looks.
//
// One card is: how far through we are and how long is left, the card, the question, the way
// to answer, who we are still waiting for, and where everyone stands. At the reveal the
// same screen turns over: the picture shrinks, the answer takes the heading, the tiles
// repaint, and the standings take the room.

import { html, Fragment } from '../../app/h.js';
import { TimerRing, useNow } from '../../app/components/Timer.js';
import { PromptCard, hasMedia } from '../../app/game-ui/PromptCard.js';
import { ChoiceGrid } from '../../app/game-ui/ChoiceGrid.js';
import { TextAnswer } from '../../app/game-ui/TextAnswer.js';
import { CardResults, RevealPanel } from '../../app/game-ui/RevealPanel.js';
import { joinWords, playerName, formatScore } from '../../app/lib.js';
import { isClose } from '../../shared/match.js';

/** The face a player wears when we were told nothing about them. */
const FACE = '\u{1F642}';

/**
 * The in-game screen.
 * @param {{
 *   view: any,
 *   me: string | null,
 *   players: import('../../../types/parlor.js').PlayerInfo[],
 *   send: (type: string, payload?: any) => void,
 *   now: number,
 * }} props
 */
export function Play({ view, me, players, send, now }) {
  // The countdown keeps its own clock so it ticks between polls; whichever is further on wins.
  const ticking = useNow(!!view.wakeAt);
  const at = Math.max(Number(now) || 0, ticking);
  const round = view.round;
  if (!round) return html`<p class="lede center">This game has no cards in it.</p>`;

  const revealed = view.phase !== 'card';
  const mine = round.mine || null;
  const mode = view.answerMode;
  const answered = !!mine;
  const picked = pickedIndex(mine, revealed);
  const typed = typedAnswer(mine, revealed);
  const last = view.progress.n >= view.progress.total;

  return html`
    <${Fragment}>
      <div class="topbar">
        <span class="num ink-2 small">Card ${view.progress.n} of ${view.progress.total}</span>
        ${revealed
          ? html`<span class="num ink-2 small">${nextLine(view, players, me, at, last)}</span>`
          : html`<${TimerRing} wakeAt=${round.endsAt} total=${view.seconds * 1000} now=${at} />`}
      </div>

      <${PromptCard} card=${round.card} compact=${revealed} />

      ${revealed
        ? html`<${RevealPanel} answer=${round.answer} results=${round.results} players=${players} me=${me} />`
        : (hasMedia(round.card) ? html`<h2 class="center">${round.card.prompt}</h2>` : null)}

      <div class="stack">
        ${mode !== 'text' ? html`
          <${ChoiceGrid}
            choices=${round.card.choices}
            picked=${picked}
            correct=${revealed ? round.correctChoice : null}
            revealed=${revealed}
            disabled=${!round.canAnswer}
            onPick=${(index) => send('answer', { n: round.n, value: index })}
          />` : null}
        ${showText(mode, answered, typed, revealed, Boolean(mine && mine.correct)) ? html`
          <${TextAnswer}
            submitted=${typed}
            revealed=${revealed}
            correct=${Boolean(mine && mine.correct)}
            close=${Boolean(revealed && typed && mine && !mine.correct && isClose(typed, { answer: round.answer }))}
            disabled=${!round.canAnswer}
            onAnswer=${(text) => send('answer', { n: round.n, value: text })}
          />` : null}
      </div>

      ${revealed
        ? html`<${CardResults} results=${round.results} players=${players} me=${me} />`
        : (answered ? html`<p class="small ink-2">${lockedLine(view, players, me)}</p>` : null)}

      <div class="stack-tight">
        ${revealed ? html`<p class="small muted">Totals so far</p>` : null}
        <div class="score-chips">
          ${view.standings.map((row) => {
            const player = players.find((p) => p.id === row.playerId) || null;
            return html`
              <span class="chip" key=${row.playerId}>
                <span aria-hidden="true">${(player && player.avatar) || FACE}</span>
                <span class="sr-only">${playerName(player, me)}</span>
                <span class="num">${formatScore(row.score)}</span>
              </span>`;
          })}
        </div>
      </div>
    <//>`;
}

/** The tile this player tapped, or null when they typed or have not answered. */
function pickedIndex(mine, revealed) {
  if (!mine) return null;
  if (revealed) return typeof mine.pick === 'number' && mine.pick >= 0 ? mine.pick : null;
  return typeof mine.value === 'number' ? mine.value : null;
}

/** What this player typed, or null when they tapped a tile or have not answered. */
function typedAnswer(mine, revealed) {
  if (!mine) return null;
  if (revealed) return typeof mine.pick === 'number' && mine.pick >= 0 ? null : String(mine.value || '');
  return typeof mine.value === 'string' ? mine.value : null;
}

/**
 * The box is there for typing, and afterwards for showing what was typed. Once the answer
 * is up it only comes back for a guess that missed, where seeing it again is the point.
 */
function showText(mode, answered, typed, revealed, correct) {
  if (revealed) return typed !== null && !correct;
  if (mode === 'text') return true;
  if (mode !== 'both') return false;
  return !answered || typed !== null;
}

/** "Locked in. Waiting for Nina." */
function lockedLine(view, players, me) {
  const others = (view.waitingOn || []).filter((id) => id !== me);
  if (!others.length) return 'Locked in.';
  const names = others.map((id) => playerName(players.find((p) => p.id === id) || null, me));
  return `Locked in. Waiting for ${joinWords(names)}.`;
}

/** What happens after the reveal: a countdown, or the name of whoever has to press the button. */
function nextLine(view, players, me, at, last) {
  if (view.autoAdvance && view.wakeAt) {
    const seconds = Math.max(0, Math.ceil((view.wakeAt - at) / 1000));
    return `${last ? 'Results in' : 'Next card in'} ${seconds}`;
  }
  const host = players.find((player) => player.isHost);
  if (!host || host.id === me) return '';
  return `Waiting for ${host.name}.`;
}

/**
 * The creator's content step. Decks are chosen before this, so all it does for now is let
 * someone play a corner of a deck: tap the categories to keep, or leave them all off to
 * play the whole thing.
 * @param {{
 *   content: any,
 *   config?: any,
 *   onChange: (content: any) => void,
 *   decks?: Record<string, import('../../../types/parlor.js').Deck> | import('../../../types/parlor.js').Deck[],
 * }} props
 */
export function Editor({ content, onChange, decks }) {
  const chosen = (content && content.categories) || [];
  const available = categoriesOf(decks, chosen);
  const toggle = (id) => {
    const next = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
    onChange({ ...content, categories: next });
  };
  return html`
    <div class="stack">
      <p class="lede">Pick the categories you want, or leave them all off to play the whole deck.</p>
      ${available.length ? html`
        <div class="chip-strip">
          ${available.map((category) => html`
            <button
              type="button"
              key=${category.id}
              class=${chosen.includes(category.id) ? 'chip is-active' : 'chip'}
              aria-pressed=${chosen.includes(category.id)}
              onClick=${() => toggle(category.id)}
            >
              ${category.color ? html`<span class="chip-dot" style=${`background:${category.color}`}></span>` : null}
              ${category.emoji ? html`<span aria-hidden="true">${category.emoji}</span>` : null}
              ${category.name}
            </button>`)}
        </div>`
        : html`<p class="small muted">These cards are not sorted into categories, so every one of them is in play.</p>`}
    </div>`;
}

/**
 * The categories the chosen decks offer. Decks the creator has not loaded yet still show
 * whatever the game already has, so nothing disappears while the page is catching up.
 */
function categoriesOf(decks, chosen) {
  const list = Array.isArray(decks) ? decks : Object.values(decks || {});
  /** @type {Map<string, { id: string, name: string, color?: string, emoji?: string }>} */
  const found = new Map();
  for (const deck of list) {
    for (const category of (deck && deck.categories) || []) {
      if (category && category.id && !found.has(category.id)) found.set(category.id, category);
    }
  }
  for (const id of chosen) if (!found.has(id)) found.set(id, { id, name: id });
  return [...found.values()];
}
