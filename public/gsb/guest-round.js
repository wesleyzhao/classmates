// Optional guest sprint, loaded only when the server enables the experiment and a visitor opens it.
import { html, useEffect, useLayoutEffect, useRef, useState } from "../app/h.js";
import { api, Answers, Photo } from "./components.js";
import { portraitUrl } from "./media-cache.js";

const storageKey = (id) => `gsb-guest-attempt:${id}`;
function remember(id, state) {
  try { sessionStorage.setItem(storageKey(id), JSON.stringify(state)); } catch {}
}
function restore(round) {
  try {
    const state = JSON.parse(sessionStorage.getItem(storageKey(round.id)));
    if (Array.isArray(state?.answers) && state.answers.length <= round.count &&
      state.answers.every((a, i) => a.questionId === round.questions[i].id &&
        (a.choice === null || /^[0-3]$/.test(a.choice)) && Number.isInteger(a.elapsedMs) &&
        a.elapsedMs >= 0 && a.elapsedMs <= round.questionMs))
      return { answers: state.answers, startedAt: Number(state.startedAt) || Date.now() };
  } catch {}
  return { answers: [], startedAt: Date.now() };
}

/** Play one local, timed round; only its validated personal result may be claimed after email sign-in. */
export function GuestRound({ onSignIn }) {
  const [round, setRound] = useState(null),
    [attempt, setAttempt] = useState(null),
    [feedback, setFeedback] = useState(null),
    [now, setNow] = useState(Date.now()),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [result, setResult] = useState(null),
    [loadVersion, setLoadVersion] = useState(0);
  const current = useRef(null), locked = useRef(false), transition = useRef(null),
    mounted = useRef(true), finishing = useRef(false);
  current.current = { round, attempt, feedback };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(transition.current); };
  }, []);
  useEffect(() => {
    let active = true;
    setError("");
    api("guest/start", {}).then(async (data) => {
      if (!active) return;
      if (data.status === "complete") {
        setRound(data); setResult(data.result); return;
      }
      // Eight target portraits fit in the existing twelve-entry memory cache.
      await Promise.all(data.questions.map((q) => portraitUrl(q.image)));
      if (!active) return;
      const saved = restore(data);
      setRound(data); setAttempt(saved); setNow(Date.now());
      remember(data.id, saved);
    }).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [loadVersion]);

  const finish = async () => {
    const c = current.current;
    if (finishing.current || !c.attempt || c.attempt.answers.length !== c.round.count) return;
    finishing.current = true; setSaving(true); setError("");
    try {
      const saved = await api("guest/finish", { answers: c.attempt.answers });
      if (mounted.current) {
        setResult(saved);
        try { sessionStorage.removeItem(storageKey(c.round.id)); } catch {}
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      finishing.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const choose = (choice) => {
    const c = current.current;
    if (locked.current || !c.round || !c.attempt || c.feedback) return false;
    const question = c.round.questions[c.attempt.answers.length];
    if (!question) return false;
    locked.current = true;
    const elapsedMs = Math.min(c.round.questionMs, Math.max(0, Date.now() - c.attempt.startedAt));
    if (elapsedMs >= c.round.questionMs) choice = null;
    const answer = { questionId: question.id, choice, elapsedMs: choice === null ? c.round.questionMs : elapsedMs };
    const next = { answers: [...c.attempt.answers, answer], startedAt: Date.now() + 280 };
    remember(c.round.id, next);
    setFeedback({ choice, correct: choice === question.correctChoice, question });
    transition.current = setTimeout(() => {
      if (!mounted.current) return;
      setAttempt(next); setFeedback(null); setNow(Date.now()); locked.current = false;
    }, 280);
    return true;
  };
  useLayoutEffect(() => {
    if (!attempt || !round || result || feedback) return;
    if (attempt.answers.length === round.count) { finish(); return; }
    const tick = () => {
      setNow(Date.now());
      if (Date.now() - attempt.startedAt >= round.questionMs) choose(null);
    };
    tick();
    const timer = setInterval(tick, 50);
    return () => clearInterval(timer);
  }, [attempt, round, feedback, result]);

  if (result) return html`<section class="narrow gsb-card guest-result">
    <div class="eyebrow">Eight faces. One sprint.</div>
    <h1>${result.score.toLocaleString()} points</h1>
    <p>${result.correct} of ${result.count} correct in ${(result.elapsedMs / 1000).toFixed(1)} seconds.</p>
    <p class="muted">That is your warm-up. Sign in to keep playing and save your score.</p>
    <button class="btn btn-primary" onClick=${onSignIn}>Sign in to save my score</button>
    <p class="small muted" style="margin-top:16px">Personal speed round. Multiplayer ratings are separate.</p>
  </section>`;
  if (!round || !attempt) return html`<section class="narrow">
    <h1>Eight faces. Think fast.</h1>
    <p class="muted">Eight seconds each. Accurate and quick earns more points.</p>
    ${error ? html`<p class="notice error" role="alert">${error}</p>
      <button class="btn btn-primary" onClick=${() => setLoadVersion((n) => n + 1)}>Retry loading</button>`
      : html`<p role="status">Getting your eight faces ready.</p>`}
    <button class="linkbtn" onClick=${onSignIn}>Sign in instead</button>
  </section>`;
  const question = round.questions[attempt.answers.length];
  if (!question) return html`<section class="narrow gsb-card">
    <h1>Sprint complete.</h1>
    ${error ? html`<p class="notice error" role="alert">${error}</p>
      <button class="btn btn-primary" disabled=${saving} onClick=${finish}>Retry saving round</button>`
      : html`<p role="status">Finishing your round.</p>`}
  </section>`;
  const remaining = Math.max(0, round.questionMs - Math.max(0, now - attempt.startedAt));
  return html`<section class="question guest-round">
    <div class="row spread"><h1>Think fast.</h1><span class="small muted">${attempt.answers.length + 1} / ${round.count}</span></div>
    <div class="row spread small"><span>Match the name.</span><span class="clock" role="timer">${(remaining / 1000).toFixed(1)}s</span></div>
    <div class="meter guest-clock"><span style=${`width:${100 * remaining / round.questionMs}%`}></span></div>
    <${Answers} question=${{ ...question, direction: "face" }} onAnswer=${choose}
      disabled=${!!feedback} picked=${feedback?.choice ?? null} tilt=${false}
      right=${feedback ? question.correctChoice : null}
      wrong=${feedback && !feedback.correct && feedback.choice !== null ? [feedback.choice] : []} />
    <div class="status-line" aria-live="polite">${feedback
      ? feedback.correct ? "Got it." : question.choices.find((c) => c.id === question.correctChoice)?.label
      : ""}</div>
    <button class="linkbtn small" onClick=${onSignIn}>Sign in instead</button>
  </section>`;
}
