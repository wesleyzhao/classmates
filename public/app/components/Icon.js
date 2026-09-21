// The handful of inline SVG icons the shell uses. They are inline rather than a sprite or
// a font because there are eight of them, they all inherit `currentColor`, and a file the
// browser has to fetch before a button is legible is a worse trade than 40 lines here.
//
// Every icon is drawn on a 24 unit grid with round caps at the same stroke weight, so they
// sit together in a row without one looking heavier than the others.

import { html } from '../h.js';

/** Each icon is the list of paths that draw it. Dots are zero-length paths with a round cap. */
const PATHS = {
  chevron: ['M9 5l7 7-7 7'],
  back: ['M15 5l-7 7 7 7'],
  share: ['M12 3v12', 'M8 7l4-4 4 4', 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7'],
  chat: ['M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z'],
  send: ['M5 12h14', 'M13 6l6 6-6 6'],
  menu: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  sound: ['M11 5L6 9H3v6h3l5 4z', 'M15.5 9.5a4 4 0 0 1 0 5', 'M18.5 7a8 8 0 0 1 0 10'],
  mute: ['M11 5L6 9H3v6h3l5 4z', 'M16 10l4 4', 'M20 10l-4 4'],
  copy: ['M9 9h10v10H9z', 'M15 5H5v10'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  undo: ['M8 6l-4 4 4 4', 'M4 10h9a5 5 0 0 1 0 10h-2'],
};

/**
 * One icon, sized by CSS (`.icon` is 18px inside a button) and coloured by its parent.
 * Icons are decoration: the button around them carries the label.
 * @param {{ name: keyof typeof PATHS, class?: string, width?: number }} props
 */
export function Icon({ name, class: className = 'icon', width = 1.8 }) {
  const paths = PATHS[name] || [];
  return html`
    <svg class=${className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width=${name === 'menu' ? 2.6 : width} stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true" focusable="false">
      ${paths.map((d) => html`<path d=${d}></path>`)}
    </svg>`;
}
