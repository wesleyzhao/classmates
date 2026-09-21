// A form drawn from a schema. One kit definition (public/shared/schema.js) already decides what
// the server will accept and what the docs print; this makes it decide what the creator shows,
// so a kit that adds a setting gets a control for it without anybody editing a screen.
//
// Three rules hold everywhere. A field with a `when` that does not match is not on the screen at
// all, because the server ignores it too and an input nobody's answer reaches is a trap. Every
// issue from `validate` is drawn under the field its path names, never in a list at the top.
// And every control is a finger tall (44 px) with 16 px text, which is what keeps iOS from
// zooming the page the moment somebody taps an input.

import { html } from '../h.js';
import { whenMatches } from '../../shared/schema.js';
import { DeckPicker } from './DeckPicker.js';
import { ListEditor } from './ListEditor.js';

/** @typedef {import('../../../types/parlor.js').Field} Field */
/** @typedef {import('../../../types/parlor.js').Schema} Schema */
/** @typedef {import('../../../types/parlor.js').ValidationIssue} ValidationIssue */

/** Twelve colours that sit well on both themes. A maker who wants another types it in. */
export const PALETTE = [
  '#111111', '#5c5852', '#c8322b', '#e07b39',
  '#e0a81a', '#1f7a4d', '#2fc57b', '#0f7b8a',
  '#2456f5', '#6d4cff', '#b4459e', '#7a5230',
];

/** Emoji that turn up on games and cards often enough to be worth one tap. */
export const COMMON_EMOJI = [
  '\u{1F3B2}', '\u{1F9E0}', '\u{1F5FA}', '\u{1F3AC}', '\u{1F3B5}', '\u{1F4DA}',
  '\u{1F3C6}', '\u{26BD}', '\u{1F52C}', '\u{1F3A8}', '\u{1F37F}', '\u{1F415}',
  '\u{1F420}', '\u{1F332}', '\u{2B50}', '\u{1F680}',
];

/** A choice with more options than this, or a longer label than that, gets a menu instead. */
const SEGMENT_MAX = 3;
const SEGMENT_LABEL_MAX = 16;

/**
 * Every field of a schema, in the order the schema names them.
 * @param {{
 *   schema: Schema,
 *   value: Record<string, any>,
 *   onChange: (value: Record<string, any>) => void,
 *   issues?: ValidationIssue[],
 *   config?: Record<string, any>,
 *   path?: string,
 * }} props
 *   `value` is the whole object this schema describes and `onChange` gets the whole new object.
 *   `issues` come from `validate`; each is drawn under the field its `path` names.
 *   `config` resolves a content field whose `when` reads `$config.x`.
 *   `path` prefixes the paths this form compares against, for a schema nested inside another.
 */
export function Form({ schema, value, onChange, issues, config, path = '' }) {
  const current = value && typeof value === 'object' ? value : {};
  const entries = Object.entries(schema || {});
  return html`
    <div class="stack">
      ${entries.map(([name, field]) => {
        if (field.when && !whenMatches(field.when, current, config)) return null;
        const fieldPath = path ? `${path}.${name}` : name;
        return html`
          <${FormField}
            key=${name}
            name=${name}
            field=${field}
            value=${current[name]}
            issues=${issues}
            config=${config}
            path=${fieldPath}
            onChange=${(next) => onChange({ ...current, [name]: next })} />`;
      })}
    </div>`;
}

/**
 * One labelled field: its name, its help, its control, and anything wrong with it.
 * @param {{ name: string, field: Field, value: any, onChange: (next: any) => void,
 *   issues?: ValidationIssue[], config?: Record<string, any>, path: string }} props
 */
function FormField({ name, field, value, onChange, issues, config, path }) {
  const id = controlId(path);
  const mine = (issues || []).filter((issue) => issue.path === path);
  const help = field.help ? `${id}-help` : null;
  const error = mine.length ? `${id}-error` : null;
  const label = field.label || name;
  const describedBy = [help, error].filter(Boolean).join(' ') || null;

  return html`
    <div class=${mine.length ? 'field is-invalid' : 'field'}>
      ${labelFor(field)
        ? html`<label class="field-label" id=${`${id}-label`} for=${id}>${label}</label>`
        : html`<span class="field-label" id=${`${id}-label`}>${label}</span>`}
      ${field.help ? html`<p class="field-help" id=${help}>${field.help}</p>` : null}
      <${Control} field=${field} value=${value} onChange=${onChange} id=${id} path=${path}
                  issues=${issues} config=${config} describedBy=${describedBy} />
      ${mine.map((issue, i) => html`<p class="field-error" id=${i === 0 ? error : null} key=${i}>${issue.message}</p>`)}
    </div>`;
}

/** Only a real input can be pointed at by a label's `for`; a group of buttons gets a span. */
function labelFor(field) {
  return ['text', 'longtext', 'number', 'image', 'ref', 'emoji'].includes(field.type)
    || (field.type === 'choice' && !isSegmented(field));
}

/**
 * The control itself. Every branch takes the value it is given and hands back the value the
 * schema would accept, so nothing downstream has to guess what an empty input meant.
 * @param {{ field: Field, value: any, onChange: (next: any) => void, id: string, path: string,
 *   issues?: ValidationIssue[], config?: Record<string, any>, describedBy?: string | null }} props
 */
function Control({ field, value, onChange, id, path, issues, config, describedBy }) {
  switch (field.type) {
    case 'longtext':
      return html`
        <textarea class="input" id=${id} rows="3" aria-describedby=${describedBy}
                  maxLength=${field.maxLength || 2000} value=${value == null ? '' : value}
                  onInput=${(e) => onChange(e.currentTarget.value)}></textarea>`;

    case 'number':
      return html`
        <input class="input" id=${id} type="number" inputMode="numeric" aria-describedby=${describedBy}
               min=${field.min} max=${field.max} value=${value == null ? '' : value}
               onInput=${(e) => {
                 const raw = e.currentTarget.value;
                 onChange(raw === '' ? '' : Number(raw));
               }} />`;

    case 'bool':
      return html`
        <button type="button" class="switch" role="switch" aria-checked=${Boolean(value)}
                aria-labelledby=${`${id}-label`} aria-describedby=${describedBy}
                onClick=${() => onChange(!value)}>
          <span class="switch-track"></span>
          <span class="small">${value ? 'On' : 'Off'}</span>
        </button>`;

    case 'choice':
      return isSegmented(field)
        ? html`
          <div class="segmented" role="group" aria-labelledby=${`${id}-label`}>
            ${options(field).map((option) => html`
              <button type="button" key=${option.value} aria-pressed=${value === option.value}
                      onClick=${() => onChange(option.value)}>${option.label}</button>`)}
          </div>`
        : html`
          <select class="input" id=${id} aria-describedby=${describedBy} value=${value == null ? '' : value}
                  onChange=${(e) => onChange(e.currentTarget.value)}>
            ${options(field).map((option) => html`
              <option key=${option.value} value=${option.value} selected=${value === option.value}>${option.label}</option>`)}
          </select>`;

    case 'multi': {
      const chosen = Array.isArray(value) ? value : [];
      return html`
        <div class="chip-wrap" role="group" aria-labelledby=${`${id}-label`}>
          ${options(field).map((option) => {
            const on = chosen.includes(option.value);
            return html`
              <button type="button" key=${option.value} class=${on ? 'chip chip-lg is-active' : 'chip chip-lg'}
                      aria-pressed=${on}
                      onClick=${() => onChange(on ? chosen.filter((v) => v !== option.value) : [...chosen, option.value])}>
                ${option.label}
              </button>`;
          })}
        </div>`;
    }

    case 'color': {
      const swatches = [...PALETTE];
      if (typeof value === 'string' && value && !swatches.includes(value)) swatches.unshift(value);
      return html`
        <div class="picker" role="group" aria-labelledby=${`${id}-label`}>
          ${field.required === false ? html`
            <button type="button" class="swatch swatch-none" aria-pressed=${!value} aria-label="No color"
                    onClick=${() => onChange('')}>${value ? '' : '✓'}</button>` : null}
          ${swatches.map((color) => html`
            <button type="button" key=${color} class="swatch" style=${`background:${color}`}
                    aria-pressed=${value === color} aria-label=${color}
                    onClick=${() => onChange(color)}></button>`)}
        </div>`;
    }

    case 'emoji':
      return html`
        <div class="stack-tight stack">
          <input class="input input-emoji" id=${id} aria-describedby=${describedBy} maxLength="8"
                 value=${value == null ? '' : value} onInput=${(e) => onChange(e.currentTarget.value)} />
          <div class="picker" role="group" aria-label="Common emoji">
            ${COMMON_EMOJI.map((emoji) => html`
              <button type="button" key=${emoji} aria-pressed=${value === emoji} aria-label=${emoji}
                      onClick=${() => onChange(emoji)}>${emoji}</button>`)}
          </div>
        </div>`;

    case 'image':
      return html`
        <div class="stack-tight stack">
          <input class="input" id=${id} type="url" inputMode="url" placeholder="https://" spellcheck="false"
                 aria-describedby=${describedBy} value=${value == null ? '' : value}
                 onInput=${(e) => onChange(e.currentTarget.value)} />
          ${/^https:\/\/\S+$/i.test(String(value || ''))
            ? html`<img class="thumb" src=${value} alt="" loading="lazy" />`
            : null}
        </div>`;

    case 'decks':
      return html`
        <${DeckPicker} value=${Array.isArray(value) ? value : []} onChange=${onChange}
                       max=${field.max} cardFields=${field.cardFields} />`;

    case 'object':
      return html`
        <div class="fieldset">
          <${Form} schema=${field.fields || {}} value=${value || {}} onChange=${onChange}
                   issues=${issues} config=${config} path=${path} />
        </div>`;

    case 'list': {
      const items = Array.isArray(value) ? value : [];
      const of = field.of || { type: 'text' };
      return html`
        <${ListEditor}
          items=${items}
          onChange=${onChange}
          max=${field.max}
          addLabel=${addLabelFor(field.label)}
          empty=${`No ${lower(field.label || 'items')} yet. Add the first one.`}
          newItem=${() => blankItem(of)}
          renderItem=${(item, index, patch) => (of.type === 'object'
            ? html`
              <${Form} schema=${of.fields || {}} value=${item || {}} onChange=${patch}
                       issues=${issues} config=${config} path=${`${path}[${index}]`} />`
            : html`
              <${ListRow} field=${of} value=${item} onChange=${patch} issues=${issues} config=${config}
                          path=${`${path}[${index}]`} />`)} />`;
    }

    case 'ref':
    case 'text':
    default:
      return html`
        <input class="input" id=${id} type="text" aria-describedby=${describedBy}
               maxLength=${field.maxLength || 200} value=${value == null ? '' : value}
               onInput=${(e) => onChange(e.currentTarget.value)} />`;
  }
}

/**
 * One scalar inside a list: the control with no label of its own, since the row number and the
 * list's own label already say what it is, plus whatever is wrong with this item.
 */
function ListRow({ field, value, onChange, issues, config, path }) {
  const mine = (issues || []).filter((issue) => issue.path === path);
  return html`
    <div class=${mine.length ? 'field is-invalid' : 'field'}>
      <${Control} field=${field} value=${value} onChange=${onChange} id=${controlId(path)} path=${path}
                  issues=${issues} config=${config} describedBy=${null} />
      ${mine.map((issue, i) => html`<p class="field-error" key=${i}>${issue.message}</p>`)}
    </div>`;
}

/** What a fresh row in a list starts as, so a new item is never the wrong shape. */
function blankItem(of) {
  if (of.type === 'object') {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [name, nested] of Object.entries(of.fields || {})) {
      if (nested.default !== undefined) out[name] = nested.default;
      else if (nested.type === 'list' || nested.type === 'multi' || nested.type === 'decks') out[name] = [];
      else if (nested.type === 'bool') out[name] = false;
      else out[name] = '';
    }
    return out;
  }
  if (of.type === 'bool') return false;
  if (of.type === 'number') return '';
  if (of.type === 'multi' || of.type === 'decks' || of.type === 'list') return [];
  return '';
}

/** A choice is a segmented control when it fits on one line of a phone, and a menu otherwise. */
function isSegmented(field) {
  const list = options(field);
  return list.length > 0 && list.length <= SEGMENT_MAX
    && list.every((option) => option.label.length <= SEGMENT_LABEL_MAX);
}

/** Options as value and label pairs, whichever way the schema wrote them. */
function options(field) {
  return (field.options || []).map((option) => (typeof option === 'string'
    ? { value: option, label: option }
    : { value: option.value, label: option.label || option.value }));
}

/** A path turned into something that can be an id attribute. */
function controlId(path) {
  return `f-${String(path).replace(/[^A-Za-z0-9]+/g, '-')}`;
}

/** "Categories" becomes "categories", so "Add categories" reads like a sentence. */
function lower(text) {
  const word = String(text || '');
  return word ? word[0].toLowerCase() + word.slice(1) : word;
}

/**
 * "Add a category" from a field labelled "Categories": the button adds one, so it names one.
 * @param {string | undefined} label
 */
function addLabelFor(label) {
  const words = lower(label || '').trim();
  if (!words) return 'Add one';
  const one = words.endsWith('ies') ? `${words.slice(0, -3)}y` : words.endsWith('s') ? words.slice(0, -1) : words;
  return `Add ${/^[aeiou]/.test(one) ? 'an' : 'a'} ${one}`;
}

/**
 * Bring the first field with a problem into view and put the cursor in it. The note under the
 * button says what is wrong; this shows where, which on a phone can be a screen and a half up.
 */
export function revealFirstProblem() {
  requestAnimationFrame(() => {
    const field = document.querySelector('.field.is-invalid');
    if (!field) return;
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const control = field.querySelector('input, textarea, select, button');
    if (control instanceof HTMLElement) control.focus({ preventScroll: true });
  });
}
