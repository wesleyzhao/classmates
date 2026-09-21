// The front page: the masthead, a box for a code somebody read out to you, the rooms this
// device was in, and the list of games. The masthead and the list are the hero; everything
// else on this screen exists to get out of their way.
//
// It asks the server for the catalog and nothing else. A player with a code never needs
// this list, which is why the code box sits above it.

import { html, useEffect, useState } from '../h.js';
import { api } from '../net.js';
import { navigate } from '../main.js';
import { normalizeCode } from '../../shared/codes.js';
import { recentRooms } from '../identity.js';
import { Icon } from '../components/Icon.js';
import { firstSentence, roomPath } from '../lib.js';

/**
 * What a code looks like while it is being typed. People read codes out loud and paste them
 * out of messages, so spaces, dashes and lower case are all fixed as they arrive rather than
 * refused: the input only ever holds the four letters that matter.
 * @param {string} raw
 */
function cleanCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

export function Home() {
  const [games, setGames] = useState(/** @type {any[] | null} */ (null));
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState('');
  const rooms = recentRooms();

  useEffect(() => {
    let live = true;
    api('GET', '/api/games')
      .then((data) => { if (live) setGames(data.games || []); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  function join(event) {
    if (event) event.preventDefault();
    const clean = normalizeCode(code);
    if (!clean) {
      setProblem('Room codes are four letters. Check the one you were given.');
      return;
    }
    navigate(roomPath(clean));
  }

  return html`
    <main class="page">
      <div class="masthead">
        <h1 class="wordmark">Parlor</h1>
        <p class="lede">Small games for the people in the room. Open a game, share the link, play on your phones.</p>
      </div>

      <section class="stack">
        <label class="field-label" for="room-code">Join with a code</label>
        <form class="row" onSubmit=${join}>
          <input class="input input-code" id="room-code" value=${code} placeholder="ABCD"
                 autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go"
                 inputMode="text" aria-describedby=${problem ? 'code-problem' : null}
                 onInput=${(e) => { setCode(cleanCode(e.currentTarget.value)); if (problem) setProblem(''); }} />
          <button class="btn btn-primary btn-tall" type="submit">Join</button>
        </form>
        ${problem ? html`<p class="field-error" id="code-problem">${problem}</p>` : null}
      </section>

      ${rooms.length ? html`
        <section class="stack">
          <div class="section-head"><h3>Rooms you were in</h3></div>
          <ul class="list">
            ${rooms.map((room) => html`
              <li key=${room.code}>
                <a class="list-row list-row-link" href=${roomPath(room.code)}>
                  <span class=${room.gameEmoji ? 'tile tile-game' : 'tile'} aria-hidden="true"
                        style=${room.gameAccent ? `--tile: ${room.gameAccent}` : null}>${room.gameEmoji || room.code.slice(0, 2)}</span>
                  <div class="grow">
                    <div class="title">${room.code}</div>
                    <div class="sub">${room.gameTitle || 'A room you were in'}</div>
                  </div>
                  <${Icon} name="chevron" class="chevron" />
                </a>
              </li>`)}
          </ul>
        </section>` : null}

      <section class="stack">
        <div class="section-head"><h3>Pick a game</h3></div>
        ${failed
          ? html`<p class="notice notice-bad">Can't reach the list of games. Check your signal, then reload the page.</p>`
          : null}
        ${games && games.length ? html`
          <ul class="list">
            ${games.map((game) => html`
              <li key=${game.id}>
                <a class="list-row list-row-link" href=${`/g/${game.slug}`}>
                  <span class="tile tile-game" aria-hidden="true" style=${game.accent ? `--tile: ${game.accent}` : null}>${game.emoji}</span>
                  <div class="grow">
                    <div class="title">${game.title}</div>
                    <div class="sub">${firstSentence(game.description)}</div>
                  </div>
                  <${Icon} name="chevron" class="chevron" />
                </a>
              </li>`)}
            <li>
              <a class="list-row list-row-link" href="/create">
                <span class="tile tile-make" aria-hidden="true"><${Icon} name="plus" /></span>
                <div class="grow">
                  <div class="title">Make your own game</div>
                  <div class="sub">A quiz from your own questions, or a board game with your own cards. It takes a few minutes.</div>
                </div>
                <${Icon} name="chevron" class="chevron" />
              </a>
            </li>
          </ul>` : null}
        ${games && !games.length
          ? html`<p class="empty">No games here yet. <a href="/create">Make one</a> and it will show up in this list.</p>`
          : null}
      </section>
    </main>`;
}
