// Voice linter: catches the mechanical tells of machine-written copy in everything a player or
// a reader sees (see docs/VOICE.md). It scans string literals in JavaScript, the text of HTML,
// and Markdown prose, and fails `npm test` with the offending lines. It is a net for the obvious;
// tone is still reviewed by a person. Put `voice-ok` on a line to allow a deliberate exception.
//
//   node scripts/lint-copy.js            # the whole repo
//   node scripts/lint-copy.js path ...   # specific files

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SCAN_DIRS = ['public', 'docs', 'server', 'scripts'];
const SCAN_FILES = ['README.md', 'AGENTS.md'];
const SKIP = [/^public\/vendor\//, /^docs\/VOICE\.md$/, /^scripts\/lint-copy\.js$/, /node_modules/, /^public\/dev\//];
const EXTS = new Set(['.js', '.mjs', '.html', '.md']);

const DASH = /[—–]/; // em dash, en dash
const ELLIPSIS = /…|\p{L}\.\.\.(\s|$)/u; // the character, or three dots trailing a word
const BANNED = [
  /\blet's\b/i, /\bready\?/i, /\bboom\b/i, /\bnailed it\b/i, /\bpro tip\b/i, /\bseamless(ly)?\b/i,
  /\bdelightful\b/i, /\bdive in\b/i, /\bunleash\b/i, /\belevate\b/i, /\bbuckle up\b/i, /\bget ready\b/i,
  /\boops\b/i, /\bwhoops\b/i, /\bsimply\b/i, /\bsupercharge\b/i, /\bgame-changer\b/i, /\bnext level\b/i,
  /\bawesome\b/i, /\bamazing\b/i, /\bexciting\b/i,
];
const EMOJI = /\p{Extended_Pictographic}/u;
const WORD = /\p{L}{2,}/u;

/** @returns {Array<{ file: string, line: number, text: string, why: string }>} */
function lintText(file, text, lineOffset, allowed) {
  const problems = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const lineNo = lineOffset + i + 1;
    if (allowed.has(lineNo)) return;
    const push = (why) => problems.push({ file, line: lineNo, text: raw.trim().slice(0, 100), why });
    if (DASH.test(raw)) push('dash used as punctuation; use a comma, a full stop, or parentheses');
    if (ELLIPSIS.test(raw)) push('ellipsis; say the thing');
    for (const re of BANNED) if (re.test(raw)) push(`"${raw.match(re)[0]}" reads like hype or filler`);
    if ((raw.match(/!/g) || []).length > 1) push('more than one exclamation mark');
    const codeLike = /\/\/|=>|: '|: "/.test(raw);
    if (!codeLike && WORD.test(raw) && EMOJI.test(raw) && raw.split(/\s+/).length >= 4) push('emoji inside prose');
    const frags = raw.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
    let run = 0;
    for (const s of frags) {
      const words = s.trim().split(/\s+/).length;
      run = words <= 3 && /[.!?]$/.test(s.trim()) ? run + 1 : 0;
      if (run >= 3) { push('a stack of short fragments'); break; }
    }
  });
  return problems;
}

/** String literals in JavaScript, with their line numbers. */
function jsStrings(source) {
  const out = [];
  const re = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g;
  let m;
  while ((m = re.exec(source))) {
    // Template interpolations are code, not copy: `${!!x}` or `${a !== b}` must not read as prose.
    const value = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    const line = source.slice(0, m.index).split('\n').length;
    out.push({ value, line });
  }
  return out;
}

function allowedLines(source) {
  const set = new Set();
  source.split('\n').forEach((line, i) => { if (line.includes('voice-ok')) set.add(i + 1); });
  return set;
}

function lintFile(path) {
  const rel = relative(ROOT, path);
  const source = readFileSync(path, 'utf8');
  const allowed = allowedLines(source);
  const ext = extname(path);
  if (ext === '.md') {
    // Code is not prose: blank out fenced blocks and inline spans but keep the line count.
    const prose = source.replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, (b) => ' '.repeat(b.length));
    return lintText(rel, prose, 0, allowed);
  }
  if (ext === '.html') {
    const text = source.replace(/<script[\s\S]*?<\/script>/g, (s) => s.replace(/[^\n]/g, ' ')).replace(/<style[\s\S]*?<\/style>/g, (s) => s.replace(/[^\n]/g, ' ')).replace(/<[^>]+>/g, ' ');
    return lintText(rel, text, 0, allowed);
  }
  const problems = [];
  for (const { value, line } of jsStrings(source)) {
    if (allowed.has(line)) continue;
    if (!/\p{L}/u.test(value) || value.length < 4) continue;
    if (/^[\w./:-]+$/.test(value)) continue; // paths, ids, urls
    for (const p of lintText(rel, value, line - 1, new Set())) problems.push({ ...p, text: value.slice(0, 100) });
  }
  return problems;
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(ROOT, path);
    if (SKIP.some((re) => re.test(rel))) continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (EXTS.has(extname(name))) out.push(path);
  }
}

const args = process.argv.slice(2);
const files = [];
if (args.length) files.push(...args.map((a) => join(ROOT, a)));
else {
  for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files);
  for (const f of SCAN_FILES) files.push(join(ROOT, f));
}
const problems = files.flatMap((f) => { try { return lintFile(f); } catch { return []; } });
if (problems.length) {
  console.error(`Voice check found ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} (see docs/VOICE.md):`);
  for (const p of problems) console.error(`  ${p.file}:${p.line}  ${p.why}\n      ${p.text}`);
  process.exit(1);
}
console.log(`Voice check passed (${files.length} files).`);
