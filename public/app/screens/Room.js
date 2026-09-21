// Everything that is true of a room whichever phase it is in: getting a seat, keeping the
// snapshot fresh, wearing the game's theme, leaving, and the two screens that mean there is
// nothing left to show. The three phases (lobby, playing, over) are separate files; this one
// decides which of them is on screen and hands them all the same props.
//
// The order of business on arrival is: do we already have a seat here (saved on this device
// from an earlier visit), do we know what this player is called, and only then, join.

import { html, useEffect, useRef, useState } from '../h.js';
import { api, createRoomClient, newActionId } from '../net.js';
import { navigate } from '../main.js';
import { forgetRoom, hasName, me, recentCards, rememberCards, saveRoom, savedRoom } from '../identity.js';
import { Confetti } from '../components/Confetti.js';
import { NameSheet } from '../components/NameSheet.js';
import { toast } from '../components/Toast.js';
import { applyLook, clearLook } from '../look.js';
import { ACTIONS } from '../lib.js';
import { Lobby } from './Lobby.js';
import { Play } from './Play.js';
import { Results } from './Results.js';

/**
 * @param {{ code: string }} props
 */
export function Room({ code }) {
  const [stage, setStage] = useState('opening');       // opening | naming | live | error
  const [snapshot, setSnapshot] = useState(/** @type {any} */ (null));
  const [status, setStatus] = useState('live');
  const [problem, setProblem] = useState('');
  const [burst, setBurst] = useState(0);
  // Bumped when the player has just told us their name, to run the arrival effect again.
  const [attempt, setAttempt] = useState(0);

  const client = useRef(/** @type {any} */ (null));
  const auth = useRef(/** @type {{ playerId: string, secret: string } | null} */ (null));
  const host = useRef(false);
  const wasOver = useRef(false);
  const wentAway = useRef(false);
  const helloPending = useRef(false);

  // --- arriving -------------------------------------------------------------

  useEffect(() => {
    let live = true;
    const seat = savedRoom(code);
    if (seat) {
      open({ playerId: seat.playerId, secret: seat.secret });
    } else if (!hasName()) {
      // Make sure the room is there before asking a stranger to pick a name for it.
      api('GET', `/api/rooms/${code}/v`)
        .then(() => { if (live) setStage('naming'); })
        .catch((err) => {
          if (!live) return;
          setProblem(err.message || 'That room would not open. Check the code and try again.');
          setStage('error');
        });
    } else {
      join();
    }
    return () => {
      live = false;
      if (client.current) { client.current.stop(); client.current = null; }
    };

    /** Take the snapshot the join returned and keep polling from there. */
    function open(seatNow, first) {
      if (!live) return;
      auth.current = seatNow;
      const room = createRoomClient({
        code,
        auth: seatNow,
        onSnapshot: accept,
        onStatus: (next) => {
          if (!live) return;
          // A seat the server no longer honours is not worth keeping: the next visit starts fresh.
          if (next === 'removed' || next === 'gone') forgetRoom(code);
          setStatus(next);
        },
        isHost: () => host.current,
      });
      client.current = room;
      setStage('live');
      if (first) accept(first);
      room.start();
    }

    async function join() {
      try {
        const who = me();
        const joined = await api('POST', `/api/rooms/${code}/join`, {
          body: { name: who.name, avatar: who.avatar, recent: recentCards() },
        });
        if (!live) return;
        saveRoom(code, {
          playerId: joined.playerId,
          secret: joined.secret,
          gameTitle: (joined.room && joined.room.game && joined.room.game.title) || '',
          gameEmoji: (joined.room && joined.room.game && joined.room.game.emoji) || '',
          gameAccent: (joined.room && joined.room.game && joined.room.game.accent) || '',
        });
        open({ playerId: joined.playerId, secret: joined.secret }, joined);
      } catch (err) {
        if (!live) return;
        setProblem(err.message || 'That room would not open. Check the code and try again.');
        setStage('error');
      }
    }

    /** Every snapshot lands here: scores for the deltas, cards for this device, the win. */
    function accept(next) {
      if (!live || !next || !next.room) return;
      host.current = !!auth.current && next.room.hostId === auth.current.playerId;
      noteCards(next);
      noteWin(next);
      setSnapshot(next);
      announceIfAway(next);
    }

    /**
     * A reload fires pagehide, which marks this seat away; the fresh page must say it is back,
     * or a game that waits on "everyone who is here" moves on without it. One hello per absence.
     */
    function announceIfAway(next) {
      const seat = auth.current;
      const mine = seat && next.room.players.find((p) => p.id === seat.playerId);
      if (!mine) return;
      if (mine.connected) { helloPending.current = false; return; }
      if (helloPending.current) return;
      helloPending.current = true;
      client.current?.send(ACTIONS.hello).catch(() => { helloPending.current = false; });
    }
  }, [code, attempt]);

  /** Cards this device has now seen, so the next room deals something else. */
  function noteCards(next) {
    const view = next.view;
    if (!view) return;
    const ids = [];
    if (typeof view.cardId === 'string') ids.push(view.cardId);
    if (Array.isArray(view.cardIds)) for (const id of view.cardIds) if (typeof id === 'string') ids.push(id);
    if (ids.length) rememberCards(ids);
  }

  /** Confetti belongs to the moment the game ends, which is the moment the screen changes. */
  function noteWin(next) {
    const over = next.room.phase === 'over';
    const winners = (next.summary && next.summary.winnerIds) || [];
    const mine = !!auth.current && winners.includes(auth.current.playerId);
    if (over && !wasOver.current && mine) setBurst((n) => n + 1);
    wasOver.current = over;
  }

  // --- the game's look ------------------------------------------------------

  const game = snapshot && snapshot.room ? snapshot.room.game : null;
  const look = game ? `${game.theme}|${game.accent || ''}` : '';
  useEffect(() => {
    if (!look) return undefined;
    const root = document.documentElement;
    applyLook(root, game);
    // Home is editorial, and a room is the only thing that ever changes that.
    return () => clearLook(root);
  }, [look]);

  // --- presence -------------------------------------------------------------

  useEffect(() => {
    // pagehide is the only event a phone reliably fires when a tab goes away, and by then
    // fetch is already gone, so this one call uses sendBeacon. Beacons cannot carry headers,
    // so the seat travels in the body; the server takes auth either way for this action.
    function away() {
      const seat = auth.current;
      if (!seat || !navigator.sendBeacon) return;
      wentAway.current = true;
      const body = new Blob([JSON.stringify({
        id: newActionId(),
        type: ACTIONS.away,
        playerId: seat.playerId,
        secret: seat.secret,
      })], { type: 'application/json' });
      navigator.sendBeacon(`/api/rooms/${code}/act`, body);
    }
    function back() {
      if (document.visibilityState !== 'visible' || !wentAway.current) return;
      wentAway.current = false;
      send(ACTIONS.hello);
    }
    addEventListener('pagehide', away);
    document.addEventListener('visibilitychange', back);
    return () => {
      removeEventListener('pagehide', away);
      document.removeEventListener('visibilitychange', back);
    };
  }, [code]);

  // --- doing things ---------------------------------------------------------

  /**
   * Send an action and say so when it does not work. Quiet errors never reach here: net.js
   * turns "someone else got there first" into a fresh snapshot instead.
   */
  async function send(type, payload) {
    if (!client.current) return null;
    try {
      return await client.current.send(type, payload);
    } catch (err) {
      toast(err.message || 'That did not work. Try again.', { bad: true });
      return null;
    }
  }

  /** After a removal, start over as a newcomer: the old seat is gone on both sides. */
  function rejoin() {
    forgetRoom(code);
    setStatus('live');
    setStage('opening');
    setAttempt((n) => n + 1);
  }

  /** Leaving gives up the seat, which is why it is a button and not a closed tab. */
  async function leave() {
    if (client.current) {
      try { await client.current.send(ACTIONS.leave); } catch { /* going anyway */ }
      client.current.stop();
      client.current = null;
    }
    forgetRoom(code);
    navigate('/');
  }

  // --- what is on screen ----------------------------------------------------

  if (stage === 'naming') {
    return html`
      <main class="page"><h1>Room ${code}</h1></main>
      <${NameSheet} cta="Join the room" onClose=${() => navigate('/')}
                    onDone=${() => { setStage('opening'); setAttempt((n) => n + 1); }} />`;
  }

  if (status === 'gone') {
    return html`<${Closed} title="This room has closed"
      line="Rooms are kept for a while after the last game and then let go. Start a new one and share the code again." />`;
  }

  if (status === 'removed') {
    return html`<${Closed} title="You were removed from the room"
      line="The host took the seat back. You can join again with the code, and you will get a fresh seat."
      action=${{ label: 'Join again', onClick: rejoin }} />`;
  }

  if (stage === 'error') {
    return html`<${Closed} title="That room would not open" line=${problem} />`;
  }

  if (!snapshot) {
    return html`<main class="page"><p class="lede">Opening room ${code}.</p></main>`;
  }

  const meId = auth.current ? auth.current.playerId : null;
  const shared = {
    snapshot,
    meId,
    isHost: !!meId && snapshot.room.hostId === meId,
    status,
    send,
    onLeave: leave,
  };

  const phase = snapshot.room.phase;
  const screen = phase === 'playing'
    ? html`<${Play} ...${shared} />`
    : phase === 'over'
      ? html`<${Results} ...${shared} />`
      : html`<${Lobby} ...${shared} />`;

  return html`${screen}<${Confetti} burst=${burst} />`;
}

/** The two dead ends a room has, drawn the same way. */
function Closed({ title, line, action = null }) {
  return html`
    <main class="page">
      <div class="stack">
        <h1>${title}</h1>
        <p class="lede">${line}</p>
      </div>
      <div class="actionbar">
        ${action ? html`<button class="btn btn-primary btn-block btn-tall" onClick=${action.onClick}>${action.label}</button>` : null}
        <a class=${action ? 'btn btn-secondary btn-block btn-tall' : 'btn btn-primary btn-block btn-tall'} href="/">Back to Parlor</a>
      </div>
    </main>`;
}

