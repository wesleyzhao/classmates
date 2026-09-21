// Table talk. The same list and the same compose box are drawn in two places: a rail down
// the side of a wide screen, and a sheet on a phone. Writing it once is the point; a chat
// that behaves differently depending on the width of the screen is two chats to keep right.
//
// System lines (who joined, who left) come from the room's log rather than from chat, so
// they cannot be typed by a player and they survive a chat that has been trimmed.

import { html, useEffect, useRef, useState } from '../h.js';
import { Avatar } from './Avatar.js';
import { Icon } from './Icon.js';
import { Sheet } from './Sheet.js';
import { ACTIONS, playerName, unreadCount } from '../lib.js';
import { pop } from '../sound.js';

/** How long a new line floats at the top of the screen before it goes. */
const PEEK_MS = 4000;

/** Log entries worth a line in the chat, and how each one reads. */
const SYSTEM = {
  joined: (who) => `${who} joined`,
  join: (who) => `${who} joined`,
  left: (who) => `${who} left`,
  leave: (who) => `${who} left`,
  returned: (who) => `${who} came back`,
  return: (who) => `${who} came back`,
  removed: (who) => `${who} was removed`,
  kicked: (who) => `${who} was removed`,
  host: (who) => `${who} is the host now`,
};

/**
 * Whether the chat is open and how much of it is unread. Screens own the state so the
 * topbar button and the sheet agree, and so the rail can ignore unread entirely.
 * @param {any} room  the room half of a snapshot
 * @param {string | null} meId
 */
export function useChatDock(room, meId) {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(/** @type {{ id: string, name: string, avatar: string, text: string } | null} */ (null));
  const lastId = useRef(/** @type {string | null} */ (null));
  const chat = (room && room.chat) || [];
  const players = (room && room.players) || [];
  const newest = chat.length ? chat[chat.length - 1] : null;
  const newestId = newest ? newest.id : null;

  // The newest line this device has read: everything there on arrival, and everything that
  // comes in while the sheet is open. Kept by id rather than by time, so a phone whose clock
  // is ahead of the server's still counts what it has not seen.
  const seenId = useRef(/** @type {string | null | undefined} */ (undefined));
  if (seenId.current === undefined) seenId.current = newestId;
  useEffect(() => {
    if (open) seenId.current = newestId;
  }, [open, newestId]);

  // A line from somebody else, arriving while the sheet is closed, shows itself for a moment
  // and makes a small noise. The first snapshot is history and shows nothing.
  useEffect(() => {
    if (lastId.current === null) { lastId.current = newestId || ''; return undefined; }
    if (!newest || newestId === lastId.current) return undefined;
    lastId.current = newestId;
    if (newest.playerId === meId) return undefined;
    pop();
    if (open || railShowing()) return undefined;
    const who = players.find((p) => p.id === newest.playerId) || null;
    setPeek({ id: newest.id, name: playerName(who, meId), avatar: (who && who.avatar) || '🙂', text: newest.text });
    const timer = setTimeout(() => setPeek(null), PEEK_MS);
    return () => clearTimeout(timer);
  }, [newestId]);

  return {
    open,
    unread: open ? 0 : unreadCount(chat, seenId.current || null, meId),
    peek,
    openChat: () => { setPeek(null); setOpen(true); },
    closeChat: () => setOpen(false),
  };
}

/** Whether the rail is on screen, in which case a new line is already visible. */
function railShowing() {
  return typeof matchMedia === 'function' && matchMedia('(min-width: 900px)').matches;
}

/**
 * The floating line: who said what, tap to open the chat. Hidden on wide screens, where
 * the rail already shows it.
 * @param {{ peek: { id: string, name: string, avatar: string, text: string } | null, onOpen: () => void }} props
 */
export function ChatPeek({ peek, onOpen }) {
  if (!peek) return null;
  return html`
    <button class="chat-peek hide-on-desktop" key=${peek.id} type="button" onClick=${onOpen} aria-live="polite">
      <span class="chat-peek-avatar" aria-hidden="true">${peek.avatar}</span>
      <span class="chat-peek-body">
        <span class="chat-peek-name">${peek.name}</span>
        <span class="chat-peek-text">${peek.text}</span>
      </span>
    </button>`;
}

/**
 * The topbar button that opens the chat on a phone. It is hidden on wide screens, where
 * the rail is already showing everything it would open.
 * @param {{ unread?: number, onClick: () => void }} props
 */
export function ChatButton({ unread = 0, onClick }) {
  return html`
    <button class="btn btn-ghost btn-icon hide-on-desktop" onClick=${onClick}
            aria-label=${unread ? `Chat, ${unread} new` : 'Chat'}>
      <${Icon} name="chat" />
      ${unread ? html`<span class="badge" aria-hidden="true">${unread > 9 ? '9+' : unread}</span>` : null}
    </button>`;
}

/**
 * The messages and the box to add to them.
 * @param {{
 *   room: any,
 *   meId: string | null,
 *   send: (type: string, payload?: any) => void,
 *   autoFocus?: boolean,
 * }} props
 */
export function Chat({ room, meId, send, autoFocus }) {
  const [draft, setDraft] = useState('');
  const log = useRef(null);
  const items = timeline(room, meId);

  // Stay at the bottom: a chat that does not follow the newest line is a chat nobody reads.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [items.length]);

  function submit(event) {
    if (event) event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    send(ACTIONS.chat, { text });
  }

  return html`
    <div class="chat grow">
      <div class="chat-log" ref=${log}>
        ${items.length
          ? items.map((item) => (item.kind === 'system'
            ? html`<div class="chat-system" key=${item.key}>${item.text}</div>`
            : html`
              <div class="chat-msg" key=${item.key}>
                <${Avatar} avatar=${item.avatar} size="sm" away=${false} />
                <div>
                  <div class="who">${item.who}</div>
                  <div class="text">${item.text}</div>
                </div>
              </div>`))
          : html`<p class="chat-system">No messages yet. Say hello.</p>`}
      </div>
      <form class="chat-compose" onSubmit=${submit}>
        <input class="input" value=${draft} maxLength="300" placeholder="Say something" aria-label="Message"
               enterkeyhint="send" autofocus=${Boolean(autoFocus)}
               onInput=${(e) => setDraft(e.currentTarget.value)} />
        <button class="btn btn-primary btn-icon" type="submit" aria-label="Send">
          <${Icon} name="send" />
        </button>
      </form>
    </div>`;
}

/**
 * The chat as a rail down the side of a wide screen. base.css hides it below 900 px.
 * @param {{ room: any, meId: string | null, send: (type: string, payload?: any) => void }} props
 */
export function ChatRail({ room, meId, send }) {
  return html`
    <aside class="rail">
      <div class="rail-title">Table talk</div>
      <${Chat} room=${room} meId=${meId} send=${send} />
    </aside>`;
}

/**
 * The chat as a sheet, for phones.
 * @param {{ room: any, meId: string | null, send: (type: string, payload?: any) => void, onClose: () => void }} props
 */
export function ChatSheet({ room, meId, send, onClose }) {
  return html`
    <${Sheet} title="Table talk" onClose=${onClose}>
      <${Chat} room=${room} meId=${meId} send=${send} autoFocus=${true} />
    <//>`;
}

/** Messages and system lines, oldest first. */
function timeline(room, meId) {
  const players = new Map(((room && room.players) || []).map((p) => [p.id, p]));
  const items = [];
  for (const message of (room && room.chat) || []) {
    const player = players.get(message.playerId) || null;
    items.push({
      kind: 'msg',
      key: `m${message.id}`,
      t: message.t,
      who: playerName(player, meId),
      avatar: (player && player.avatar) || '🙂',
      text: message.text,
    });
  }
  for (const entry of (room && room.log) || []) {
    const say = SYSTEM[entry.type];
    if (!say) continue;
    const player = players.get(/** @type {string} */ (entry.playerId)) || null;
    if (!player) continue;
    items.push({ kind: 'system', key: `l${entry.n}`, t: entry.t, text: say(player.name) });
  }
  items.sort((a, b) => a.t - b.t);
  return items;
}
