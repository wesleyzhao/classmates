// One anonymous introduction: preload, count down, answer instantly, then verify email to continue.
import { html, useEffect, useLayoutEffect, useRef, useState } from "../app/h.js";
import { api } from "./components.js";
import { prepareRoundMedia } from "./round-media.js";
import { pieceMarkup, zoneMarkup } from "./sprint-pieces.js";
import { useFlick, dealPiece, flashZone, floater, firstName, targetOf } from "./sprint-arcade.js";
import { sfx } from "./sound.js";

const storageKey = (id) => `gsb-guest-attempt:${id}`;
function remember(id, state) {
  try { localStorage.setItem(storageKey(id), JSON.stringify(state)); } catch {}
}
function restore(round) {
  try {
    const state = JSON.parse(localStorage.getItem(storageKey(round.id)) || sessionStorage.getItem(storageKey(round.id)));
    if (Array.isArray(state?.answers) && state.answers.length <= round.count &&
      state.answers.every((a, i) => a.questionId === round.questions[i].id &&
        (a.choice === null || /^[0-3]$/.test(a.choice)) && Number.isInteger(a.elapsedMs) &&
        a.elapsedMs >= 0 && a.elapsedMs <= round.questionMs))
      return { answers: state.answers, startedAt: Number(state.startedAt) || Date.now() };
  } catch {}
  return null;
}

/** Guest attempts use the same arcade artwork and media owner as Speed, with no per-answer HTTP. */
export function GuestRound({ onSignIn, signInForm }) {
  const [round, setRound] = useState(null), [attempt, setAttempt] = useState(null),
    [countdown, setCountdown] = useState(null), [now, setNow] = useState(Date.now()),
    [error, setError] = useState(""), [saving, setSaving] = useState(false),
    [result, setResult] = useState(null), [expired, setExpired] = useState(false),
    [loadVersion, setLoadVersion] = useState(0);
  const current = useRef(null), media = useRef(null), mounted = useRef(true), finishing = useRef(false),
    arena = useRef(null), fx = useRef(null), piece = useRef(null), region = useRef(null);
  current.current = { round, attempt, result, countdown };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError("");
    api("guest/start", {}, { signal: controller.signal }).then(async (data) => {
      if (!active) return;
      if (data.status === "expired") { setExpired(true); return; }
      if (data.status === "complete") { setRound(data); setResult(data.result); return; }
      media.current = await prepareRoundMedia(data.questions, { signal: controller.signal });
      if (!active) return;
      const saved = restore(data);
      setRound(data); setAttempt(saved); setNow(Date.now());
      if (!saved) setCountdown(3);
    }).catch((e) => { if (active) { setError(e.message); if (e.status === 410) setExpired(true); } });
    return () => { active = false; controller.abort(); media.current?.dispose(); media.current = null; };
  }, [loadVersion]);

  // A hidden tab cannot burn the first question before its player sees the countdown.
  useEffect(() => {
    if (!round || attempt || result) return;
    let deadline = Date.now() + 3000;
    const visible = () => { deadline = Date.now() + 3000; setCountdown(3); };
    const timer = setInterval(() => {
      if (document.hidden) return;
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      if (remaining > 0) { setCountdown(remaining); return; }
      clearInterval(timer);
      const next = { answers: [], startedAt: Date.now() };
      current.current = { ...current.current, attempt: next, countdown: null };
      remember(round.id, next); setAttempt(next); setCountdown(null); setNow(Date.now());
    }, 50);
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [round, !!attempt, !!result]);

  const finish = async () => {
    const c = current.current;
    if (finishing.current || !c.attempt || c.attempt.answers.length !== c.round.count) return;
    finishing.current = true; setSaving(true); setError("");
    try {
      const saved = await api("guest/finish", { answers: c.attempt.answers });
      if (mounted.current) {
        setResult(saved);
        try { localStorage.removeItem(storageKey(c.round.id)); sessionStorage.removeItem(storageKey(c.round.id)); } catch {}
      }
    } catch (e) {
      if (mounted.current) { setError(e.message); if (e.status === 410) setExpired(true); }
    } finally { finishing.current = false; if (mounted.current) setSaving(false); }
  };
  const choose = (questionId, choice) => {
    const c = current.current, question = c.round?.questions[c.attempt?.answers.length];
    if (!question || c.result || c.countdown !== null || question.id !== questionId) return false;
    const elapsedMs = Math.min(c.round.questionMs, Math.max(0, Date.now() - c.attempt.startedAt));
    if (elapsedMs >= c.round.questionMs) choice = null;
    const answer = { questionId, choice, elapsedMs: choice === null ? c.round.questionMs : elapsedMs };
    const next = { answers: [...c.attempt.answers, answer], startedAt: Date.now() };
    // Consume the displayed question synchronously so two events cannot answer the next one.
    current.current = { ...c, attempt: next };
    remember(c.round.id, next); setAttempt(next); setNow(Date.now());
    media.current?.warm(next.answers.length).catch(() => {});
    return true;
  };
  const question = round?.questions[attempt?.answers.length];
  const answer = (index) => {
    if (!question || !choose(question.id, question.choices[index].id)) return;
    const zone = arena.current?.querySelector(`[data-k="${index}"]`);
    const right = question.choices[index].id === question.correctChoice;
    if (right) sfx.right(); else sfx.wrong();
    if (zone && fx.current && piece.current) {
      dealPiece(fx.current, piece.current, zone, right); flashZone(zone, right);
      floater(fx.current, zone, `${right ? "✓" : "✗"} ${firstName(targetOf(question).name)}`, right);
    }
  };
  useFlick(piece, arena, answer, question?.id ?? "");
  useEffect(() => {
    if (!question) return;
    const key = (e) => {
      if (e.target instanceof Element && e.target.closest("input,textarea,select")) return;
      if (/^[1-4]$/.test(e.key)) { e.preventDefault(); if (!e.repeat) answer(Number(e.key) - 1); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [question?.id]);
  useLayoutEffect(() => {
    if (!attempt || !round || result || expired) return;
    if (attempt.answers.length === round.count) { finish(); return; }
    const tick = () => {
      setNow(Date.now());
      if (Date.now() - attempt.startedAt >= round.questionMs) choose(round.questions[attempt.answers.length].id, null);
    };
    tick(); const timer = setInterval(tick, 50);
    return () => clearInterval(timer);
  }, [attempt, round, result, expired]);
  useLayoutEffect(() => {
    if (attempt && !result) { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: "nearest" }); }
  }, [!!attempt, !!result]);

  if (result || expired) return html`<section class="sprint-stage sprint-result guest-result"><div class="cab attract">
    <div class="eyebrow">${result ? "Round complete" : "Your guest round has ended"}</div>
    <h1 class="title">${result ? `${result.score.toLocaleString()} points` : "Keep learning your classmates."}</h1>
    ${result && html`<p class="big">${result.correct} of ${result.count} correct in ${(result.elapsedMs / 1000).toFixed(1)} seconds.</p>`}
    <p>${result ? "Sign in to save your score and play again." : "Sign in to play another round."}</p>
    ${signInForm || html`<button class="btn btn-primary" onClick=${onSignIn}>Sign in to save my score</button>`}
    <p class="small">Your guest score is a personal record. Multiplayer ratings are separate.</p>
  </div></section>`;
  if (!round) return html`<section class="sprint-stage guest-loading"><div class="cab attract">
    <h1 class="title">Meet ten classmates.</h1>
    ${error ? html`<p class="notice error" role="alert">${error}</p><button class="btn btn-primary" onClick=${() => setLoadVersion(n => n + 1)}>Retry loading</button>`
      : html`<p role="status">Loading your ten faces.</p>`}
    <button class="linkbtn" onClick=${onSignIn}>Sign in instead</button>
  </div></section>`;
  if (countdown !== null) return html`<section class="sprint-stage guest-countdown"><div class="cab attract">
    <h1 class="title">Match ten faces to their names.</h1>
    <p>Tap a name or flick the person toward it. Quick, correct answers earn more points.</p>
    <div class="guest-count" role="status" aria-live="polite" aria-label=${`Starting in ${countdown}`}>${countdown}</div>
    <button class="linkbtn" onClick=${onSignIn}>Sign in instead</button>
  </div></section>`;
  if (!question) return html`<section class="sprint-stage"><div class="cab attract"><h1 class="title">Round complete.</h1>
    ${error ? html`<p class="notice error" role="alert">${error}</p><button class="btn btn-primary" disabled=${saving} onClick=${finish}>Retry saving round</button>`
      : html`<p role="status">Finishing your round.</p>`}
  </div></section>`;
  const remaining = Math.max(0, round.questionMs - Math.max(0, now - attempt.startedAt));
  const right = attempt.answers.filter((a, i) => a.choice === round.questions[i].correctChoice).length;
  return html`<section ref=${region} tabindex="-1" aria-label="Guest speed round" class="sprint-stage sprint-play guest-round" data-question-id=${question.id}><div class="cab">
    <header class="sprint-hud">
      <div class="col"><span class="lbl">Right</span><span class="val">${right}</span></div>
      <div class="col"><span class="lbl">Face</span><span class="val">${attempt.answers.length + 1} / ${round.count}</span></div>
      <div class="col"><span class="lbl">Time left</span><span class="val clock" role="timer">${(remaining / 1000).toFixed(1)}s</span></div>
      <button class="linkbtn small sprint-leave" onClick=${onSignIn}>Sign in</button>
    </header>
    <h1 class="sr-only">Match the face to a name</h1>
    <div class="arena" ref=${arena} data-dir="face"><div class="fx" ref=${fx} aria-hidden="true"></div>
      <div class="choices" role="group" aria-label="Answer choices">${question.choices.map((choice, i) => html`<button key=${choice.id} class="answer zone" data-k=${i} data-state="idle" aria-label=${choice.label} onClick=${() => answer(i)}>${zoneMarkup(choice, i, media.current.urls)}</button>`)}</div>
      <div key=${question.id} class="piece" ref=${piece}>${pieceMarkup(question, media.current.urls, false)}</div>
    </div>
    <div class="strip"><span class="hint">Tap a name or flick toward it</span></div>
  </div></section>`;
}
