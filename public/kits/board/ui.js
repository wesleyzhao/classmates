// The board screen: whose turn it is, the board, one status block that changes with the step, and
// everyone's wedges underneath. The kit decided all of it already, so this file only chooses the
// words and where things sit. Roll, Go again, Right and Wrong are in `view.actions`, which the
// platform draws in the action bar, so they are never drawn here (docs/KIT-CONTRACT.md, rule R3).
//
// Two things are watched between renders rather than handed over: the roll, so the die tumbles on a
// number that came back the same, and the wedges, so a new one pops. The room's log is not in these
// props, and the view carries enough to know both happened. The roll is the one moment the screen
// holds something back: while the die is still turning, the sentence about the number and the
// places to move wait, because a four that is announced before it lands is not a roll.

import { html, Fragment, useEffect, useRef, useState } from '../../app/h.js';
import { Board, spaceLabel, spaceColor } from '../../app/game-ui/Board.js';
import { Die, rollWord, TUMBLE_MS } from '../../app/game-ui/Die.js';
import { Wedges, WedgeStrip, TrackStrip } from '../../app/game-ui/Wedges.js';
import { PromptCard, hasMedia } from '../../app/game-ui/PromptCard.js';
import { ChoiceGrid } from '../../app/game-ui/ChoiceGrid.js';
import { TextAnswer } from '../../app/game-ui/TextAnswer.js';
import { Avatar } from '../../app/components/Avatar.js';
import { DeckPicker, deckCategories, useDecks } from '../../app/components/DeckPicker.js';
import { ListEditor } from '../../app/components/ListEditor.js';
import { DEFAULT_COLORS } from './kit.js';
import { joinWords, playerName, plural } from '../../app/lib.js';
import { midSentence } from '../../shared/words.js';
import { rattle as rattleSound, ding as dingSound, win as winSound } from '../../app/sound.js';
import * as wheel from './layouts/wheel.js';
import * as track from './layouts/track.js';

/** How long the die takes to land after a roll (the number waits for it), and how long a new wedge bounces. */
const SPIN_MS = TUMBLE_MS;
const POP_MS = 460;

/**
 * The in-game screen.
 * @param {{
 *   view: any,
 *   me: string | null,
 *   players: import('../../../types/parlor.js').PlayerInfo[],
 *   send: (type: string, payload?: any) => void,
 *   now?: number,
 *   sending?: string | null,
 * }} props
 * `sending` is the action this device is still waiting on, from the platform; while it is the
 * roll, the die keeps turning.
 */
export function Play({ view, me, players, send, sending = null }) {
  const moments = useMoments(view);
  // The die keeps the last number on screen through the next player's roll step, where the
  // turn's own roll is still empty. Written while rendering because it is only ever a mirror.
  // The key changes once per roll, so a four after a four still tumbles, and only then.
  const shown = useRef({ value: 1, key: '' });
  const turn = view.turn;
  if (turn && turn.roll) shown.current = { value: turn.roll, key: `${turn.seq}:${turn.roll}` };
  const rolling = sending === 'roll';
  const landing = moments.spin;

  if (!turn) return html`<p class="lede center">This game has not dealt anyone in yet.</p>`;

  const layout = layoutOf(view);
  const cats = view.cats || [];
  const active = players.find((player) => player.id === turn.playerId) || null;
  const collecting = view.win === 'collect';
  const done = turn.step === 'done';

  return html`
    <${Fragment}>
      <div class="row">
        <${Avatar} player=${active} />
        <span class="turn-name grow">${done ? 'Game over' : view.isActive ? 'Your turn' : `${playerName(active, null)}'s turn`}</span>
        ${collecting && !done ? html`
          <${Wedges} cats=${cats} owned=${view.wedges[turn.playerId] || []}
                     pop=${moments.pop && moments.pop.playerId === turn.playerId ? moments.pop.cat : null} />` : null}
      </div>

      <${Board}
        layout=${layout}
        cats=${cats}
        positions=${view.pos}
        players=${players}
        options=${turn.step === 'move' && view.isActive && !landing ? turn.options || [] : []}
        lastMove=${turn.lastMove ? { ...turn.lastMove, playerId: turn.playerId } : null}
        onPick=${(to) => send('move', { to })}
        highlightSpace=${HIGHLIGHT.has(turn.step) && turn.lastMove ? turn.lastMove.to : null}
      />

      ${turn.step === 'roll' || turn.step === 'move'
        ? html`
          <div class="stack">
            <div class="row">
              <${Die} value=${shown.current.value} roll=${shown.current.key} rolling=${rolling} />
              ${turn.step === 'roll'
                ? html`<p class="lede grow">${rolling ? 'Rolling.' : view.isActive ? "Your turn. Roll when you're ready." : `Waiting for ${playerName(active, null)} to roll.`}</p>`
                : html`<h2 class="grow">${landing ? 'Rolling.' : `${playerName(active, me)} rolled a ${rollWord(turn.roll)}.`}</h2>`}
            </div>
            <${Status} view=${view} turn=${turn} layout=${layout} cats=${cats} players=${players}
                       me=${me} send=${send} active=${active} landing=${landing} />
          </div>`
        : html`
          <${Status} view=${view} turn=${turn} layout=${layout} cats=${cats} players=${players}
                     me=${me} send=${send} active=${active} landing=${landing} />`}

      ${collecting
        ? html`<${WedgeStrip} players=${players} wedges=${view.wedges} cats=${cats} meId=${me} pop=${moments.pop} />`
        : view.layout === 'track'
          ? html`<${TrackStrip} players=${players} positions=${view.pos} spaces=${layout.spaces} length=${view.trackLength} meId=${me} />`
          : null}
    <//>`;
}

/** The steps where the board should point at the space someone landed on. */
const HIGHLIGHT = new Set(['pick', 'final-pick', 'ask', 'judge', 'result']);

// ---------------------------------------------------------------------------
// the status block, one step at a time

// The die and the line beside it are drawn by Play, not here, so the die stays in one place in
// the tree from the roll step to the move step and its tumble is not lost to a fresh mount.
function Status({ view, turn, layout, cats, players, me, send, active, landing }) {
  const name = playerName(active, me);
  const theirName = playerName(active, null);

  switch (turn.step) {
    case 'roll':
      return null;

    case 'move':
      if (landing) return null;
      if (!view.isActive) return html`<p class="lede">${`${theirName} is choosing where to move.`}</p>`;
      return html`
        <${Fragment}>
          <p class="lede">Choose where to move. The numbers match the rings on the board.</p>
          <div class="chip-strip">
            ${(turn.options || []).map((option, index) => {
              const space = layout.spaces[option.to];
              const color = spaceColor(space, cats);
              const many = (turn.options || []).length > 1;
              return html`
                <button type="button" class="chip chip-lg" key=${option.to} onClick=${() => send('move', { to: option.to })}>
                  ${many ? html`<span class="chip-num" aria-hidden="true">${index + 1}</span>` : null}
                  ${color ? html`<span class="chip-dot" style=${`background:${color}`}></span>` : null}
                  ${spaceLabel(space, cats)}
                </button>`;
            })}
          </div>
        <//>`;

    case 'pick':
    case 'final-pick': {
      const final = turn.step === 'final-pick';
      if (view.canPick) {
        return html`
          <div class="stack">
            <p class="lede">${final ? `Choose the final category for ${theirName}.` : 'Pick a category.'}</p>
            <div class="chip-strip">
              ${cats.map((cat, index) => html`
                <button type="button" class="chip chip-lg" key=${cat.id} onClick=${() => send('pick', { cat: index })}>
                  <span class="chip-dot" style=${`background:${cat.color}`}></span>
                  ${cat.emoji ? html`<span class="chip-face" aria-hidden="true">${cat.emoji}</span>` : null}
                  ${cat.name}
                </button>`)}
            </div>
          </div>`;
      }
      if (final) {
        return html`<p class="lede">${view.isActive ? 'The others are choosing your final category.' : `The others are choosing ${theirName}'s final category.`}</p>`;
      }
      return html`<p class="lede">${`${theirName} is picking a category.`}</p>`;
    }

    case 'ask':
      return html`<${Ask} view=${view} turn=${turn} cats=${cats} me=${me} send=${send} name=${name} theirName=${theirName} />`;

    case 'judge':
      return html`
        <div class="stack">
          <${PromptCard} card=${turn.card} compact=${true} />
          <h2 class="center">${turn.typed ? `${name} said: ${turn.typed}.` : `${name} passed.`}</h2>
          ${turn.answer ? html`<p class="lede center">${`That's ${midSentence(turn.answer)}.`}</p>` : null}
          <p class="lede center">${judgeLine(view, theirName)}</p>
        </div>`;

    case 'result': {
      const result = turn.result || {};
      return html`
        <div class="stack">
          <${PromptCard} card=${turn.card} compact=${true} />
          <h2 class="center">${result.correct ? 'Right.' : 'Wrong.'}</h2>
          <p class="lede center">${resultLine(view, turn, cats, name, players, me)}</p>
          ${!result.correct && result.answer ? html`<p class="lede center">${`The answer was ${midSentence(result.answer)}.`}</p>` : null}
          ${result.typed ? html`<p class="small ink-2 center">${`${name} said: ${result.typed}.`}</p>` : null}
          ${turn.card && turn.card.choices ? html`
            <${ChoiceGrid} choices=${turn.card.choices} picked=${turn.chosen}
                           correct=${result.correctIndex} revealed=${true} />` : null}
        </div>`;
    }

    case 'done':
      return html`<${Done} view=${view} players=${players} cats=${cats} me=${me} />`;

    default:
      return null;
  }
}

/** The question, what it is worth, and the way this player answers it. */
function Ask({ view, turn, cats, me, send, name, theirName }) {
  const cat = turn.cat === null || turn.cat === undefined ? null : cats[turn.cat];
  const seated = me !== null && view.pos && view.pos[me] !== undefined;
  const open = view.answerStyle === 'open';
  const stake = turn.final
    ? 'To win the game.'
    : turn.forWedge && cat ? `For the ${cat.name} wedge.` : 'Answer to keep your turn.';

  return html`
    <div class="stack">
      <${PromptCard} card=${turn.card} />
      ${hasMedia(turn.card) ? html`<h2 class="center">${turn.card.prompt}</h2>` : null}
      <p class="lede center">${stake}</p>

      ${view.isActive ? html`
        <${Fragment}>
          ${view.answerStyle === 'choices' ? html`
            <${ChoiceGrid}
              choices=${turn.card.choices || []}
              picked=${turn.chosen}
              onPick=${(index) => send('answer', { index })}
            />` : html`
            <${Fragment}>
              ${open ? html`<p class="small ink-2 center">Say it out loud, then lock in what you said so the table can mark it.</p>` : null}
              <${TextAnswer}
                submitted=${turn.submitted ? turn.typed || '' : null}
                onAnswer=${(text) => send('submit', { text })}
              />
              ${open && !turn.submitted ? html`
                <button type="button" class="btn btn-secondary btn-block" onClick=${() => send('submit', { text: '' })}>Pass</button>` : null}
            <//>`}
        <//>`
        : seated ? html`
          <${Fragment}>
            ${turn.answer ? html`<p class="lede center">${`The answer is ${midSentence(turn.answer)}. Don't tell.`}</p>` : null}
            <p class="small ink-2 center">${`${theirName} is answering.`}</p>
          <//>`
        : null}
    </div>`;
}

/** The last screen: who won, with what, and where everyone else got to. */
function Done({ view, players, cats, me }) {
  const winner = players.find((player) => player.id === view.winnerId) || null;
  const name = playerName(winner, me);
  const collecting = view.win === 'collect';
  const others = players.filter((player) => player.id !== view.winnerId && view.wedges[player.id]);
  const line = others.length ? `${joinWords(others.map((player) => behind(player, view, me, collecting)))}.` : '';

  return html`
    <div class="stack center">
      <h2 class="center">${winner ? `${name} ${name === 'You' ? 'win' : 'wins'}.` : 'Nobody wins.'}</h2>
      ${winner && collecting ? html`
        <div class="row" style="justify-content:center">
          <${Wedges} cats=${cats} owned=${view.wedges[view.winnerId] || []} />
        </div>` : null}
      ${winner ? null : html`<p class="lede center">The game ran out of turns.</p>`}
      ${line ? html`<p class="lede center">${line}</p>` : null}
    </div>`;
}

// ---------------------------------------------------------------------------
// sentences

function judgeLine(view, theirName) {
  if (view.canJudge) return 'Mark it right or wrong.';
  if (view.isActive) return 'The others are marking your answer.';
  return `The table is marking ${theirName}'s answer.`;
}

/** What just happened, in one sentence: a wedge, a kept turn, a win, or a turn that moves on. */
function resultLine(view, turn, cats, name, players, me) {
  const result = turn.result || {};
  if (result.win) return `${name} ${name === 'You' ? 'win' : 'wins'}.`;
  if (result.wedge !== null && result.wedge !== undefined && cats[result.wedge]) {
    const cat = cats[result.wedge];
    return view.isActive ? `The ${cat.name} wedge is yours.` : `The ${cat.name} wedge goes to ${name}.`;
  }
  if (result.correct) return `${name} ${name === 'You' ? 'keep' : 'keeps'} the turn.`;
  const up = players.find((player) => player.id === turn.nextId) || null;
  if (!up) return 'The turn passes to the next player.';
  if (up.id === me) return 'Your turn next.';
  return `${up.name} is up next.`;
}

/** "Nina had 3 wedges", or on a race, "Nina reached 24 of 30". */
function behind(player, view, me, collecting) {
  const who = playerName(player, me);
  if (collecting) {
    const count = (view.wedges[player.id] || []).filter(Boolean).length;
    return `${who} had ${plural(count, 'wedge', 'wedges')}`;
  }
  const layout = layoutOf(view);
  const space = layout.spaces[view.pos[player.id]];
  return `${who} reached ${((space && space.index) || 0) + 1} of ${view.trackLength}`;
}

// ---------------------------------------------------------------------------
// moments

/**
 * The two things worth a noise and a wiggle, spotted by comparing this view with the last one.
 * A screen that has only just opened plays nothing: everything it can see already happened.
 * @param {any} view
 * @returns {{ spin: boolean, pop: { playerId: string, cat: number } | null }}
 */
function useMoments(view) {
  const turn = view.turn;
  const ready = useRef(false);
  const seenRoll = useRef('');
  const seenResult = useRef('');
  const [spin, setSpin] = useState(false);
  const [pop, setPop] = useState(/** @type {{ playerId: string, cat: number } | null} */ (null));

  const rollKey = turn && turn.roll ? `${turn.seq}:${turn.roll}` : '';
  const resultKey = turn && turn.step === 'result' && turn.result ? `${turn.seq}:${turn.result.correct}` : '';

  useEffect(() => {
    const primed = ready.current;
    const wasRoll = seenRoll.current;
    const wasResult = seenResult.current;
    ready.current = true;
    seenRoll.current = rollKey;
    seenResult.current = resultKey;
    if (!primed) return undefined;

    /** @type {ReturnType<typeof setTimeout>[]} */
    const timers = [];
    if (rollKey && rollKey !== wasRoll) {
      rattleSound();
      setSpin(true);
      timers.push(setTimeout(() => setSpin(false), SPIN_MS));
    }
    if (resultKey && resultKey !== wasResult) {
      const result = turn.result;
      if (result.correct) dingSound();
      if (result.win) winSound();
      if (result.wedge !== null && result.wedge !== undefined) {
        setPop({ playerId: turn.playerId, cat: result.wedge });
        timers.push(setTimeout(() => setPop(null), POP_MS));
      }
    }
    return () => { for (const timer of timers) clearTimeout(timer); };
  }, [rollKey, resultKey]);

  return { spin, pop };
}

/** The board the view is describing. Both builders cache, so this is cheap on every render. */
function layoutOf(view) {
  if (view.layout === 'track') return track.build({ length: view.trackLength, categories: (view.cats || []).length });
  return wheel.build();
}


// ---------------------------------------------------------------------------
// the creator's content step

/**
 * The board a game is played on and the categories that fill it. The settings form above this
 * already covers how to win and how people answer, so this step is the two things a form cannot
 * draw: which board, and a category with a colour, an emoji and a corner of a deck behind it.
 * @param {{ content: any, config?: any, onChange: (content: any) => void }} props
 */
export function Editor({ content, onChange }) {
  const layout = (content && content.layout) || 'wheel';
  const cats = (content && content.categories) || [];
  const set = (patch) => onChange({ ...content, ...patch });
  const short = layout === 'wheel' && cats.length !== 6;

  return html`
    <div class="stack stack-loose">
      <div class="field">
        <span class="field-label">The board</span>
        <div class="row">
          <${LayoutChoice} id="wheel" name="The wheel" chosen=${layout === 'wheel'} onPick=${() => set({ layout: 'wheel' })} />
          <${LayoutChoice} id="track" name="A race track" chosen=${layout === 'track'} onPick=${() => set({ layout: 'track' })} />
        </div>
        <p class="field-help">${layout === 'wheel'
          ? 'Six headquarters, six spokes, and the middle. It needs exactly six categories.'
          : 'One way from the start to the finish line. Any number of categories.'}</p>
      </div>

      ${layout === 'track' ? html`
        <div class="field">
          <label class="field-label" for="track-length">Track length</label>
          <p class="field-help">Twelve spaces is a quick race, sixty is a long evening.</p>
          <input class="input" id="track-length" type="number" inputmode="numeric" min="12" max="60"
                 value=${(content && content.trackLength) || 30}
                 onInput=${(event) => set({ trackLength: clamp(event.currentTarget.value, 12, 60) })} />
        </div>` : null}

      <div class="stack">
        <div class="section-head">
          <h3>Categories</h3>
          <span class="small muted num">${plural(cats.length, 'category', 'categories')}</span>
        </div>
        ${short ? html`
          <p class="notice">The wheel needs exactly six categories. ${cats.length > 6
            ? `Take ${cats.length - 6} away and it is ready.`
            : `Add ${6 - cats.length} more and it is ready.`}</p>` : null}
        <${ListEditor}
          items=${cats}
          onChange=${(next) => set({ categories: next })}
          max=${12}
          addLabel="Add a category"
          empty="No categories yet. Each one is a color on the board and a corner of a deck behind it."
          newItem=${() => newCategory(cats)}
          rowLabel=${(item, index) => item.name || `Category ${index + 1}`}
          renderItem=${(item, index, patch) => html`<${CategoryRow} item=${item} patch=${patch} />`}
        />
      </div>
    </div>`;
}

/** One board, with a drawing of it, because the names alone do not say what you are choosing. */
function LayoutChoice({ id, name, chosen, onPick }) {
  return html`
    <button type="button" class=${chosen ? 'choice choice-stack grow is-picked' : 'choice choice-stack grow'}
            aria-pressed=${chosen} onClick=${onPick}>
      ${id === 'wheel' ? html`
        <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" fill="none" stroke="currentColor">
          <circle cx="24" cy="24" r="19" stroke-width="5" opacity="0.35" />
          ${[0, 1, 2, 3, 4, 5].map((k) => {
            const angle = (-90 + 60 * k) * (Math.PI / 180);
            return html`<line key=${k} x1="24" y1="24" x2=${24 + 19 * Math.cos(angle)} y2=${24 + 19 * Math.sin(angle)} stroke-width="3" opacity="0.35" />`;
          })}
          <circle cx="24" cy="24" r="5" stroke-width="2" />
        </svg>`
        : html`
        <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" fill="none" stroke="currentColor">
          ${[[7, 13], [17, 13], [27, 13], [37, 13], [37, 25], [27, 25], [17, 25], [7, 25], [7, 37], [17, 37], [27, 37], [37, 37]].map(([x, y], i) => html`
            <rect key=${i} x=${x - 4} y=${y - 4} width="8" height="8" rx="2" stroke-width="2"
                  opacity=${i === 0 || i === 11 ? 1 : 0.35} />`)}
        </svg>`}
      <span>${name}</span>
    </button>`;
}

/** One category: what it is called, what colour it wears, and which cards it asks. */
function CategoryRow({ item, patch }) {
  const decks = useDecks(item.decks || []);
  const found = deckCategories(decks);
  return html`
    <${Fragment}>
      <div class="field">
        <label class="field-label">Name</label>
        <input class="input" type="text" maxLength=${32} value=${item.name || ''} placeholder="Geography"
               onInput=${(event) => patch({ ...item, name: event.currentTarget.value })} />
      </div>

      <div class="field">
        <span class="field-label">Colour</span>
        <div class="picker">
          ${DEFAULT_COLORS.map((color) => html`
            <button type="button" key=${color} class="swatch" aria-pressed=${item.color === color}
                    aria-label=${`Colour ${color}`} style=${`background:${color}`}
                    onClick=${() => patch({ ...item, color })}></button>`)}
        </div>
      </div>

      <div class="field">
        <label class="field-label">Emoji</label>
        <p class="field-help">It shows up beside the name. Leave it out if you would rather not.</p>
        <input class="input" type="text" maxLength=${4} value=${item.emoji || ''}
               onInput=${(event) => patch({ ...item, emoji: event.currentTarget.value })} />
      </div>

      <details class="disclosure" open=${!(item.decks || []).length}>
        <summary>Cards<span class="small ink-2">${deckLine(item.decks, decks)}</span></summary>
        <${DeckPicker}
          value=${item.decks || []}
          onChange=${(ids) => patch({ ...item, decks: ids, filter: stillThere(item.filter, deckCategories(decks)) })}
          max=${3}
          cardFields=${['prompt', 'answer']}
        />
      </details>

      ${found.length ? html`
        <div class="field">
          <span class="field-label">Which cards</span>
          <div class="chip-strip">
            <button type="button" class=${item.filter ? 'chip' : 'chip is-active'} aria-pressed=${!item.filter}
                    onClick=${() => patch({ ...item, filter: '' })}>Every card</button>
            ${found.map((category) => html`
              <button type="button" key=${category.id} aria-pressed=${item.filter === category.id}
                      class=${item.filter === category.id ? 'chip is-active' : 'chip'}
                      onClick=${() => patch({ ...item, filter: category.id })}>
                ${category.color ? html`<span class="chip-dot" style=${`background:${category.color}`}></span>` : null}
                ${category.name}
              </button>`)}
          </div>
        </div>` : null}
    <//>`;
}

/** A fresh category, with the next colour along so no two start the same. */
function newCategory(existing) {
  const used = new Set(existing.map((category) => category.id));
  let n = existing.length + 1;
  while (used.has(`cat${n}`)) n += 1;
  return { id: `cat${n}`, name: '', color: DEFAULT_COLORS[existing.length % DEFAULT_COLORS.length], emoji: '', decks: [], filter: '' };
}

/** What the closed Cards box says: the decks this category draws from, or an invitation. */
function deckLine(ids, decks) {
  const names = (ids || []).map((id) => (decks[id] && decks[id].title) || id);
  return names.length ? joinWords(names) : 'Choose the cards';
}

/** A filter survives a change of decks only if the new decks still have that category. */
function stillThere(filter, found) {
  return filter && found.some((category) => category.id === filter) ? filter : '';
}

/** A number the way the schema wants it, whatever was typed into the box. */
function clamp(raw, low, high) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return low;
  return Math.max(low, Math.min(high, n));
}

/** A board wants the wider column. The chrome reads this off the screen it just loaded. */
Play.wide = true;
