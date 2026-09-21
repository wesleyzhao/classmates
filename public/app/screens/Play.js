// The platform's frame around a game in progress. The kit's own screen is the hero here;
// everything this file adds is the same for every kit, which is the point: a player who
// knows how to leave one Parlor game knows how to leave all of them.
//
// The kit module is fetched at the moment it is needed, so a device only ever downloads the
// game it is actually playing. The URL comes from `kitUiPath` in the registry, which is the
// only place in the codebase that builds one: a second place would let a kit whose folder is
// not its id fall through the gap again.

import { html, useEffect, useState } from '../h.js';
import { KITS, kitUiPath } from '../../shared/registry.js';
import { tick as tickSound, win as winSound } from '../sound.js';
import { ChatButton, ChatPeek, ChatRail, ChatSheet, useChatDock } from '../components/Chat.js';
import { HostBar } from '../components/HostBar.js';
import { Icon } from '../components/Icon.js';
import { Reactions } from '../components/Reactions.js';
import { Sheet } from '../components/Sheet.js';
import { useLogSounds, useTurnChime } from '../components/Sounds.js';
import { StatusPill } from '../components/StatusPill.js';
import { useNow } from '../components/Timer.js';
import { ACTIONS, waitingLine } from '../lib.js';

/** Which log events make a noise, and which noise. */
const SOUNDS = { answered: tickSound, won: winSound };

/**
 * @param {{
 *   snapshot: any,
 *   meId: string | null,
 *   isHost: boolean,
 *   status: string,
 *   send: (type: string, payload?: any) => void,
 *   onLeave: () => void,
 *   kitScreen?: any,
 * }} props
 * `kitScreen` is the seam the dev screens harness uses to render this chrome without a
 * kit module on disk. A real room never passes it.
 */
export function Play({ snapshot, meId, isHost, status, send, onLeave, kitScreen }) {
  const [leaving, setLeaving] = useState(false);
  const [sending, setSending] = useState(/** @type {string | null} */ (null));
  const chat = useChatDock(snapshot.room, meId);

  /**
   * Send, and remember which action is still on its way, so the kit's screen can show the
   * wait: a die that keeps turning until the number comes back. Cleared when the reply lands,
   * whichever way it went.
   * @param {string} type
   * @param {any} [payload]
   */
  function sendNoted(type, payload) {
    setSending(type);
    const clear = () => setSending((current) => (current === type ? null : current));
    const reply = Promise.resolve(send(type, payload));
    reply.then(clear, clear);
    return reply;
  }

  const room = snapshot.room;
  const view = snapshot.view;
  const players = room.players || [];
  const kit = useKitScreen(kitScreen ? null : room.game.kitId);
  const KitScreen = kitScreen || kit.screen;
  // A kit whose screen is a board (or anything else that wants room) says so by exporting
  // `wide` on its Play component. Every other screen keeps the reading column.
  const wide = !!(KitScreen && KitScreen.wide);

  // The clock only runs while the kit says something is counting down.
  const now = useNow(!!(view && view.wakeAt));
  useLogSounds(room.log, SOUNDS);
  useTurnChime(view, meId);

  const quiet = waitingLine(view, players);
  // The bar and the reactions wait for the kit's screen: a host button over "Loading the
  // game." invites a tap at a screen that is not there yet.
  const ready = !!(KitScreen && view) || kit.failed;

  return html`
    <div class="with-rail">
      <div class="main">
        <main class=${wide ? 'page page-wide' : 'page'}>
          <div class="topbar">
            <button class="btn btn-ghost" onClick=${() => setLeaving(true)}><${Icon} name="back" />Leave</button>
            <h1 class="topbar-title">${room.game.title}</h1>
            <span class="row">
              <${StatusPill} status=${status} />
              ${room.canUndo && isHost ? html`
                <button class="btn btn-ghost btn-sm" onClick=${() => send(ACTIONS.undo)}>
                  <${Icon} name="undo" />Undo
                </button>` : null}
              <${ChatButton} unread=${chat.unread} onClick=${chat.openChat} />
            </span>
          </div>

          ${KitScreen && view
            ? html`<${KitScreen} view=${view} me=${meId} players=${players} send=${sendNoted} now=${now} sending=${sending} />`
            : kit.failed
              ? html`<p class="notice notice-bad">This game's screen would not load. Reload the page to try again.</p>`
              : html`<p class="lede">Loading the game.</p>`}

          ${quiet ? html`<p class="notice">${quiet} The game will wait, or the host can move on.</p>` : null}

          ${room.canTakeOver ? html`
            <div class="notice row">
              <span class="grow">${hostAway(players, room.hostId) ? 'The host has stepped away.' : 'The host has gone quiet.'}</span>
              <button class="btn btn-secondary btn-sm" onClick=${() => send(ACTIONS.takeover)}>Take over as host</button>
            </div>` : null}

          ${ready ? html`<${Reactions} log=${room.log} send=${send} />` : null}

          ${ready ? html`<${HostBar} actions=${view ? view.actions : []} isHost=${isHost} send=${sendNoted} />` : null}
        </main>
      </div>
      <${ChatRail} room=${room} meId=${meId} send=${send} />
    </div>

    <${ChatPeek} peek=${chat.peek} onOpen=${chat.openChat} />
    ${chat.open ? html`<${ChatSheet} room=${room} meId=${meId} send=${send} onClose=${chat.closeChat} />` : null}

    ${leaving ? html`
      <${Sheet} title="Leave the game" onClose=${() => setLeaving(false)}>
        <p class="lede">You give up your seat and the game carries on without you. You can join again with the code.</p>
        <button class="btn btn-danger btn-block btn-tall" onClick=${onLeave}>Leave</button>
        <button class="btn btn-ghost btn-block" onClick=${() => setLeaving(false)}>Stay</button>
      <//>` : null}`;
}

/**
 * The kit's Play component, fetched once per kit. The id arrives inside a room snapshot, so
 * it is checked against the shape of a kit id before `kitUiPath` interpolates it: a snapshot
 * is data, and data does not get to name a path.
 * @param {string | null} kitId  null when the caller already has a screen
 */
function useKitScreen(kitId) {
  const [state, setState] = useState(/** @type {{ screen: any, failed: boolean }} */ ({ screen: null, failed: false }));
  useEffect(() => {
    let live = true;
    if (!kitId) return undefined;
    setState({ screen: null, failed: false });
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(kitId)) { setState({ screen: null, failed: true }); return undefined; }
    import(kitUiPath(kitId))
      .then((module) => {
        if (!live) return;
        if (module.Play) setState({ screen: module.Play, failed: false });
        else setState({ screen: null, failed: true });
      })
      .catch(() => { if (live) setState({ screen: null, failed: true }); });
    return () => { live = false; };
  }, [kitId]);
  return state;
}


/** Whether the host has left the page (as opposed to sitting on it without acting). */
function hostAway(players, hostId) {
  const host = (players || []).find((p) => p.id === hostId);
  return !!host && !host.connected;
}

/** The registry is imported so a kit's metadata is available without another round trip. */
export const KNOWN_KITS = KITS;
