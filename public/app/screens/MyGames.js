// Everything this device has made: the games, then the decks. There is no account behind any
// of it, so this list is the only place a maker finds their own work again. It says so plainly,
// because a list that quietly depends on site data not being cleared is a trap.
//
// Every row carries the three things somebody comes here to do: play it, change it, send it.

import { html, useState } from '../h.js';
import { forgetMade, myDecks, myGames } from '../identity.js';
import { Icon } from '../components/Icon.js';
import { ShareButton } from '../components/ShareButton.js';
import { deckPath, editPath, gamePath, gameShareText } from '../creator.js';

export function MyGames() {
  const [games, setGames] = useState(() => myGames());
  const [decks, setDecks] = useState(() => myDecks());
  const empty = !games.length && !decks.length;

  /** @param {'game' | 'deck'} what @param {string} id */
  function forget(what, id) {
    forgetMade(what, id);
    setGames(myGames());
    setDecks(myDecks());
  }

  return html`
    <main class="page">
      <div class="topbar">
        <a class="btn btn-ghost" href="/"><${Icon} name="back" />Parlor</a>
      </div>

      <div class="stack">
        <h1 class="display-hero">Your games</h1>
        <p class="lede">What you have made on this device. Games and decks live on their links,
          so send yourself the edit link for anything you want to keep.</p>
      </div>

      ${empty ? html`
        <div class="stack">
          <p class="empty">Nothing here yet. Making a game takes a few minutes: you pick how it plays,
            choose the cards, give it a name, and publish it.</p>
        </div>` : null}

      ${games.length ? html`
        <section class="stack">
          <div class="section-head"><h3>Games</h3></div>
          <ul class="list-editor">
            ${games.map((game) => html`
              <li class="list-item surface" key=${game.id}>
                <div class="row">
                  <div class="grow">
                    <div class="title">${game.title || 'A game with no name'}</div>
                    <div class="sub num">${gamePath(game.slug)}</div>
                  </div>
                </div>
                <div class="row row-wrap">
                  <a class="btn btn-primary btn-sm" href=${gamePath(game.slug)}>Play</a>
                  <a class="btn btn-secondary btn-sm" href=${editPath(game.id, game.editKey)}>Edit</a>
                  <${ShareButton} class="btn btn-secondary btn-sm" label="Share"
                                  link=${gameShareText({ slug: game.slug, title: game.title })} />
                  <span class="spacer"></span>
                  <button class="btn btn-ghost btn-sm" onClick=${() => forget('game', game.id)}>Remove from this list</button>
                </div>
                ${game.editKey ? null : html`
                  <p class="field-help">This device has no edit link for this one, so it can only be played.</p>`}
              </li>`)}
          </ul>
        </section>` : null}

      ${decks.length ? html`
        <section class="stack">
          <div class="section-head"><h3>Decks</h3></div>
          <ul class="list-editor">
            ${decks.map((deck) => html`
              <li class="list-item surface" key=${deck.id}>
                <div class="row">
                  <div class="grow">
                    <div class="title">${deck.title || 'A deck with no name'}</div>
                    <div class="sub num">${deck.id}</div>
                  </div>
                </div>
                <div class="row row-wrap">
                  <a class="btn btn-secondary btn-sm" href=${deckPath(deck.id)}>Edit the cards</a>
                  <a class="btn btn-secondary btn-sm" href=${`/create?deck=${encodeURIComponent(deck.id)}`}>Make a game with it</a>
                  <span class="spacer"></span>
                  <button class="btn btn-ghost btn-sm" onClick=${() => forget('deck', deck.id)}>Remove from this list</button>
                </div>
              </li>`)}
          </ul>
        </section>` : null}

      <div class="actionbar">
        <a class="btn btn-primary btn-block btn-tall" href="/create">Make a game</a>
        <p class="actionbar-note"><a href=${deckPath('new')}>Or make a deck of cards first.</a></p>
      </div>
    </main>`;
}
