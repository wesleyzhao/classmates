// Owns the speed-round lifecycle, input, timer, private media and result recovery independently of its styling.
// A round is prepared as soon as the screen opens or a setting changes, and the next one is prepared behind
// the result screen, so "Start the clock" and "Play again" are ready before anyone taps.
import { useEffect, useLayoutEffect, useRef, useState } from "../app/h.js";
import { api } from "./components.js";
import { scoreSprint } from "../kits/recognition/sprint.js";
import { prepareRoundMedia } from "./round-media.js";
import { createSprintBuffer } from "./sprint-buffer.js";

import { createFaceCheckpoints } from "./face-checkpoints.js";

const pendingKey = (id) => `gsb-sprint-pending:${id}`;
function readPending(id) {
  try { return JSON.parse(sessionStorage.getItem(pendingKey(id))); } catch { return null; }
}
function remember(id, value) {
  try {
    if (value) sessionStorage.setItem(pendingKey(id), JSON.stringify(value));
    else sessionStorage.removeItem(pendingKey(id));
  } catch {}
}
export const DIRECTIONS = ["face", "name", "mixed"];
export const LENGTHS = { quick: 10, short: 20 };

/** Controller for one signed-in account. Mount with key=account.id (plus the challenge code, when there is one).
 * A challenge plays one shared sequence: the round comes from the join route, settings are fixed, and standings are polled.
 * @param {{id:string}} account
 * @param {{ challenge?: string | null, initialLength?: string }} [options]
 */
export function useSprintRound(account, { challenge = null, initialLength = "short" } = {}) {
  const [history] = useState(() => createFaceCheckpoints(account.id));
  const storageKey = challenge ? `${account.id}:${challenge}` : account.id;
  const [restored] = useState(() => readPending(storageKey));
  const pending = useRef(restored);
  const [choices, setChoices] = useState(pending.current ? pending.current.choices ?? 4 : 2);
  const [direction, setDirection] = useState(pending.current?.direction || "face"),
    [length, setLength] = useState(pending.current?.length || (Object.hasOwn(LENGTHS, initialLength) ? initialLength : "short")),
    [phase, setPhase] = useState(pending.current ? "result" : "setup"),
    [round, setRound] = useState(null),
    [loaded, setLoaded] = useState([0, 0]),
    [answers, setAnswers] = useState([]),
    [result, setResult] = useState(pending.current?.result || null),
    [records, setRecords] = useState(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [unsavable, setUnsavable] = useState(false),
    [saving, setSaving] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [standings, setStandings] = useState(null),
    [challengeInfo, setChallengeInfo] = useState(null),
    [goAt, setGoAt] = useState(null);
  // A duel starts on the server's instant; the offset turns it into this device's clock.
  const offset = useRef(0), duel = useRef(false);
  const media = useRef(null), abort = useRef(null), alive = useRef(true),
    current = useRef(null), clock = useRef(null), saveLock = useRef(false),
    preparing = useRef(false), next = useRef(null), ticket = useRef(0),
    buffer = useRef(null), loadingSpec = useRef(null);
  current.current = { round, answers, phase, direction, length, choices };
  const elapsedNow = () => clock.current
    ? Math.max(1, Math.round(Math.max(performance.now() - clock.current.monotonic, Date.now() - clock.current.wall))) : 0;
  // The round behind the result screen: its own media and abort, adopted by the next prepare when settings match.
  const dropNext = () => {
    const n = next.current; next.current = null;
    if (n) { n.abort.abort(); n.media?.dispose(); }
  };
  const release = () => { abort.current?.abort(); media.current?.dispose(); media.current = null; buffer.current = null; loadingSpec.current = null; };
  const showBuffered = (data) => {
    current.current = { ...current.current, round: data, phase: "ready", answers: [] };
    setRound(data); setRecords(data.records); setPhase("ready");
    media.current?.warm(data.mediaOffset ?? 0).catch(() => {});
  };
  useEffect(() => {
    const flush = () => { history.flush(); };
    const hidden = () => { if (document.hidden) flush(); };
    flush();
    window.addEventListener("pagehide",flush);
    window.addEventListener("online",flush);
    document.addEventListener("visibilitychange",hidden);
    return () => { flush(); window.removeEventListener("pagehide",flush); window.removeEventListener("online",flush);
      document.removeEventListener("visibilitychange",hidden); alive.current=false; release(); dropNext(); };
  }, []);
  useEffect(() => {
    // Preparation already includes records. Refresh only after a saved result.
    if (!saved || phase !== "result") return undefined;
    let active = true;
    const controller = new AbortController();
    api(`sprint/records?direction=${direction}&length=${length}&choices=${round?.choices ?? choices}`, undefined, {signal:controller.signal})
      .then(data => { if (active) { buffer.current?.updateRecords(length, data); setRecords(data); } })
      .catch(e => active && setError(e.message));
    return () => { active = false; controller.abort(); };
  }, [direction, length, choices, saved, phase]);

  const save = async () => {
    if (saveLock.current || !pending.current) return;
    saveLock.current = true; setSaving(true); setError("");
    try {
      const payload = pending.current;
      const confirmed = await api("sprint/finish", {
        id: payload.id, answers: payload.answers, elapsedMs: payload.elapsedMs, epoch:payload.epoch ?? "0",
      });
      history.forget(payload.id);
      remember(storageKey, null); pending.current = null;
      if (alive.current) {
        const updated = buffer.current?.record(payload.id, confirmed);
        if (updated) setRecords(updated);
        setResult(confirmed); setSaved(true);
      }
      if (challenge && alive.current) api(`sprint/challenge/${challenge}`).then((view) => alive.current && setStandings(view.standings)).catch(() => {});
    } catch (e) {
      if ([400, 404, 410].includes(e.status)) {
        remember(storageKey, null); pending.current = null;
        if (alive.current) { buffer.current = null; setUnsavable(true); }
      }
      if (alive.current) setError(e.message);
    }
    finally { saveLock.current = false; if (alive.current) setSaving(false); }
  };
  useEffect(() => { if (pending.current) save(); }, []);

  const prepare = async () => {
    const c = current.current;
    if (preparing.current || pending.current || ["playing", "arming", "loading"].includes(c.phase)) return;
    preparing.current = true;
    setError(""); setSaved(false); setUnsavable(false);
    setResult(null); setAnswers([]); setElapsed(0); clock.current = null;
    const buffered = !challenge && c.phase !== "expired" && media.current && buffer.current?.get(c.length);
    if (buffered) { showBuffered(buffered); preparing.current = false; return; }
    release();
    const n = next.current;
    // A prepare that a setting change superseded must not touch the round that replaced it.
    const mine = ++ticket.current;
    const live = () => alive.current && mine === ticket.current;
    if (n && n.direction === c.direction && n.length === c.length && n.choices === c.choices) {
      // The round behind the result screen: take it as it is, or wait for the rest of its photos.
      next.current = null; abort.current = n.abort;
      loadingSpec.current = { direction: n.direction, length: n.length };
      const adopt = () => {
        media.current = n.media; buffer.current = createSprintBuffer(n.data);
        setLoaded([n.total, n.total]); showBuffered(buffer.current.get(current.current.length) ?? buffer.current.get(n.length));
      };
      if (n.ready) { adopt(); preparing.current = false; return; }
      setPhase("loading"); setLoaded([n.loaded, n.total]);
      n.report = (loadedCount, total) => live() && setLoaded([loadedCount, total]);
      try { await n.promise; if (live()) adopt(); }
      catch (e) { if (live()) { release(); setRound(null); setPhase("setup"); setError(e.message); } }
      finally { if (mine === ticket.current) preparing.current = false; }
      return;
    }
    dropNext();
    const controller = new AbortController();
    abort.current = controller;
    loadingSpec.current = { direction: c.direction, length: c.length };
    setPhase("loading"); setLoaded([0, 0]);
    try {
      await history.flush();
      if (!live()) return;
      const data = challenge ? await api(`sprint/challenge/${challenge}/join`, {}, {signal:controller.signal}) : await api("sprint/prepare", { direction: c.direction, length: c.length, choices: c.choices }, {signal:controller.signal});
      if (!live()) return;
      if (challenge) { setRound(data); setRecords(data.records); }
      else {
        buffer.current = createSprintBuffer(data);
        const selected = buffer.current.get(current.current.length) ?? buffer.current.get(data.length);
        setRound(selected); setRecords(selected.records);
      }
      if (challenge) {
        setDirection(data.direction); setLength(data.length); setChoices(data.choices ?? 4); setStandings(data.standings);
        duel.current = data.mode === "duel";
        if (typeof data.now === "number") offset.current = data.now - Date.now();
        setChallengeInfo({ code: data.code, hostId: data.hostId, expiresAt: data.expiresAt, mode: data.mode, choices: data.choices, selectionVersion: data.selectionVersion, startsAt: Math.max(data.startsAt ?? 0,data.startedAt ?? 0) || null, startedAt: data.startedAt, nextCode: data.nextCode });
        if (data.result) {
          // This account already finished the challenge: show the saved result and the standings.
          setResult(data.result); setSaved(true); setPhase("result");
          return;
        }
      }
      const prepared = await prepareRoundMedia(data.questions, {
        signal: controller.signal,
        onProgress: (loadedCount, total) => live() && setLoaded([loadedCount, total]),
      });
      if (!live()) { prepared.dispose(); return; }
      media.current = prepared;
      if (challenge) setPhase("ready");
      else showBuffered(buffer.current.get(current.current.length) ?? buffer.current.get(data.length));
    } catch (e) { if (live()) { release(); setRound(null); setPhase("setup"); setError(e.message); } }
    finally { if (mine === ticket.current) preparing.current = false; }
  };
  // Prepare as soon as the screen opens, and again shortly after a setting changes, so a round only ever
  // waits for a tap on Start. A prepare that failed leaves the manual button; it is not retried on its own.
  const [wanted, setWanted] = useState(0);
  useEffect(() => {
    if (current.current.phase !== "setup" || pending.current) return undefined;
    const timer = setTimeout(prepare, wanted ? 400 : 0);
    return () => clearTimeout(timer);
  }, [wanted]);
  // Behind the result screen, prepare the next round with the same settings (a challenge is one run, so not there).
  useEffect(() => {
    if (challenge || phase !== "result" || !saved || !round || next.current) return undefined;
    const remaining = buffer.current?.get(length);
    if (remaining) {
      // The second half is already downloaded. Warm its opening photos while the result is visible.
      media.current?.warm(remaining.mediaOffset).catch(() => {});
      return undefined;
    }
    const timer = setTimeout(() => {
      const c = current.current;
      const slot = { abort: new AbortController(), media: null, data: null, ready: false, loaded: 0, total: 0, direction: c.direction, length: c.length, choices: c.choices, report: null, promise: null };
      slot.promise = (async () => {
        const data = await api("sprint/prepare", { direction: slot.direction, length: slot.length, choices: slot.choices }, {signal:slot.abort.signal});
        if (slot.abort.signal.aborted) throw new Error("Photo loading was cancelled.");
        slot.data = data;
        slot.media = await prepareRoundMedia(data.questions, { signal: slot.abort.signal, onProgress: (loadedCount, total) => { slot.loaded = loadedCount; slot.total = total; slot.report?.(loadedCount, total); } });
        slot.ready = true;
      })();
      slot.promise.catch(() => { if (next.current === slot) next.current = null; });
      next.current = slot;
    }, 400);
    return () => clearTimeout(timer);
  }, [phase, saved]);
  // Challenge standings: polled while the player is not mid-round, faster while the tab is visible.
  // A duel polls every second, during play too, for the other player's progress, the count and a rematch.
  useEffect(() => {
    if (!challenge || (!duel.current && (phase === "playing" || phase === "arming"))) return undefined;
    let active = true, timer = null;
    const controller = new AbortController();
    const every = () => (duel.current && phase !== "result" ? 1000 : document.hidden ? 5000 : 2500);
    const poll = async () => {
      try {
        const view = await api(`sprint/challenge/${challenge}`, undefined, {signal:controller.signal});
        if (active) {
          if (duel.current && current.current.round && view.selectionVersion !== current.current.round.selectionVersion &&
              !["playing","result","loading","arming"].includes(current.current.phase)) {
            setChallengeInfo(info => info ? {...info, startsAt:null} : info);
            await prepare();
            return;
          }
          setStandings(view.standings);
          if (typeof view.now === "number") offset.current = view.now - Date.now();
          setChallengeInfo((info) => info ? { ...info, startsAt: Math.max(view.startsAt ?? 0,current.current.round?.startedAt ?? 0) || null, nextCode: view.nextCode } : info);
        }
      } catch (e) { if (active && e.status === 404) setError(e.message); }
      if (active) timer = setTimeout(poll, every());
    };
    timer = setTimeout(poll, every());
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [challenge, phase]);
  // The count: once the start instant is known and the round is ready, play begins on it, wherever the tab is.
  const startsAt = challengeInfo?.startsAt ?? null;
  useEffect(() => {
    if (!duel.current || !startsAt || !["ready", "count"].includes(phase)) return undefined;
    const goLocal = startsAt - offset.current;
    setGoAt(goLocal);
    if (phase === "ready") setPhase("count");
    const go = () => {
      clock.current = { monotonic: performance.now() - Math.max(0, Date.now() - goLocal), wall: goLocal };
      current.current.phase = "playing"; setPhase("playing");
    };
    const wait = goLocal - Date.now();
    if (wait <= 0) { go(); return undefined; }
    const timer = setTimeout(go, wait);
    return () => clearTimeout(timer);
  }, [startsAt, phase]);
  const ready = async () => {
    try { const view = await api(`sprint/challenge/${challenge}/ready`, {version:current.current.round?.selectionVersion}); if (alive.current) setStandings(view.standings); }
    catch (e) { if (alive.current) setError(e.message); }
  };
  const begin = async () => {
    try {
      const view = await api(`sprint/challenge/${challenge}/begin`, {version:current.current.round?.selectionVersion});
      if (!alive.current) return;
      if (typeof view.now === "number") offset.current = view.now - Date.now();
      setStandings(view.standings);
      setChallengeInfo((info) => info ? { ...info, startsAt: view.startsAt } : info);
    } catch (e) { if (alive.current) setError(e.message); }
  };
  const rematch = async () => {
    try { return (await api(`sprint/challenge/${challenge}/rematch`, {})).code; }
    catch (e) { if (alive.current) setError(e.message); return null; }
  };
  const createChallenge = async ({ mode = "solo" } = {}) => {
    const c = current.current;
    setError("");
    try { return (await api("sprint/challenge", mode === "duel" ? { direction: "face", length: "quick", mode } : { direction: c.direction, length: c.length, choices: c.choices })).code; }
    catch (e) { if (alive.current) setError(e.message); return null; }
  };
  const start = async () => {
    if (current.current.phase !== "ready") return;
    current.current.phase = "arming"; setPhase("arming"); setError("");
    try {
      await api("sprint/start", { id: round.id });
      if (alive.current) { buffer.current?.consume(round.id); setPhase("playing"); }
    } catch (e) { if (alive.current) {
      if (e.status === 410) { release(); setRound(null); }
      setPhase(e.status === 410 ? "setup" : "ready"); setError(e.message);
    } }
  };
  useLayoutEffect(() => {
    if (phase !== "playing" || clock.current) return;
    clock.current = { monotonic: performance.now(), wall: Date.now() };
  }, [phase]);
  useEffect(() => {
    if (phase !== "playing") return;
    history.remember(current.current.round,current.current.answers);
    const id = setInterval(() => {
      const ms = elapsedNow(); setElapsed(ms);
      if (ms >= 3600000) setPhase("expired");
    }, 100);
    return () => clearInterval(id);
  }, [phase]);
  const choose = (questionId, choice) => {
    const c = current.current, q = c.round?.questions[c.answers.length];
    if (c.phase !== "playing" || !clock.current || !q || q.id !== questionId ||
        typeof choice !== "string" || !/^[0-3]$/.test(choice) || !q.choices.some(a => a.id===choice)) return;
    if (duel.current) {
      // Live progress for the other player; it never waits and never counts for the score.
      const right = c.answers.filter((a, i) => a.choice === c.round.questions[i].correctChoice).length + Number(choice === q.correctChoice);
      api(`sprint/challenge/${challenge}/progress`, { index: c.answers.length + 1, right }).catch(() => {});
    }
    if (elapsedNow() >= 3600000) { setPhase("expired"); return; }
    const nextAnswers = [...c.answers, { questionId, choice }];
    // Advance the input guard synchronously, so queued events for the old question cannot answer twice.
    current.current = { ...c, answers: nextAnswers };
    setAnswers(nextAnswers);
    history.remember(c.round,nextAnswers);
    if (nextAnswers.length === c.round.count) {
      const elapsedMs = elapsedNow(), scored = scoreSprint(c.round.questions, nextAnswers, elapsedMs);
      current.current.phase = "result";
      const payload = { id: c.round.id, epoch:c.round.historyEpoch ?? "0", direction, length, choices: c.round.choices ?? 4, answers: nextAnswers, elapsedMs, result: scored };
      pending.current = payload; remember(storageKey, payload);
      setResult(scored); setPhase("result"); save();
    } else media.current?.warm((c.round.mediaOffset ?? 0) + nextAnswers.length).catch(() => {});
  };
  useEffect(() => {
    const key = event => {
      // Native buttons activate repeatedly on held Enter, even without our number shortcuts.
      if (event.repeat && ["Enter", " "].includes(event.key) &&
          event.target?.closest?.("[data-sprint-answer]")) {
        event.preventDefault(); return;
      }
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        event.target?.closest?.("input,textarea,select,[contenteditable]")) return;
      const c = current.current, q = c.round?.questions[c.answers.length];
      if (c.phase !== "playing" || !q) return;
      const index = q.choices.length === 2 && event.key === "ArrowLeft" ? 0
        : q.choices.length === 2 && event.key === "ArrowRight" ? 1 : /^[1-4]$/.test(event.key) ? Number(event.key) - 1 : -1;
      if (!q.choices[index]) return;
      event.preventDefault(); choose(q.id, q.choices[index].id);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [direction, length]);
  // Direction changes need new questions. Length changes reuse a compatible sequence, even while it loads.
  const reconfigure = (apply) => {
    if (challenge || !["setup", "ready", "loading"].includes(current.current.phase)) return;
    ticket.current++; release(); dropNext(); preparing.current = false;
    setRound(null); setRecords(null); setError(""); setLoaded([0, 0]); setPhase("setup");
    apply();
    setWanted((n) => n + 1);
  };
  const changeLength = value => {
    const c = current.current;
    if (!Object.hasOwn(LENGTHS, value) || value === c.length || challenge || !["setup", "ready", "loading"].includes(c.phase)) return;
    const selected = buffer.current?.get(value);
    const loading = c.phase === "loading" && loadingSpec.current?.direction === c.direction &&
      (loadingSpec.current.length === value || (loadingSpec.current.length === "short" && value === "quick"));
    if ((selected && c.phase === "ready") || loading) {
      current.current = { ...c, length: value }; setLength(value); setError("");
      if (selected) {
        if (c.phase === "ready") showBuffered(selected);
        else { setRound(selected); setRecords(selected.records); }
      }
      return;
    }
    reconfigure(() => { current.current.length = value; setLength(value); });
  };
  const question = round?.questions[answers.length];
  return {
    phase, direction, length, choices, round, question, loaded, answers, result, records, error,
    saved, saving, unsavable, elapsed, photoUrls: media.current?.urls,
    challenge: challenge ? { code: challenge, ...(challengeInfo || {}), standings, goAt } : null,
    prepare, start, choose, save, createChallenge, ready, begin, rematch,
    changeDirection(value) {
      const nextDirection = value === "classic" ? "face" : value, nextChoices = value === "face" ? 2 : 4;
      if (DIRECTIONS.includes(nextDirection) && (nextDirection !== current.current.direction || nextChoices !== current.current.choices))
        reconfigure(() => { current.current.direction = nextDirection; current.current.choices = nextChoices; setDirection(nextDirection); setChoices(nextChoices); });
    },
    changeLength,
  };
}
