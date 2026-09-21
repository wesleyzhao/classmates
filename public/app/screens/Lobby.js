// The waiting room, and the only screen whose job is to be read out loud. The code is the
// hero: big enough to read across a table, spaced enough that M and K do not run together.
// Everything under it answers "who is here" and "what are we about to play".
//
// The host is the only person with a button. Everyone else gets a sentence saying whose
// turn it is to press it, which is friendlier than a disabled button with no explanation.

import { html, useState } from '../h.js';
import { KITS } from '../../shared/registry.js';
import { validate } from '../../shared/schema.js';
import { isSoundOn, setSound, tick } from '../sound.js';
import { Avatar } from '../components/Avatar.js';
import { ChatButton, ChatPeek, ChatRail, ChatSheet, useChatDock } from '../components/Chat.js';
import { Form } from '../components/Form.js';
import { Icon } from '../components/Icon.js';
import { NameSheet } from '../components/NameSheet.js';
import { Sheet } from '../components/Sheet.js';
import { useLogSounds } from '../components/Sounds.js';
import { CopyCodeButton, ShareButton } from '../components/ShareButton.js';
import { StatusPill } from '../components/StatusPill.js';
import { ACTIONS, playerNote, plural, settingsLine } from '../lib.js';

/** Somebody arriving is worth a small click. */
const JOIN_SOUNDS = { joined: tick, returned: tick };

/**
 * @param {{
 *   snapshot: any,
 *   meId: string | null,
 *   isHost: boolean,
 *   status: string,
 *   send: (type: string, payload?: any) => void,
 *   onLeave: () => void,
 * }} props
 */
export function Lobby({ snapshot, meId, isHost, status, send, onLeave }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const chat = useChatDock(snapshot.room, meId);
  useLogSounds(snapshot.room.log, JOIN_SOUNDS);

  const room = snapshot.room;
  const players = room.players || [];
  const kit = KITS[room.game.kitId];
  const minPlayers = kit ? kit.minPlayers : 1;
  const maxPlayers = kit ? kit.maxPlayers : players.length;
  const short = Math.max(0, minPlayers - players.length);
  const settings = settingsLine(room.game, kit ? kit.config : {});
  const hostName = (players.find((p) => p.id === room.hostId) || {}).name || 'the host';
  const now = snapshot.now || Date.now();

  return html`
    <div class="with-rail">
      <div class="main">
        <main class="page">
          <div class="topbar">
            <button class="btn btn-ghost" onClick=${onLeave}><${Icon} name="back" />Leave</button>
            <span class="topbar-title">${room.game.title}</span>
            <span class="row">
              <${StatusPill} status=${status} />
              <button class="btn btn-ghost btn-icon" aria-label="Room menu" onClick=${() => setMenu(true)}>
                <${Icon} name="menu" />
              </button>
              <${ChatButton} unread=${chat.unread} onClick=${chat.openChat} />
            </span>
          </div>

          <div class="stack center" style="align-items: center">
            <p class="muted">Your room</p>
            <h1 class="code-heading"><span class="sr-only">Room </span><span class="code-text code-hero">${room.code}</span></h1>
            <p class="lede center">Friends can type the code on the home screen, or open your link.</p>
            <div class="row">
              <${ShareButton} code=${room.code} gameTitle=${room.game.title} />
              <${CopyCodeButton} code=${room.code} />
            </div>
          </div>

          <section class="stack">
            <div class="section-head">
              <h3>At the table</h3>
              <span class="num small ink-2">${players.length} of ${maxPlayers}</span>
            </div>
            <ul class="list">
              ${players.map((player) => html`
                <li class="list-row" key=${player.id}>
                  <${Avatar} player=${player} />
                  <span class="strong grow">${player.name}</span>
                  ${player.isHost
                    ? html`<span class="end"><span class="tag">host</span></span>`
                    : endNote(player, now)}
                </li>`)}
            </ul>
            ${players.length === 1
              ? html`<p class="empty">Nobody else has joined yet. Share the link and they will show up here.</p>`
              : null}
          </section>

          ${settings || (isHost && kit && Object.keys(kit.config || {}).length) ? html`
            <p class="small ink-2">
              ${settings}
              ${isHost && kit && Object.keys(kit.config || {}).length
                ? html` <button class="link-btn" type="button" onClick=${() => setAdjusting(true)}>Change the settings</button>`
                : null}
            </p>` : null}

          ${isHost
            ? html`
              <div class="actionbar">
                <button class="btn btn-primary btn-block btn-tall" disabled=${short > 0}
                        onClick=${() => send(ACTIONS.start)}>Start game</button>
                <p class="actionbar-note">${short > 0
                  ? `Waiting for ${plural(short, 'more player', 'more players')}.`
                  : 'You can start with anyone who is here. Others can still join.'}</p>
              </div>`
            : html`
              <div class="actionbar">
                <p class="actionbar-note">Waiting for ${hostName} to start.</p>
              </div>`}
        </main>
      </div>
      <${ChatRail} room=${room} meId=${meId} send=${send} />
    </div>

    <${ChatPeek} peek=${chat.peek} onOpen=${chat.openChat} />
    ${chat.open ? html`<${ChatSheet} room=${room} meId=${meId} send=${send} onClose=${chat.closeChat} />` : null}

    ${menu ? html`
      <${RoomMenu} room=${room} meId=${meId} isHost=${isHost} send=${send}
                   onClose=${() => setMenu(false)}
                   onRename=${() => { setMenu(false); setRenaming(true); }} />` : null}

    ${adjusting && kit ? html`
      <${SettingsSheet} kit=${kit} game=${room.game}
                        onClose=${() => setAdjusting(false)}
                        onSave=${(config) => { setAdjusting(false); send(ACTIONS.settings, { config }); }} />` : null}

    ${renaming ? html`
      <${NameSheet} title="Change your name" cta="Save"
                    onClose=${() => setRenaming(false)}
                    onDone=${(who) => {
                      setRenaming(false);
                      send(ACTIONS.rename, { name: who.name });
                      send(ACTIONS.avatar, { avatar: who.avatar });
                    }} />` : null}`;
}

/**
 * The host's settings for this room, drawn from the kit's own schema so a kit that adds a
 * setting gets a control here without anybody editing this screen. Saved as one action; the
 * server validates again and everyone's lobby line updates on the next poll.
 */
function SettingsSheet({ kit, game, onClose, onSave }) {
  const [draft, setDraft] = useState(() => ({ ...(game.config || {}) }));
  const [issues, setIssues] = useState(/** @type {any[]} */ ([]));

  function save(event) {
    if (event) event.preventDefault();
    const result = validate(kit.config, draft);
    if (!result.ok) { setIssues(result.issues); return; }
    onSave(result.value);
  }

  return html`
    <${Sheet} title="Settings" onClose=${onClose}>
      <form class="stack" onSubmit=${save}>
        <${Form} schema=${kit.config} value=${draft} issues=${issues}
                 onChange=${(next) => { setDraft(next); if (issues.length) setIssues([]); }} />
        <button class="btn btn-primary btn-block btn-tall" type="submit">Save</button>
        <p class="small muted center">Everyone at the table sees the change.</p>
      </form>
    <//>`;
}

/** "just joined" or "gone quiet", when there is something to say. */
function endNote(player, now) {
  const note = playerNote(player, now);
  return note ? html`<span class="end">${note}</span>` : null;
}

/**
 * The sheet behind the menu button: the things about a room that are not the game.
 * Removing someone is the host's alone; the rest is everyone's.
 */
function RoomMenu({ room, meId, isHost, send, onClose, onRename }) {
  const [sound, setSoundState] = useState(isSoundOn());
  const others = (room.players || []).filter((player) => player.id !== meId);

  function toggleSound() {
    const next = !sound;
    setSound(next);
    setSoundState(next);
  }

  return html`
    <${Sheet} title="Room" onClose=${onClose}>
      <button class="btn btn-secondary btn-block" onClick=${onRename}>Change your name</button>

      <button class="switch" role="switch" aria-checked=${sound} onClick=${toggleSound}>
        <span class="switch-track"></span>
        <span>${sound ? 'Sound is on' : 'Sound is off'}</span>
      </button>

      ${room.canTakeOver ? html`
        <button class="btn btn-secondary btn-block" onClick=${() => { onClose(); send(ACTIONS.takeover); }}>
          Take over as host
        </button>` : null}

      ${isHost && others.length ? html`
        <div class="stack">
          <div class="section-head"><h3>At the table</h3></div>
          <ul class="list">
            ${others.map((player) => html`
              <li class="list-row" key=${player.id}>
                <${Avatar} player=${player} size="sm" />
                <span class="strong grow">${player.name}</span>
                <button class="btn btn-danger btn-sm" onClick=${() => send(ACTIONS.kick, { playerId: player.id })}>
                  Remove
                </button>
              </li>`)}
          </ul>
          <p class="small muted">Removing someone frees their seat. They can join again with the code.</p>
        </div>` : null}
    <//>`;
}
