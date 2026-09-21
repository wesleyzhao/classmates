// How a game ends: who won, by how much, and the two things anyone wants next, which are
// the same game again or a different one. The winner is the hero of this screen, so the
// avatar is the biggest thing on it and the sentence under it says the score out loud.

import { html } from '../h.js';
import { Avatar } from '../components/Avatar.js';
import { ChatButton, ChatPeek, ChatRail, ChatSheet, useChatDock } from '../components/Chat.js';
import { Standings } from '../components/Standings.js';
import { StatusPill } from '../components/StatusPill.js';
import { ACTIONS, winnerLine, winnerTitle } from '../lib.js';

/** What the winner's circle shows when the winner has left the room. */
const NO_WINNER_FACE = '\u{1F3B2}';

/**
 * @param {{
 *   snapshot: any,
 *   meId: string | null,
 *   isHost: boolean,
 *   status: string,
 *   send: (type: string, payload?: any) => void,
 * }} props
 */
export function Results({ snapshot, meId, isHost, status, send }) {
  const chat = useChatDock(snapshot.room, meId);
  const room = snapshot.room;
  const players = room.players || [];
  const summary = snapshot.summary;

  const winners = (summary && summary.winnerIds) || [];
  const winner = players.find((player) => player.id === winners[0]) || null;

  return html`
    <div class="with-rail">
      <div class="main">
        <main class="page">
          <div class="topbar">
            <span class="strong">${room.game.title}</span>
            <span class="row">
              <${StatusPill} status=${status} />
              <span class="small ink-2">Room ${room.code}</span>
              <${ChatButton} unread=${chat.unread} onClick=${chat.openChat} />
            </span>
          </div>

          <header class="stack center" style="align-items: center">
            <${Avatar} avatar=${winner ? winner.avatar : NO_WINNER_FACE} size="xl" winner=${true} away=${false} />
            <h1 class="display-hero">${winnerTitle(summary, players, meId)}</h1>
            <p class="lede center">${winnerLine(summary, players, meId)}</p>
          </header>

          <${Standings} summary=${summary} players=${players} showScores=${!summary || summary.unit !== 'labels'}
                        meId=${meId} title="" note=${(summary && summary.label) || ''} />

          <div class="actionbar">
            ${isHost
              ? html`<button class="btn btn-primary btn-block btn-tall" onClick=${() => send(ACTIONS.restart)}>Play again</button>`
              : null}
            <a class="btn btn-secondary btn-block btn-tall" href="/">Pick another game</a>
            <p class="actionbar-note">${isHost
              ? 'Everyone stays in the room, and a fresh set of cards comes out.'
              : 'Waiting for the host to start another game.'}</p>
          </div>
        </main>
      </div>
      <${ChatRail} room=${room} meId=${meId} send=${send} />
    </div>

    <${ChatPeek} peek=${chat.peek} onOpen=${chat.openChat} />
    ${chat.open ? html`<${ChatSheet} room=${room} meId=${meId} send=${send} onClose=${chat.closeChat} />` : null}`;
}
