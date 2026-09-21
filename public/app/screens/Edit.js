// Editing a game somebody made: the creator's last three screens with the values already in
// them. There is no account behind a game, so the right to change it is the edit key, which
// arrives in the address (`/edit/<id>?key=...`) or out of this device's own list of games.
//
// Built-in games are never editable. They open read only with one button, which copies the
// whole thing into the creator as a game of your own, because "you cannot change this" is a
// dead end and "make your own version" is not.

import { html, useEffect, useState } from '../h.js';
import { api } from '../net.js';
import { navigate } from '../main.js';
import { KITS } from '../../shared/registry.js';
import { addMyGame, myGames } from '../identity.js';
import { useDecks } from '../components/DeckPicker.js';
import { Icon } from '../components/Icon.js';
import { ShareButton, copy } from '../components/ShareButton.js';
import { toast } from '../components/Toast.js';
import { revealFirstProblem } from '../components/Form.js';
import { CardsStep, LookStep, SummaryCard } from './Create.js';
import {
  absolute, deckIdsIn, draftFromGame, editPath, gameBody, gamePath, gameShareText, hasContent,
  nextLabel, stepIssues,
} from '../creator.js';

/** @typedef {import('../creator.js').Draft} Draft */

/** The heading over each editing screen. The last one names what the button does. */
const TITLES = { cards: 'Change the cards', look: 'Settings and look', publish: 'Save your changes' };
const LEDES = {
  cards: 'Rooms already playing keep the cards they started with. New rooms use what you save here.',
  look: 'How it plays, what it is called, and how it looks on the screen.',
  publish: 'Here is the game as it stands. Saving it changes the game behind the link you shared.',
};

/**
 * @param {{ id: string }} props
 */
export function Edit({ id }) {
  const [game, setGame] = useState(/** @type {any} */ (null));
  const [draft, setDraft] = useState(/** @type {Draft | null} */ (null));
  const [problem, setProblem] = useState('');
  const [step, setStep] = useState('cards');
  const [showIssues, setShowIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const editKey = keyFor(id);

  useEffect(() => {
    let live = true;
    api('GET', `/api/games/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!live) return;
        setGame(data.game);
        setDraft(draftFromGame(data.game));
      })
      .catch((err) => { if (live) setProblem(err.message || 'That game would not load. Check the link.'); });
    return () => { live = false; };
  }, [id]);

  if (problem) return html`<${Trouble} title="No game here" line=${problem} />`;
  if (!game || !draft) return html`<main class="page"><${TopBar} /></main>`;

  if (game.builtin) return html`<${ReadOnly} game=${game} line="This game ships with Parlor, so it cannot be changed. You can copy it and change the copy." />`;
  if (!editKey) {
    return html`<${ReadOnly} game=${game}
      line="This device does not hold the edit link for this game. Open the edit link you were given, or copy the game and change the copy." />`;
  }

  const kit = KITS[draft.kitId] || null;
  const steps = hasContent(kit) ? ['cards', 'look', 'publish'] : ['look', 'publish'];
  const index = Math.max(0, steps.indexOf(step));
  const current = steps[index];
  const issues = stepIssues(current, kit, draft);
  const shown = showIssues ? issues : [];

  /** @param {Partial<Draft>} patch */
  function change(patch) {
    setDraft((old) => ({ .../** @type {Draft} */ (old), ...patch }));
    setShowIssues(false);
    setSaved(false);
    setProblem('');
  }

  // Steps are history entries here too, so a back gesture steps back rather than leaving.
  useEffect(() => {
    const onPop = (event) => {
      const wanted = event.state && event.state.step;
      setStep(steps.includes(wanted) ? wanted : steps[0]);
      setShowIssues(false);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [steps.join('/')]);

  function back() {
    if (index === 0) { navigate('/my'); return; }
    if (history.state && history.state.step === current) { history.back(); return; }
    setStep(steps[index - 1]);
    setShowIssues(false);
  }

  function next() {
    if (issues.length) { setShowIssues(true); revealFirstProblem(); return; }
    const to = steps[index + 1];
    history.pushState({ step: to }, '', location.pathname + location.search);
    setStep(to);
    setShowIssues(false);
  }

  async function save() {
    setBusy(true);
    setProblem('');
    try {
      const result = await api('PUT', `/api/games/${encodeURIComponent(game.id)}`, {
        body: gameBody(draft),
        editKey,
      });
      addMyGame({ id: result.game.id, slug: result.game.slug, title: result.game.title, editKey });
      setGame(result.game);
      setSaved(true);
      toast('Saved');
    } catch (err) {
      setProblem(err.message || 'That game would not save. Try again.');
    }
    setBusy(false);
  }

  return html`
    <main class="page">
      <div class="topbar">
        <button class="btn btn-ghost" onClick=${back}>
          <${Icon} name="back" />${index === 0 ? 'Your games' : 'Back'}
        </button>
        <span class="spacer"></span>
        <span class="small ink-2 num">Step ${index + 1} of ${steps.length}</span>
      </div>

      <div class="steps" aria-hidden="true">
        ${steps.map((name, i) => html`<i key=${name} class=${i <= index ? 'is-done' : ''}></i>`)}
      </div>

      <div class="stack">
        <h1 class="display-hero">${TITLES[current]}</h1>
        <p class="lede">${LEDES[current]}</p>
      </div>

      ${problem ? html`<p class="notice notice-bad">${problem}</p>` : null}

      ${current === 'cards' ? html`<${CardsStep} kit=${kit} draft=${draft} onChange=${change} issues=${shown} />` : null}
      ${current === 'look' ? html`<${LookStep} kit=${kit} draft=${draft} onChange=${change} issues=${shown} />` : null}
      ${current === 'publish' ? html`<${SavePanel} kit=${kit} draft=${draft} game=${game} editKey=${editKey} saved=${saved} />` : null}

      <div class="actionbar">
        ${current === 'publish'
          ? html`<button class="btn btn-primary btn-block btn-tall" disabled=${busy} onClick=${save}>Save changes</button>`
          : html`<button class="btn btn-primary btn-block btn-tall" onClick=${next}>${nextLabel(steps, index)}</button>`}
        ${showIssues && issues.length ? html`<p class="actionbar-note">${issues[0].message}</p>` : null}
      </div>
    </main>`;
}

/** The last screen of the editor: what is about to be saved, and the two links once it is. */
function SavePanel({ kit, draft, game, editKey, saved }) {
  const decks = useDecks(deckIdsIn(draft.content));
  const play = absolute(gamePath(game.slug));
  const edit = absolute(editPath(game.id, editKey));
  return html`
    <div class="stack">
      <${SummaryCard} draft=${draft} kit=${kit} decks=${decks} />
      ${saved ? html`<p class="notice">Saved. Anyone opening the link from now on gets this version.</p>` : null}
      <section class="stack">
        <div class="section-head"><h3>The link to play</h3></div>
        <div class="link-box"><span class="link-text">${play}</span></div>
        <div class="btn-group">
          <${ShareButton} class="btn btn-secondary" link=${gameShareText({ slug: game.slug, title: game.title })} />
          <a class="btn btn-secondary" href=${gamePath(game.slug)}>Play it</a>
        </div>
      </section>
      <section class="stack">
        <div class="section-head"><h3>The link to edit</h3></div>
        <div class="link-box"><span class="link-text">${edit}</span></div>
        <button class="btn btn-secondary btn-block" onClick=${() => copy(edit, 'Edit link copied')}>
          <${Icon} name="copy" />Copy the edit link
        </button>
        <p class="small muted">Keep this edit link. Anyone with it can change the game.</p>
      </section>
    </div>`;
}

/** A game this device may look at but not change. The way out is a copy of your own. */
function ReadOnly({ game, line }) {
  const kit = KITS[game.kitId];
  return html`
    <main class="page">
      <${TopBar} />
      <header class="stack center" style="align-items: center">
        <span class="tile" aria-hidden="true">${game.emoji}</span>
        <h1 class="display-hero">${game.title}</h1>
        <p class="lede">${game.description}</p>
      </header>
      <p class="notice">${line}</p>
      <ul class="list">
        <li class="list-row">
          <span class="grow strong">How it plays</span>
          <span class="end">${kit ? kit.name : game.kitId}</span>
        </li>
        <li class="list-row">
          <span class="grow strong">Look</span>
          <span class="end">${game.theme === 'playful' ? 'Playful' : 'Editorial'}</span>
        </li>
      </ul>
      <div class="actionbar">
        <a class="btn btn-primary btn-block btn-tall" href=${`/create?remix=${encodeURIComponent(game.id)}`}>
          Make my own version
        </a>
        <p class="actionbar-note">It opens the creator with everything filled in, as a copy you own.</p>
      </div>
    </main>`;
}

function Trouble({ title, line }) {
  return html`
    <main class="page">
      <${TopBar} />
      <div class="stack">
        <h1>${title}</h1>
        <p class="lede">${line}</p>
      </div>
      <div class="actionbar">
        <a class="btn btn-primary btn-block btn-tall" href="/my">Your games</a>
      </div>
    </main>`;
}

function TopBar() {
  return html`
    <div class="topbar">
      <a class="btn btn-ghost" href="/"><${Icon} name="back" />Parlor</a>
    </div>`;
}

/**
 * The edit key for this game: the one in the address if there is one, otherwise the one this
 * device kept when it made the game. The address wins, because that is the link somebody was
 * sent and it is the only way a second device ever gets to edit anything.
 * @param {string} id
 */
function keyFor(id) {
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const fromLink = params.get('key');
  if (fromLink) return fromLink;
  const mine = myGames().find((game) => game.id === id || game.slug === id);
  return (mine && mine.editKey) || '';
}
