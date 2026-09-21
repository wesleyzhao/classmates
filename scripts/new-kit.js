// `npm run new-kit -- --id memory`: a new mechanic that already works. It copies the
// template kit and its screen, renames everything, writes a README for the new kit and a
// test wired to the conformance suite, and puts the kit in the registry.
//
// The copy passes `npm test` on the spot. That is the point: you start from a green kit and
// change one rule at a time, rather than from an empty file that fails twelve ways.
//
//   node scripts/new-kit.js --id memory --name "Memory"
//   node scripts/new-kit.js --id memory --dry-run

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import template from '../public/kits/_template/kit.js';
import { describe } from '../public/shared/schema.js';
import { Plan, ROOT, guard, parseArgs } from './lib/scaffold.js';
import { REGISTRY_PATH, has, readRegistry, withKit } from './lib/registry.js';

const USAGE = 'Usage: node scripts/new-kit.js --id <id> [--name "..."] [--dry-run]';
const TEMPLATE_DIR = join(ROOT, 'public/kits/_template');

/**
 * The template file with the template's name taken out of it: its id, its display name, its
 * CSS class prefix and the comment at the top, which is about being a template.
 * @param {string} source  the template file's text
 * @param {{ id: string, name: string, header: string }} kit
 * @returns {string}
 */
export function rename(source, kit) {
  const withoutHeader = source.replace(/^(\/\/[^\n]*\n)+\n/, '');
  // Two replacements, because the template's name turns up in two kinds of place. Inside an
  // identifier (TallyState) it has to stay an identifier, so a name with a space in it loses
  // the space. On its own it is prose, and keeps the name as it was given.
  const identifier = kit.name.replace(/[^A-Za-z0-9]/g, '') || 'Kit';
  return `${kit.header}\n\n${withoutHeader}`
    .replace(/Tally(?=[A-Za-z0-9_])/g, identifier)
    .replace(/\bTally\b/g, kit.name)
    .replace(/tally/g, kit.id)
    .replace(/^\s*hidden: true,\n/m, '');
}

const KIT_HEADER = (/** @type {{ id: string, name: string }} */ kit) => `// ${kit.name}: say in a sentence what the players do, and in another what makes it different
// from the kits that already exist. Read docs/KIT-CONTRACT.md before changing any shape here.
//
// This started as a copy of the template kit, so it still plays like it: everyone taps, and
// the first to the target wins. Change one rule at a time and keep tests/kits/${kit.id}.test.js green.`;

const UI_HEADER = (/** @type {{ id: string, name: string }} */ kit) => `// ${kit.name}'s screen. A kit's ui.js exports Play (the in-game screen) and Editor (the
// creator step). Both are Preact components; both get everything they need as props and
// never talk to the network themselves.
//
// The classes below are the template's. Add what you need to public/themes/base.css, or use
// the game-ui primitives in public/app, and check the gallery in both themes.`;

/**
 * The README that lives beside a kit: what its state holds, what it accepts, how to run it.
 * @param {{ id: string, name: string }} kit
 * @param {import('../types/parlor.js').Kit} source  the kit the copy was made from
 * @returns {string}
 */
export function renderReadme(kit, source) {
  const config = describe(source.config, '  ') || '  (none yet)';
  const content = describe(source.content, '  ') || '  (none yet)';
  return `# ${kit.name}

One paragraph on what a round feels like from a seat at the table. Write it before you write
the rules, and rewrite it when the rules change.

## Settings

These come from \`config\` in kit.js, and the creator draws its form from the same lines.

\`\`\`
${config}
\`\`\`

## Content

These come from \`content\` in kit.js. Decks are referenced by id and loaded by the platform.

\`\`\`
${content}
\`\`\`

## State

\`setup\` returns this, \`reduce\` and \`tick\` return a new one, and the platform stores it as the
room's \`s\`. Keys beginning with \`$\` and \`wakeAt\` belong to the platform. Anything a player
must not see yet goes under a key that starts with an underscore, which the platform strips
before a view leaves the server.

| key | what it holds |
| --- | --- |
| \`phase\` | \`'playing'\` while the game runs, \`'over'\` when it has finished |
| \`wakeAt\` | when \`tick\` must run next, or \`null\` |

Add a row for every key you add.

## Actions

What \`reduce\` accepts, and who may send it. Platform events (\`player/join\`, \`player/leave\`,
\`host/transfer\` and the rest) arrive here too; ignore the ones that do not matter.

| action | payload | who |
| --- | --- | --- |
| \`tap\` | none | any player who is in the game |

## How to test it

\`\`\`
node --test tests/kits/${kit.id}.test.js     this kit
npm test                             everything, including the conformance suite
npm run dev                          play it at http://localhost:3000
\`\`\`

The conformance suite in \`tests/lib/conformance.js\` checks the contract: pure functions, no
clock, no randomness outside \`ctx.rng\`, no secrets in a view. \`tests/lib/sim.js\` runs a whole
game in memory, which is how the rules below it are tested.
`;
}

/**
 * The test file for a new kit: the conformance suite, plus one test of its own to grow.
 * @param {{ id: string, name: string }} kit
 * @returns {string}
 */
export function renderTest(kit) {
  return `// Tests for the ${kit.name} kit. The conformance suite covers the contract that every kit
// shares; the tests below cover what this kit does that no other kit does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import kit from '../../public/kits/${kit.id}/kit.js';
import { conformance } from '../lib/conformance.js';
import { simulate } from '../lib/sim.js';

conformance(kit, { file: import.meta.resolve('../../public/kits/${kit.id}/kit.js') });

test('${kit.id}: a game ends when somebody reaches the target', () => {
  const sim = simulate(kit, { config: { target: 3, seconds: 30 } }, ['ann', 'ben']);
  sim.do('ann', 'tap').do('ben', 'tap').do('ann', 'tap');
  assert.equal(sim.summary().phase, 'playing');
  sim.do('ann', 'tap');
  assert.equal(sim.summary().phase, 'over');
  assert.deepEqual(sim.summary().winnerIds, ['ann']);
});
`;
}

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}  a process exit code
 */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const id = String(args.id || '');
  if (!id) { console.error(USAGE); return 1; }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    console.error(`"${id}" cannot be a kit id. Use lowercase letters, digits and dashes, starting with a letter.`);
    return 1;
  }
  const name = typeof args.name === 'string' && args.name ? args.name : id[0].toUpperCase() + id.slice(1);

  const plan = new Plan({ dryRun: Boolean(args['dry-run']) });
  const kitSource = readFileSync(join(TEMPLATE_DIR, 'kit.js'), 'utf8');
  const uiSource = readFileSync(join(TEMPLATE_DIR, 'ui.js'), 'utf8');

  plan.write(join(ROOT, 'public/kits', id, 'kit.js'), rename(kitSource, { id, name, header: KIT_HEADER({ id, name }) }));
  plan.write(join(ROOT, 'public/kits', id, 'ui.js'), rename(uiSource, { id, name, header: UI_HEADER({ id, name }) }));
  plan.write(join(ROOT, 'public/kits', id, 'README.md'), renderReadme({ id, name }, template));
  plan.write(join(ROOT, 'tests/kits', `${id}.test.js`), renderTest({ id, name }));

  const registry = readRegistry();
  if (has(registry, 'KITS', id)) plan.note(`leave the registry alone; ${id} is already in KITS`);
  else {
    plan.note(`add ${id} to KITS in public/shared/registry.js`);
    if (!plan.dryRun) writeFileSync(REGISTRY_PATH, withKit(registry, id));
  }

  const code = plan.run();
  if (!plan.dryRun) console.log(`Read docs/HOW-TO-MAKE-A-KIT.md, then run node --test tests/kits/${id}.test.js.`);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await guard(() => main()));
}
