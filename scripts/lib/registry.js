// Editing public/shared/registry.js from a script. The registry is the one file that names
// every kit, deck and game, which makes it the one file every scaffold has to touch. Doing
// that with a parser would mean a dependency, and doing it with a loose regular expression
// would mean mangling someone's file, so these functions find the exact object by name,
// match its braces, and add one entry.
//
// Every function takes the file's text and returns new text. Nothing here writes to disk;
// the scaffolds decide that, which is what makes their --dry-run honest.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the registry lives. */
export const REGISTRY_PATH = join(ROOT, 'public/shared/registry.js');

/** @returns {string} the registry as it is on disk right now */
export function readRegistry() {
  return readFileSync(REGISTRY_PATH, 'utf8');
}

/**
 * A deck id pointing at its module, added to BUILTIN_DECKS.
 * @param {string} source  the registry file's text
 * @param {string} id
 * @param {string} [path]  relative to public/, defaults to decks/<id>.js
 * @returns {string}
 */
export function withDeck(source, id, path = `decks/${id}.js`) {
  return addEntry(source, 'BUILTIN_DECKS', id, quote(path));
}

/**
 * A game slug pointing at its module, added to BUILTIN_GAMES.
 * @param {string} source
 * @param {string} slug
 * @param {string} [path]  relative to public/, defaults to games/<slug>.js
 * @returns {string}
 */
export function withGame(source, slug, path = `games/${slug}.js`) {
  return addEntry(source, 'BUILTIN_GAMES', slug, quote(path));
}

/**
 * A kit, added both as an import and as a name in KITS.
 * @param {string} source
 * @param {string} id
 * @returns {string}
 */
export function withKit(source, id) {
  // A dashed id is fine: the object key is quoted and the import is given a camel case name.
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`"${id}" cannot be a kit id. Use lowercase letters, digits and dashes, starting with a letter.`);
  }
  const local = camel(id);
  let next = source;
  if (!new RegExp(`^import\\s+${local}\\s+from`, 'm').test(next)) {
    next = addImport(next, `import ${local} from '../kits/${id}/kit.js';`);
  }
  return addEntry(next, 'KITS', id, local, { shorthand: true });
}

/**
 * Whether an entry is already in one of the registry's objects, so a scaffold can say
 * "already registered" instead of adding it twice.
 * @param {string} source
 * @param {'KITS' | 'BUILTIN_DECKS' | 'BUILTIN_GAMES'} objectName
 * @param {string} key
 * @returns {boolean}
 */
export function has(source, objectName, key) {
  const body = bodyOf(source, objectName);
  return hasKey(body, key);
}

/** The text between the braces of `export const <name> = { ... }`. */
function bodyOf(source, objectName) {
  const { start, end } = span(source, objectName);
  return source.slice(start, end);
}

/** Where the body of `export const <name> = { ... }` starts and ends. */
function span(source, objectName) {
  const declaration = new RegExp(`export const ${objectName}\\s*=\\s*\\{`).exec(source);
  if (!declaration) throw new Error(`${objectName} is not in the registry`);
  const start = declaration.index + declaration[0].length;
  let depth = 1;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: i };
    }
  }
  throw new Error(`${objectName} is never closed`);
}

/**
 * Add `key: value` to a named object, after whatever is already there. A single-line object
 * stays on one line; a multi-line one gets a new line with the same indent as its last entry.
 */
function addEntry(source, objectName, key, value, opts = {}) {
  const { start, end } = span(source, objectName);
  const body = source.slice(start, end);
  if (hasKey(body, key)) return source;

  const name = isName(key) ? key : quote(key);
  const entry = opts.shorthand && name === value ? name : `${name}: ${value}`;

  if (!body.includes('\n')) {
    const inner = body.trim();
    const next = inner ? `${inner.replace(/,$/, '')}, ${entry}` : entry;
    return `${source.slice(0, start)} ${next} ${source.slice(end)}`;
  }

  const lines = body.split('\n');
  const last = lines.map((l) => l.trimEnd()).findLastIndex((l) => l.trim() && !l.trim().startsWith('//'));
  const indent = last >= 0 ? (lines[last].match(/^\s*/) || [''])[0] : '  ';
  const at = last >= 0 ? last : lines.length - 2;
  if (last >= 0 && !lines[last].trimEnd().endsWith(',')) lines[last] = `${lines[last].trimEnd()},`;
  lines.splice(at + 1, 0, `${indent}${entry},`);
  return source.slice(0, start) + lines.join('\n') + source.slice(end);
}

/** Does the object body already name this key, quoted or not? */
function hasKey(body, key) {
  const quoted = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[{,\\s])(['"]?)${quoted}\\2\\s*[:,}]`).test(body)
    || new RegExp(`(^|[{,\\s])${quoted}\\s*$`, 'm').test(body);
}

/** Put an import after the last one, so the imports stay in one block. */
function addImport(source, line) {
  const imports = [...source.matchAll(/^import .*;$/gm)];
  if (!imports.length) return `${line}\n${source}`;
  const last = imports[imports.length - 1];
  const at = last.index + last[0].length;
  return `${source.slice(0, at)}\n${line}${source.slice(at)}`;
}

/** The registry is written in single quotes, and so is everything added to it. */
function quote(text) {
  return `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** A bare identifier needs no quotes; anything with a dash in it does. */
function isName(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

/** "my-kit" as a JavaScript name: myKit. */
export function camel(id) {
  return String(id).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''));
}
