// Presentational speed-round screen in the arcade look: a dark cabinet where the player flicks a classmate
// into the corner that names them. Rules, timing and persistence live in useSprintRound; this file only draws.
// With a challenge code, the same screens show the code, who has joined, and the standings.
import { html, useEffect, useLayoutEffect, useRef, useState } from "../app/h.js";
import { ShareLink } from "./components.js";
import { LENGTHS, useSprintRound } from "./use-sprint-round.js";
import { DuelRound } from "./duel-round.js";
import { GAME_NAME } from "./brand.js";
import { isSoundOn, setSound, sfx } from "./sound.js";
import { useFlick, dealPiece, flashZone, floater, answerSummary, targetOf, firstName, introTour } from "./sprint-arcade.js";

import { doorMarkup, doorPieceMarkup, doorSide } from "./two-door-pieces.js";
import { pieceMarkup, zoneMarkup } from "./sprint-pieces.js";

const seconds = (ms) => `${(ms / 1000).toFixed(2)}s`;
const pad2 = (n) => String(n).padStart(2, "0");
const HINTS = { face: "Walk them onto their name", name: "Put the body under the right face" };
const DIRECTION_LABEL = { face: "Face to name", name: "Name to face", mixed: "Both directions" };
const SETTINGS_PHASES = ["setup", "ready", "loading"];

/** Who is in a challenge: finished players ranked first, then everyone still to play. */
function Standings({ list, me }) {
  if (!list) return null;
  return html`<ol class="challenge-standings" aria-label="Challenge standings">${list.map((s, i) => html`<li key=${s.accountId} class=${s.accountId === me ? "me" : ""}>
    <span class="rank">${s.result ? i + 1 : ""}</span>
    <span class="who">${s.nickname}</span>
    <span class="how">${s.result ? `${s.result.score.toLocaleString()} pts, ${s.result.correct}/${s.result.count}, ${seconds(s.result.elapsedMs)}` : s.status === "playing" ? "Playing now" : "Not played yet"}</span>
  </li>`)}</ol>`;
}

/** Speed-round view and accessible focus transitions; rules and persistence live in useSprintRound. */
/** The speed screens. Two doors by default; `classic` is the four-corner round with its match settings, on its own path. */
export function SprintRound({ account, onExit, challenge = null, onChallenge = null, initialLength = "short", guestSaved = null, classic = false }) {
  const R = useSprintRound(account, { challenge, initialLength, initialChoices: classic ? 4 : 2 });
  const {
    phase, direction, length, choices, round, question, loaded, answers, result, records, error,
    saved, saving, unsavable, elapsed, photoUrls, challenge: contest,
    prepare, start, choose, save, changeDirection, changeLength, createChallenge,
  } = R;
  const playRegion = useRef(null), resultHeading = useRef(null), arena = useRef(null), fx = useRef(null), piece = useRef(null);
  const [joinCode, setJoinCode] = useState(""), [creating, setCreating] = useState(false), [dueling, setDueling] = useState(false), [sound, setSoundOn] = useState(() => isSoundOn());
  // Tapping a chip in the strip opens a peek at that pairing; it closes on a tap or on its own, and never pauses the clock.
  const [peek, setPeek] = useState(null);
  useEffect(() => {
    if (!peek) return undefined;
    const timer = setTimeout(() => setPeek(null), 2600);
    return () => clearTimeout(timer);
  }, [peek]);
  useEffect(() => {
    if (phase === "result" && result) { if (result.perfect) sfx.perfect(); else sfx.done(); }
  }, [phase]);
  useLayoutEffect(() => {
    // Move focus only at screen boundaries, never between rapid answers.
    if (phase === "playing") {
      playRegion.current?.focus({ preventScroll: true });
      playRegion.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    } else if (phase === "result") resultHeading.current?.focus();
  }, [phase]);

  const twoDoors = question?.direction === "face" && question?.choices.length === 2;
  // Draw the deal: a copy of the piece flies into the corner while the next question renders underneath.
  // The answer itself is the controller's choose(); nothing here waits for the animation.
  const deal = (k) => {
    const zone = arena.current?.querySelector(`.zone[data-k="${k}"]`);
    if (!question || !zone || !fx.current) return;
    const right = question.choices[k]?.id === question.correctChoice;
    if (right) sfx.right(); else sfx.wrong();
    if (piece.current) dealPiece(fx.current, twoDoors ? piece.current.querySelector(".slot") : piece.current, twoDoors ? zone.querySelector(".slot") : zone, right);
    flashZone(zone, right);
    const name = firstName(targetOf(question).name);
    floater(fx.current, zone, right ? `✓ ${name}` : question.direction === "face" ? `✗ ${name}` : `✗ Not ${name}`, right);
  };
  const answer = (k) => {
    if (!question?.choices[k]) return;
    deal(k);
    choose(question.id, question.choices[k].id);
  };
  // The question exists before play starts, so bind on the phase too: the piece only exists while playing.
  useFlick(piece, arena, answer, phase === "playing" && question ? question.id : "", twoDoors ? { map: doorSide } : {});
  useEffect(() => {
    // Keys 1 to 4 already answer through the controller (a capture listener on window, which runs first);
    // the document listener only draws the deal for the question that was on screen.
    if (phase !== "playing") return undefined;
    const onKey = (e) => {
      if (e.repeat) return;
      if (e.target instanceof Element && e.target.closest("input,textarea,select")) return;
      const index = twoDoors && e.key === "ArrowLeft" ? 0 : twoDoors && e.key === "ArrowRight" ? 1 : /^[1-4]$/.test(e.key) ? Number(e.key) - 1 : -1;
      if (question.choices[index]) deal(index);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [phase, question ? question.id : ""]);
  useEffect(() => {
    // The first question opens with a short tour: the piece leans toward each corner and that corner lights up.
    if (phase !== "playing" || answers.length !== 0 || !piece.current || !arena.current) return undefined;
    const stage = arena.current;
    const cancel = introTour(piece.current, [...stage.querySelectorAll(".zone")]);
    stage.addEventListener("pointerdown", cancel, true);
    window.addEventListener("keydown", cancel, true);
    return () => { cancel(); stage.removeEventListener("pointerdown", cancel, true); window.removeEventListener("keydown", cancel, true); };
  }, [phase, question ? question.id : ""]);

  const count = round?.count || LENGTHS[length] || 20;
  const canChange = SETTINGS_PHASES.includes(phase) && !challenge;
  const inviteLink = () => `${location.origin}/speed/${contest?.code || challenge}`;
  const startChallenge = async () => {
    if (creating) return;
    setCreating(true);
    const code = await createChallenge();
    setCreating(false);
    if (code && onChallenge) onChallenge(code);
  };
  const startDuel = async () => {
    if (dueling) return;
    setDueling(true);
    const code = await createChallenge({ mode: "duel" });
    setDueling(false);
    if (code && onChallenge) onChallenge(code);
  };
  // A duel has its own screens once the join says so.
  if (contest?.mode === "duel") return html`<${DuelRound} account=${account} R=${R} onExit=${onExit} onChallenge=${onChallenge} />`;
  const joinChallenge = (e) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(code) && onChallenge) onChallenge(code);
  };
  const settings = html`${classic && html`<label class="form-field">Match<select value=${direction === "face" && choices === 4 ? "classic" : direction} disabled=${!canChange}
      onChange=${e => changeDirection(e.target.value)}>
      <option value="face">Face to name · two choices</option><option value="classic">Face to name · four choices</option><option value="name">Name to face</option><option value="mixed">Both directions</option>
    </select></label>`}
    <div class="form-field"><span>Round</span><div class="seg" role="group" aria-label="Round length">
      ${Object.keys(LENGTHS).map((value) => html`<button key=${value} type="button" class="segbtn" aria-pressed=${String(length === value)} disabled=${!canChange} onClick=${() => changeLength(value)}>${LENGTHS[value]} classmates</button>`)}
    </div></div>`;
  const inviteButton = html`<${ShareLink} url=${inviteLink()} title=${GAME_NAME} text=${`Same ${count} classmates for both of us. Your turn`} />`;
  const scoreShare = challenge && result && html`<${ShareLink} url=${inviteLink()} title=${GAME_NAME} label="Share my score" text=${`I got ${result.correct} out of ${result.count} faces in ${(result.elapsedMs / 1000).toFixed(1)} seconds. Your turn`} />`;
  // A round prepares on its own when the screen opens or a setting changes; the button only appears after a failure.
  const controls = phase === "loading" ? html`<p role="status">Getting your photos ready${loaded[1] ? `: ${loaded[0]} of ${loaded[1]}` : ""}.</p>`
    : phase === "ready" || phase === "arming" ? html`<p class="small">${round.count} classmates are ready. Your timer starts with the first question.</p>
      <button class="btn btn-primary" disabled=${phase === "arming"} onClick=${start}>${phase === "arming" ? "Starting" : "Start the clock"}</button>`
    : phase === "setup" && !error ? html`<p role="status">Getting a round ready.</p>`
    : html`<button class="btn btn-primary" onClick=${prepare}>${challenge ? "Get the round ready" : `Get ${count} classmates ready`}</button>`;

  if (phase === "expired") return html`<section class="sprint-stage sprint-expired">
    <div class="cab attract">
      <div class="eyebrow">Out of time</div>
      <h1 class="title">Time for a fresh round.</h1>
      <p>This round passed its one-hour limit and was not saved.</p>
      <div class="row"><button class="btn btn-primary" onClick=${prepare}>Prepare a new round</button>
        <button class="linkbtn" onClick=${onExit}>Back to games</button></div>
    </div>
  </section>`;

  if (phase === "playing" && question && photoUrls) {
    const right = answers.filter((a, i) => a.choice === round.questions[i].correctChoice).length;
    const strip = answerSummary(round, answers, photoUrls).slice(0, 3);
    const next = [1, 2].map((i) => round.questions[answers.length + i]).filter(Boolean);
    return html`<section ref=${playRegion} class=${`sprint-stage sprint-play ${twoDoors ? "sprint-duel" : ""}`} tabindex="-1" aria-label="Speed round" data-question-id=${question.id}>
      <div class="cab">
        <header class="sprint-hud">
          <div class="col"><span class="lbl">Right</span><span class="val">${pad2(right)}</span></div>
          <div class="col"><span class="lbl">Stage</span><span class="val">${pad2(answers.length + 1)}/${round.count}</span></div>
          <div class="col"><span class="lbl">Time</span><span class="val clock" role="timer">${(elapsed / 1000).toFixed(1)}s</span></div>
          <button class="linkbtn small sprint-leave" onClick=${onExit}>Leave round</button>
        </header>
        ${question.direction === "face" && html`<h1 class="sr-only">What is their name?</h1>`}
        <div class="arena" ref=${arena} data-dir=${question.direction}>
          <div class="fx" ref=${fx} aria-hidden="true"></div>
          <div class="choices" role="group" aria-label="Answer choices">
            ${question.choices.map((choice, i) => html`<button key=${choice.id} class=${`answer zone ${twoDoors ? "door" : ""}`} data-k=${i} data-state="idle" data-sprint-answer="true"
              aria-label=${choice.image ? `Photo ${i + 1}` : choice.label} onClick=${() => answer(i)}>${twoDoors ? doorMarkup(choice, i) : zoneMarkup(choice, i, photoUrls)}</button>`)}
          </div>
          ${!twoDoors && html`<div class="deck" aria-hidden="true">${next.map((q, i) => html`<div key=${q.id} class="layer silhouette l${i + 1}">${pieceMarkup(q, photoUrls, true)}</div>`)}</div>`}
          <div key=${question.id} class="piece is-enter" ref=${piece}>${twoDoors ? doorPieceMarkup(question, photoUrls) : pieceMarkup(question, photoUrls, false)}</div>
          ${peek && html`<button type="button" class="peek ${peek.ok ? "ok" : "no"}" onClick=${() => setPeek(null)} aria-label=${`${peek.name}. Tap to close.`}>
            <span class="pthumb">${peek.thumb && html`<img src=${peek.thumb} alt="" />`}</span>
            <span class="ptext"><span class="pname">${peek.name}</span>
              ${peek.pickedName && html`<span class="psaid">You said ${peek.pickedName}</span>`}
              ${peek.pickedThumb && html`<span class="psaid">You picked <span class="pthumb small"><img src=${peek.pickedThumb} alt="" /></span></span>`}
              ${peek.ok && html`<span class="pgot">You got it</span>`}</span>
          </button>`}
        </div>
        <div class="strip">${strip.length
          ? strip.map((e) => html`<button key=${e.id} type="button" class="chip ${e.ok ? "ok" : "no"}" aria-label=${`Look at ${e.name}`} onClick=${() => setPeek(peek?.id === e.id ? null : e)}><span class="thumb">${e.thumb && html`<img src=${e.thumb} alt="" />`}</span><span class="cname">${e.name}</span></button>`)
          : html`<span class="hint">${HINTS[question.direction]}</span>`}</div>
      </div>
    </section>`;
  }

  if (phase === "result") {
    const pairs = round && answers.length ? answerSummary(round, answers, photoUrls) : [];
    const missed = pairs.filter((e) => !e.ok), got = pairs.filter((e) => e.ok);
    const pair = (e) => html`<div key=${e.id} class="pair ${e.ok ? "ok" : "no"}">
      <span class="pthumb">${e.thumb && html`<img src=${e.thumb} alt="" />`}</span>
      <span class="pname">${e.name}</span>
      ${e.pickedName && html`<span class="psaid">You said ${e.pickedName}</span>`}
      ${e.pickedThumb && html`<span class="psaid">You picked <span class="pthumb small"><img src=${e.pickedThumb} alt="" /></span></span>`}
    </div>`;
    return html`<section class="sprint-stage sprint-result">
      <div class="cab attract">
        <div class="eyebrow">${challenge ? `Challenge ${contest?.code || challenge}` : "Round complete"}</div>
        <h1 ref=${resultHeading} tabindex="-1" class="title">${result?.score?.toLocaleString() ?? "Your result"}${result ? " points" : ""}</h1>
        ${result && html`<p class="big">${result.correct} of ${result.count} correct in <strong>${seconds(result.elapsedMs)}</strong>.</p>
          <p>${result.perfect ? "A perfect run." : "Every correct answer counts. Try for 100%."}</p>`}
        <p role="status" class="small">${saved ? "Saved to your speed records." : saving ? "Saving your result." : unsavable ? "This result could not be saved. You can start a fresh round." : "This result has not been saved yet."}</p>
        ${error && html`<p class="notice error" role="alert">${error}</p>`}
        ${!(saved || unsavable) && html`<button class="btn btn-primary" disabled=${saving} onClick=${save}>Retry saving result</button>`}
        ${challenge && html`<h2 class="lbl-heading">Standings</h2><${Standings} list=${contest?.standings} me=${account.id} />`}
        <div class="row">${challenge ? scoreShare : html`<button class="btn btn-primary" disabled=${!(saved || unsavable)} onClick=${prepare}>Play again</button>`}
          <button class="linkbtn" onClick=${onExit}>Back to games</button></div>
        ${pairs.length > 0 && html`<section class="review" aria-label="Your answers">
          ${missed.length > 0 && html`<h2 class="no">Missed (${missed.length})</h2><div class="pairs">${missed.map(pair)}</div>`}
          ${got.length > 0 && html`<h2>Got right (${got.length})</h2><div class="pairs">${got.map(pair)}</div>`}
        </section>`}
        <${SprintRecords} records=${records} choices=${round?.choices ?? choices} />
      </div>
    </section>`;
  }

  if (challenge) return html`<section class="sprint-stage sprint-setup sprint-challenge">
    <div class="cab attract">
      <div class="eyebrow">Speed challenge</div>
      <h1 class="title">Challenge <span class="challenge-code">${contest?.code || challenge}</span></h1>
      <p>Everyone who opens this code plays ${round ? `the same ${count} classmates, ${DIRECTION_LABEL[direction].toLowerCase()}` : "the same round"}. Play whenever you like; the standings rank score first, then time.</p>
      <div class="row">${inviteButton}</div>
      ${contest?.standings && html`<h2 class="lbl-heading">Standings</h2><${Standings} list=${contest.standings} me=${account.id} />`}
      ${error && html`<p class="notice error" role="alert">${error}</p>`}
      ${controls}
      <p><button class="linkbtn" onClick=${onExit}>Back to games</button></p>
    </div>
  </section>`;

  return html`<section class="sprint-stage sprint-setup">
    <div class="cab attract">
      <div class="eyebrow">Your quickest introductions</div>
      <h1 class="title">Speed round</h1>
      ${guestSaved && html`<p class="small" role="status">Speed round saved: ${guestSaved.correct} of ${guestSaved.count} correct, ${guestSaved.score.toLocaleString()} points.</p>`}
      ${classic
        ? html`<p>Flick each classmate onto their name, as fast as you can. Every correct answer earns 1,000 points, with up to 999 extra for a fast round.</p>`
        : html`<p>Drop each face on the body with their name, left or right, as fast as you can. Every one right earns 1,000 points, with up to 999 extra for a fast round.</p>`}
      <p class="small">A perfect run sets your fastest time. The clock keeps running if you switch tabs.</p>
      ${settings}
      ${error && html`<p class="notice error" role="alert">${error}</p>`}
      ${controls}
      ${classic
        ? html`<div class="row"><button type="button" class="btn btn-secondary" disabled=${creating} onClick=${startChallenge}>${creating ? "Making a code" : "Challenge classmates"}</button>
            <span class="small">Same round for everyone who opens your code, whenever they like.</span></div>
          <div class="row"><button type="button" class="btn btn-secondary" disabled=${dueling} onClick=${startDuel}>${dueling ? "Making a code" : "Start a duel"}</button>
            <span class="small">Two doors, everyone on the same 3-2-1.</span></div>`
        : html`<div class="row"><button type="button" class="btn btn-secondary" disabled=${dueling} onClick=${startDuel}>${dueling ? "Making a code" : "Challenge classmates"}</button>
            <span class="small">The same ${count} classmates for everyone, on the same 3-2-1.</span></div>`}
      <form class="code-form" onSubmit=${joinChallenge}>
        <span class="lbl">Have a challenge code?</span>
        <div class="row"><input aria-label="Challenge code" maxlength="4" pattern="[A-Za-z]{4}" autocapitalize="characters" autocomplete="off" placeholder="ABCD" value=${joinCode} onInput=${(e) => setJoinCode(e.target.value)} />
          <button class="btn btn-secondary" disabled=${joinCode.trim().length !== 4}>Join</button></div>
      </form>
      <p><button class="linkbtn" onClick=${onExit}>Back to games</button> <button type="button" class="linkbtn small" aria-pressed=${String(sound)} onClick=${() => { setSound(!sound); setSoundOn(!sound); }}>${sound ? "Sound is on" : "Sound is off"}</button></p>
      <${SprintRecords} records=${records} choices=${round?.choices ?? choices} />
    </div>
  </section>`;
}

function SprintRecords({ records, choices }) {
  if (!records) return null;
  return html`<aside class="sprint-records">
    <h2>Your speed records</h2>
    <p class="small">${choices === 2 ? "Two-choice rounds" : "Four-choice rounds"}</p>
    <p>Best score: <strong>${records.bestScore ? records.bestScore.score.toLocaleString() : "No completed round yet"}</strong><br />
      Fastest 100%: <strong>${records.fastestPerfect ? seconds(records.fastestPerfect.elapsedMs) : "Your first perfect run sets the time"}</strong></p>
    ${(records.leaders?.length > 0 || records.perfectLeaders?.length > 0) && html`<details>
      <summary>Class speed records</summary>
      <h3>Highest scores</h3><ol>${records.leaders.map(p => html`<li>${p.nickname}: ${p.score.toLocaleString()} points</li>`)}</ol>
      <h3>Fastest perfect rounds</h3>${records.perfectLeaders.length ? html`<ol>${records.perfectLeaders.map(p => html`<li>${p.nickname}: ${seconds(p.elapsedMs)}</li>`)}</ol>` : html`<p>No perfect rounds yet.</p>`}
    </details>`}
    <p class="small">Solo speed records use your device timer. Multiplayer ratings are separate.</p>
  </aside>`;
}
