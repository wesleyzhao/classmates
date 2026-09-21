// The moment the answer goes up. Two lines: what it was, and who took it, written the way
// someone reading the room would say it. "That's Portugal. Sam had it first, two seconds
// ahead of you." Under that, one row per player for this card: how fast, how many points,
// or what they said instead.
//
// The sentence is built here rather than in the kit because it needs names, and kits never
// learn anyone's name (docs/KIT-CONTRACT.md). The kit sends results; this turns them into
// English.

import { midSentence } from '../../shared/words.js';
import { html } from '../h.js';
import { Avatar } from '../components/Avatar.js';
import { formatScore, playerName } from '../lib.js';

/** @typedef {{ playerId: string, correct: boolean, value?: string, points?: number, ms?: number }} Result */

/** Under this, two people answered together as far as anyone at the table could tell. */
const MOMENT_MS = 1000;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * @param {{
 *   answer: string,
 *   results?: Result[],
 *   players?: import('../../../types/parlor.js').PlayerInfo[],
 *   me?: string | null,
 *   note?: string,
 * }} props
 */
export function RevealPanel({ answer, results = [], players = [], me = null, note = '' }) {
  return html`
    <div class="stack center">
      <h2 class="center">That's ${midSentence(answer)}.</h2>
      <p class="lede center">${revealLine(results, players, me)}</p>
      ${note ? html`<p class="small muted center">${note}</p>` : null}
    </div>`;
}

/**
 * One sentence about who took the card: the first right answer, and by how much.
 * @param {Result[]} results  correct first, then fastest first, as the quiz kit sorts them
 * @param {import('../../../types/parlor.js').PlayerInfo[]} players
 * @param {string | null} me
 * @returns {string}
 */
export function revealLine(results, players, me) {
  const answered = results || [];
  if (!answered.length) return 'Nobody answered that one.';
  const right = answered.filter((result) => result.correct);
  if (!right.length) return 'Nobody got it.';

  const names = right.map((result) => playerName(find(players, result.playerId), me));
  const first = names[0];
  if (right.length < 2) {
    return answered.length > 1 ? `Only ${first === 'You' ? 'you' : first} had it.` : `${first} had it.`;
  }

  const gap = Number(right[1].ms || 0) - Number(right[0].ms || 0);
  const second = names[1] === 'You' ? 'you' : names[1];
  const by = gap < MOMENT_MS ? 'a moment' : `${count(Math.round(gap / 1000))} ${Math.round(gap / 1000) === 1 ? 'second' : 'seconds'}`;
  const everyone = right.length === answered.length && answered.length > 2;
  return everyone
    ? `Everyone had it. ${first} ${first === 'You' ? 'were' : 'was'} first, ${by} ahead of ${second}.`
    : `${first} had it first, ${by} ahead of ${second}.`;
}

/**
 * This card, player by player: the first right answer wears a tag, every right answer shows
 * its time and points, a wrong one shows what was said, and silence shows as no answer.
 * @param {{
 *   results?: Result[],
 *   players?: import('../../../types/parlor.js').PlayerInfo[],
 *   me?: string | null,
 * }} props
 */
export function CardResults({ results = [], players = [], me = null }) {
  const rows = [...results];
  for (const player of players) {
    if (!rows.some((row) => row.playerId === player.id)) rows.push({ playerId: player.id, correct: false });
  }
  if (!rows.length) return null;
  const firstRight = rows.find((row) => row.correct);
  return html`
    <ul class="list card-results" aria-label="This card">
      ${rows.map((row) => {
        const player = find(players, row.playerId);
        return html`
          <li class="list-row" key=${row.playerId}>
            <${Avatar} player=${player} size="sm" />
            <span class="strong grow">${playerName(player, me)}</span>
            ${row === firstRight && results.filter((r) => r.correct).length > 1 ? html`<span class="tag tag-accent">first</span>` : null}
            ${row.correct
              ? html`
                <span class="small muted num">${seconds(row.ms)}</span>
                <span class="delta is-up num">+${formatScore(row.points || 0)}</span>`
              : html`<span class="small muted">${row.value ? `said ${row.value}` : 'no answer'}</span>`}
          </li>`;
      })}
    </ul>`;
}

/** "2.1 s", or nothing when the kit gave no time. */
function seconds(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return `${(ms / 1000).toFixed(1)} s`;
}

function find(players, playerId) {
  return (players || []).find((player) => player.id === playerId) || null;
}

/** Small numbers read better as words in the middle of a sentence. */
function count(n) {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}
