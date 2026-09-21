// `npm run kits`: everything a kit declares about itself, printed. Use it to find out what a
// game file may set before writing one, to check that a schema change reads the way you meant
// it to, and to paste into docs.
//
// The schemas come out of describe() in public/shared/schema.js, which is the same text the
// docs use, so there is one description of a field in the project and not two.
//
//   node scripts/kits.js            every kit
//   node scripts/kits.js quiz       one kit

import { pathToFileURL } from 'node:url';
import { KITS } from '../public/shared/registry.js';
import { defaults, describe } from '../public/shared/schema.js';

/**
 * One kit, as lines of text.
 * @param {import('../types/parlor.js').Kit} kit
 * @returns {string}
 */
export function report(kit) {
  const lines = [];
  const players = kit.minPlayers === kit.maxPlayers
    ? `${kit.minPlayers} players`
    : `${kit.minPlayers} to ${kit.maxPlayers} players`;
  lines.push(`${kit.id}  ${kit.name}${kit.hidden ? '  (hidden)' : ''}`);
  lines.push(`  ${kit.tagline}`);
  lines.push(`  version ${kit.version}, ${players}, late joiners ${kit.joinMidGame}`);
  lines.push('');
  lines.push('  settings');
  lines.push(indent(describe(kit.config, '') || '(none)', '    '));
  lines.push('  content');
  lines.push(indent(describe(kit.content, '') || '(none)', '    '));
  lines.push('  a game that sets nothing gets');
  lines.push(indent(JSON.stringify({ config: defaults(kit.config), content: defaults(kit.content) }, null, 2), '    '));
  if (kit.demoDecks?.length) lines.push(`  demo decks: ${kit.demoDecks.join(', ')}`);
  return lines.join('\n');
}

function indent(text, pad) {
  return text.split('\n').map((line) => (line ? pad + line : line)).join('\n');
}

/**
 * @param {string[]} [ids]  kit ids, or none for all of them
 * @returns {number}  a process exit code
 */
export function main(ids = []) {
  const wanted = ids.length ? ids : Object.keys(KITS);
  let missing = 0;
  const blocks = [];
  for (const id of wanted) {
    const kit = KITS[id];
    if (!kit) { console.error(`There is no kit called "${id}". Kits: ${Object.keys(KITS).join(', ')}`); missing += 1; continue; }
    blocks.push(report(kit));
  }
  console.log(blocks.join('\n\n'));
  return missing ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2).filter((a) => !a.startsWith('-'))));
}
