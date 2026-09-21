// The one place application code imports Preact from.
// Kits, screens, and components write `import { html, useState } from '../app/h.js'`
// (path adjusted for depth) and never touch public/vendor/ directly, so swapping or
// upgrading the renderer is a one-file change.
//
// `html` is htm bound to Preact's `h`, which gives JSX-like templates without a build step:
//   html`<button class="btn" onClick=${go}>Start game</button>`

import { h, render, Fragment, createContext, createRef, cloneElement, toChildArray } from '../vendor/preact.mjs';
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer } from '../vendor/preact-hooks.mjs';
import htm from '../vendor/htm.mjs';

const html = htm.bind(h);

export { html, h, render, Fragment, createContext, createRef, cloneElement, toChildArray };
export { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer };
