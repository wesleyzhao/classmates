// `npm run smoke -- https://parlor.example.com`: play a real round against a real deployment,
// through the public API and nothing else. It opens a room, brings in a second player, starts
// the game, answers a card from both seats, waits for the answer to go up, and says something
// in the chat. One line per step, and a non-zero exit the moment anything is wrong.
//
// This is the check that runs after a deploy, so it uses no test helpers, no store, and no
// imports from the project: if it passes, a person with a phone can play.
//
//   node scripts/smoke.js http://localhost:3000
//   node scripts/smoke.js https://parlor.example.com --game pub-trivia

import { pathToFileURL } from 'node:url';

const DEFAULT_BASE = 'http://localhost:3000';
const DEFAULT_GAME = 'flags-world';
/** How long to wait for the answer to go up before calling it stuck. */
const REVEAL_TIMEOUT_MS = 40_000;
/** How often to poll the version endpoint, which is what a browser does. */
const POLL_MS = 700;

/** @typedef {{ name: string, playerId: string, secret: string }} Player */

let failures = 0;

/**
 * Run one step, print a line about it, and hand back what it returned.
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} body
 * @returns {Promise<T>}
 */
async function step(name, body) {
  const started = Date.now();
  try {
    const result = await body();
    const detail = typeof result === 'object' && result && '$note' in result ? ` ${result.$note}` : '';
    console.log(`ok    ${name}${detail} (${Date.now() - started}ms)`);
    return result;
  } catch (err) {
    failures += 1;
    console.error(`fail  ${name}: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * One API call. Errors come back from the server as JSON with a message a player would read,
 * so that message is what this reports.
 * @param {string} base
 * @param {string} path
 * @param {{ method?: string, body?: unknown, as?: Player | null }} [opts]
 * @returns {Promise<any>}
 */
async function api(base, path, opts = {}) {
  const headers = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.as) {
    headers['x-player-id'] = opts.as.playerId;
    headers['x-player-secret'] = opts.as.secret;
  }
  const response = await fetch(`${base}${path}`, {
    method: opts.method || (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const message = data && data.error ? data.error : text.slice(0, 200) || 'no body';
    throw new Error(`${opts.method || 'GET'} ${path} returned ${response.status}: ${message}`);
  }
  return data;
}

/** A client-generated action id, the way the browser makes one. */
function actionId() {
  return `smoke-${Math.random().toString(36).slice(2, 10)}`;
}

/** @param {number} ms */
function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Poll the cheap version endpoint, and read the full snapshot only when the version moves.
 * This is exactly what a browser does, so it also proves the polling contract works.
 * @param {string} base
 * @param {string} code
 * @param {Player} as
 * @param {(snapshot: any) => boolean} done
 * @param {string} what  what we are waiting for, for the error message
 * @returns {Promise<any>}
 */
async function pollUntil(base, code, as, done, what) {
  const deadline = Date.now() + REVEAL_TIMEOUT_MS;
  let lastVersion = -1;
  let polls = 0;
  while (Date.now() < deadline) {
    const version = await api(base, `/api/rooms/${code}/v`);
    polls += 1;
    if (version.v !== lastVersion) {
      lastVersion = version.v;
      const snapshot = await api(base, `/api/rooms/${code}`, { as });
      if (done(snapshot)) return { ...snapshot, $polls: polls };
    }
    await wait(POLL_MS);
  }
  throw new Error(`waited ${REVEAL_TIMEOUT_MS}ms for ${what} and it never happened`);
}

/**
 * Play one card from both seats and check the answer goes up.
 * @param {string} base
 * @param {string} gameId
 * @returns {Promise<number>}  a process exit code
 */
export async function smoke(base, gameId) {
  const health = await step('health', async () => {
    const body = await api(base, '/api/health');
    if (!body.ok) throw new Error('the server says it is not ok');
    return { ...body, $note: `store ${body.store?.name || '?'}, kits ${(body.kits || []).join(' ')}` };
  });

  await step('list games', async () => {
    const body = await api(base, '/api/games');
    const games = body.games || [];
    const found = games.find((g) => g.id === gameId || g.slug === gameId);
    if (!found) throw new Error(`${gameId} is not in the catalog (${games.map((g) => g.id).join(', ') || 'it is empty'})`);
    return { $note: `${games.length} games, including ${found.title}` };
  });

  const created = await step('create a room as Ann', async () => {
    const body = await api(base, '/api/rooms', { body: { gameId, name: 'Ann', avatar: '🦊' } });
    if (!body.code || !body.playerId || !body.secret) throw new Error('the room came back without a code or a seat');
    return { ...body, $note: `code ${body.code}` };
  });
  const code = created.code;
  /** @type {Player} */
  const ann = { name: 'Ann', playerId: created.playerId, secret: created.secret };

  const joined = await step('join as Ben', async () => {
    const body = await api(base, `/api/rooms/${code}/join`, { body: { name: 'Ben', avatar: '🐢' } });
    if (!body.playerId || !body.secret) throw new Error('joining came back without a seat');
    if ((body.room?.players || []).length !== 2) throw new Error(`expected two players, found ${body.room?.players?.length}`);
    return { ...body, $note: 'two at the table' };
  });
  /** @type {Player} */
  const ben = { name: 'Ben', playerId: joined.playerId, secret: joined.secret };

  const started = await step('the host starts the game', async () => {
    const body = await api(base, `/api/rooms/${code}/act`, {
      as: ann,
      body: { id: actionId(), type: 'room/start' },
    });
    if (body.room?.phase !== 'playing') throw new Error(`expected to be playing, room says ${body.room?.phase}`);
    const round = body.view?.round;
    if (!round?.card?.prompt) throw new Error('the game started without a card');
    return { ...body, $note: `card 1 of ${body.view.progress?.total}: ${round.card.prompt}` };
  });

  const round = started.view.round;
  const choices = round.card.choices || [];
  if (choices.length < 2) {
    console.error(`fail  answer the card: this game does not offer choices, so a smoke run cannot tap one`);
    return 1;
  }

  /** @type {Array<{ player: Player, pick: number }>} */
  const turns = [{ player: ann, pick: 0 }, { player: ben, pick: 1 % choices.length }];
  for (const { player, pick } of turns) {
    await step(`${player.name} answers`, async () => {
      const body = await api(base, `/api/rooms/${code}/act`, {
        as: player,
        body: { id: actionId(), type: 'answer', payload: { n: round.n, value: pick } },
      });
      const answered = body.view?.round?.answeredIds || [];
      if (!answered.includes(player.playerId)) throw new Error('the answer was not recorded');
      return { $note: `picked "${choices[pick]}"` };
    });
  }

  const revealed = await step('the answer goes up', async () => {
    const snapshot = await pollUntil(base, code, ann, (s) => s.view?.phase !== 'card', 'the reveal');
    const answer = snapshot.view?.round?.answer;
    if (!answer) throw new Error('the reveal came with no answer on it');
    return { ...snapshot, $note: `${answer}, after ${snapshot.$polls} polls` };
  });

  await step('scores moved', async () => {
    const standings = revealed.summary?.scores || [];
    if (standings.length !== 2) throw new Error(`expected two scores, found ${standings.length}`);
    const mine = revealed.view?.round?.mine;
    return { $note: mine?.correct ? 'Ann had it' : 'Ann did not have it, which still counts as playing' };
  });

  await step('say something in the chat', async () => {
    const line = 'Good card.';
    const body = await api(base, `/api/rooms/${code}/act`, {
      as: ben,
      body: { id: actionId(), type: 'chat/send', payload: { text: line } },
    });
    const chat = body.room?.chat || [];
    if (!chat.some((m) => m.text === line && m.playerId === ben.playerId)) throw new Error('the line is not in the chat');
    return { $note: `${chat.length} in the chat` };
  });

  console.log(`\nPlayed a card of ${gameId} at ${base} on Node ${health.node || '?'}. Room ${code}.`);
  return 0;
}

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}  a process exit code
 */
export async function main(argv = process.argv.slice(2)) {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const base = (positional[0] || process.env.PARLOR_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const gameFlag = argv.indexOf('--game');
  const gameId = gameFlag >= 0 ? argv[gameFlag + 1] : DEFAULT_GAME;

  console.log(`Playing ${gameId} at ${base}\n`);
  try {
    return await smoke(base, gameId);
  } catch {
    // Every step reports itself; this is only here so one bad step ends the run.
    return failures ? 1 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
