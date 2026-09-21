// The one modal in Parlor: a panel that slides up from the bottom of a phone and sits in
// the middle of a wide screen (base.css does that part). Everything that interrupts a
// player uses it, so the keyboard and screen reader behaviour is written once, here.
//
// What "modal" has to mean: focus starts inside, Tab cannot leave, Escape closes, the
// backdrop closes, and when it closes focus goes back to the button that opened it.

import { html, useEffect, useRef } from '../h.js';

/** Everything that can hold focus, in the order the browser would visit it. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let sheetCount = 0;

/**
 * @param {{
 *   title?: string,
 *   onClose: () => void,
 *   children?: any,
 *   label?: string,
 * }} props
 */
export function Sheet({ title, onClose, children, label }) {
  const panel = useRef(null);
  const titleId = useRef(`sheet-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    const element = panel.current;
    const previous = document.activeElement;
    // The page behind must not scroll under the sheet; nested sheets only restore at the last one.
    sheetCount += 1;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const first = element && element.querySelector(FOCUSABLE);
    if (first) first.focus();
    else if (element) element.focus();

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !element) return;
      const targets = Array.from(element.querySelectorAll(FOCUSABLE));
      if (!targets.length) { event.preventDefault(); return; }
      const edge = event.shiftKey ? targets[0] : targets[targets.length - 1];
      if (document.activeElement === edge || !element.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? targets[targets.length - 1] : targets[0]).focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      sheetCount -= 1;
      if (sheetCount === 0) document.body.style.overflow = bodyOverflow;
      if (previous && typeof (/** @type {any} */ (previous).focus) === 'function') /** @type {any} */ (previous).focus();
    };
  }, []);

  // Two roots, not a wrapper: both are position:fixed, and an empty wrapper element would
  // still count as a flex item wherever the sheet happened to be rendered.
  return html`
    <div class="sheet-backdrop" onClick=${onClose}></div>
    <div class="sheet" role="dialog" aria-modal="true" tabindex="-1" ref=${panel}
         aria-label=${title ? null : (label || 'Options')}
         aria-labelledby=${title ? titleId.current : null}>
      <div class="sheet-handle"></div>
      ${title ? html`<h2 class="sheet-title" id=${titleId.current}>${title}</h2>` : null}
      <div class="sheet-body stack">${children}</div>
    </div>`;
}
