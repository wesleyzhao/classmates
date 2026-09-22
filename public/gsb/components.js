// Shared answer UI accepts structured text or image choices and an optional tilt input adapter.
import {
  html,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "../app/h.js";
import { createTiltDetector } from "./tilt.js";
import { useFlick } from "./sprint-arcade.js";
import { sfx } from "./sound.js";
import { cachedPortraitUrl, invalidatePortrait, retainPortrait } from "./media-cache.js";
export { api } from "./api.js";
/**
 * An invite on its way: on a phone (and a Mac with a share sheet) "Share invite link" opens the system
 * share sheet, which is how a code reaches a group chat; "Copy invite link" is always there too and says
 * "Link copied" for a moment. A cancelled share is not a failure and falls through to nothing.
 * @param {{ url: string, title: string, text: string, className?: string, label?: string }} props
 */
export function ShareLink({ url, title, text, className = "btn btn-secondary", label = "Share invite link" }) {
  const [copied, setCopied] = useState(false), [note, setNote] = useState("");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    setNote("");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNote("This browser will not copy for us. Select the link and copy it yourself: " + url);
    }
  };
  const share = async () => {
    setNote("");
    try { await navigator.share({ title, text, url }); }
    catch (e) { if (!(e && /** @type {any} */ (e).name === "AbortError")) await copy(); }
  };
  return html`<span class="share-link">
    ${canShare && html`<button type="button" class=${className.replace("btn-secondary", "btn-primary")} onClick=${share}>${label}</button>`}
    <button type="button" class=${className} onClick=${copy}>${copied ? "Link copied" : canShare ? "Copy link" : "Copy invite link"}</button>
    ${note && html`<span class="small muted share-note">${note}</span>`}
  </span>`;
}
/** Keep API prompt detail for accessibility while showing a shorter visual heading. */
export function visibleQuestionPrompt(question) {
  if (!question || question.direction === "face") return "";
  return question.prompt.replace(/^Which face belongs to (.+)\?$/, "$1");
}
/** Show explicit recovery when a private image fails, instead of an empty game tile. */
export function Photo({
  src,
  alt = "Classmate portrait",
  className = "portrait",
}) {
  const [failed, setFailed] = useState(""),
    [resolved, setResolved] = useState(null),
    [retry, setRetry] = useState(0);
  useLayoutEffect(() => {
    let active = true;
    setFailed("");
    const retained = retainPortrait(src);
    retained.promise
      .then((url) => {
        if (!active) return;
        setFailed("");
        setResolved({ src, url });
      })
      .catch(() => active && setFailed(src));
    return () => {
      active = false;
      retained.release();
    };
  }, [src, retry]);
  // A prior render may hold an object URL that was revoked while this photo was unmounted.
  const ready = cachedPortraitUrl(src);
  if (failed === src && className === "choice-photo")
    return html`<span>Photo unavailable. Refresh to retry.</span>`;
  return failed === src
    ? html`<div class="portrait-failed">
        <span>Photo unavailable.</span
        ><button
          class="linkbtn"
          onClick=${() => {
            invalidatePortrait(src);
            setResolved(null);
            setFailed("");
            setRetry((n) => n + 1);
          }}
        >
          Retry photo
        </button>
      </div>`
    : ready
      ? html`<img
          class=${className}
          src=${ready}
          data-source=${src}
          alt=${alt}
          onError=${() => {
            if (cachedPortraitUrl(src) === ready) setFailed(src);
          }}
          decoding="async"
        />`
      : html`<span
          class=${`photo-loading ${className}`}
          role="status"
          aria-label=${alt}
          >Loading photo.</span
        >`;
}
/** One answer control surface for practice, shared rounds, and racing: the arcade arena.
 * The prompt is the piece in the middle (a portrait on a body, or a headless body wearing the name) and the four
 * choices are corner figures. Drag, tap, keys 1 to 4 and tilt all go through the same input latch. */
export function Answers({
  question,
  onAnswer,
  disabled = false,
  picked = null,
  right = null,
  wrong = [],
  tilt = true,
}) {
  const [enabled, setEnabled] = useState(false),
    [message, setMessage] = useState(""),
    [docked, setDocked] = useState(null);
  const detector = useRef(createTiltDetector()),
    current = useRef(null),
    inputLock = useRef(""),
    arena = useRef(null),
    piece = useRef(null);
  current.current = { question, onAnswer, disabled, picked, wrong };
  // Slide the piece onto the corner it was sent to; it stays there until the next question.
  const dock = (k) => {
    const el = piece.current, host = arena.current, zone = host?.querySelector(`.zone[data-k="${k}"]`);
    if (!el || !host || !zone) return;
    const a = host.getBoundingClientRect(), z = zone.getBoundingClientRect();
    const s = Math.min(1, z.width / el.offsetWidth, z.height / el.offsetHeight);
    // The enter animation pins the transform while it fills; drop it before moving the piece.
    el.classList.remove("is-enter");
    el.style.transition = "transform 240ms cubic-bezier(0.3, 0.6, 0.3, 1)";
    el.style.transform = `translate(${z.left + z.width / 2 - (a.left + a.width / 2)}px, ${z.top + z.height / 2 - (a.top + a.height / 2)}px) scale(${s})`;
    setDocked(k);
  };
  const undock = () => {
    const el = piece.current;
    if (el) { el.style.transition = ""; el.style.transform = ""; }
    setDocked(null);
  };
  const send = (choice) => {
    const c = current.current;
    if (!c.question || c.disabled || c.picked !== null || c.wrong.includes(choice)) return;
    const key = `${c.question.id}:${c.picked}:${c.wrong.join(",")}`;
    if (inputLock.current === key) return;
    inputLock.current = key;
    dock(Number(choice));
    Promise.resolve(c.onAnswer(choice)).then((accepted) => {
      if (accepted === false && inputLock.current === key) { inputLock.current = ""; undock(); }
    }).catch(() => {
      if (inputLock.current === key) { inputLock.current = ""; undock(); }
    });
  };
  useLayoutEffect(() => {
    detector.current.rearm();
    inputLock.current = "";
    setDocked(null);
  }, [question?.id]);
  // A choice the server already knows about (after a reload, or a race retry) shows docked without a fresh send.
  useLayoutEffect(() => {
    if (picked !== null && docked === null) dock(Number(picked));
  }, [picked, question?.id]);
  useEffect(() => {
    const key = (event) => {
      const target = event.target;
      if (
        (target?.closest?.("input,textarea,select,button,[contenteditable]") &&
          !target?.closest?.("button.answer")) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const n = Number(event.key) - 1,
        c = current.current;
      if (
        n >= 0 &&
        n < 4 &&
        !c.disabled &&
        c.picked === null &&
        !c.wrong.includes(String(n))
      ) {
        event.preventDefault();
        send(String(n));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useLayoutEffect(() => {
    if (!enabled) return;
    let received = false;
    const orientation = (event) => {
      if (document.hidden) return;
      if (Number.isFinite(event.beta) && Number.isFinite(event.gamma))
        received = true;
      const answer = detector.current.sample(
          event.beta,
          event.gamma,
          performance.now(),
        ),
        c = current.current;
      if (
        answer !== null &&
        !c.disabled &&
        c.picked === null &&
        !c.wrong.includes(String(answer))
      )
        send(String(answer));
    };
    const reset = () => detector.current.reset();
    window.addEventListener("deviceorientation", orientation);
    window.addEventListener("orientationchange", reset);
    document.addEventListener("visibilitychange", reset);
    const timeout = setTimeout(() => {
      if (!received) {
        setEnabled(false);
        setMessage(
          "Motion is unavailable on this device. You can tap any answer.",
        );
      }
    }, 4000);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("deviceorientation", orientation);
      window.removeEventListener("orientationchange", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [enabled]);
  const toggle = async () => {
    if (enabled) {
      setEnabled(false);
      setMessage("");
      return;
    }
    try {
      const motion = /** @type {any} */ (window).DeviceOrientationEvent;
      if (!motion) throw new Error();
      if (
        typeof motion.requestPermission === "function" &&
        (await motion.requestPermission()) !== "granted"
      ) {
        setMessage("Motion permission was declined. Tap answers instead.");
        return;
      }
      detector.current.reset();
      setEnabled(true);
      setMessage(
        "Hold the phone comfortably to calibrate. Tilt left for 1, right for 2, away for 3, or toward you for 4. Return to center after each answer.",
      );
    } catch {
      setMessage("Tilt is unavailable here. Tap answers or use keys 1 to 4.");
    }
  };
  // Flicking the piece toward a corner answers the same way a tap does. A docked piece can be picked up again
  // only while another answer is allowed (a race retry); let go short of a corner, it returns to the middle.
  useFlick(piece, arena, (k) => send(String(k)), question ? question.id : "", {
    canStart: () => { const c = current.current; return !!c.question && !c.disabled && c.picked === null; },
    onRelease: () => { if (piece.current) piece.current.style.transform = ""; setDocked(null); },
  });
  const isFace = !!question && question.direction === "face";
  const verdict = !question || docked === null || right === null ? "" : String(docked) === right ? "is-right" : wrong.includes(String(docked)) ? "is-wrong" : "";
  useEffect(() => {
    if (verdict === "is-right") sfx.right();
    else if (verdict === "is-wrong") sfx.wrong();
  }, [verdict, question?.id]);
  if (!question) return null;
  return html`<div class="arena-host">
      <div class="arena" ref=${arena} data-dir=${question.direction}>
        <div class="choices" role="group" aria-label="Answer choices">
          ${question.choices.map(
            (c, i) =>
              html`<button
                key=${c.id}
                class=${`answer zone ${right === c.id ? "right" : ""} ${wrong.includes(c.id) ? "wrong blocked" : ""}`}
                data-k=${i}
                data-state="idle"
                data-picked=${String(picked === c.id)}
                disabled=${disabled || picked !== null || wrong.includes(c.id)}
                onClick=${() => send(c.id)}
                aria-label=${c.image ? `Photo ${Number(c.id) + 1}` : c.label}
              >
                ${c.image
                  ? html`<span class="slot filled"><span class="key" aria-hidden="true">${Number(c.id) + 1}</span><${Photo}
                      src=${c.image}
                      alt=${`Option photo ${Number(c.id) + 1}`}
                      className="choice-photo"
                    /></span><span class="bod ghost"></span>`
                  : html`<span class="plate ${c.label.length > 22 ? "long" : ""}"><span class="key" aria-hidden="true">${Number(c.id) + 1}</span><span class="pname">${c.label}</span></span><span class="bod ghost"></span>`}
              </button>`,
          )}
        </div>
        <div key=${question.id} class=${`piece ${docked !== null ? "is-docked" : "is-enter"} ${verdict}`} data-grab=${String(!disabled && picked === null)} ref=${piece}>
          ${isFace
            ? html`<span class="figure"><span class="slot filled">${question.image && html`<${Photo} src=${question.image} />`}</span><span class="bod"></span></span>`
            : html`<span class="figure"><span class="slot"></span><span class="bod"></span><div class="tag chest"><span class="tl">Hi, I'm</span><h2 class="prompt tn">${visibleQuestionPrompt(question)}</h2></div></span>`}
        </div>
      </div>
    </div>
    ${isFace && html`<h2 class="sr-only">${question.prompt}</h2>`}
    ${tilt &&
    html`<button class="linkbtn small" onClick=${toggle}>
      ${enabled ? "Turn off tilt" : "Use tilt controls"}
    </button>`}${message &&
    html`<p class="tilt-help" role="status">${message}</p>`}`;
}
/** A clock based on the latest server snapshot rather than the phone's wall clock. */
export function useServerClock(snapshot) {
  const [now, setNow] = useState(Date.now());
  const anchor = useRef({ server: Date.now(), local: performance.now() });
  useEffect(() => {
    if (snapshot)
      anchor.current = { server: snapshot.now, local: performance.now() };
  }, [snapshot]);
  useEffect(() => {
    const t = setInterval(
      () =>
        setNow(
          anchor.current.server + performance.now() - anchor.current.local,
        ),
      100,
    );
    return () => clearInterval(t);
  }, []);
  return now;
}
