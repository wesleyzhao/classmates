// Room snapshots that look like the real thing, for looking at screens without a server.
// public/dev/screens.html renders any screen against one of these, which is how the client
// gets reviewed at phone width and desktop width in both themes before a room exists.
//
// They are typed as RoomSnapshot on purpose: if the contract in types/parlor.d.ts moves,
// `npm run check` fails here first, and the fixtures get fixed rather than drifting.

/** @typedef {import('../../types/parlor.js').RoomSnapshot} RoomSnapshot */

const NOW = Date.now();
const MINUTE = 60 * 1000;

/** @type {import('../../types/parlor.js').PlayerInfo[]} */
const PLAYERS = [
  { id: 'p1', name: 'Wesley', avatar: '🦊', seat: 0, connected: true, isHost: true, joinedAt: NOW - 8 * MINUTE, lastSeen: NOW },
  { id: 'p2', name: 'Nina', avatar: '🐙', seat: 1, connected: true, isHost: false, joinedAt: NOW - 5 * MINUTE, lastSeen: NOW },
  { id: 'p3', name: 'Sam', avatar: '🐼', seat: 2, connected: true, isHost: false, joinedAt: NOW - 4000, lastSeen: NOW },
];

/** @type {import('../../types/parlor.js').RoomGameSnapshot} */
const GAME = {
  id: 'tally',
  slug: 'tally',
  title: 'Flags of Europe',
  emoji: '🇵🇹',
  kitId: 'tally',
  kitVersion: 1,
  config: { target: 10, seconds: 30 },
  content: {},
  theme: 'editorial',
  deckIds: [],
  deckVersions: {},
  // The kit's own settings line, computed on the server from kit.blurb(). A game whose kit
  // does not write one arrives without this field and the lobby falls back to the labels.
  blurb: 'Ten cards, fifteen seconds each. Tap one of four answers.',
};

/** @type {import('../../types/parlor.js').ChatMessage[]} */
const CHAT = [
  { id: 'c1', t: NOW - 3 * MINUTE, playerId: 'p2', text: 'Is this the one where Sam always wins?' },
  { id: 'c2', t: NOW - 2 * MINUTE, playerId: 'p3', text: 'Only the Europe one. Ask me about Oceania.' },
  { id: 'c3', t: NOW - MINUTE, playerId: 'p1', text: 'Starting in a minute, waiting for Ali.' },
];

/** @type {import('../../types/parlor.js').LogEntry[]} */
const LOG = [
  { n: 1, t: NOW - 8 * MINUTE, type: 'joined', playerId: 'p1' },
  { n: 2, t: NOW - 5 * MINUTE, type: 'joined', playerId: 'p2' },
  { n: 3, t: NOW - 4000, type: 'joined', playerId: 'p3' },
];

/** Three people in a room that has not started. @type {RoomSnapshot} */
export const lobby = {
  v: 4,
  now: NOW,
  room: {
    code: 'MKRT',
    phase: 'lobby',
    hostId: 'p1',
    players: PLAYERS,
    game: GAME,
    chat: CHAT,
    log: LOG,
    logN: 3,
    games: 0,
    canUndo: false,
    canTakeOver: false,
  },
  view: null,
  summary: null,
};

/** A tally game halfway through, with a deadline running. @type {RoomSnapshot} */
export const playing = {
  v: 19,
  now: NOW,
  room: {
    ...lobby.room,
    phase: 'playing',
    log: [...LOG, { n: 4, t: NOW - 20000, type: 'started', seconds: 30 }, { n: 5, t: NOW - 4000, type: 'answered', playerId: 'p2' }],
    logN: 5,
    canUndo: true,
    canTakeOver: false,
  },
  view: {
    phase: 'playing',
    target: 10,
    taps: { p1: 6, p2: 4, p3: 2 },
    mine: 6,
    endsAt: NOW + 9000,
    wakeAt: NOW + 9000,
    winnerId: null,
    reason: null,
    waitingOn: ['p3'],
    actions: [{ type: 'tap', label: 'Tap', kind: 'primary' }],
  },
  summary: {
    phase: 'playing',
    scores: [
      { playerId: 'p1', score: 6 },
      { playerId: 'p2', score: 4 },
      { playerId: 'p3', score: 2 },
    ],
    winnerIds: [],
    label: 'First to 10',
  },
};

/** The same room, finished. @type {RoomSnapshot} */
export const results = {
  v: 31,
  now: NOW,
  room: {
    ...lobby.room,
    phase: 'over',
    log: [...LOG, { n: 6, t: NOW - 2000, type: 'won', playerId: 'p3', reason: 'target' }],
    logN: 6,
    games: 1,
    canUndo: false,
    canTakeOver: false,
  },
  view: {
    phase: 'over',
    target: 10,
    taps: { p1: 870, p2: 1200, p3: 1240 },
    mine: 870,
    endsAt: NOW - 2000,
    wakeAt: null,
    winnerId: 'p3',
    reason: 'target',
    actions: [],
  },
  summary: {
    phase: 'over',
    scores: [
      { playerId: 'p3', score: 1240, label: '8 of 10' },
      { playerId: 'p2', score: 1200, label: '8 of 10' },
      { playerId: 'p1', score: 870, label: '6 of 10' },
    ],
    winnerIds: ['p3'],
    label: 'Ten cards',
  },
};

/** What GET /api/games answers with, for screens that ask. */
export const games = [
  { id: 'g1', slug: 'flags-of-the-world', title: 'Flags of the World', description: 'Everyone guesses the same flag. Quick answers score more.', emoji: '🌍', kitId: 'tally', theme: 'editorial' },
  { id: 'g2', slug: 'capitals', title: 'Capitals', description: 'Name the capital before the clock does.', emoji: '🏛️', kitId: 'tally', theme: 'editorial' },
  { id: 'g3', slug: 'trivial-pursuit', title: 'Trivial Pursuit', description: 'The classic wheel. Roll, move, win six wedges, make for the hub.', emoji: '🎲', kitId: 'tally', theme: 'playful' },
  { id: 'g4', slug: 'crazy-eights', title: 'Crazy Eights', description: 'Match the suit or the number. Eights change everything.', emoji: '🃏', kitId: 'tally', theme: 'playful' },
  { id: 'g5', slug: 'pub-trivia', title: 'Pub Trivia', description: 'Six categories, ten cards, no phones under the table.', emoji: '🍻', kitId: 'tally', theme: 'editorial' },
];
