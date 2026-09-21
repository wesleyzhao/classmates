// The creator: four screens, one decision each, and a published game at the end. What kind of
// game, which cards, what it is called and how it looks, then publish.
//
// Two things keep it honest. The state is one draft object mirrored to sessionStorage on every
// keystroke, so a reload in the middle of typing twenty settings loses nothing. And every step
// is checked against the kit's own schema before the button at the bottom lets anyone past, so
// the server's refusal is the second line of defence rather than the first thing a maker meets.
//
// The step bodies are exported because the game editor (Edit.js) is the same three screens with
// the values already in them, and two copies of a schema form would drift within a week.

import { html, useEffect, useState } from '../h.js';
import { api } from '../net.js';
import { navigate } from '../main.js';
import { KITS, kitUiPath } from '../../shared/registry.js';
import { defaults } from '../../shared/schema.js';
import { addMyGame, me } from '../identity.js';
import { DeckPicker, useDecks } from '../components/DeckPicker.js';
import { Form, revealFirstProblem } from '../components/Form.js';
import { Icon } from '../components/Icon.js';
import { ShareButton, copy } from '../components/ShareButton.js';
import {
  GAME_FIELDS, STEP_LEDES, STEP_TITLES, absolute, clearDraft, deckIdsIn, draftFromGame, editPath,
  emptyDraft, gameBody, gamePath, gameShareText, loadDraft, loadStep, lookValue, nextLabel,
  playersLine, saveDraft, saveStep, stepIssues, stepList, summaryRows, visibleKits,
} from '../creator.js';

/** @typedef {import('../creator.js').Draft} Draft */

/**
 * A simple line drawing per kit: a card, a wheel, two cards. Anything without one gets the
 * card, which is what most mechanics look like from a distance anyway.
 * @type {Record<string, string[]>}
 */
const KIT_ART = {
  quiz: ['M3.5 6.5h17a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z', 'M8 12h8'],
  board: ['M12 3.2a8.8 8.8 0 1 1 0 17.6 8.8 8.8 0 0 1 0-17.6z', 'M12 3.2v17.6', 'M3.2 12h17.6', 'M12 9.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z'],
  cards: ['M9 7.5h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z', 'M5.2 16.5v-11a1 1 0 0 1 1-1H14'],
};
const DEFAULT_ART = KIT_ART.quiz;

/**
 * The two looks, as they describe themselves on the look step.
 * @type {Array<{ id: 'editorial' | 'playful', name: string, line: string }>}
 */
const THEMES = [
  { id: 'editorial', name: 'Editorial', line: 'Paper, ink and a serif. Nothing shouts.' },
  { id: 'playful', name: 'Playful', line: 'Rounded, bright and loud.' },
];

export function Create() {
  const [draft, setDraft] = useState(startingDraft);
  const [step, setStep] = useState(() => startingStep());
  const [showIssues, setShowIssues] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(/** @type {{ game: any, editKey: string } | null} */ (null));

  const kit = KITS[draft.kitId] || null;
  const steps = stepList(kit);
  const index = Math.max(0, steps.indexOf(step));
  const current = steps[index];
  const issues = stepIssues(current, kit, draft);

  useEffect(() => { saveDraft(draft); }, [draft]);
  useEffect(() => { saveStep(current); }, [current]);

  // A remix arrives as an address, so the game it copies is fetched before anything is drawn.
  useEffect(() => {
    const remix = query().get('remix');
    if (!remix) return undefined;
    let live = true;
    api('GET', `/api/games/${encodeURIComponent(remix)}`)
      .then((data) => { if (live && data.game) setDraft(draftFromGame(data.game, { copy: true })); })
      .catch(() => { if (live) setProblem('That game would not load, so there is nothing to copy yet.'); });
    return () => { live = false; };
  }, []);

  /** @param {Partial<Draft>} patch */
  function change(patch) {
    setDraft((old) => ({ ...old, ...patch }));
    setShowIssues(false);
    setProblem('');
  }

  /** Changing the kit starts its settings and content over: another kit's values mean nothing here. */
  function chooseKit(kitId) {
    const chosen = KITS[kitId];
    if (!chosen) return;
    setDraft((old) => ({
      ...old,
      kitId,
      config: defaults(chosen.config || {}),
      content: preselect(defaults(chosen.content || {}), chosen, query().get('deck')),
    }));
    setShowIssues(false);
  }

  // Each step forward is a history entry, so the browser's back button (or a phone's back
  // swipe) returns to the previous step instead of leaving the creator altogether.
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
    if (index === 0) { navigate('/'); return; }
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

  async function publish() {
    setBusy(true);
    setProblem('');
    try {
      const result = await api('POST', '/api/games', { body: gameBody(draft, me().id) });
      addMyGame({
        id: result.game.id,
        slug: result.game.slug,
        title: result.game.title,
        editKey: result.editKey,
      });
      clearDraft();
      setPublished({ game: result.game, editKey: result.editKey });
    } catch (err) {
      setProblem(err.message || 'That game would not save. Try again.');
    }
    setBusy(false);
  }

  if (published) return html`<${Published} game=${published.game} editKey=${published.editKey} />`;

  const shown = showIssues ? issues : [];

  return html`
    <main class="page">
      <div class="topbar">
        <button class="btn btn-ghost" onClick=${back}>
          <${Icon} name="back" />${index === 0 ? 'Parlor' : 'Back'}
        </button>
        <span class="spacer"></span>
        <span class="small ink-2 num">Step ${index + 1} of ${steps.length}</span>
      </div>

      <div class="steps" aria-hidden="true">
        ${steps.map((name, i) => html`<i key=${name} class=${i <= index ? 'is-done' : ''}></i>`)}
      </div>

      <div class="stack">
        <h1 class="display-hero">${STEP_TITLES[current]}</h1>
        <p class="lede">${STEP_LEDES[current]}</p>
      </div>

      ${problem ? html`<p class="notice notice-bad">${problem}</p>` : null}

      ${current === 'kind' ? html`<${KindStep} kitId=${draft.kitId} onChange=${chooseKit} />` : null}
      ${current === 'cards' ? html`<${CardsStep} kit=${kit} draft=${draft} onChange=${change} issues=${shown} />` : null}
      ${current === 'look' ? html`<${LookStep} kit=${kit} draft=${draft} onChange=${change} issues=${shown} />` : null}
      ${current === 'publish' ? html`<${PublishStep} kit=${kit} draft=${draft} />` : null}

      <div class="actionbar">
        ${current === 'publish'
          ? html`<button class="btn btn-primary btn-block btn-tall" disabled=${busy} onClick=${publish}>Publish game</button>`
          : html`<button class="btn btn-primary btn-block btn-tall" onClick=${next}>${nextLabel(steps, index)}</button>`}
        ${showIssues && issues.length
          ? html`<p class="actionbar-note">${issues[0].message}</p>`
          : null}
      </div>
    </main>`;
}

/** Step one: one card per kit, the chosen one outlined. */
function KindStep({ kitId, onChange }) {
  return html`
    <div class="option-list">
      ${visibleKits(KITS).map((kit) => html`
        <button type="button" key=${kit.id} class="option-card" aria-pressed=${kit.id === kitId}
                onClick=${() => onChange(kit.id)}>
          <svg class="option-art" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            ${(KIT_ART[kit.id] || DEFAULT_ART).map((d, i) => html`<path key=${i} d=${d}></path>`)}
          </svg>
          <span class="option-text grow">
            <span class="title">${kit.name}</span>
            <span class="sub">${kit.tagline}</span>
            <span class="meta">${playersLine(kit)}</span>
          </span>
        </button>`)}
    </div>`;
}

/**
 * Step two: the kit's content schema, and the kit's own editor under it when it ships one.
 * @param {{ kit: any, draft: Draft, onChange: (patch: Partial<Draft>) => void, issues: any[] }} props
 */
export function CardsStep({ kit, draft, onChange, issues }) {
  const decks = useDecks(deckIdsIn(draft.content));
  const kitUi = useKitEditor(kit ? kit.id : '');
  if (!kit) return html`<p class="notice notice-bad">This game is built on a kit this browser does not have.</p>`;
  const schema = platformFields(kit.content || {}, kitUi);

  return html`
    <div class="stack-loose stack">
      ${Object.keys(schema).length ? html`
        <${Form} schema=${schema} value=${draft.content} issues=${issues} config=${draft.config}
                 onChange=${(content) => onChange({ content })} />` : null}
      ${kitUi.Editor ? html`
        <div class="stack">
          ${Object.keys(schema).length ? html`<hr class="rule" />` : null}
          <${kitUi.Editor} content=${draft.content} config=${draft.config} decks=${decks}
                           onChange=${(content) => onChange({ content })} />
        </div>` : null}
    </div>`;
}

/**
 * The content fields the platform draws itself.
 *
 * A kit that ships an `Editor` is the authority on its own content (docs/KIT-CONTRACT.md), so
 * the schema form steps back and draws only the `decks` fields, which no kit may draw: choosing
 * a deck means knowing about built-in decks and about the decks on this device, and a kit knows
 * about neither. A kit that wants both can say exactly which fields its editor covers by
 * exporting `EDITOR_FIELDS` from its `ui.js`; everything not named there stays on the form.
 * @param {import('../../../types/parlor.js').Schema} content
 * @param {{ Editor: any, fields: string[] | null }} kitUi
 */
function platformFields(content, kitUi) {
  if (!kitUi.Editor) return content;
  /** @type {import('../../../types/parlor.js').Schema} */
  const out = {};
  for (const [name, field] of Object.entries(content)) {
    const claimed = kitUi.fields ? kitUi.fields.includes(name) : field.type !== 'decks';
    if (!claimed) out[name] = field;
  }
  return out;
}

/**
 * Step three: the kit's settings, then the name, the look and the accent.
 * @param {{ kit: any, draft: Draft, onChange: (patch: Partial<Draft>) => void, issues: any[] }} props
 */
export function LookStep({ kit, draft, onChange, issues }) {
  const settings = kit && Object.keys(kit.config || {}).length ? kit.config : null;
  return html`
    <div class="stack-loose stack">
      ${settings ? html`
        <${Form} schema=${settings} value=${draft.config} issues=${issues}
                 onChange=${(config) => onChange({ config })} />
        <hr class="rule" />` : null}

      <${Form} schema=${GAME_FIELDS} value=${lookValue(draft)} issues=${issues}
               onChange=${(look) => onChange(look)} />

      <div class="field">
        <span class="field-label" id="theme-label">Theme</span>
        <p class="field-help">It sets the colors and the type for everyone at the table.</p>
        <div class="option-pair" role="group" aria-labelledby="theme-label">
          ${THEMES.map((theme) => html`
            <button type="button" key=${theme.id} class="option-card" aria-pressed=${draft.theme === theme.id}
                    onClick=${() => onChange({ theme: theme.id })}>
              <span class=${`theme-thumb is-${theme.id}`} aria-hidden="true">
                <i class="bar-title"></i>
                <i class="bar-line"></i>
                <i class="bar-line"></i>
                <i class="bar-btn"></i>
              </span>
              <span class="option-text">
                <span class="title">${theme.name}</span>
                <span class="sub">${theme.line}</span>
              </span>
            </button>`)}
        </div>
      </div>
    </div>`;
}

/** Step four: what is about to be published, before it is. */
function PublishStep({ kit, draft }) {
  const decks = useDecks(deckIdsIn(draft.content));
  return html`
    <div class="stack">
      <${SummaryCard} draft=${draft} kit=${kit} decks=${decks} />
      <p class="small muted">Games made here are not listed on the home screen. Yours is shared by its link.</p>
    </div>`;
}

/**
 * The game as it will be, in one box: the emoji, the name, and four lines about it.
 * @param {{ draft: Draft, kit: any, decks: Record<string, any> }} props
 */
export function SummaryCard({ draft, kit, decks }) {
  return html`
    <div class="panel">
      <div class="row">
        <span class="tile" aria-hidden="true">${draft.emoji}</span>
        <div class="grow">
          <div class="title">${draft.title || 'A game with no name'}</div>
          ${draft.description ? html`<div class="sub">${draft.description}</div>` : null}
        </div>
      </div>
      <ul class="list">
        ${summaryRows(draft, kit, decks).map((row) => html`
          <li class="list-row" key=${row.label}>
            <span class="grow strong">${row.label}</span>
            <span class="end">${row.value}</span>
          </li>`)}
      </ul>
    </div>`;
}

/** What a maker sees the moment a game exists: two links, and the way into the first room. */
function Published({ game, editKey }) {
  const play = absolute(gamePath(game.slug));
  const edit = absolute(editPath(game.id, editKey));
  return html`
    <main class="page">
      <div class="topbar">
        <a class="btn btn-ghost" href="/"><${Icon} name="back" />Parlor</a>
      </div>

      <header class="stack center" style="align-items: center">
        <span class="tile" aria-hidden="true">${game.emoji}</span>
        <h1 class="display-hero">${game.title} is published</h1>
        <p class="lede">Send the first link to whoever is playing. Keep the second one somewhere safe.</p>
      </header>

      <section class="stack">
        <div class="section-head"><h3>The link to play</h3></div>
        <div class="link-box"><span class="link-text">${play}</span></div>
        <${ShareButton} class="btn btn-secondary btn-block"
                        link=${gameShareText({ slug: game.slug, title: game.title })} />
      </section>

      <section class="stack">
        <div class="section-head"><h3>The link to edit</h3></div>
        <div class="link-box"><span class="link-text">${edit}</span></div>
        <button class="btn btn-secondary btn-block" onClick=${() => copy(edit, 'Edit link copied')}>
          <${Icon} name="copy" />Copy the edit link
        </button>
        <p class="small muted">Keep this edit link. Anyone with it can change the game.</p>
      </section>

      <div class="actionbar">
        <a class="btn btn-primary btn-block btn-tall" href=${gamePath(game.slug)}>Play it</a>
        <p class="actionbar-note">It is saved on this device under your games.</p>
      </div>
    </main>`;
}

/**
 * A kit's own editor and the content fields it says it covers. A kit that ships no `ui.js`, or
 * one whose screen has no `Editor`, gets the schema form and nothing else, which is enough for
 * most kits.
 * @param {string} kitId
 * @returns {{ Editor: any, fields: string[] | null }}
 */
function useKitEditor(kitId) {
  const [state, setState] = useState(/** @type {{ Editor: any, fields: string[] | null }} */ ({ Editor: null, fields: null }));
  useEffect(() => {
    let live = true;
    setState({ Editor: null, fields: null });
    if (!kitId || !/^[a-z0-9][a-z0-9-]{0,30}$/.test(kitId)) return undefined;
    import(kitUiPath(kitId))
      .then((module) => {
        if (!live || typeof module.Editor !== 'function') return;
        const fields = Array.isArray(module.EDITOR_FIELDS) ? module.EDITOR_FIELDS.map(String) : null;
        setState({ Editor: module.Editor, fields });
      })
      .catch(() => { /* A kit with no screen module still has a schema, which is the form above. */ });
    return () => { live = false; };
  }, [kitId]);
  return state;
}

/**
 * The draft this screen opens with: a saved one, or a fresh one on the first visible kit.
 * @returns {Draft}
 */
function startingDraft() {
  const params = query();
  const saved = params.get('remix') ? null : loadDraft();
  if (saved && KITS[saved.kitId]) return withDeck(saved, params.get('deck'));
  const base = emptyDraft();
  const first = visibleKits(KITS)[0];
  const kit = KITS[params.get('kit') || ''] || first;
  if (!kit) return base;
  base.kitId = kit.id;
  base.config = defaults(kit.config || {});
  base.content = defaults(kit.content || {});
  return withDeck(base, params.get('deck'));
}

/** Where a reload lands. A remix always starts at the beginning, because it is a new game. */
function startingStep() {
  if (query().get('remix')) return 'kind';
  return loadStep() || 'kind';
}

/** @param {Draft} draft @param {string | null} deckId @returns {Draft} */
function withDeck(draft, deckId) {
  const kit = KITS[draft.kitId];
  if (!kit || !deckId) return draft;
  return { ...draft, content: preselect(draft.content, kit, deckId) };
}

/**
 * A deck the maker arrived with, dropped into the kit's own deck field. Only a top level
 * `decks` field is filled in: a board game keeps its decks inside its categories, and guessing
 * which category a deck belongs to would be worse than letting them choose.
 */
function preselect(content, kit, deckId) {
  const field = (kit.content || {}).decks;
  if (!deckId || !field || field.type !== 'decks') return content;
  const current = Array.isArray(content.decks) ? content.decks : [];
  if (current.includes(deckId)) return content;
  return { ...content, decks: [...current, deckId] };
}

function query() {
  return new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
}
