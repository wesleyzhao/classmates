// The race screen. The lanes are the scoreboard: one line per runner, a token on the space
// they have reached, and the finish at the end. The round underneath is the quiz screen a
// player already knows. Every rule and the answer itself live in kit.js, so nothing here can
// be wrong about the game, only about how it looks.
//
// Lanes rather than a board of squares because a race has to fit above the answers on a
// phone: a card with ten seconds on it cannot ask anyone to scroll. Three runners take a
// hundred pixels however long the track is, and the card sits between them and the tiles.
//
// At the reveal the answer takes the heading, one sentence says who moved and how far, and
// the tokens slide along their lanes to where they have got to.

import { html, Fragment } from '../../app/h.js';
import { TimerRing, useNow } from '../../app/components/Timer.js';
import { Avatar } from '../../app/components/Avatar.js';
import { Lanes } from '../../app/game-ui/Lanes.js';
import { PromptCard, hasMedia } from '../../app/game-ui/PromptCard.js';
import { ChoiceGrid } from '../../app/game-ui/ChoiceGrid.js';
import { TextAnswer } from '../../app/game-ui/TextAnswer.js';
import { joinWords, playerName } from '../../app/lib.js';
import { midSentence, numberWord } from '../../shared/words.js';
import { isClose } from '../../shared/match.js';

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
  const revealed = view.phase !== 'card';
  const over = view.phase === 'over';

  const track = html`<${Lanes} players=${players} positions=${view.pos} length=${view.trackLength} meId=${me} />`;

  if (!round) {
    return html`
      <${Fragment}>
        ${track}
        <p class="lede center">This race has no cards in it.</p>
      <//>`;
  }
  if (over) return track;

  const mine = round.mine || null;
  const mode = view.answerMode;
  const answered = !!mine;
  const picked = pickedIndex(mine, revealed);
  const typed = typedAnswer(mine, revealed);

  return html`
    <${Fragment}>
      ${track}

      <div class="stack">
        <div class="topbar">
          <span class="num ink-2 small">Card ${round.n}</span>
          ${revealed
            ? html`<span class="num ink-2 small">${nextLine(view, at)}</span>`
            : html`<${TimerRing} wakeAt=${round.endsAt} total=${view.seconds * 1000} now=${at} />`}
        </div>

        <${PromptCard} card=${round.card} size=${revealed ? 'sm' : 'md'} />

        ${revealed
          ? html`
            <div class="stack-tight center">
              <h2 class="center">That's ${midSentence(round.answer)}.</h2>
              <p class="lede center">${raceLine(round, players, me)}</p>
            </div>`
          : (hasMedia(round.card) ? html`<h2 class="center">${round.card.prompt}</h2>` : null)}
      </div>

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
        ? html`<${Movers} round=${round} players=${players} pos=${view.pos} me=${me} />`
        : (answered ? html`<p class="small ink-2">${lockedLine(view, players, me)}</p>` : null)}
    <//>`;
}

/** A board wants the wider column. The chrome reads this off the screen it just loaded. */
Play.wide = true;

// ---------------------------------------------------------------------------
// the reveal

/** Who moved, and what everyone else said. */
function Movers({ round, players, pos, me }) {
  const rows = [...(round.results || [])];
  for (const player of players) {
    if (pos[player.id] === undefined) continue;
    if (!rows.some((row) => row.playerId === player.id)) rows.push({ playerId: player.id, correct: false, value: '', spaces: 0 });
  }
  if (!rows.length) return null;
  const rights = rows.filter((row) => row.correct).length;
  return html`
    <ul class="list card-results" aria-label="This card">
      ${rows.map((row) => {
        const player = players.find((p) => p.id === row.playerId) || null;
        return html`
          <li class="list-row" key=${row.playerId}>
            <${Avatar} player=${player} size="sm" />
            <span class="strong grow">${playerName(player, me)}</span>
            ${rights > 1 && row.playerId === round.firstId ? html`<span class="tag tag-accent">first</span>` : null}
            ${row.correct
              ? html`
                <span class="small muted num">${secondsLine(row.ms)}</span>
                <span class="delta is-up num">+${row.spaces}</span>`
              : html`<span class="small muted">${row.value ? `said ${row.value}` : 'no answer'}</span>`}
          </li>`;
      })}
    </ul>`;
}

/**
 * One sentence about the race this card just ran: who had it first, how far they go, and who
 * follows them. "Sam had it first and moves two. You move one."
 * @returns {string}
 */
function raceLine(round, players, me) {
  const right = (round.results || []).filter((row) => row.correct);
  if (!right.length) return 'Nobody had it, so nobody moves.';
  const name = (row) => playerName(players.find((p) => p.id === row.playerId) || null, me);
  const verb = (who) => (who === 'You' ? 'move' : 'moves');

  const [first, ...rest] = right;
  const leader = name(first);
  if (first.spaces > 1) {
    const lead = `${leader} had it ${rest.length ? 'first ' : ''}and ${verb(leader)} ${numberWord(first.spaces)}.`;
    if (!rest.length) return lead;
    const names = rest.map(name);
    const tail = names.length > 1 ? `${joinWords(names)} each move` : `${names[0]} ${verb(names[0])}`;
    return `${lead} ${tail} ${numberWord(rest[0].spaces)}.`;
  }
  if (right.length === 1) return `${leader} had it and ${verb(leader)} ${numberWord(first.spaces)}.`;
  return `${joinWords(right.map(name))} had it, and move ${numberWord(first.spaces)} each.`;
}

/** "2.1 s", or nothing when the kit gave no time. */
function secondsLine(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return `${(ms / 1000).toFixed(1)} s`;
}

// ---------------------------------------------------------------------------
// the round

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

/** The race moves on by itself, so the corner counts the seconds until the next card. */
function nextLine(view, at) {
  if (!view.wakeAt) return '';
  const seconds = Math.max(0, Math.ceil((view.wakeAt - at) / 1000));
  return `Next card in ${seconds}`;
}

// ---------------------------------------------------------------------------
// the creator's content step

/**
 * The creator's content step. Decks are chosen before this, so all it does for now is let
 * someone race through a corner of a deck: tap the categories to keep, or leave them all off
 * to play the whole thing.
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
      <p class="lede">Pick the categories you want, or leave them all off to race through the whole deck.</p>
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
