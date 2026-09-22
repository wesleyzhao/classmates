// The speed duel: ten classmates, two doors, everyone on the same count. You hold a face and drop it on the body
// wearing the right name, bottom-left or bottom-right. The people still to clear line up along the top, yours and
// theirs, so the race is visible the whole way. Rules, the clock and the shared start live in useSprintRound.
import { html, useEffect, useLayoutEffect, useRef, useState } from "../app/h.js";
import { ShareLink } from "./components.js";
import { isSoundOn, setSound } from "./sound.js";
import { GAME_NAME } from "./brand.js";
import { doorMarkup, doorPieceMarkup, doorSide } from "./two-door-pieces.js";
import { sfx } from "./sound.js";
import { useFlick, dealPiece, flashZone, floater, answerSummary, targetOf, firstName } from "./sprint-arcade.js";

const seconds = (ms) => `${(ms / 1000).toFixed(2)}s`;
const pad2 = (n) => String(n).padStart(2, "0");
// Corner 0 or 2 (a left-hand flick) is the left door, 1 or 3 the right one.
const side = doorSide;

/** Who is in and how far along: a row of the heads still to clear, shrinking as the player goes. */
function Lane({ label, me, questions, index, photoUrls, dim = false, leading = false }) {
  return html`<div class="lane ${me ? "me" : "them"} ${dim ? "dim" : ""} ${leading ? "leading" : ""}">
    <span class="who">${label}</span>
    <div class="row">${questions.map((q, i) => html`<span key=${q.id} class="head ${i < index ? "gone" : i === index ? "next" : ""}">${photoUrls?.get(q.image) && html`<img src=${photoUrls.get(q.image)} alt="" />`}</span>`)}</div>
    <span class="count">${questions.length - index}</span>
  </div>`;
}

/** The two rows along the top and the line that says who is ahead. */
function Race({ account, contest, round, answered, photoUrls }) {
  const others = (contest.standings || []).filter((s) => s.accountId !== account.id).slice(0, 3);
  const best = others.length ? others.reduce((a, b) => (b.progress.index > a.progress.index ? b : a)) : null;
  const d = best ? answered - best.progress.index : 0;
  const lead = () => {
    if (!best) return "Nobody else is in yet.";
    if (d === 0) return html`Even with ${best.nickname}`;
    return d > 0 ? html`<span class="ahead">You are <b>${d} ahead</b></span>` : html`<span class="behind">${best.nickname} is <b>${-d} ahead</b></span>`;
  };
  return html`<div class="lanes">
    <${Lane} label="You" me=${true} questions=${round.questions} index=${answered} photoUrls=${photoUrls} leading=${!!best && d > 0} />
    ${others.map((s) => html`<${Lane} key=${s.accountId} label=${s.nickname} me=${false} questions=${round.questions} index=${Math.min(s.progress.index, round.questions.length)} photoUrls=${photoUrls} dim=${s.status === "waiting"} leading=${d < 0 && s === best} />`)}
  </div>
  <p class="lead">${lead()}</p>`;
}

/** The speed duel screens. `R` is the round controller from useSprintRound. */
export function DuelRound({ account, R, onExit, onChallenge }) {
  const { phase, round, question, loaded, answers, result, error, saved, saving, unsavable, elapsed, photoUrls, challenge: contest, choose, save, ready, begin, rematch, prepare } = R;
  const playRegion = useRef(null), resultHeading = useRef(null), arena = useRef(null), fx = useRef(null), piece = useRef(null);
  const [tick, setTick] = useState(0), [rematching, setRematching] = useState(false), [sound, setSoundOn] = useState(() => isSoundOn());
  const soundSwitch = html`<button type="button" class="linkbtn small" aria-pressed=${String(sound)} onClick=${() => { setSound(!sound); setSoundOn(!sound); }}>${sound ? "Sound is on" : "Sound is off"}</button>`;
  const code = contest?.code, host = contest?.hostId === account.id;
  const me = (contest?.standings || []).find((s) => s.accountId === account.id);
  const others = (contest?.standings || []).filter((s) => s.accountId !== account.id);
  // The count ticks ten times a second so the digits and the GO land on the instant.
  useEffect(() => {
    if (phase !== "count" && !(phase === "playing" && contest?.goAt && Date.now() - contest.goAt < 700)) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [phase, contest?.goAt]);
  useLayoutEffect(() => {
    if (phase === "playing") { playRegion.current?.focus({ preventScroll: true }); playRegion.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); }
    else if (phase === "result") resultHeading.current?.focus();
  }, [phase]);
  useEffect(() => { if (phase === "result" && result) { if (result.perfect) sfx.perfect(); else sfx.done(); } }, [phase]);
  useEffect(() => { if (phase === "playing" && contest?.goAt && Date.now() - contest.goAt < 700) sfx.done(); }, [phase]);

  const deal = (k) => {
    const zone = arena.current?.querySelector(`.zone[data-k="${k}"]`);
    if (!question || !zone || !fx.current) return;
    const right = question.choices[k]?.id === question.correctChoice;
    if (right) sfx.right(); else sfx.wrong();
    const head = piece.current?.querySelector(".slot");
    if (head instanceof HTMLElement) dealPiece(fx.current, head, zone.querySelector(".slot") || zone, right);
    flashZone(zone, right);
    zone.classList.remove("hit", "miss"); void zone.offsetWidth; zone.classList.add(right ? "hit" : "miss");
    floater(fx.current, zone, right ? `✓ ${firstName(targetOf(question).name)}` : `✗ ${firstName(targetOf(question).name)}`, right);
  };
  const answer = (k) => { if (!question || !question.choices[k]) return; deal(k); choose(question.id, question.choices[k].id); };
  useFlick(piece, arena, answer, phase === "playing" && question ? question.id : "", { map: side });
  useEffect(() => {
    if (phase !== "playing") return undefined;
    const onKey = (e) => {
      if (e.repeat || (e.target instanceof Element && e.target.closest("input,textarea,select"))) return;
      if (e.key === "ArrowLeft" || e.key === "1") { e.preventDefault(); answer(0); }
      if (e.key === "ArrowRight" || e.key === "2") { e.preventDefault(); answer(1); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [phase, question ? question.id : ""]);

  const link = `${location.origin}/speed/${code}`;
  const invite = html`<${ShareLink} url=${link} title=${GAME_NAME} text=${`First to name all ${round?.count ?? 10} classmates wins...`} />`;
  // From the result: the score is the message, and the link is the same ten people.
  const scoreShare = result && html`<${ShareLink} url=${link} title=${GAME_NAME} label="Share my score" text=${`I got ${result.correct} out of ${result.count} faces in ${(result.elapsedMs / 1000).toFixed(1)} seconds. Your turn`} />`;
  const seats = html`<ol class="seats" aria-label="Who is in">
    ${(contest?.standings || []).map((s) => html`<li key=${s.accountId} class=${`seat ${s.ready || s.accountId === contest.hostId ? "ready" : ""} ${s.accountId === account.id ? "me" : ""}`}>
      <span class="who">${s.nickname}${s.accountId === contest.hostId ? " · host" : ""}</span>
      <span class="how">${s.result ? "Finished" : s.status === "playing" ? "Playing" : s.ready || s.accountId === contest.hostId ? "Ready" : "Not ready yet"}</span>
    </li>`)}
  </ol>`;
  const followRematch = async () => {
    if (rematching) return;
    setRematching(true);
    const next = contest?.nextCode || (await rematch());
    setRematching(false);
    if (next && onChallenge) onChallenge(next);
  };

  let count = null;
  if (phase === "count" || (phase === "playing" && contest?.goAt && Date.now() - contest.goAt < 700)) {
    const left = contest?.goAt ? Math.ceil((contest.goAt - Date.now()) / 1000) : 3;
    count = html`<div class="countdown" role="status" aria-live="assertive">
      <div class="eyebrow">Everyone at once</div>
      <div class=${`digit ${left <= 0 ? "go" : ""}`} key=${left}>${left <= 0 ? "GO" : Math.min(3, left)}</div>
      <p>Drop each face on the body with their name.</p>
    </div>`;
  }

  if (phase === "playing" && question && photoUrls) {
    const right = answers.filter((a, i) => a.choice === round.questions[i].correctChoice).length;
    const strip = answerSummary(round, answers, photoUrls).slice(0, 3);
    return html`<section ref=${playRegion} class="sprint-stage sprint-play sprint-duel" tabindex="-1" aria-label="Speed duel" data-question-id=${question.id}>
      <div class="cab">
        <header class="sprint-hud">
          <div class="col"><span class="lbl">Right</span><span class="val">${pad2(right)}</span></div>
          <div class="col"><span class="lbl">Left</span><span class="val">${pad2(round.count - answers.length)}</span></div>
          <div class="col"><span class="lbl">Time</span><span class="val clock" role="timer">${(elapsed / 1000).toFixed(1)}s</span></div>
          <button class="linkbtn small sprint-leave" onClick=${onExit}>Leave</button>
        </header>
        <${Race} account=${account} contest=${contest} round=${round} answered=${answers.length} photoUrls=${photoUrls} />
        <h1 class="sr-only">What is their name?</h1>
        <div class="arena" ref=${arena} data-dir="face">
          <div class="fx" ref=${fx} aria-hidden="true"></div>
          <div class="choices" role="group" aria-label="Answer choices">
            ${question.choices.map((choice, i) => html`<button key=${choice.id} class="answer zone door" data-k=${i} data-state="idle" data-sprint-answer="true" aria-label=${choice.label} onClick=${() => answer(i)}>
              ${doorMarkup(choice, i)}
            </button>`)}
          </div>
          <div key=${question.id} class="piece is-enter" ref=${piece}>
            ${doorPieceMarkup(question, photoUrls)}
          </div>
        </div>
        <div class="strip">${strip.length
          ? strip.map((e) => html`<span key=${e.id} class="chip ${e.ok ? "ok" : "no"}"><span class="thumb">${e.thumb && html`<img src=${e.thumb} alt="" />`}</span><span class="cname">${e.name}</span></span>`)
          : html`<span class="hint">Flick the face down onto their body</span>`}</div>
        ${count}
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
    </div>`;
    const finished = (contest?.standings || []).filter((s) => s.result);
    const winner = finished[0];
    // What the others missed and got, by question position, drawn from this player's own copy of the round.
    const theirs = (s) => {
      if (!round || !Array.isArray(s.missed)) return null;
      const entry = (i) => { const q = round.questions[i]; return { id: q.id, name: targetOf(q).name, thumb: photoUrls?.get(q.image) || null }; };
      const missedSet = new Set(s.missed);
      return { missed: s.missed.map(entry), got: round.questions.map((q, i) => i).filter((i) => !missedSet.has(i)).map(entry) };
    };
    const small = (e) => html`<span key=${e.id} class="pair mini ok" title=${e.name}><span class="pthumb">${e.thumb && html`<img src=${e.thumb} alt="" />`}</span><span class="pname">${e.name}</span></span>`;
    const heading = !result ? "Your result" : others.length === 0 ? "Round cleared." : others.every((s) => s.result) ? (winner?.accountId === account.id ? "You take it." : `${winner?.nickname} takes it.`) : "Waiting for the others.";
    return html`<section class="sprint-stage sprint-result sprint-duel">
      <div class="cab attract">
        <div class="eyebrow">Duel ${code}</div>
        <h1 ref=${resultHeading} tabindex="-1" class="title">${heading}</h1>
        ${result && html`<p class="big">${result.correct} of ${result.count} correct in <strong>${seconds(result.elapsedMs)}</strong>, ${result.score.toLocaleString()} points.</p>`}
        <p role="status" class="small">${saved ? "Saved to your speed records." : saving ? "Saving your result." : unsavable ? "This result could not be saved. You can start a fresh round." : "This result has not been saved yet."}</p>
        ${error && html`<p class="notice error" role="alert">${error}</p>`}
        ${!(saved || unsavable) && html`<button class="btn btn-primary" disabled=${saving} onClick=${save}>Retry saving result</button>`}
        <ol class="versus" aria-label="Standings">${(contest?.standings || []).map((s, i) => html`<li key=${s.accountId} class=${`${s.accountId === account.id ? "me" : ""} ${s.result && i === 0 ? "win" : ""}`}>
          <span class="rank">${s.result ? i + 1 : ""}</span>
          <span class="who">${s.nickname}</span>
          <span class="how">${s.result ? `${seconds(s.result.elapsedMs)} · ${s.result.correct}/${s.result.count} · ${s.result.score.toLocaleString()} pts` : s.status === "playing" ? `Still playing, ${s.progress.index} of ${round?.count ?? 10}` : "Not started"}</span>
        </li>`)}</ol>
        <div class="row">
          ${scoreShare}
          ${contest?.nextCode ? html`<button class="btn btn-secondary" onClick=${followRematch}>Join the rematch</button>`
            : html`<button class="btn btn-secondary" disabled=${rematching} onClick=${followRematch}>${rematching ? "Making a code" : "Rematch"}</button>`}
          <button class="linkbtn" onClick=${onExit}>Back to games</button>
        </div>
        ${pairs.length > 0 && html`<section class="review" aria-label="Your answers">
          ${missed.length > 0 && html`<h2 class="no">You missed (${missed.length})</h2><div class="pairs">${missed.map(pair)}</div>`}
          ${got.length > 0 && html`<h2>You got right (${got.length})</h2><div class="pairs">${got.map(pair)}</div>`}
        </section>`}
        ${others.filter((s) => s.result && theirs(s)).map((s) => { const t = theirs(s); return html`<section key=${s.accountId} class="review theirs" aria-label=${`${s.nickname}'s answers`}>
          <h2 class="no">${s.nickname} missed (${t.missed.length})</h2>
          ${t.missed.length ? html`<div class="pairs">${t.missed.map(pair)}</div>` : html`<p class="small">Nobody. A clean run.</p>`}
          <h2>${s.nickname} got right (${t.got.length})</h2><div class="pairs minis">${t.got.map(small)}</div>
        </section>`; })}
      </div>
    </section>`;
  }

  // The lobby: who is in, who is ready, and the host's count.
  // The count waits for everyone who has joined; alone, the host may start whenever.
  const notReady = others.filter((s) => !s.ready && !s.result);
  const canStart = host && phase === "ready" && notReady.length === 0;
  return html`<section class="sprint-stage sprint-setup sprint-duel">
    <div class="cab attract">
      <div class="eyebrow">Speed duel · 10 classmates · two doors</div>
      <h1 class="title">Duel <span class="challenge-code">${code}</span></h1>
      <p>Same ten people for everyone, same count. Drop each face on the body with their name, bottom-left or bottom-right.</p>
      <div class="row">${invite}</div>
      <h2 class="lbl-heading">Who is in</h2>
      ${seats}
      ${error && html`<p class="notice error" role="alert">${error}</p>`}
      ${phase === "loading" ? html`<p role="status">Getting the ten ready${loaded[1] ? `: ${loaded[0]} of ${loaded[1]}` : ""}.</p>`
        : phase === "setup" && !error ? html`<p role="status">Getting the round ready.</p>`
        : phase === "setup" ? html`<button class="btn btn-primary" onClick=${prepare}>Get the round ready</button>`
        : host ? html`<button class="btn btn-primary" disabled=${!canStart} onClick=${begin}>Start the count</button>
          <p class="small">${!others.length ? "Share the link, or start alone." : notReady.length ? `Waiting for ${notReady.map((s) => s.nickname).join(", ")} to tap Ready.` : `${others.length === 1 ? others[0].nickname + " is" : "Everyone is"} ready. The count is 3, 2, 1.`}</p>`
        : me?.ready ? html`<p role="status">You are ready. ${(contest?.standings || []).find((s) => s.accountId === contest.hostId)?.nickname || "The host"} starts the count.</p>`
        : html`<button class="btn btn-primary" onClick=${ready}>I'm ready</button>`}
      <p><button class="linkbtn" onClick=${onExit}>Back to games</button> ${soundSwitch}</p>
      ${count}
    </div>
  </section>`;
}
