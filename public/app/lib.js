// Pure helpers the screens share: the sentences they build, the numbers they compare,
// and the action names they send. Nothing here touches the DOM or the network, so every
// line of copy and arithmetic a player depends on can be unit tested (tests/client/render.test.js).
//
// If a screen is about to compute a string or a delta inline, it belongs here instead.

/**
 * The platform actions the shell sends. They live in one object because the server names
 * them and the client only echoes them: if a name changes over there, this is the one
 * place to change here. Kit actions are not listed; those come from `view.actions`.
 */
export const ACTIONS = {
  /** The host starts the game from the lobby. No payload. */
  start: 'room/start',
  /** "Play again" on the results screen. Host only. */
  restart: 'room/restart',
  /** The player left on purpose and gives up their seat. */
  leave: 'room/leave',
  /** Their tab closed; they keep their seat. Sent with sendBeacon on pagehide. */
  away: 'room/away',
  /** They came back. The counterpart to away, sent when a screen mounts. */
  hello: 'room/hello',
  /** The host takes back the last action. Host only. */
  undo: 'room/undo',
  /** A chat message: { text }. */
  chat: 'chat/send',
  /** An emoji reaction: { emoji }. */
  react: 'chat/react',
  /** The host removes someone: { playerId }. Host only. */
  kick: 'room/kick',
  /** A player changes their own name: { name }. */
  rename: 'room/rename',
  /** A player changes their own avatar: { avatar }. Renaming both means sending both. */
  avatar: 'room/avatar',
  /** Any player takes the host's place when the host has gone quiet. */
  takeover: 'room/takeover',
  /** The host changes the game's settings in the lobby: { config }. */
  settings: 'room/settings',
};

/** Someone who joined this recently still reads as new to the table. */
export const JUST_JOINED_MS = 45 * 1000;

/** The path of a room on this site. */
export function roomPath(code) {
  return `/r/${String(code || '').toUpperCase()}`;
}

/**
 * The link a player shares, and the sentence that goes with it.
 * @param {{ code: string, gameTitle?: string, origin?: string }} room
 * @returns {{ title: string, text: string, url: string }}
 */
export function shareText({ code, gameTitle, origin }) {
  const base = origin || (typeof location === 'undefined' ? '' : location.origin);
  const title = gameTitle ? `Parlor: ${gameTitle}` : 'Parlor';
  const game = gameTitle ? `my game of ${gameTitle}` : 'my game';
  return {
    title,
    text: `Join ${game} on Parlor. The room code is ${code}.`,
    url: `${base}${roomPath(code)}`,
  };
}

/** The longest a kit's own settings line may be. Past this it is not the one sentence it promised. */
const BLURB_MAX = 120;

/**
 * The line under the player list that says how this room is set up.
 *
 * A kit may write its own (`kit.blurb(ctx)`, computed on the server and attached to the game
 * in the snapshot), which is always better than anything assembled from labels: "Ten cards,
 * fifteen seconds each. Tap one of four answers." When there is no blurb, or it does not look
 * like the one short sentence it is supposed to be, this falls back to `settingsSummary`,
 * which works for any kit including ones nobody has written a blurb for yet.
 *
 * @param {{ blurb?: unknown, config?: Record<string, unknown> } | null} game  the game in a snapshot
 * @param {import('../../types/parlor.js').Schema} schema  the kit's config schema
 * @returns {string} '' when there is nothing worth saying
 */
export function settingsLine(game, schema) {
  const blurb = typeof (game && game.blurb) === 'string' ? String(game.blurb).trim() : '';
  // Too long is a fallback, not a truncation: half a sentence reads worse than a plain one.
  if (blurb && blurb.length <= BLURB_MAX) return blurb;
  return settingsSummary(schema, (game && game.config) || {});
}

/** How many settings fit in one readable line before it stops being a line. */
const SUMMARY_MAX = 3;
/** A setting longer than this is a sentence, and a sentence does not belong in a list. */
const SUMMARY_WORDS = 5;

/**
 * One line describing how this room is set up, built from the kit's own labels.
 *
 * Each setting contributes as little as it can get away with, because a label and a value
 * jammed together read as a run-on: a number keeps its label ("cards 10"), a switch is just
 * its label ("move on automatically"), and a choice is just the value ("tap a choice"),
 * since a choice's label is usually a question and its value already answers it.
 *
 * A setting that still does not fit in a few words is left out rather than mangled. Some
 * kits label a switch with the whole rule it turns on ("A two makes the next player draw
 * two"), and three of those in a row is a paragraph, not a summary. Three settings is the
 * most this line carries.
 *
 * This is the honest mechanical fallback. A kit whose settings deserve a real sentence
 * should say so itself rather than hope this reads well.
 *
 * @param {import('../../types/parlor.js').Schema} schema  the kit's config schema
 * @param {Record<string, unknown>} config  the room's settings
 * @returns {string} e.g. "Taps to win 10, time limit 30." or '' when there is nothing to say
 */
export function settingsSummary(schema, config) {
  const parts = [];
  for (const [name, field] of Object.entries(schema || {})) {
    if (parts.length >= SUMMARY_MAX) break;
    const value = (config || {})[name];
    if (value === undefined || value === null || value === '') continue;
    const label = lowerFirst(String(field.label || name));
    if (field.type === 'bool') {
      if (value) add(parts, label);
      continue;
    }
    const shown = showValue(field, value);
    if (!shown) continue;
    // A chosen value speaks for itself; a number needs to say what it counts.
    add(parts, field.options ? lowerFirst(shown) : `${label} ${shown}`);
  }
  if (!parts.length) return '';
  return asSentence(parts.join(', '));
}

/** Keep a part only if it is short enough to sit in a list with two others. */
function add(parts, part) {
  if (part.trim().split(/\s+/).length <= SUMMARY_WORDS) parts.push(part);
}

/** How one setting's value reads in the summary. */
function showValue(field, value) {
  if (Array.isArray(value)) {
    const items = value.map((item) => optionLabel(field, item)).filter(Boolean);
    return joinWords(items);
  }
  return optionLabel(field, value);
}

/** A choice's label when the schema gave it one, otherwise the raw value. */
function optionLabel(field, value) {
  for (const option of field.options || []) {
    if (typeof option === 'string') {
      if (option === value) return option;
    } else if (option && option.value === value) {
      return option.label;
    }
  }
  return String(value);
}

/** "a, b and c", the way a person lists things out loud. */
export function joinWords(items) {
  const list = items.filter((item) => item !== '' && item !== null && item !== undefined).map(String);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The rows the standings list draws, in the order the kit put them in.
 * @param {import('../../types/parlor.js').Summary | null} summary
 * @param {import('../../types/parlor.js').PlayerInfo[]} players
 * @param {Record<string, number> | null} previous  scores from the snapshot before this one
 * @param {string | null} meId
 */
export function standingsRows(summary, players, previous, meId) {
  const byId = new Map((players || []).map((p) => [p.id, p]));
  return ((summary && summary.scores) || []).map((entry, index) => {
    const player = byId.get(entry.playerId) || null;
    const before = previous ? previous[entry.playerId] : undefined;
    const delta = typeof before === 'number' ? entry.score - before : 0;
    return {
      playerId: entry.playerId,
      rank: index + 1,
      name: playerName(player, meId),
      avatar: (player && player.avatar) || '🙂',
      score: entry.score,
      label: entry.label || '',
      delta,
      isMe: !!meId && entry.playerId === meId,
      isWinner: ((summary && summary.winnerIds) || []).includes(entry.playerId),
    };
  });
}

/**
 * The first sentence of a description, for a list that has room for one line. A game's
 * description opens with its hook ("The classic wheel."), so the list shows that and the
 * game page shows the rest. Splits only on a full stop followed by a space and a capital,
 * so "St. Louis" and "1.5 points" stay whole.
 * @param {string} text
 */
export function firstSentence(text) {
  const clean = String(text || '').trim();
  const cut = clean.search(/[.!?]\s+(?=[A-Z0-9"'])/);
  return cut === -1 ? clean : clean.slice(0, cut + 1);
}

/** What a player is called on screen. Your own row says "You". */
export function playerName(player, meId) {
  if (!player) return 'Someone';
  if (meId && player.id === meId) return 'You';
  return player.name;
}

/** Scores read the way people say them: 1,240. */
export function formatScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

/**
 * How many lines from other people arrived after the one this device last saw. Counted by
 * place in the list rather than by time, so a phone whose clock runs ahead of the server's
 * still gets its badge. A line that has been trimmed off the front counts everything as new,
 * which is the honest answer.
 * @param {Array<{ id: string, playerId: string }> | null | undefined} chat
 * @param {string | null} seenId  the newest line seen, or null for none
 * @param {string | null} meId
 */
export function unreadCount(chat, seenId, meId) {
  const list = chat || [];
  let from = 0;
  if (seenId) {
    const at = list.findIndex((message) => message.id === seenId);
    from = at >= 0 ? at + 1 : 0;
  }
  let count = 0;
  for (let i = from; i < list.length; i++) {
    if (meId && list[i].playerId === meId) continue;
    count += 1;
  }
  return count;
}

/** The headline on the results screen: "Sam wins", "You win", "Nina and Sam tie". */
export function winnerTitle(summary, players, meId) {
  const names = winnerNames(summary, players, meId);
  if (!names.length) return 'Nobody wins';
  if (names.length === 1) return `${names[0]} ${names[0] === 'You' ? 'win' : 'wins'}`;
  return `${joinWords(names)} tie`;
}

/**
 * One sentence under the winner: the score, and how close it was.
 * @param {import('../../types/parlor.js').Summary | null} summary
 * @param {import('../../types/parlor.js').PlayerInfo[]} players
 * @param {string | null} meId
 */
export function winnerLine(summary, players, meId) {
  const scores = (summary && summary.scores) || [];
  if (!scores.length) return 'Nobody scored this time.';
  const top = scores[0];
  const runnerUp = scores[1];
  const byId = new Map((players || []).map((p) => [p.id, p]));
  // A kit whose scores are not points (cards left, wedges, a place on a track) says so, and
  // then its own labels tell the story.
  if (summary && summary.unit === 'labels') {
    if (!runnerUp) return top.label ? `${capitalize(top.label)}.` : '';
    const second = playerName(byId.get(runnerUp.playerId) || null, meId);
    const how = runnerUp.finish || (runnerUp.label ? `finished with ${runnerUp.label}` : '');
    return how ? `${second} ${how}.` : '';
  }
  const points = `${formatScore(top.score)} ${top.score === 1 ? 'point' : 'points'}`;
  if (!runnerUp) return `${points} on the board.`;
  const gap = top.score - runnerUp.score;
  const second = playerName(byId.get(runnerUp.playerId) || null, meId);
  if (gap === 0) return `${points} each, and no way to split them.`;
  return `${points}. ${second} ${second === 'You' ? 'were' : 'was'} ${formatScore(gap)} behind.`;
}

/** @param {string} text */
function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** The winners' names, or an empty list when the kit named none. */
function winnerNames(summary, players, meId) {
  const byId = new Map((players || []).map((p) => [p.id, p]));
  return ((summary && summary.winnerIds) || []).map((id) => playerName(byId.get(id) || null, meId));
}

/**
 * The "gone quiet" line: who the game is waiting for who is not connected.
 * @param {import('../../types/parlor.js').KitView | null} view
 * @param {import('../../types/parlor.js').PlayerInfo[]} players
 * @returns {string} '' when everyone the game needs is here
 */
export function waitingLine(view, players) {
  const waitingOn = (view && view.waitingOn) || [];
  if (!waitingOn.length) return '';
  const byId = new Map((players || []).map((p) => [p.id, p]));
  const quiet = waitingOn.map((id) => byId.get(id)).filter((p) => p && !p.connected);
  if (!quiet.length) return '';
  const names = joinWords(quiet.map((p) => p.name));
  return quiet.length === 1 ? `${names} has gone quiet.` : `${names} have gone quiet.`;
}

/**
 * The end label on a lobby row: what just changed about this player, or nothing.
 * @param {import('../../types/parlor.js').PlayerInfo} player
 * @param {number} now
 */
export function playerNote(player, now) {
  if (!player.connected) return 'gone quiet';
  if (now - player.joinedAt < JUST_JOINED_MS) return 'just joined';
  return '';
}

/**
 * The actions the platform's action bar draws, out of everything a view offers.
 *
 * Two are left out. A `host` action is only for the host. An action with `kind: 'canvas'` is
 * drawn by the kit on its own screen (a card, a board space, a choice tile) and listed in
 * `view.actions` only so the conformance suite can check that `reduce` accepts it: exactly
 * one of the kit and the platform draws any given action, so nothing appears twice.
 *
 * @param {import('../../types/parlor.js').ViewAction[] | undefined} actions
 * @param {boolean} isHost
 * @returns {import('../../types/parlor.js').ViewAction[]}
 */
export function barActions(actions, isHost) {
  return (actions || []).filter((action) => {
    if (action.host && !isHost) return false;
    return action.kind !== 'canvas';
  });
}

/** Log entries the screen has not reacted to yet, oldest first. */
export function logSince(log, lastN) {
  return (log || []).filter((entry) => entry.n > lastN);
}

/** The highest `n` in a log, so the next pass knows where it got to. */
export function lastLogN(log) {
  let highest = 0;
  for (const entry of log || []) if (entry.n > highest) highest = entry.n;
  return highest;
}

/** "3 more" for the lobby's start button, phrased for a count. */
export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function lowerFirst(text) {
  if (!text) return '';
  // Leave an acronym or a proper noun alone; only a plain capital gets lowered.
  if (text.length > 1 && text[1] === text[1].toUpperCase() && text[1] !== text[1].toLowerCase()) return text;
  return text[0].toLowerCase() + text.slice(1);
}

function asSentence(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const capitalised = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}
