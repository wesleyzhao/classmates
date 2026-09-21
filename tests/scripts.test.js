// The scaffolds, run for real. Each one is asked to describe what it would write (--dry-run),
// and then what it would have written is loaded and checked the way the platform would check
// it: a game against its kit's schema, a deck against the deck audit, a kit against a game
// played through the simulator.
//
// Nothing here touches the repository. The scaffolds write nothing in --dry-run, and the
// generated modules are loaded from data URLs, with their few relative imports pointed back
// at the real files. The registry edits are checked as string transforms, which is what they
// are, so a test never has to put a fake kit in the real registry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditDeck } from '../scripts/audit-decks.js';
import { has, readRegistry, withDeck, withGame, withKit } from '../scripts/lib/registry.js';
import { KITS, getKit } from '../public/shared/registry.js';
import { validate } from '../public/shared/schema.js';
import { simulate } from './lib/sim.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const BEGIN = '>>> begin';
const END = '>>> end';

/**
 * Run a scaffold and return every file it says it would write, by path.
 * @param {string} script
 * @param {string[]} args
 * @returns {Record<string, string>}
 */
function dryRun(script, args) {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', script), ...args, '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  /** @type {Record<string, string>} */
  const files = {};
  let path = null;
  /** @type {string[]} */
  let body = [];
  for (const line of out.split('\n')) {
    if (line.startsWith(BEGIN)) { path = line.slice(BEGIN.length).trim(); body = []; continue; }
    if (line.startsWith(END)) { files[path] = `${body.join('\n')}\n`; path = null; continue; }
    if (path) body.push(line);
  }
  return { ...files, $stdout: out };
}

/**
 * Run a scaffold that is expected to refuse, and hand back what it said.
 * @param {string} script
 * @param {string[]} args
 * @returns {{ status: number, output: string }}
 */
function expectRefusal(script, args) {
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    return { status: err.status, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
  return { status: 0, output: '' };
}

/** Load generated source as a module, with relative imports pointed back at the real files. */
async function load(source, fromDir) {
  const base = pathToFileURL(join(ROOT, fromDir, 'x.js'));
  const resolved = source.replace(/(from\s+')(\.[^']*)(')/g, (_, a, spec, c) => a + new URL(spec, base).href + c);
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(resolved)}`);
}

test('new-game: writes a game that its kit accepts', async () => {
  const files = dryRun('new-game.js', ['--kit', 'quiz', '--slug', 'scaffold-check', '--title', 'Scaffold check']);
  const source = files['public/games/scaffold-check.js'];
  assert.ok(source, 'the scaffold printed no game file');
  assert.match(files.$stdout, /BUILTIN_GAMES/, 'the scaffold says nothing about registering the game');
  assert.ok(!existsSync(join(ROOT, 'public/games/scaffold-check.js')), '--dry-run wrote a file');

  const game = (await load(source, 'public/games')).default;
  assert.equal(game.id, 'scaffold-check');
  assert.equal(game.slug, 'scaffold-check');
  assert.equal(game.title, 'Scaffold check');
  assert.equal(game.kitId, 'quiz');
  assert.ok(game.description, 'a scaffolded game still needs a description');

  const kit = getKit('quiz');
  const config = validate(kit.config, game.config);
  assert.deepEqual(config.issues, [], 'the scaffolded settings do not fit the kit');
  const content = validate(kit.content, game.content, { config: config.value });
  assert.deepEqual(content.issues, [], 'the scaffolded content does not fit the kit');
  assert.match(source, /TODO/, 'the scaffold leaves nothing to fill in');
});

test('new-game: says what it needs when the kit is unknown', () => {
  const { status, output } = expectRefusal('new-game.js', ['--kit', 'nope', '--slug', 'x']);
  assert.equal(status, 1, 'an unknown kit should be an error');
  assert.match(output, /no kit called "nope"/);
  assert.match(output, /quiz/, 'the refusal should list the kits there are');
});

test('new-deck: writes a deck that passes the audit', async () => {
  const files = dryRun('new-deck.js', ['--id', 'scaffold-check']);
  const source = files['public/decks/scaffold-check.js'];
  assert.ok(source, 'the scaffold printed no deck file');
  assert.match(files.$stdout, /BUILTIN_DECKS/, 'the scaffold says nothing about registering the deck');
  assert.ok(!existsSync(join(ROOT, 'public/decks/scaffold-check.js')), '--dry-run wrote a file');

  const deck = (await load(source, 'public/decks')).default;
  assert.equal(deck.id, 'scaffold-check');
  assert.equal(deck.cards.length, 3);
  const report = auditDeck(deck);
  assert.deepEqual(report.errors, [], 'a freshly scaffolded deck does not pass the audit');
});

test('new-deck: refuses to write over a deck that exists', () => {
  const { status, output } = expectRefusal('new-deck.js', ['--id', 'countries', '--dry-run']);
  assert.equal(status, 1, 'overwriting a deck should be an error');
  assert.match(output, /already exists/);
});

test('new-kit: refuses to write over a kit that exists', () => {
  const { status, output } = expectRefusal('new-kit.js', ['--id', 'quiz', '--dry-run']);
  assert.equal(status, 1, 'overwriting a kit should be an error');
  assert.match(output, /already exists/);
});

test('new-kit: writes a kit, a screen, a README and a test', async () => {
  const files = dryRun('new-kit.js', ['--id', 'scaffcheck', '--name', 'Scaffold check']);
  const paths = Object.keys(files).filter((p) => p !== '$stdout').sort();
  assert.deepEqual(paths, [
    'public/kits/scaffcheck/README.md',
    'public/kits/scaffcheck/kit.js',
    'public/kits/scaffcheck/ui.js',
    'tests/kits/scaffcheck.test.js',
  ]);
  assert.match(files.$stdout, /KITS/, 'the scaffold says nothing about registering the kit');

  const source = files['public/kits/scaffcheck/kit.js'];
  assert.ok(!/tally|Tally/.test(source), 'the copy still mentions the kit it came from');
  assert.ok(!/hidden:\s*true/.test(source), 'a new kit should not be hidden from the catalog');

  const kit = (await load(source, 'public/kits/scaffcheck')).default;
  assert.equal(kit.id, 'scaffcheck');
  assert.equal(kit.name, 'Scaffold check');
  for (const fn of ['setup', 'reduce', 'tick', 'view', 'summary']) {
    assert.equal(typeof kit[fn], 'function', `a kit needs ${fn}`);
  }

  // The copy has to play, not just parse: a scaffold you cannot run is not a starting point.
  const sim = simulate(kit, { config: { target: 3, seconds: 30 } }, ['ann', 'ben']);
  sim.do('ann', 'tap').do('ben', 'tap').do('ann', 'tap').do('ann', 'tap');
  assert.equal(sim.summary().phase, 'over');
  assert.deepEqual(sim.summary().winnerIds, ['ann']);

  assert.match(files['tests/kits/scaffcheck.test.js'], /conformance\(kit/, 'the generated test does not run the conformance suite');
  assert.match(files['public/kits/scaffcheck/README.md'], /## State/, 'the README does not describe the state');
  assert.match(files['public/kits/scaffcheck/README.md'], /## Actions/, 'the README does not describe the actions');
});

test('the registry edits add one entry and leave everything else alone', () => {
  const before = readRegistry();

  const withNewDeck = withDeck(before, 'scaffold-check');
  assert.ok(has(withNewDeck, 'BUILTIN_DECKS', 'scaffold-check'));
  assert.equal(withDeck(withNewDeck, 'scaffold-check'), withNewDeck, 'adding the same deck twice changed the file');
  for (const id of Object.keys(KITS)) assert.ok(has(withNewDeck, 'KITS', id), `${id} fell out of KITS`);

  const withNewGame = withGame(before, 'scaffold-check');
  assert.ok(has(withNewGame, 'BUILTIN_GAMES', 'scaffold-check'));
  assert.match(withNewGame, /'scaffold-check': 'games\/scaffold-check\.js'/, 'a dashed key must be quoted, in the house style');

  const withNewKit = withKit(before, 'scaff-check');
  assert.ok(has(withNewKit, 'KITS', 'scaff-check'));
  assert.match(withNewKit, /import scaffCheck from '\.\.\/kits\/scaff-check\/kit\.js';/);
  assert.equal(withKit(withNewKit, 'scaff-check'), withNewKit, 'adding the same kit twice changed the file');

  assert.equal(readRegistry(), before, 'a registry edit wrote to disk');
});

test('kits: prints every kit with its schemas', () => {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts/kits.js')], { cwd: ROOT, encoding: 'utf8' });
  for (const [id, kit] of Object.entries(KITS)) {
    assert.ok(out.includes(id), `${id} is missing from the report`);
    assert.ok(out.includes(kit.name), `${kit.name} is missing from the report`);
  }
  assert.match(out, /settings/);
  assert.match(out, /content/);
});
