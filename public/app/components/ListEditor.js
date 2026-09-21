// A list somebody edits by hand: the cards in a deck, the categories on a board, the aliases
// on a card. It owns the row chrome (the number, move up, move down, remove, add) and knows
// nothing about what is in a row, which is drawn by the `renderItem` the caller passes.
//
// Two decisions worth knowing. There is no drag reordering: dragging on a phone fights the
// page scroll, and two buttons work with a finger, a keyboard and a screen reader alike.
// And a list with a `parseLine` gets a paste box, because anyone typing twenty cards already
// has them in a notes app and retyping them is the reason they give up halfway.

import { html, useState } from '../h.js';

/**
 * @template T
 * @param {{
 *   items: T[],
 *   onChange: (items: T[]) => void,
 *   renderItem: (item: T, index: number, patch: (next: T) => void) => any,
 *   addLabel?: string,
 *   noun?: [string, string],
 *   empty?: string,
 *   max?: number,
 *   newItem?: () => T,
 *   parseLine?: (line: string) => T | null,
 *   pasteLabel?: string,
 *   pasteHelp?: string,
 *   rowLabel?: (item: T, index: number) => string,
 *   rowKey?: (item: T, index: number) => string,
 * }} props
 *   `items` is the list as it stands and `onChange` gets the whole new list, never a patch.
 *   `renderItem` is handed one item, its index, and a `patch` that replaces that item.
 *   `newItem` makes the item the add button appends (an empty string by default).
 *   `parseLine` turns one pasted line into an item, or returns null to skip it; passing it is
 *   what puts the paste box on the screen.
 *   `rowLabel` names a row in place of its number, for lists where the number means nothing.
 *   `rowKey` gives a row an identity of its own. Without it rows are keyed by position, which
 *   is fine until a row holds state of its own (a half-typed field) and somebody moves it.
 */
export function ListEditor({
  items,
  onChange,
  renderItem,
  addLabel = 'Add one',
  noun = ['row', 'rows'],
  empty = 'Nothing here yet.',
  max,
  newItem,
  parseLine,
  pasteLabel = 'Paste a list',
  pasteHelp = '',
  rowLabel,
  rowKey,
}) {
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [note, setNote] = useState('');
  const list = Array.isArray(items) ? items : [];
  const full = typeof max === 'number' && list.length >= max;

  /** @param {number} index @param {any} next */
  function patch(index, next) {
    onChange(list.map((item, i) => (i === index ? next : item)));
  }

  function add() {
    if (full) return;
    onChange([...list, newItem ? newItem() : /** @type {any} */ ('')]);
  }

  /** @param {number} index */
  function removeAt(index) {
    onChange(list.filter((_, i) => i !== index));
  }

  /** @param {number} index @param {number} step  -1 is up, 1 is down */
  function move(index, step) {
    const target = index + step;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function addPasted() {
    const lines = pasted.split('\n');
    /** @type {any[]} */
    const made = [];
    let skipped = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const item = parseLine ? parseLine(line) : null;
      if (item) made.push(item);
      else skipped += 1;
    }
    const room = typeof max === 'number' ? Math.max(0, max - list.length) : made.length;
    const taken = made.slice(0, room);
    onChange([...list, ...taken]);
    setPasted('');
    setNote(pasteNote(taken.length, skipped, made.length - taken.length, noun));
  }

  return html`
    <div class="stack">
      ${list.length ? html`
        <ul class="list-editor">
          ${list.map((item, index) => html`
            <li class="list-item surface" key=${rowKey ? rowKey(item, index) : index}>
              <div class="list-item-head">
                <span class="small muted num">${rowLabel ? rowLabel(item, index) : index + 1}</span>
                <span class="spacer"></span>
                <button type="button" class="btn btn-ghost btn-sm" disabled=${index === 0}
                        aria-label=${`Move ${rowName(rowLabel, item, index)} up`}
                        onClick=${() => move(index, -1)}>Up</button>
                <button type="button" class="btn btn-ghost btn-sm" disabled=${index === list.length - 1}
                        aria-label=${`Move ${rowName(rowLabel, item, index)} down`}
                        onClick=${() => move(index, 1)}>Down</button>
                <button type="button" class="btn btn-ghost btn-sm"
                        aria-label=${`Remove ${rowName(rowLabel, item, index)}`}
                        onClick=${() => removeAt(index)}>Remove</button>
              </div>
              <div class="stack">${renderItem(item, index, (next) => patch(index, next))}</div>
            </li>`)}
        </ul>`
        : html`<p class="empty">${empty}</p>`}

      <div class="row row-wrap">
        <button type="button" class="btn btn-secondary" disabled=${full} onClick=${add}>${addLabel}</button>
        ${parseLine ? html`
          <button type="button" class="btn btn-ghost" onClick=${() => { setPasting(!pasting); setNote(''); }}>
            ${pasting ? 'Hide the paste box' : pasteLabel}
          </button>` : null}
      </div>

      ${full ? html`<p class="field-help">That is the most this list takes (${max}).</p>` : null}

      ${pasting && parseLine ? html`
        <div class="field">
          <label class="field-label" for="paste-box">One per line</label>
          ${pasteHelp ? html`<p class="field-help">${pasteHelp}</p>` : null}
          <textarea class="input" id="paste-box" rows="6" value=${pasted}
                    onInput=${(e) => setPasted(e.currentTarget.value)}></textarea>
          <div class="row">
            <button type="button" class="btn btn-primary" disabled=${!pasted.trim()} onClick=${addPasted}>Add these</button>
          </div>
        </div>` : null}

      ${note ? html`<p class="notice">${note}</p>` : null}
    </div>`;
}

/** What the paste box says it did. It always says the number, because a silent skip is a bug. */
function pasteNote(added, skipped, overflow, noun = ['row', 'rows']) {
  const parts = [`Added ${added} ${added === 1 ? noun[0] : noun[1]}`];
  if (skipped) parts.push(`skipped ${skipped} ${skipped === 1 ? 'line it could not read' : 'lines it could not read'}`);
  if (overflow) parts.push(`left out ${overflow} that would not fit`);
  return `${parts.join(', ')}.`;
}

/** The name a move or remove button says out loud, for anyone who cannot see the row. */
function rowName(rowLabel, item, index) {
  return rowLabel ? String(rowLabel(item, index)) : `row ${index + 1}`;
}
