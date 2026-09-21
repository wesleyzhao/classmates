// One short sentence at the bottom of the screen, then gone. Toasts are for things that
// happened and need no answer ("Link copied"); anything a player must decide belongs in a
// Sheet, and anything they must fix belongs next to the thing that is wrong.
//
// The queue lives outside the component so any module can call toast() without holding a
// reference to the UI, and so two toasts fired at once are read one after the other rather
// than fighting over the same corner.

import { html, useEffect, useState } from '../h.js';

/** How long one toast stays up. Long enough to read six words, short enough to ignore. */
const LIFETIME = 2500;

/** @type {Set<(item: { id: number, text: string, bad: boolean } | null) => void>} */
const listeners = new Set();
/** @type {Array<{ id: number, text: string, bad: boolean }>} */
let queue = [];
/** @type {{ id: number, text: string, bad: boolean } | null} */
let showing = null;
let nextId = 1;
/** @type {any} */
let timer = null;

/**
 * Say something happened.
 * @param {string} text  a full sentence, or two or three words that read as one
 * @param {{ bad?: boolean }} [options]  bad turns it red; use it when something did not work
 */
export function toast(text, options = {}) {
  const line = String(text || '').trim();
  if (!line) return;
  queue.push({ id: nextId++, text: line, bad: !!options.bad });
  pump();
}

/** Drop anything queued. Used when a screen goes away and its news is no longer news. */
export function clearToasts() {
  queue = [];
  showing = null;
  clearTimeout(timer);
  emit();
}

function pump() {
  if (showing || !queue.length) return;
  showing = queue.shift() || null;
  emit();
  timer = setTimeout(() => {
    showing = null;
    emit();
    pump();
  }, LIFETIME);
}

function emit() {
  for (const listener of listeners) listener(showing);
}

/**
 * The one place toasts are drawn. App renders it once, above every screen.
 * It is a live region so a screen reader hears the message without being moved to it.
 */
export function ToastRoot() {
  const [item, setItem] = useState(showing);
  useEffect(() => {
    listeners.add(setItem);
    return () => { listeners.delete(setItem); };
  }, []);
  return html`
    <div class="toast-root" role="status" aria-live="polite">
      ${item ? html`<div class=${item.bad ? 'toast toast-bad' : 'toast'} key=${item.id}>${item.text}</div>` : null}
    </div>`;
}
