// What the three scaffolds (new-game, new-deck, new-kit) have in common: reading flags,
// refusing to overwrite, and printing exactly what they would write when asked not to
// write it. Keeping this in one place is why `--dry-run` can be trusted: the same plan
// either goes to disk or goes to the terminal, and nothing else happens either way.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Markers around a file's contents in --dry-run output, so a test can read them back. */
export const BEGIN = '>>> begin';
export const END = '>>> end';

/**
 * Flags, in the plainest form that covers what the scaffolds need: --name value and
 * --switch. A value that starts with two dashes is treated as the next flag.
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [name, inline] = splitOnce(arg.slice(2), '=');
    if (inline !== null) { out[name] = inline; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[name] = true;
    else { out[name] = next; i += 1; }
  }
  return out;
}

function splitOnce(text, sep) {
  const at = text.indexOf(sep);
  return at === -1 ? [text, null] : [text.slice(0, at), text.slice(at + 1)];
}

/**
 * The files a scaffold means to write, plus what it means to do to the registry. Build the
 * whole plan first, then run it: a scaffold that would clobber something says so before it
 * has written anything at all.
 */
export class Plan {
  /** @param {{ dryRun?: boolean }} [opts] */
  constructor(opts = {}) {
    this.dryRun = Boolean(opts.dryRun);
    /** @type {Array<{ path: string, text: string }>} */
    this.files = [];
    /** @type {string[]} */
    this.notes = [];
  }

  /**
   * Add a file. Throws when it is already there, because a scaffold that overwrites your
   * work is worse than one that makes you pick another name.
   * @param {string} path  absolute
   * @param {string} text
   */
  write(path, text) {
    if (existsSync(path)) {
      throw new Error(`${relative(ROOT, path)} already exists. Pick another name, or delete it first.`);
    }
    if (this.files.some((f) => f.path === path)) throw new Error(`${relative(ROOT, path)} is planned twice`);
    this.files.push({ path, text });
    return this;
  }

  /** @param {string} note  one line about something that is not a file, such as the registry */
  note(note) {
    this.notes.push(note);
    return this;
  }

  /** Write everything (or print it), then report. @returns {number} a process exit code */
  run() {
    for (const file of this.files) {
      const shown = relative(ROOT, file.path);
      if (this.dryRun) {
        console.log(`${BEGIN} ${shown}`);
        process.stdout.write(file.text.endsWith('\n') ? file.text : `${file.text}\n`);
        console.log(`${END} ${shown}`);
        continue;
      }
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.text);
      console.log(`written    ${shown}`);
    }
    for (const note of this.notes) console.log(`${this.dryRun ? 'would     ' : 'done      '} ${note}`);
    return 0;
  }
}

/**
 * Run a scaffold's main and turn a thrown error into a plain line and a non-zero exit.
 * @param {() => number | Promise<number>} body
 * @returns {Promise<number>}
 */
export async function guard(body) {
  try {
    return await body();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
