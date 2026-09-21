// `npm run new-game -- --kit quiz --slug capitals-of-asia`: a game file you can play in a
// minute. It reads the kit's own schemas, fills every field with that kit's default, leaves
// a TODO beside each one, and adds the game to public/shared/registry.js.
//
// The generated file is deliberately verbose. A scaffold that writes `config: {}` saves four
// lines and hides every setting the kit has; this one shows them all, with their labels.
//
//   node scripts/new-game.js --kit quiz --slug capitals-of-asia --title "Capitals of Asia"
//   node scripts/new-game.js --kit quiz --slug try-me --dry-run

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { BUILTIN_DECKS, KITS, getKit } from '../public/shared/registry.js';
import { defaults } from '../public/shared/schema.js';
import { slugify } from '../public/shared/ids.js';
import { Plan, ROOT, guard, parseArgs } from './lib/scaffold.js';
import { REGISTRY_PATH, has, readRegistry, withGame } from './lib/registry.js';

const USAGE = 'Usage: node scripts/new-game.js --kit <kit> --slug <slug> [--title "..."] [--dry-run]';

// A scaffolded game is registered straight away, which means `npm test` runs tests/games.test.js
// over it before anyone has filled in a TODO. So every placeholder here is a real value: a
// description that is a sentence, and a deck that exists. Nothing you have to fix to go green.
const PLACEHOLDER_DESCRIPTION = 'Two sentences about what happens in this game and who it is for.';

/**
 * The text of public/games/<slug>.js for one kit, with every setting spelled out.
 * @param {import('../types/parlor.js').Kit} kit
 * @param {{ slug: string, title: string }} game
 * @returns {string}
 */
export function renderGame(kit, game) {
  const lines = [];
  lines.push(`// ${game.title}: a ${kit.id} game. Say here what it is for and who it is for, the way the`);
  lines.push('// other files in this folder do, then delete this sentence.');
  lines.push('');
  lines.push("/** @type {import('../../types/parlor.js').GameDefinition} */");
  lines.push('const game = {');
  lines.push(`  id: ${JSON.stringify(game.slug)},`);
  lines.push(`  slug: ${JSON.stringify(game.slug)},`);
  lines.push(`  title: ${JSON.stringify(game.title)},`);
  lines.push(`  description: ${JSON.stringify(PLACEHOLDER_DESCRIPTION)},  // TODO two sentences, in the voice of docs/VOICE.md`);
  lines.push("  emoji: '🎲',  // TODO one emoji, the one people will look for in the catalog");
  lines.push(`  kitId: ${JSON.stringify(kit.id)},`);
  lines.push(...fieldBlock('config', kit.config, defaults(kit.config)));
  lines.push(...fieldBlock('content', kit.content, defaults(kit.content)));
  lines.push("  theme: 'editorial',  // TODO 'editorial' or 'playful'");
  lines.push("  accent: '#2456f5',  // TODO the one color this game is remembered by");
  lines.push('  builtin: true,');
  lines.push('};');
  lines.push('');
  lines.push('export default game;');
  lines.push('');
  return lines.join('\n');
}

/** One half of a game definition, one field per line, each with the kit's own label. */
function fieldBlock(name, schema, values) {
  const entries = Object.entries(schema || {});
  if (!entries.length) return [`  ${name}: {},`];
  const lines = [`  ${name}: {`];
  for (const [field, spec] of entries) {
    let value = values[field] !== undefined ? values[field] : blankFor(spec);
    // A kit that needs at least one deck gets one, so the file is playable before it is edited.
    if (spec.type === 'decks' && Array.isArray(value) && !value.length && (spec.min || 0) > 0) {
      value = [firstDeck()];
    }
    const todo = spec.default === undefined ? 'TODO ' : '';
    const about = [spec.label || field, spec.help].filter(Boolean).join('. ');
    lines.push(`    ${field}: ${JSON.stringify(value)},  // ${todo}${about}`);
  }
  lines.push('  },');
  return lines;
}

/** Any built-in deck will do as a placeholder; the first one is the one people will recognise. */
function firstDeck() {
  return Object.keys(BUILTIN_DECKS)[0] || 'demo';
}

/** What an empty value of each type looks like, for fields the kit gives no default. */
function blankFor(spec) {
  if (spec.type === 'list' || spec.type === 'multi' || spec.type === 'decks') return [];
  if (spec.type === 'object') return {};
  if (spec.type === 'bool') return false;
  if (spec.type === 'number') return spec.min ?? 0;
  if (spec.type === 'choice') return (spec.options || []).map((o) => (typeof o === 'string' ? o : o.value))[0] ?? '';
  return '';
}

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}  a process exit code
 */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const kitId = String(args.kit || '');
  const slug = slugify(String(args.slug || args.name || ''));

  if (!kitId || !args.slug) {
    console.error(USAGE);
    console.error(`Kits: ${Object.keys(KITS).join(', ')}`);
    return 1;
  }
  const kit = getKit(kitId);
  if (!kit) {
    console.error(`There is no kit called "${kitId}". Kits: ${Object.keys(KITS).join(', ')}`);
    return 1;
  }

  const title = typeof args.title === 'string' && args.title ? args.title : titleFrom(slug);
  const path = join(ROOT, 'public/games', `${slug}.js`);
  const plan = new Plan({ dryRun: Boolean(args['dry-run']) });
  plan.write(path, renderGame(kit, { slug, title }));

  const registry = readRegistry();
  if (has(registry, 'BUILTIN_GAMES', slug)) plan.note(`leave the registry alone; ${slug} is already in BUILTIN_GAMES`);
  else {
    plan.note(`add ${slug} to BUILTIN_GAMES in public/shared/registry.js`);
    if (!plan.dryRun) writeFileSync(REGISTRY_PATH, withGame(registry, slug));
  }

  const code = plan.run();
  if (!plan.dryRun) {
    console.log(`Fill in the TODOs, then run npm test. Play it at /g/${slug}.`);
  }
  return code;
}

/** "capitals-of-asia" as a title: sentence case, because docs/VOICE.md says so. */
function titleFrom(slug) {
  const words = slug.split('-').filter(Boolean);
  if (!words.length) return 'New game';
  return words[0][0].toUpperCase() + words[0].slice(1) + (words.length > 1 ? ` ${words.slice(1).join(' ')}` : '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await guard(() => main()));
}
