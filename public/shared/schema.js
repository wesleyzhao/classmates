// A small schema language for kit settings and content. One definition does four jobs:
// the server validates what people submit, the creator draws a form from it, the docs
// print it, and tests check every built-in game against it. It is deliberately tiny;
// see types/parlor.d.ts (`Field`) for the field props and docs/KIT-CONTRACT.md for examples.
//
//   const schema = { seconds: { type: 'number', label: 'Seconds per card', min: 5, max: 90, default: 15 } };
//   validate(schema, { seconds: 20 })   // -> { ok: true, value: { seconds: 20 }, issues: [] }
//   defaults(schema)                    // -> { seconds: 15 }

const TEXT_MAX = 200;
const LONGTEXT_MAX = 2000;
const LIST_MAX = 500;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// Control characters other than tab and newline never belong in text people typed.
const CONTROL_CHARS = /[^\P{Cc}\t\n]/gu;
const ASCII_ONLY = /^[ -~]+$/;

/**
 * The value a form starts from: every field's default, nested for objects.
 * Lists start empty unless they have a default; scalars without a default are left out.
 * @param {import('../../types/parlor.js').Schema} schema
 * @returns {Record<string, any>}
 */
export function defaults(schema) {
  const out = {};
  for (const [name, field] of Object.entries(schema || {})) {
    if (field.default !== undefined) out[name] = clone(field.default);
    else if (field.type === 'list' || field.type === 'multi' || field.type === 'decks') out[name] = [];
    else if (field.type === 'object') out[name] = defaults(field.fields || {});
    else if (field.type === 'bool') out[name] = false;
  }
  return out;
}

/**
 * Check a value against a schema. Never throws for bad input; returns issues with paths
 * like `items[3].answer` that a form can show next to the field.
 * @param {import('../../types/parlor.js').Schema} schema
 * @param {unknown} input
 * @param {{ config?: Record<string, any>, path?: string }} [opts]  `config` resolves `$config.x` in `when`
 * @returns {{ ok: boolean, value: Record<string, any>, issues: import('../../types/parlor.js').ValidationIssue[] }}
 */
export function validate(schema, input, opts = {}) {
  const issues = [];
  const value = {};
  const base = opts.path ? opts.path + '.' : '';
  const obj = input === undefined || input === null ? {} : input;
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, value: {}, issues: [{ path: opts.path || '', message: 'Expected an object.' }] };
  }
  for (const key of Object.keys(obj)) {
    if (!schema[key]) issues.push({ path: base + key, message: 'This field is not part of the schema.' });
  }
  for (const [name, field] of Object.entries(schema || {})) {
    const path = base + name;
    if (field.when && !whenMatches(field.when, obj, opts.config)) continue;
    const raw = obj[name];
    if (raw === undefined || raw === null || raw === '') {
      if (field.default !== undefined) { value[name] = clone(field.default); continue; }
      if (field.type === 'list' || field.type === 'multi' || field.type === 'decks') {
        if ((field.min || 0) > 0 && field.required !== false) issues.push({ path, message: `Add at least ${field.min} ${field.min === 1 ? 'item' : 'items'}.` });
        value[name] = [];
        continue;
      }
      if (field.type === 'object') {
        const nested = validate(field.fields || {}, {}, { config: opts.config, path });
        value[name] = nested.value;
        if (field.required !== false) issues.push(...nested.issues);
        continue;
      }
      if (field.type === 'bool') { value[name] = false; continue; }
      if (field.required !== false) issues.push({ path, message: `${field.label || name} is required.` });
      continue;
    }
    const result = checkField(field, raw, path, opts.config);
    if (result.issues.length) issues.push(...result.issues);
    if (result.value !== undefined) value[name] = result.value;
  }
  return { ok: issues.length === 0, value, issues };
}

/** @returns {{ value: any, issues: import('../../types/parlor.js').ValidationIssue[] }} */
function checkField(field, raw, path, config) {
  const issues = [];
  const bad = (message) => ({ value: undefined, issues: [{ path, message }] });
  switch (field.type) {
    case 'text':
    case 'longtext': {
      if (typeof raw !== 'string') return bad('Expected text.');
      const text = raw.replace(CONTROL_CHARS, '').trim();
      const max = field.maxLength || (field.type === 'text' ? TEXT_MAX : LONGTEXT_MAX);
      if (text.length > max) return bad(`Keep this under ${max} characters.`);
      if (field.min && text.length < field.min) return bad(`Use at least ${field.min} characters.`);
      if (!text && field.required !== false) return bad(`${field.label || path} is required.`);
      return { value: text, issues };
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return bad('Expected a number.');
      if (field.min !== undefined && raw < field.min) return bad(`Use ${field.min} or more.`);
      if (field.max !== undefined && raw > field.max) return bad(`Use ${field.max} or less.`);
      return { value: raw, issues };
    }
    case 'bool': {
      if (typeof raw !== 'boolean') return bad('Expected true or false.');
      return { value: raw, issues };
    }
    case 'choice': {
      const allowed = optionValues(field);
      if (!allowed.includes(raw)) return bad(`Choose one of: ${allowed.join(', ')}.`);
      return { value: raw, issues };
    }
    case 'multi': {
      if (!Array.isArray(raw)) return bad('Expected a list of choices.');
      const allowed = optionValues(field);
      for (const item of raw) if (!allowed.includes(item)) return bad(`"${item}" is not one of the choices.`);
      return { value: [...new Set(raw)], issues };
    }
    case 'color': {
      if (typeof raw !== 'string' || !HEX_COLOR.test(raw)) return bad('Use a color like #2456f5.');
      return { value: raw.toLowerCase(), issues };
    }
    case 'emoji': {
      if (typeof raw !== 'string') return bad('Expected an emoji.');
      const text = raw.trim();
      if (!text || text.length > 16 || ASCII_ONLY.test(text)) return bad('Use a single emoji.');
      return { value: text, issues };
    }
    case 'image': {
      if (typeof raw !== 'string') return bad('Expected an image address.');
      const url = raw.trim();
      if (url.length > 500 || !/^https:\/\/[^\s"'<>]+$/i.test(url)) return bad('Use a full https:// image address.');
      return { value: url, issues };
    }
    case 'ref': {
      if (typeof raw !== 'string' || !raw.trim() || raw.length > 64) return bad('Expected an id.');
      return { value: raw.trim(), issues };
    }
    case 'decks': {
      if (!Array.isArray(raw)) return bad('Expected a list of deck ids.');
      const ids = raw.map((d) => (typeof d === 'string' ? d.trim() : '')).filter(Boolean);
      if (ids.length !== raw.length) return bad('Every deck must be an id.');
      if (field.min !== undefined && ids.length < field.min) return bad(`Choose at least ${field.min} ${field.min === 1 ? 'deck' : 'decks'}.`);
      if (field.max !== undefined && ids.length > field.max) return bad(`Choose at most ${field.max} decks.`);
      return { value: [...new Set(ids)], issues };
    }
    case 'list': {
      if (!Array.isArray(raw)) return bad('Expected a list.');
      const max = field.max ?? LIST_MAX;
      if (raw.length > max) return bad(`Keep this to ${max} items or fewer.`);
      if (field.min !== undefined && raw.length < field.min) return bad(`Add at least ${field.min} ${field.min === 1 ? 'item' : 'items'}.`);
      const out = [];
      raw.forEach((item, i) => {
        const itemPath = `${path}[${i}]`;
        if (!field.of) { out.push(item); return; }
        if (field.of.type === 'object') {
          const nested = validate(field.of.fields || {}, item, { config, path: itemPath });
          issues.push(...nested.issues);
          out.push(nested.value);
        } else {
          const res = checkField(field.of, item, itemPath, config);
          issues.push(...res.issues);
          if (res.value !== undefined) out.push(res.value);
        }
      });
      return { value: out, issues };
    }
    case 'object': {
      const nested = validate(field.fields || {}, raw, { config, path });
      issues.push(...nested.issues);
      return { value: nested.value, issues };
    }
    default:
      return bad(`Unknown field type "${field.type}".`);
  }
}

function optionValues(field) {
  return (field.options || []).map((o) => (typeof o === 'string' ? o : o.value));
}

/**
 * Whether a conditional field applies right now. The creator's form calls this too, so a field
 * the server would ignore is a field nobody is asked to fill in.
 * @param {{ field: string, eq: unknown }} when
 * @param {Record<string, any>} siblings  the object the field lives in
 * @param {Record<string, any>} [config]  resolves `$config.x`, which reaches config from content
 * @returns {boolean}
 */
export function whenMatches(when, siblings, config) {
  const value = when.field.startsWith('$config.') ? (config || {})[when.field.slice(8)] : (siblings || {})[when.field];
  return value === when.eq;
}

function clone(v) {
  return v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v));
}

/**
 * A readable description of a schema for docs and `npm run kits`.
 * @param {import('../../types/parlor.js').Schema} schema
 * @param {string} [indent]
 */
export function describe(schema, indent = '') {
  const lines = [];
  for (const [name, field] of Object.entries(schema || {})) {
    /** @type {string[]} */
    const bits = [field.type];
    if (field.default !== undefined) bits.push(`default ${JSON.stringify(field.default)}`);
    if (field.min !== undefined || field.max !== undefined) bits.push(`${field.min ?? ''}..${field.max ?? ''}`);
    if (field.options) bits.push(`one of ${optionValues(field).join(' | ')}`);
    if (field.required === false) bits.push('optional');
    if (field.when) bits.push(`when ${field.when.field} = ${JSON.stringify(field.when.eq)}`);
    lines.push(`${indent}${name}: ${bits.join(', ')}${field.label ? `  (${field.label})` : ''}`);
    if (field.type === 'object' && field.fields) lines.push(describe(field.fields, indent + '  '));
    if (field.type === 'list' && field.of) {
      if (field.of.type === 'object' && field.of.fields) lines.push(describe(field.of.fields, indent + '  '));
      else lines.push(`${indent}  each: ${field.of.type}`);
    }
  }
  return lines.join('\n');
}
