// Every sentence a screen builds and every number it compares lives in public/app/lib.js,
// so it can be checked here without rendering anything. If a screen is ever found doing
// this arithmetic inline, the fix is to move it into lib.js and add a case below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, barActions, formatScore, joinWords, lastLogN, logSince, playerName, playerNote, plural,
  roomPath, settingsLine, settingsSummary, shareText, standingsRows, unreadCount,
  waitingLine, winnerLine, winnerTitle,
} from '../../public/app/lib.js';

/** @typedef {import('../../types/parlor.js').Schema} Schema */
/** @typedef {import('../../types/parlor.js').Summary} Summary */

/** @param {Partial<import('../../types/parlor.js').PlayerInfo>} bits */
function player(bits) {
  return { id: 'p1', name: 'Wesley', avatar: '🦊', seat: 0, connected: true, isHost: false, joinedAt: 0, lastSeen: 0, ...bits };
}

const PLAYERS = [
  player({ id: 'p1', name: 'Wesley', avatar: '🦊', isHost: true }),
  player({ id: 'p2', name: 'Nina', avatar: '🐙' }),
  player({ id: 'p3', name: 'Sam', avatar: '🐼' }),
];

// ---------------------------------------------------------------------------

test('the action names the server owns are spelled exactly once', () => {
  assert.equal(ACTIONS.start, 'room/start');
  assert.equal(ACTIONS.kick, 'room/kick');
  assert.equal(ACTIONS.takeover, 'room/takeover');
  assert.equal(ACTIONS.chat, 'chat/send');
  // player/* and host/* are the platform's own; a client that sends one gets a 400.
  for (const type of Object.values(ACTIONS)) {
    assert.ok(!type.startsWith('player/') && !type.startsWith('host/'), `${type} is a system prefix`);
  }
});

test('the action bar draws what the kit does not', () => {
  /** @type {import('../../types/parlor.js').ViewAction[]} */
  const actions = [
    { type: 'next', label: 'Next card', kind: 'primary' },
    { type: 'skip', label: 'Skip', kind: 'secondary', host: true },
    { type: 'end', label: 'End the game', kind: 'danger', host: true, confirm: 'Everyone goes to the results.' },
    { type: 'play', label: 'Play the eight', kind: /** @type {any} */ ('canvas'), payload: { card: '8c' } },
  ];
  assert.deepEqual(barActions(actions, true).map((a) => a.type), ['next', 'skip', 'end'],
    'the kit draws its own canvas actions, so the bar never does');
  assert.deepEqual(barActions(actions, false).map((a) => a.type), ['next'],
    'host actions are the host\'s alone');
  assert.deepEqual(barActions(undefined, true), [], 'a view with no actions is not an error');
  assert.deepEqual(barActions([], false), []);
});

test('a settings summary reads as one sentence', () => {
  /** @type {Schema} */
  const schema = {
    target: { type: 'number', label: 'Taps to win' },
    seconds: { type: 'number', label: 'Time limit' },
  };
  assert.equal(settingsSummary(schema, { target: 10, seconds: 30 }), 'Taps to win 10, time limit 30.');
  assert.equal(settingsSummary(schema, { target: 10 }), 'Taps to win 10.');
  assert.equal(settingsSummary(schema, {}), '', 'nothing to say means no line at all');
  assert.equal(settingsSummary({}, { target: 10 }), '', 'a setting the kit does not define is not shown');
});

test('a settings summary stops before it becomes a paragraph', () => {
  /** @type {Schema} */
  const schema = {
    cards: { type: 'number', label: 'Cards' },
    seconds: { type: 'number', label: 'Seconds per card' },
    mode: { type: 'choice', label: 'How people answer', options: ['Tap a choice'] },
    auto: { type: 'bool', label: 'Move on automatically' },
    source: { type: 'choice', label: 'Where the choices come from', options: ['The card, then the deck'] },
  };
  assert.equal(
    settingsSummary(schema, { cards: 10, seconds: 15, mode: 'Tap a choice', auto: true, source: 'The card, then the deck' }),
    'Cards 10, seconds per card 15, tap a choice.',
  );
});

test('a settings summary leaves out the settings that are whole sentences', () => {
  // The cards kit labels its switches with the rule they turn on. Three of those in a row is
  // a paragraph, so the line keeps only what fits, and says nothing when nothing does.
  /** @type {Schema} */
  const schema = {
    twos: { type: 'bool', label: 'A two makes the next player draw two' },
    specials: { type: 'multi', label: 'Special cards', options: ['A queen skips the next player', 'An ace reverses the direction'] },
    turns: { type: 'number', label: 'Turn limit' },
  };
  assert.equal(
    settingsSummary(schema, { twos: true, specials: ['A queen skips the next player'], turns: 300 }),
    'Turn limit 300.',
  );
  assert.equal(settingsSummary(schema, { twos: true }), '');
});

test('a settings summary uses the labels the schema gives choices', () => {
  /** @type {Schema} */
  const schema = {
    mode: { type: 'choice', label: 'How people answer', options: [{ value: 'tap', label: 'tapping a choice' }, 'typing'] },
    auto: { type: 'bool', label: 'Move on automatically' },
    packs: { type: 'multi', label: 'Packs', options: ['Europe', 'Asia', 'Africa'] },
  };
  assert.equal(settingsSummary(schema, { mode: 'tap' }), 'Tapping a choice.',
    "a choice's label is usually a question, and the value already answers it");
  assert.equal(settingsSummary(schema, { auto: true }), 'Move on automatically.');
  assert.equal(settingsSummary(schema, { auto: false }), '', 'a setting that is off is not worth a word');
  assert.equal(settingsSummary(schema, { packs: ['Europe', 'Asia'] }), 'Europe and Asia.');
});

test("a kit's own settings line wins, and anything doubtful falls back", () => {
  /** @type {Schema} */
  const schema = { target: { type: 'number', label: 'Taps to win' } };
  const written = 'Ten cards, fifteen seconds each. Tap one of four answers.';
  const fallback = 'Taps to win 10.';

  assert.equal(settingsLine({ blurb: written, config: { target: 10 } }, schema), written);
  assert.equal(settingsLine({ blurb: `  ${written}  `, config: {} }, schema), written, 'trimmed');

  // Everything a kit might hand over that is not the one short sentence it promised.
  assert.equal(settingsLine({ config: { target: 10 } }, schema), fallback, 'no blurb');
  assert.equal(settingsLine({ blurb: '   ', config: { target: 10 } }, schema), fallback, 'empty blurb');
  assert.equal(settingsLine({ blurb: /** @type {any} */ (42), config: { target: 10 } }, schema), fallback, 'not a string');
  assert.equal(settingsLine({ blurb: 'x'.repeat(121), config: { target: 10 } }, schema), fallback,
    'past 120 characters it is not one sentence, and half a sentence reads worse than a plain one');
  assert.equal(settingsLine({ blurb: 'x'.repeat(120), config: {} }, schema), 'x'.repeat(120), 'exactly 120 is allowed');

  assert.equal(settingsLine(null, schema), '', 'no game, no line');
  assert.equal(settingsLine({ config: {} }, schema), '', 'nothing set and no blurb says nothing');
});

test('standings deltas come from the scores before the last change', () => {
  /** @type {Summary} */
  const summary = {
    phase: 'playing',
    scores: [{ playerId: 'p2', score: 500 }, { playerId: 'p3', score: 350 }, { playerId: 'p1', score: 290 }],
    winnerIds: [],
  };
  const rows = standingsRows(summary, PLAYERS, { p1: 290, p2: 320, p3: 350 }, 'p1');
  assert.deepEqual(rows.map((row) => row.rank), [1, 2, 3]);
  assert.deepEqual(rows.map((row) => row.delta), [180, 0, 0]);
  assert.deepEqual(rows.map((row) => row.name), ['Nina', 'Sam', 'You']);
  assert.equal(rows[2].isMe, true);
  assert.equal(rows[0].avatar, '🐙');
});

test('standings work with nothing to compare against', () => {
  /** @type {Summary} */
  const summary = { phase: 'playing', scores: [{ playerId: 'p1', score: 40 }], winnerIds: ['p1'] };
  const [row] = standingsRows(summary, PLAYERS, null, 'p2');
  assert.equal(row.delta, 0);
  assert.equal(row.name, 'Wesley');
  assert.equal(row.isWinner, true);
});

test("a kit's own row label wins over a delta, and a player who left still has a row", () => {
  /** @type {Summary} */
  const summary = { phase: 'playing', scores: [{ playerId: 'p9', score: 10, label: 'Spain' }], winnerIds: [] };
  const [row] = standingsRows(summary, PLAYERS, { p9: 0 }, 'p1');
  assert.equal(row.label, 'Spain');
  assert.equal(row.name, 'Someone');
  assert.equal(row.avatar, '🙂');
});


test('unread counts what arrived after the last line you saw, and never your own', () => {
  const chat = [
    { id: 'a', t: 100, playerId: 'p2', text: 'one' },
    { id: 'b', t: 200, playerId: 'p1', text: 'two' },
    { id: 'c', t: 300, playerId: 'p3', text: 'three' },
  ];
  assert.equal(unreadCount(chat, null, 'p1'), 2);
  assert.equal(unreadCount(chat, 'a', 'p1'), 1);
  assert.equal(unreadCount(chat, 'c', 'p1'), 0);
  assert.equal(unreadCount(chat, null, null), 3);
  assert.equal(unreadCount(null, null, 'p1'), 0);
  // The line last seen has been trimmed off the front: everything is new, and that is honest.
  assert.equal(unreadCount(chat, 'gone', 'p1'), 2);
});

test('the share text carries the code and a link that opens the room', () => {
  const shared = shareText({ code: 'MKRT', gameTitle: 'Flags of Europe', origin: 'https://parlor.example' });
  assert.equal(shared.url, 'https://parlor.example/r/MKRT');
  assert.equal(shared.text, 'Join my game of Flags of Europe on Parlor. The room code is MKRT.');
  assert.equal(shared.title, 'Parlor: Flags of Europe');
  assert.equal(shareText({ code: 'MKRT', origin: 'https://x.test' }).text, 'Join my game on Parlor. The room code is MKRT.');
  assert.equal(roomPath('mkrt'), '/r/MKRT');
});

test('the results headline says who won and how', () => {
  /** @type {Summary} */
  const won = { phase: 'over', scores: [{ playerId: 'p3', score: 1240 }, { playerId: 'p2', score: 1200 }], winnerIds: ['p3'] };
  assert.equal(winnerTitle(won, PLAYERS, 'p1'), 'Sam wins');
  assert.equal(winnerTitle(won, PLAYERS, 'p3'), 'You win');
  assert.equal(winnerLine(won, PLAYERS, 'p1'), '1,240 points. Nina was 40 behind.');
  assert.equal(winnerLine(won, PLAYERS, 'p2'), '1,240 points. You were 40 behind.');

  /** @type {Summary} */
  const tied = { phase: 'over', scores: [{ playerId: 'p2', score: 10 }, { playerId: 'p3', score: 10 }], winnerIds: ['p2', 'p3'] };
  assert.equal(winnerTitle(tied, PLAYERS, 'p1'), 'Nina and Sam tie');
  assert.equal(winnerLine(tied, PLAYERS, 'p1'), '10 points each, and no way to split them.');

  /** @type {Summary} */
  const alone = { phase: 'over', scores: [{ playerId: 'p1', score: 1 }], winnerIds: ['p1'] };
  assert.equal(winnerLine(alone, PLAYERS, 'p2'), '1 point on the board.');

  /** @type {Summary} */
  const nobody = { phase: 'over', scores: [], winnerIds: [] };
  assert.equal(winnerTitle(nobody, PLAYERS, 'p1'), 'Nobody wins');
  assert.equal(winnerLine(nobody, PLAYERS, 'p1'), 'Nobody scored this time.');
});

test('the gone quiet line only names people who are actually gone', () => {
  const away = [PLAYERS[0], player({ id: 'p2', name: 'Nina', connected: false }), player({ id: 'p3', name: 'Sam', connected: false })];
  assert.equal(waitingLine({ phase: 'x', actions: [], waitingOn: ['p2'] }, away), 'Nina has gone quiet.');
  assert.equal(waitingLine({ phase: 'x', actions: [], waitingOn: ['p2', 'p3'] }, away), 'Nina and Sam have gone quiet.');
  assert.equal(waitingLine({ phase: 'x', actions: [], waitingOn: ['p1'] }, away), '', 'waiting on someone who is here is just waiting');
  assert.equal(waitingLine({ phase: 'x', actions: [] }, away), '');
  assert.equal(waitingLine(null, away), '');
});

test('the end label on a lobby row', () => {
  const now = 1_000_000;
  assert.equal(playerNote(player({ joinedAt: now - 1000 }), now), 'just joined');
  assert.equal(playerNote(player({ joinedAt: now - 90_000 }), now), '');
  assert.equal(playerNote(player({ joinedAt: now - 1000, connected: false }), now), 'gone quiet');
});

test('names, numbers and lists read the way people say them', () => {
  assert.equal(playerName(PLAYERS[0], 'p1'), 'You');
  assert.equal(playerName(PLAYERS[0], 'p2'), 'Wesley');
  assert.equal(playerName(null, 'p1'), 'Someone');
  assert.equal(formatScore(1240), '1,240');
  assert.equal(formatScore('nonsense'), '0');
  assert.equal(joinWords(['a']), 'a');
  assert.equal(joinWords(['a', 'b']), 'a and b');
  assert.equal(joinWords(['a', 'b', 'c']), 'a, b and c');
  assert.equal(joinWords([]), '');
  assert.equal(plural(1, 'more player', 'more players'), '1 more player');
  assert.equal(plural(2, 'more player', 'more players'), '2 more players');
});

test('the log is read by n, so a device that missed a poll catches up exactly once', () => {
  const log = [
    { n: 4, t: 1, type: 'answered' },
    { n: 5, t: 2, type: 'react', emoji: '🔥' },
    { n: 6, t: 3, type: 'won' },
  ];
  assert.equal(lastLogN(log), 6);
  assert.equal(lastLogN([]), 0);
  assert.deepEqual(logSince(log, 4).map((entry) => entry.n), [5, 6]);
  assert.deepEqual(logSince(log, 6), []);
  assert.deepEqual(logSince(null, 0), []);
});
