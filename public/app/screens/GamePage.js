// One game, and the button that opens a room to play it. This is the page a link to a game
// lands on, so it has to answer two questions fast: what is this, and how many of us does
// it need. Everything else about the game is discovered by playing it.

import { html, useEffect, useState } from '../h.js';
import { api } from '../net.js';
import { navigate } from '../main.js';
import { KITS } from '../../shared/registry.js';
import { hasName, me, recentCards, saveRoom } from '../identity.js';
import { Icon } from '../components/Icon.js';
import { NameSheet } from '../components/NameSheet.js';
import { toast } from '../components/Toast.js';
import { plural, roomPath, settingsLine } from '../lib.js';

/**
 * @param {{ slug: string }} props
 */
export function GamePage({ slug }) {
  const [game, setGame] = useState(/** @type {any} */ (null));
  const [problem, setProblem] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setGame(null);
    setProblem('');
    api('GET', `/api/games/${encodeURIComponent(slug)}`)
      .then((data) => { if (live) setGame(data.game); })
      .catch((err) => { if (live) setProblem(err.message || 'That game would not load. Try again.'); });
    return () => { live = false; };
  }, [slug]);

  /** Open a room and go to it. The device's name is asked for first, once, ever. */
  async function open() {
    if (!hasName()) { setAsking(true); return; }
    setBusy(true);
    try {
      const who = me();
      const room = await api('POST', '/api/rooms', {
        body: { gameId: game.id, name: who.name, avatar: who.avatar, recent: recentCards() },
      });
      saveRoom(room.code, { playerId: room.playerId, secret: room.secret, gameTitle: game.title, gameEmoji: game.emoji || '', gameAccent: game.accent || '' });
      navigate(roomPath(room.code));
    } catch (err) {
      setBusy(false);
      toast(err.message || 'The room would not open. Try again.', { bad: true });
    }
  }

  if (problem) {
    return html`
      <main class="page">
        <div class="topbar"><a class="btn btn-ghost" href="/"><${Icon} name="back" />Parlor</a></div>
        <div class="stack">
          <h1>No game here</h1>
          <p class="lede">${problem}</p>
        </div>
        <div class="actionbar">
          <a class="btn btn-primary btn-block btn-tall" href="/">Pick another game</a>
        </div>
      </main>`;
  }

  if (!game) {
    return html`<main class="page"><div class="topbar"><a class="btn btn-ghost" href="/"><${Icon} name="back" />Parlor</a></div></main>`;
  }

  const kit = KITS[game.kitId];
  const settings = settingsLine(game, kit ? kit.config : {});
  return html`
    <main class="page">
      <div class="topbar">
        <a class="btn btn-ghost" href="/"><${Icon} name="back" />Parlor</a>
      </div>

      <header class="stack center" style="align-items: center">
        <span class="tile tile-game tile-xl" aria-hidden="true" style=${game.accent ? `--tile: ${game.accent}` : null}>${game.emoji}</span>
        <h1 class="display-hero">${game.title}</h1>
        <p class="lede">${game.description}</p>
      </header>

      <ul class="list facts">
        <li class="list-row">
          <span class="facts-label">Players</span>
          <span class="facts-value num">${kit ? `${kit.minPlayers} to ${kit.maxPlayers}` : 'Any number'}</span>
        </li>
        ${kit ? html`
          <li class="list-row">
            <span class="facts-label">How it plays</span>
            <span class="facts-value">${[kit.tagline, settings].filter(Boolean).join(' ')}</span>
          </li>` : null}
      </ul>

      <p class="small ink-2 center">
        Already have a code? <a href="/">Join that room instead.</a>
        ${game.builtin ? html` Or <a href=${`/create?remix=${encodeURIComponent(game.id)}`}>make your own version of it</a>.` : null}
      </p>

      <div class="actionbar">
        <button class="btn btn-primary btn-block btn-tall" disabled=${busy} onClick=${open}>Start a room</button>
        <p class="actionbar-note">You get a four-letter code to share.${kit && kit.minPlayers > 1 ? ` It takes ${plural(kit.minPlayers, 'player', 'players')} to start.` : ''}</p>
      </div>

      ${asking ? html`
        <${NameSheet} cta="Start the room" onClose=${() => setAsking(false)} onDone=${() => { setAsking(false); open(); }} />` : null}
    </main>`;
}
