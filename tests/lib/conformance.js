// The conformance suite: every kit must pass it, and `scripts/new-kit.js` wires it into each new
// kit's test file. It checks the rules in docs/KIT-CONTRACT.md mechanically, so a kit that passes
// can be trusted by the platform: pure, deterministic, no leaked secrets, every offered action legal,
// timers that move forward, bounded state, and a game that survives players coming and going.
//
//   import { conformance } from '../lib/conformance.js';
//   conformance(kit, { file: import.meta.resolve('../../public/kits/quiz/kit.js'), game: { ... }, players: [...] });

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simulate } from './sim.js';
import { KitError } from '../../public/shared/errors.js';
import { makeRng } from '../../public/kits/_lib/rng.js';
import { defaults } from '../../public/shared/schema.js';

const STATE_LIMIT = 64 * 1024;
const IMPURE = [/\bDate\.now\s*\(/, /\bMath\.random\s*\(/, /\bnew\s+Date\s*\(/, /\bfetch\s*\(/, /\blocalStorage\b/, /\bperformance\.now\s*\(/];

/**
 * @param {import('../../types/parlor.js').Kit} kit
 * @param {{
 *   file?: string,                       // file URL or path of kit.js, for the purity scan
 *   game?: { config?: any, content?: any, decks?: any },
 *   players?: string[],
 *   script?: import('../../types/parlor.js').ScriptStep[],
 *   secretValues?: (sim: any) => unknown[],  // values that must never appear in any view (e.g. the draw pile order)
 * }} [opts]
 */
export function conformance(kit, opts = {}) {
  const game = opts.game || { config: kit.demoConfig, content: kit.demoContent };
  const players = opts.players || ['p1', 'p2', 'p3'];
  const script = opts.script || kit.demoScript || [];
  const label = `kit ${kit.id}`;

  test(`${label}: metadata is complete`, () => {
    for (const key of ['id', 'name', 'tagline', 'version', 'minPlayers', 'maxPlayers', 'joinMidGame', 'config', 'content']) {
      assert.ok(key in kit, `missing ${key}`);
    }
    assert.match(kit.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(kit.minPlayers >= 1 && kit.maxPlayers >= kit.minPlayers);
    assert.ok(['seat', 'next-round', 'spectate'].includes(kit.joinMidGame));
    for (const fn of ['setup', 'reduce', 'tick', 'view', 'summary']) assert.equal(typeof kit[fn], 'function', `${fn} is not a function`);
    assert.ok(Array.isArray(script) && script.length > 0, 'a kit needs a demoScript (or pass script) so it can be exercised');
  });

  test(`${label}: the blurb, when there is one, is a short plain sentence`, () => {
    if (typeof kit.blurb !== 'function') return;
    for (const config of [defaults(kit.config), { ...defaults(kit.config), ...(kit.demoConfig || {}) }, game.config || {}]) {
      const text = kit.blurb({ ...defaults(kit.config), ...config }, game.content || {});
      assert.equal(typeof text, 'string');
      assert.ok(text.trim().length > 0 && text.length <= 120, `blurb is ${text.length} characters: ${text}`);
      assert.doesNotMatch(text, /[\u2014\u2013]/, 'no dashes in a blurb');
      assert.match(text, /[.!?]$/, 'a blurb ends like a sentence');
    }
  });

  if (opts.file) {
    test(`${label}: source reads no clock and no randomness of its own (R1)`, () => {
      const path = opts.file.startsWith('file:') ? fileURLToPath(opts.file) : opts.file;
      const source = readFileSync(path, 'utf8').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
      for (const re of IMPURE) assert.doesNotMatch(source, re, `kit source uses ${re}`);
    });
  }

  test(`${label}: setup produces plain state that survives JSON and starts playing`, () => {
    const sim = simulate(kit, game, players);
    assert.deepEqual(JSON.parse(JSON.stringify(sim.state)), sim.state);
    assert.equal(sim.summary().phase, 'playing');
    assert.ok(sim.view(players[0]));
    assert.ok(sim.view(null), 'a spectator view must exist');
  });

  test(`${label}: the same script gives the same game twice (determinism)`, () => {
    const a = simulate(kit, game, players).run(script);
    const b = simulate(kit, game, players).run(script);
    assert.deepEqual(a.state, b.state);
    assert.deepEqual(a.log.map(({ t, ...e }) => e), b.log.map(({ t, ...e }) => e));
  });

  test(`${label}: an unknown action throws a KitError and changes nothing`, () => {
    const sim = simulate(kit, game, players);
    const before = sim.state;
    assert.throws(() => sim.do(players[0], 'definitely/not/a/thing'), (err) => err instanceof KitError && typeof err.code === 'string');
    assert.equal(sim.state, before);
  });

  test(`${label}: unknown player and host events are ignored (R6)`, () => {
    const sim = simulate(kit, game, players);
    const before = sim.state;
    sim.system('player/waved', { playerId: players[0] });
    sim.system('host/sneezed', {});
    assert.deepEqual(sim.state, before);
  });

  test(`${label}: every offered action is accepted (R3), views never leak (R2), ticks move forward (R4)`, () => {
    const sim = simulate(kit, game, players);
    const check = () => {
      for (const who of [...sim.players.map((p) => p.id), null]) {
        const view = sim.view(who);
        assert.equal(typeof view.phase, 'string', 'view.phase must be a string');
        for (const action of view.actions) {
          assert.equal(typeof action.type, 'string');
          assert.equal(typeof action.label, 'string');
          if (action.disabled || who === null) continue;
          if (action.host && who !== sim.hostId) continue;
          const trial = cloneSim(sim);
          assert.doesNotThrow(() => trial.do(who, action.type, action.payload), `offered action ${action.type} for ${who} was refused`);
        }
      }
      if (opts.secretValues) {
        const secrets = opts.secretValues(sim).map((v) => JSON.stringify(v));
        for (const who of [...sim.players.map((p) => p.id), null]) {
          const text = JSON.stringify(sim.view(who));
          for (const s of secrets) assert.ok(s.length < 3 || !text.includes(s), `a secret value appears in the view for ${who ?? 'a spectator'}`);
        }
      }
    };
    check();
    for (const step of script) {
      sim.run([step]);
      check();
    }
    assert.ok(JSON.stringify(sim.state).length < STATE_LIMIT, 'state grew past 64 KB (R8)');
    const summary = sim.summary();
    assert.ok(['playing', 'over'].includes(summary.phase));
    assert.ok(Array.isArray(summary.scores) && Array.isArray(summary.winnerIds));
    const ids = new Set(sim.players.map((p) => p.id));
    for (const id of summary.winnerIds) assert.ok(ids.has(id), `winner ${id} is not at the table`);
  });

  test(`${label}: ticking is idempotent and waiting a long time never loops`, () => {
    const sim = simulate(kit, game, players);
    sim.wait(6 * 60 * 60 * 1000);
    assert.ok(sim.state.wakeAt === null || sim.state.wakeAt > sim.now);
    const before = sim.state;
    sim.wait(1000);
    if (before.wakeAt === null) assert.deepEqual(sim.state, before);
  });

  test(`${label}: players coming and going mid-game never breaks it (R6, R7)`, () => {
    const rng = makeRng(`fuzz-${kit.id}`, 0);
    const extra = ['zed', 'yun', 'xia'];
    for (let round = 0; round < 3; round++) {
      const sim = simulate(kit, game, players);
      let joined = 0;
      const attempt = (fn) => {
        try { fn(); } catch (err) {
          // Kits may refuse a stale scripted action once the table changed; only KitErrors are fine here.
          if (!(err instanceof KitError)) throw err;
        }
      };
      for (const step of script) {
        attempt(() => sim.run([step]));
        const roll = rng();
        if (roll < 0.2 && joined < extra.length && sim.players.length < kit.maxPlayers) sim.join(extra[joined++]);
        else if (roll < 0.4 && sim.players.length > 1) sim.leave(sim.players[sim.players.length - 1].id);
        else if (roll < 0.5) { const p = sim.players.find((x) => !x.connected); if (p) sim.return(p.id); }
        else if (roll < 0.6 && sim.players.length > kit.minPlayers) sim.remove(sim.players[sim.players.length - 1].id);
        else if (roll < 0.7 && sim.players.length > 1) sim.transferHost(sim.players[1].id);
        for (const who of [...sim.players.map((p) => p.id), null]) sim.view(who);
        assert.deepEqual(JSON.parse(JSON.stringify(sim.state)), sim.state);
      }
      sim.wait(60 * 60 * 1000);
      const summary = sim.summary();
      const ids = new Set(sim.players.map((p) => p.id));
      for (const id of summary.winnerIds) assert.ok(ids.has(id));
    }
  });
}

/** A cheap copy of a sim at its current state, for trying an action without keeping it. */
function cloneSim(sim) {
  const copy = simulate(sim.kit, { config: sim.config, content: sim.content, decks: sim.decks, recent: sim.recent }, sim.players.map((p) => p.id), { seed: sim.seed, now: sim.now });
  copy.players = sim.players.map((p) => ({ ...p }));
  copy.hostId = sim.hostId;
  copy.state = sim.state;
  copy.now = sim.now;
  return copy;
}
