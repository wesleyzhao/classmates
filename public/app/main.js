// The client's entry point: a small history router, and the boot that mounts it.
//
// There are seven addresses in Parlor and they are all readable out loud, because people
// share them: `/` , `/g/flags-of-europe`, `/r/MKRT`. Matching them is a pure function
// (`matchRoute`) so it can be tested without a browser, and each screen is fetched with a
// dynamic import the first time it is needed, so opening a room link does not also
// download the creator.

import { html, render, useEffect, useState } from './h.js';
import { api } from './net.js';
import { primeOnGesture } from './sound.js';
import { ToastRoot } from './components/Toast.js';

/**
 * Every address the client answers to. Order matters only in that the first match wins,
 * and no two patterns here can match the same path.
 */
const ROUTES = [
  { pattern: '/', name: 'home' },
  { pattern: '/g/:slug', name: 'game' },
  { pattern: '/r/:code', name: 'room' },
  { pattern: '/create', name: 'create' },
  { pattern: '/edit/:id', name: 'edit' },
  { pattern: '/decks/:id', name: 'decks' },
  { pattern: '/my', name: 'my' },
];

/** Which module each screen lives in. Loaded once and remembered. */
const LOADERS = {
  home: () => import('./screens/Home.js').then((m) => m.Home),
  game: () => import('./screens/GamePage.js').then((m) => m.GamePage),
  room: () => import('./screens/Room.js').then((m) => m.Room),
  create: () => import('./screens/Create.js').then((m) => m.Create),
  edit: () => import('./screens/Edit.js').then((m) => m.Edit),
  decks: () => import('./screens/DeckEditor.js').then((m) => m.DeckEditor),
  my: () => import('./screens/MyGames.js').then((m) => m.MyGames),
  notFound: () => import('./screens/NotFound.js').then((m) => m.NotFound),
};

/** @type {Map<string, any>} */
const loaded = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();

/**
 * Which screen a path names, and the pieces of the path it carries.
 * Pure: no history, no location, no side effects, so tests can call it directly.
 * @param {string} path  e.g. '/r/MKRT?x=1'
 * @returns {{ name: string, params: Record<string, string> }}
 */
export function matchRoute(path) {
  const bare = String(path || '/').split('?')[0].split('#')[0];
  const parts = bare.split('/').filter(Boolean);
  for (const route of ROUTES) {
    const wanted = route.pattern.split('/').filter(Boolean);
    if (wanted.length !== parts.length) continue;
    /** @type {Record<string, string>} */
    const params = {};
    let matched = true;
    for (let i = 0; i < wanted.length; i += 1) {
      const piece = wanted[i];
      if (piece.startsWith(':')) params[piece.slice(1)] = safeDecode(parts[i]);
      else if (piece.toLowerCase() !== parts[i].toLowerCase()) { matched = false; break; }
    }
    if (matched) return { name: route.name, params };
  }
  return { name: 'notFound', params: {} };
}

/**
 * Go somewhere, without a page load.
 * @param {string} path  a path on this site, starting with '/'
 * @param {{ replace?: boolean }} [options]  replace leaves no entry in the back button
 */
export function navigate(path, options = {}) {
  if (typeof history === 'undefined') return;
  const url = String(path || '/');
  if (url === location.pathname + location.search) return;
  if (options.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  for (const listener of listeners) listener();
}

/** The whole client: one screen, plus the toasts that sit over every screen. */
function App() {
  const [route, setRoute] = useState(() => matchRoute(location.pathname));

  useEffect(() => {
    const onChange = () => setRoute(matchRoute(location.pathname));
    listeners.add(onChange);
    addEventListener('popstate', onChange);
    return () => { listeners.delete(onChange); removeEventListener('popstate', onChange); };
  }, []);

  const key = `${route.name}:${Object.values(route.params).join('/')}`;
  // A new screen starts at the top, the way a new page would.
  useEffect(() => { scrollTo(0, 0); }, [key]);

  const Screen = useScreen(route.name);
  const props = screenProps(route);

  return html`
    <div class="app">
      ${Screen ? html`<${Screen} key=${key} ...${props} />` : null}
    </div>
    <${ToastRoot} />`;
}

/**
 * What each screen is given. The creator's screens take the piece of the path they work on:
 * a game to edit, a deck to edit, or `new` for a deck that does not exist yet.
 */
function screenProps(route) {
  if (route.name === 'game') return { slug: route.params.slug };
  if (route.name === 'room') return { code: String(route.params.code || '').toUpperCase() };
  if (route.name === 'edit' || route.name === 'decks') return { id: String(route.params.id || '') };
  return {};
}

/** The screen component for a route name, fetched the first time it is asked for. */
function useScreen(name) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (loaded.has(name)) return undefined;
    let live = true;
    const load = LOADERS[name] || LOADERS.notFound;
    load().then((component) => {
      loaded.set(name, component);
      if (live) bump((n) => n + 1);
    }).catch(() => {
      // A screen that will not download is almost always a stale tab after a deploy.
      if (live) location.reload();
    });
    return () => { live = false; };
  }, [name]);
  // Read from the cache on every render rather than from state, so the render that changes
  // the route never hands the old screen the new route's props (the game page briefly mounted
  // with a room code and asked the server for a game called "undefined").
  return loaded.get(name) || null;
}

/**
 * Turn same-origin link clicks into navigations. Links stay real links, so they can be
 * opened in a new tab, copied, and read by anything that reads a page.
 */
function interceptLinks() {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = /** @type {Element | null} */ (event.target);
    const anchor = target && target.closest ? target.closest('a') : null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!href || href.startsWith('#') || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    if (anchor.origin !== location.origin) return;
    event.preventDefault();
    navigate(anchor.pathname + anchor.search);
  });
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Mount the app.
 * @param {Element} mount
 */
export function start(mount) {
  interceptLinks();
  render(html`<${App} />`, mount);
  // The database sleeps when nobody is playing; this wakes it while someone reads the
  // home screen, so the first room they open does not pay for the cold start.
  api('GET', '/api/health').catch(() => {});
  primeOnGesture();
}

// Boot only in a browser, and only on the real page: the dev screens harness and the tests
// import this module for `matchRoute` and must not get an app rendered underneath them.
if (typeof document !== 'undefined') {
  const mount = document.getElementById('app');
  if (mount) start(mount);
}
