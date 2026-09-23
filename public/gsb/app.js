// Classmates application shell. Screens consume stable APIs; rules live in the recognition kit.
import { selectTargets } from "../kits/recognition/selection.js";
import { LearningSummary } from "./learning-summary.js";
import {
  html,
  render,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "../app/h.js";
import {
  api,
  Answers,
  Photo,
  ShareLink,
  useServerClock,
  visibleQuestionPrompt,
} from "./components.js";
import { clearPortraits, preloadPortraits } from "./media-cache.js";
import { questionFor, questionView } from "../kits/recognition/questions.js";
import { makeRng } from "../kits/_lib/rng.js";
import { describeSpan, keepMissing, nextIntervals, pickDirection, review as scheduleReview, studyOrder } from "./learning.js";
// A missed person returns this many cards later in the same session.
const RETRY_AFTER = 5;
const ROOM_INVITE = "Let's play"; // voice-ok: the owner's invite wording.
import { createPracticeReviews, mergePracticeProgress } from "./practice-reviews.js";
import { loginLink } from "./login-link.js";
import { invitePath } from "./invite-path.js";
import { defaultNickname, nicknameError, NICKNAME_MAX } from "./profile.js";
import { GAME_NAME } from "./brand.js";
import { GuestCountdown } from "./guest-countdown.js";
import { primeOnGesture, isSoundOn, setSound, sfx } from "./sound.js";
primeOnGesture();
function readEmailCredential() {
  const credential = loginLink(location.href);
  if (credential && location.search) {
    const fragment = new URLSearchParams({ token: credential.token });
    if (credential.proof) fragment.set("proof", credential.proof);
    if (credential.returnTo) fragment.set("returnTo", credential.returnTo);
    history.replaceState(null, "", `${location.pathname}#${fragment}`);
  }
  return credential;
}
const emailCredential = readEmailCredential();
let guestModule;
const loadGuest = () => guestModule ??= import("./guest-round.js").catch((error) => {
  guestModule = null;
  throw error;
});
const uid = () => crypto.randomUUID();
const directionLabel = {
  face: "Face to name",
  name: "Name to face",
  mixed: "Both directions",
};
const PRACTICE_SAVE_EVENT = "gsb:practice-save";
/** The four-letter code in a /speed/CODE link, or null. */
const speedCode = (path) => path.match(/^\/speed\/([a-z]{4})$/i)?.[1]?.toUpperCase() ?? null;
/** The four-letter code in a /r/CODE link, or null. */
const roomCode = (path) => path.match(/^\/r\/([a-z]{4})$/i)?.[1]?.toUpperCase() ?? null;
/** The code in a /door/CODE link (the test door an operator holds open), or null. */
const doorCode = (path) => path.match(/^\/door\/([a-z0-9]{6})$/i)?.[1]?.toUpperCase() ?? null;
// An invite link opened while signed out is kept for an hour, so the sign-in link (which lands on /login)
// and the nickname step still end at the challenge or room the person was invited to.
const RETURN_KEY = "gsb-return";
let pendingInvite = emailCredential?.returnTo ?? invitePath(location.pathname);
function keepReturnPath(path = pendingInvite) {
  if (!invitePath(path)) return;
  pendingInvite = path;
  try { localStorage.setItem(RETURN_KEY, JSON.stringify({ path, at: Date.now() })); } catch {}
}
function takeReturnPath() {
  const inMemory = pendingInvite;
  pendingInvite = null;
  try {
    const kept = JSON.parse(localStorage.getItem(RETURN_KEY) || "null");
    localStorage.removeItem(RETURN_KEY);
    return inMemory || (kept && Date.now() - kept.at < 3600000 ? invitePath(kept.path) : null);
  } catch { return inMemory; }
}
keepReturnPath();

/** Sound on or off for this device, remembered like the rest of Parlor. */
function SoundSwitch() {
  const [on, setOn] = useState(() => isSoundOn());
  return html`<p class="sound-switch"><button type="button" class="linkbtn small" aria-pressed=${String(on)}
    onClick=${() => { setSound(!on); setOn(!on); }}>${on ? "Sound is on. Turn it off" : "Sound is off. Turn it on"}</button></p>`;
}

function App() {
  const practiceSaves = useRef(null);
  const [session, setSession] = useState(null),
    [site, setSite] = useState(null),
    [loaded, setLoaded] = useState(false),
    [emailReady, setEmailReady] = useState(false),
    [screen, setScreen] = useState(
      speedCode(location.pathname) || location.pathname === "/speed/classic" ? "speed"
        : ["practice", "scores", "profile", "speed"].includes(location.pathname.slice(1))
          ? location.pathname.slice(1)
          : "play",
    ),
    [challenge, setChallenge] = useState(speedCode(location.pathname)),
    // The four-corner round with its match settings stays reachable at /speed/classic; the game is two doors.
    [classic, setClassic] = useState(location.pathname === "/speed/classic"),
    [speedLength, setSpeedLength] = useState(null),
    [speedAuto, setSpeedAuto] = useState(false),
    [room, setRoom] = useState(null),
    [error, setError] = useState("");
  const [direction, setDirection] = useState("mixed"),
    [demo, setDemo] = useState(false),
    [guestAvailable, setGuestAvailable] = useState(false),
    [guestOpen, setGuestOpen] = useState(["/", "/guest"].includes(location.pathname)),
    [Guest, setGuest] = useState(null),
    [Sprint, setSprint] = useState(null),
    [guestSaved, setGuestSaved] = useState(null);
  const initialCode = useRef(
    location.pathname.match(/^\/r\/([a-z]{4})$/i)?.[1]?.toUpperCase(),
  );
  const [loginToken, setLoginToken] = useState(emailCredential);
  const acceptSession = (account) => {
    practiceSaves.current?.suspend();
    let storage;
    try { storage = window.sessionStorage; } catch { /* Memory-only fallback. */ }
    practiceSaves.current = account ? createPracticeReviews(account.id, {
      storage,
      send: ({ id, personId, direction, correct }) => api("progress", { id, personId, direction, correct }),
      onChange: (detail) => window.dispatchEvent(new CustomEvent(PRACTICE_SAVE_EVENT, { detail })),
    }) : null;
    setSession(account);
  };
  const run = async (fn) => {
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      return null;
    }
  };
  useEffect(() => {
    api("session")
      .then(async (s) => {
        let account = s.account;
        // A door link signs a visitor in without an email while the door is open; the link itself is not kept.
        const door = doorCode(location.pathname);
        if (door) {
          history.replaceState(null, "", "/");
          if (!account) {
            try { account = (await api("auth/door", { code: door })).account; }
            catch (e) { setError(e.message); }
          }
        }
        acceptSession(account);
        setEmailReady(s.emailReady);
        setSite(s.site);
        if (["/", "/login"].includes(location.pathname) && s.site?.landingMode === "quick") setScreen("speed");
        setDemo(s.demo);
        setGuestAvailable(s.guest?.enabled === true);
        // Begin fetching code as soon as guest eligibility is known, before the next render.
        if (!account && s.guest?.enabled && ["/", "/guest"].includes(location.pathname) && !emailCredential)
          void loadGuest().catch(() => {});
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (!session) return;
    const retry = () => { void practiceSaves.current?.retry(); };
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [session?.id]);
  useEffect(() => {
    // Email links can replace only the fragment of an already-open login page.
    // Show confirmation without requiring a reload or consuming the link here.
    const receive = () => {
      const credential = readEmailCredential();
      if (credential?.returnTo) keepReturnPath(credential.returnTo);
      setLoginToken(credential);
      if (credential) { setError(""); setGuestOpen(false); }
    };
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  useEffect(() => {
    if (!session || screen !== "speed" || Sprint) return;
    let active = true;
    import("./sprint-round.js").then(module => {
      if (active) setSprint(() => module.SprintRound);
    }).catch(() => {
      if (active) { setScreen("play"); setError("Speed round could not load. Please try again."); }
    });
    return () => { active = false; };
  }, [session?.id, screen, Sprint]);
  useEffect(() => {
    if (session || !guestAvailable || !guestOpen) return;
    let active = true;
    loadGuest().then((module) => {
      if (active) setGuest(() => module.GuestRound);
    }).catch(() => {
      if (active) { setGuestOpen(false); setError("The speed round could not load. Please try again."); }
    });
    return () => { active = false; };
  }, [guestAvailable, guestOpen, session?.id]);
  useEffect(() => {
    if (!guestAvailable || session?.access !== "email") return;
    let active = true;
    api("guest/claim", {}).then((data) => {
      if (active && data.result) setGuestSaved(data.result);
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [session?.id, session?.access, guestAvailable]);
  useEffect(() => {
    const lost = () => {
      clearPortraits();
      practiceSaves.current?.suspend();
      setSession(null);
      setGuestSaved(null);
      setRoom(null);
      setScreen("play");
    };
    window.addEventListener("gsb:session-lost", lost);
    return () => window.removeEventListener("gsb:session-lost", lost);
  }, []);
  const enter = (s) => {
    setRoom(s);
    setScreen("room");
    if (location.pathname !== `/r/${s.room.code}`)
      history.pushState(null, "", `/r/${s.room.code}`);
  };
  useEffect(() => {
    if (!session?.nickname || loginToken) return;
    if (initialCode.current) {
      const code = initialCode.current;
      initialCode.current = null;
      run(async () => enter(await api(`rooms/${code}/join`, {})));
      takeReturnPath();
      return;
    }
    const back = takeReturnPath();
    if (!back || back === location.pathname) return;
    const speed = speedCode(back), code = roomCode(back);
    if (speed) openChallenge(speed);
    else if (code) run(async () => enter(await api(`rooms/${code}/join`, {})));
  }, [session?.id, session?.nickname, loginToken]);
  const navigate = (next) => {
    setError("");
    setChallenge(null);
    setClassic(false);
    setSpeedAuto(false);
    setScreen(next);
    setGuestOpen(false);
    history.pushState(null, "", next === "play" ? (site?.landingMode === "quick" ? "/games" : "/") : `/${next}`);
  };
  /** The speed screen for a round of ten or twenty. */
  const openSpeed = (length) => { setSpeedLength(length === "short" ? "short" : "quick"); navigate("speed"); };
  // A speed challenge lives at /speed/CODE; the speed screen remounts for the code. A solo speed run is a room of
  // one that starts its own count as soon as it opens (`auto`), so it ends on the same result screen as any other.
  const openChallenge = (code, { auto = false } = {}) => {
    setError("");
    setChallenge(code);
    setSpeedAuto(auto);
    setScreen("speed");
    setGuestOpen(false);
    if (location.pathname !== `/speed/${code}`) history.pushState(null, "", `/speed/${code}`);
  };
  useEffect(() => {
    const back = () => {
      setGuestOpen(["/", "/guest"].includes(location.pathname));
      const code = location.pathname
        .match(/^\/r\/([a-z]{4})$/i)?.[1]
        ?.toUpperCase();
      const speed = speedCode(location.pathname);
      setChallenge(speed);
      setSpeedAuto(false);
      setClassic(location.pathname === "/speed/classic");
      if (code && session?.nickname)
        run(async () => enter(await api(`rooms/${code}/join`, {})));
      else
        setScreen(
          (speed || location.pathname === "/speed/classic" || location.pathname === "/" && site?.landingMode === "quick") ? "speed"
            : ["practice", "scores", "profile", "speed"].includes(location.pathname.slice(1))
              ? location.pathname.slice(1)
              : "play",
        );
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [session?.nickname, site?.landingMode]);
  const logout = () =>
    run(async () => {
      await api("auth/logout", {});
      clearPortraits();
      practiceSaves.current?.suspend();
      setSession(null);
      setGuestSaved(null);
      setRoom(null);
      navigate("play");
    });
  const showGuestRound = guestAvailable && guestOpen && !loginToken && !session;
  return html`<div class="shell">
    <header class="gsb-masthead">
      <div>
        <div class="eyebrow">${site?.cohortLabel || 'Classmates'}</div>
        <div class="brand">${GAME_NAME}</div>
      </div>
      ${session &&
      html`<button class="linkbtn account-link" onClick=${() => navigate("profile")}
        aria-label=${session.nickname ? `Edit nickname for ${session.nickname}` : "Your account"}>
        <span>${session.nickname || "Your account"}</span>
        ${session.nickname && html`<span class="account-link-hint">${session.access === "guest" ? "Guest. Sign in to keep scores" : "Edit nickname"}</span>`}
      </button>`}
    </header>
    ${session?.nickname &&
    html`<nav class="tabs" aria-label="Main navigation">
      ${[
        ["play", "Play"],
        ["practice", "Practice"],
        ["scores", "Scores"],
      ].map(
        ([id, label]) =>
          html`<button
            aria-current=${screen === id ? "page" : undefined}
            onClick=${() => navigate(id)}
          >
            ${label}
          </button>`,
      )}
    </nav>`}
    ${demo &&
    html`<p class="notice small">
      Local test deck. These people are fictional and no email is sent.
    </p>`}${session?.access === "owner-preview" &&
    html`<p class="notice small">
      Private owner preview with the real class deck. This session lasts 24
      hours.
    </p>`}${error &&
    html`<div role="alert" class="notice error">
      ${error}<button class="linkbtn" onClick=${() => setError("")}>
        Dismiss
      </button>
    </div>`}
    ${!loaded
      ? ["/", "/guest"].includes(location.pathname) && !loginToken
        ? html`<section class="sprint-stage sprint-opening" aria-busy="true"><span class="sr-only" role="status">Opening Classmates.</span></section>`
        : html`<p class="loading" role="status">Opening Classmates.</p>`
      : showGuestRound
        ? Guest ? html`<${Guest} signInForm=${html`<${Login} compact=${true} site=${site} emailReady=${emailReady} run=${run} />`} onSignIn=${() => {
            setGuestOpen(false);
            history.pushState(null, "", "/login");
          }} />` : html`<${GuestCountdown} />`
      : !session || loginToken
        ? html`<${Login}
            site=${site}
            token=${loginToken}
            emailReady=${emailReady}
            invite=${loginToken?.returnTo ?? pendingInvite}
            run=${run}
            guestAvailable=${guestAvailable}
            onGuest=${() => { setGuestOpen(true); history.pushState(null, "", "/guest"); }}
            onPlayAsGuest=${async (code) => {
              // A guest account for this challenge: in straight away, on the same screens as everyone else.
              const entered = await run(async () => api("auth/guest", { code }));
              if (!entered) return;
              takeReturnPath();
              setLoginToken(null);
              acceptSession(entered.account);
              openChallenge(entered.code);
            }}
            onNewLink=${() => {
              setLoginToken(null);
              setError("");
              history.replaceState(null, "", "/login");
            }}
            onLogin=${(account) => {
              setLoginToken(null);
              history.replaceState(null, "", "/");
              setScreen(site?.landingMode === "quick" ? "speed" : "play");
              acceptSession(account);
            }}
          />`
        : !session.nickname || screen === "profile"
          ? html`<${Profile}
              account=${session}
              run=${run}
              onSave=${(account) => {
                const firstLogin = !session.nickname;
                setSession(account);
                navigate(firstLogin && site?.landingMode === "quick" ? "speed" : "play");
              }}
              logout=${logout}
            />`
          : screen === "speed"
            ? Sprint ? html`<${Sprint} key=${`${session.id}:${challenge || ""}:${classic ? "classic" : speedLength || ""}`} account=${session} guestSaved=${guestSaved} classic=${classic} initialLength=${classic ? "short" : speedLength || "quick"} challenge=${challenge} autoStart=${speedAuto} onChallenge=${openChallenge} onExit=${() => navigate("play")} />`
              : html`<p role="status">Opening speed round.</p>`
          : screen === "practice"
            ? html`<${Practice}
                key=${session.id}
                run=${run}
                reviews=${practiceSaves.current}
              />`
            : screen === "room" && room
              ? html`<${Room}
                  initial=${room}
                  account=${session}
                  run=${run}
                  onExit=${() => navigate("play")}
                />`
              : screen === "scores"
                ? html`<${Scores}
                    direction=${direction}
                    setDirection=${setDirection}
                    guestAvailable=${guestAvailable}
                  />`
                : html`<${Home}
                    practice=${() => navigate("practice")}
                    sprint=${openSpeed}
                    guestSaved=${guestSaved}
                  />`}
    <footer class="footer">
      Made for learning the people in our class. ${guestAvailable
        ? "A small guest sample is available. The full class deck requires email verification."
        : "Names and photos are available only after email verification."} Contact the game organizer to
      remove a profile. Built with Parlor.
      <${SoundSwitch} />
    </footer>
  </div>`;
}
function Login({ token, emailReady, onLogin, onNewLink, guestAvailable, onGuest, onPlayAsGuest = null, invite = null, site, compact = false }) {
  const [entering, setEntering] = useState(false);
  const [email, setEmail] = useState(""),
    [sent, setSent] = useState(false),
    [formError, setFormError] = useState(""),
    [busy, setBusy] = useState(false);
  const showGuest = guestAvailable && !token && !sent && !invite;
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setFormError("");
    try {
      if (token) {
        const data = await api("auth/verify", token);
        onLogin(data.account);
      } else {
        await api("auth/request", { email, returnTo: invite });
        setSent(true);
      }
    } catch (e) { setFormError(e.message); }
    finally { setBusy(false); }
  };
  return html`<section class=${compact ? "guest-signin" : "narrow"}>
    ${!compact && html`<div class="eyebrow">A familiar face, a name to remember.</div>
    <h1>Get to know <br />your classmates.</h1>
    <p class="muted">
      Learn the class at your pace, or see how you do together.
    </p>`}
    ${invite && html`<p class="notice small" role="status">Sign in to join ${roomCode(invite) ? "room" : "speed challenge"} <strong>${roomCode(invite) || speedCode(invite)}</strong>. Your invitation will open after sign-in.</p>`}
    ${invite && speedCode(invite) && onPlayAsGuest && !(token || sent) && html`<div class="guest-invite">
      <button type="button" class="btn btn-primary" disabled=${entering} onClick=${async () => { setEntering(true); await onPlayAsGuest(speedCode(invite)); setEntering(false); }}>${entering ? "Coming in" : "Play now as a guest"}</button>
      <p class="small muted">No email needed. Guest scores are not kept; sign in later to keep yours.</p>
    </div>`}
    ${showGuest && html`<div class="guest-invite">
      <button class="btn btn-primary" onClick=${onGuest}>Try a 10-face speed round</button>
      <p class="small muted">One quick warm-up. No sign-in needed.</p>
    </div>`}
    ${formError && html`<p class="notice error" role="alert">${formError}</p>`}
    ${token
      ? html`<div class="gsb-card">
          <h2>You're almost in.</h2>
          <p>Use your one-time email link to sign in.</p>
          <button class="btn btn-primary" disabled=${busy} onClick=${submit}>
            ${busy ? "Signing in" : "Continue to Classmates"}
          </button>
          <button class="linkbtn" disabled=${busy} onClick=${onNewLink}>
            Request a new link
          </button>
        </div>`
      : sent
        ? html`<div class="gsb-card" role="status">
            <h2>Check your inbox.</h2>
            <p>
              We sent a sign-in link to <strong>${email}</strong>. It works once
              and expires in 15 minutes.
            </p>
            <p class="small muted">
              Check spam too. Open the link on the device you want to play on.
            </p>
            <button class="linkbtn" onClick=${() => setSent(false)}>
              Use another email or request a new link
            </button>
          </div>`
        : html`<form class="gsb-card" onSubmit=${submit}>
            <label class="form-field"
              >${site?.emailLabel || 'Your email address'}<input
                type="email"
                autocomplete="email"
                name="email"
                placeholder=${site?.emailPlaceholder || 'you@example.edu'}
                required
                value=${email}
                onInput=${(e) => setEmail(e.target.value)} /></label
            ><button class="btn btn-primary" disabled=${busy || !emailReady}>
              ${busy ? "Sending your link" : "Email me a sign-in link"}
            </button>
            <p class="small muted" style="margin:16px 0 0">
              ${site?.emailHint || 'Sign in with your eligible email address.'}
            </p>
            ${!emailReady &&
            html`<div class="notice small" role="status">
              Email delivery is still being connected. The private class game
              will open once sign-in is ready.
            </div>`}
          </form>`}
  </section>`;
}
function Profile({ account, run, onSave, logout }) {
  const door = account.access === "door", guest = account.access === "guest";
  const [name, setName] = useState(account.nickname || (door || guest ? "" : defaultNickname(account.email))),
    [busy, setBusy] = useState(false);
  return html`<section class="narrow">
    <h1 class=${account.nickname ? "" : "sr-only"}>${account.nickname ? "Your account" : "Choose a nickname"}</h1>
    <form
      class="gsb-card"
      onSubmit=${async (e) => {
        e.preventDefault();
        setBusy(true);
        await run(async () =>
          onSave((await api("profile", { nickname: name })).account),
        );
        setBusy(false);
      }}
    >
      <label class="form-field"
        >Nickname<input
          name="nickname"
          value=${name}
          required
          autocomplete="nickname"
          aria-describedby="nickname-help"
          onInput=${(e) => {
            setName(e.target.value);
            e.target.setCustomValidity(nicknameError(e.target.value));
          }}
      /></label>
      <p id="nickname-help" class="small muted">
        2 to ${NICKNAME_MAX} characters.<br />
        Your nickname appears in games, chat, and scores. And you can change it anytime. Your email stays private.
      </p>
      ${!(door || guest) && html`<p class="small muted">${account.email}</p>`}
      <button class="btn btn-primary" disabled=${busy}>
        ${busy ? "Saving" : "Save nickname"}
      </button>
    </form>
    ${guest && html`<div class="gsb-card"><p>You are playing as a guest. Guest scores are not kept.</p>
      <button class="btn btn-primary" onClick=${logout}>Sign in with your email</button></div>`}
    ${account.nickname && !guest && html`<${LearningSummary} />`}
    <button class="linkbtn" onClick=${logout}>${guest ? "Leave" : "Sign out"}</button>
  </section>`;
}
function Direction({ value, onChange, mixed = true, compact = false, label = "What would you like to practice?" }) {
  return html`<label class="form-field direction"
    ><span class=${compact ? "sr-only" : ""}
      >${label}</span
    ><select
      value=${value}
      onChange=${(e) => onChange(e.target.value)}
    >
      ${Object.entries(directionLabel)
        .filter(([key]) => mixed || key !== "mixed")
        .map(([key, label]) => html`<option value=${key}>${label}</option>`)}
    </select></label
  >`;
}
/** The games: practice, and the two-door speed round in ten or twenty. Quizzes, races and room codes are
 * hidden for now; their screens still answer their links. */
function Home({ practice, sprint, guestSaved }) {
  return html`<section class="hero">
      <div class="eyebrow">A little practice goes a long way.</div>
      <h1>Names worth knowing.</h1>
      <button class="btn btn-primary" onClick=${practice}>
        Practice the class deck
      </button>
    </section>
    <section class="gsb-card sprint-entry">
      <h2>Speed round</h2>
      <p class="muted">Drop each face on the body with their name, left or right, against the clock. Play on your own, or challenge classmates to the same round on the same count.</p>
      <div class="row speed-pick">
        <button class="btn btn-primary" onClick=${() => sprint("quick")}>10 classmates</button>
        <button class="btn btn-secondary" onClick=${() => sprint("short")}>20 classmates</button>
      </div>
    </section>
    ${guestSaved && html`<p class="notice small" role="status">
      Speed round saved: ${guestSaved.score.toLocaleString()} points, ${guestSaved.correct} of ${guestSaved.count} correct.
    </p>`}`;
}
function Practice({ run, reviews }) {
  const saves = reviews.pending;
  const [deck, setDeck] = useState(null),
    [progress, setProgress] = useState({}),
    [queue, setQueue] = useState([]),
    [at, setAt] = useState(0),
    [answer, setAnswer] = useState(null),
    [saveError, setSaveError] = useState(""),
    [round, setRound] = useState(0),
    [, setSaveTick] = useState(0);
  const attempt = useRef(null),
    submitting = useRef(false),
    rng = useRef(makeRng(uid(), 0)),
    questionCache = useRef({ key: "", questions: new Map() }),
    exposure = useRef({});
  useEffect(() => {
    let active = true;
    run(async () => {
      const [d, p] = await Promise.all([api("deck"), api("progress")]);
      if (!active) return;
      exposure.current = p.exposure ?? {};
      setDeck(d);
      // One memory per person covers both directions; older per-direction rows only seed the server's counts.
      setProgress((current) => mergePracticeProgress(current,
        Object.fromEntries(
          p.progress.filter((r) => r.direction === "both").map((r) => [r.person_id, r.doc]),
        ),
      ));
    });
    return () => {
      active = false;
    };
  }, []);
  // The session: due and unseen people first, each asked one way or the other. Queue entries fix the direction
  // at queue time, so a person asked again later in the session keeps the direction decided for them.
  useEffect(() => {
    if (!deck) return;
    const order = studyOrder(
      selectTargets(deck.cards, [exposure.current], deck.cards.length, rng.current),
      progress,
      Date.now(),
    );
    setQueue(order.map((id, i) => ({ id, direction: pickDirection(progress[id], i) })));
    setAt(0);
    setAnswer(null);
  }, [deck, round]);
  const questionWindow = useMemo(() => {
    if (!deck || !queue[at]) return null;
    // Cached by position within the session; a re-ask inserted behind the current card drops the entries past it.
    const key = String(round);
    if (questionCache.current.key !== key)
      questionCache.current = { key, questions: new Map() };
    for (const index of questionCache.current.questions.keys())
      if (index < at) questionCache.current.questions.delete(index);
    for (let i = at; i < Math.min(queue.length, at + 3); i++) {
      if (questionCache.current.questions.has(i)) continue;
      const target = deck.cards.find((c) => c.id === queue[i].id);
      questionCache.current.questions.set(
        i,
        questionFor(target, deck.cards, queue[i].direction, rng.current, `${round}:${i}`, {
          distractors: "similar-portraits",
        }),
      );
    }
    return Array.from(
      { length: Math.min(3, queue.length - at) },
      (_, offset) => questionCache.current.questions.get(at + offset),
    );
  }, [deck, queue, at, round]);
  const question = questionWindow?.[0] ?? null;
  const activeQuestion = useRef(null);
  activeQuestion.current = question?.id;
  useLayoutEffect(() => {
    setAnswer(null);
    setSaveError("");
    attempt.current = { id: uid(), choice: null };
  }, [question?.id]);
  useEffect(() => {
    const saved = (event) => {
      const { review, result, error, discarded } = event.detail;
      setSaveTick((n) => n + 1);
      if (result)
        setProgress((p) => mergePracticeProgress(p, { [review.personId]: result.progress }));
      if (activeQuestion.current === review.questionId) {
        if (result) {
          setAnswer((current) => current && { ...current, saved: true });
          setSaveError("");
        } else if (error) setSaveError(discarded
          ? "This card is no longer available. Your other reviews will still save."
          : "Your review has not saved yet.");
      }
    };
    window.addEventListener(PRACTICE_SAVE_EVENT, saved);
    return () => window.removeEventListener(PRACTICE_SAVE_EVENT, saved);
  }, []);
  const choose = (choice) => {
    if (answer || submitting.current || !question) return;
    submitting.current = true;
    if (attempt.current.choice === null) attempt.current.choice = choice;
    choice = attempt.current.choice;
    const correct = question.options[Number(choice)] === question.target;
    const review = {
      id: attempt.current.id,
      questionId: question.id,
      personId: question.target,
      direction: question.direction,
      choice,
      correct,
      saving: false,
      error: false,
    };
    // Anki tells you when the card comes back; the same schedule the server keeps says it here.
    const dueIn = scheduleReview(progress[question.target], correct, Date.now(), question.direction).dueAt - Date.now();
    setAnswer({ choice, correct, saved: false, dueIn });
    submitting.current = false;
    reviews.add(review);
    // A miss comes back a few cards later in this same session, the same way round, like a learning step.
    if (!correct) {
      for (const index of questionCache.current.questions.keys())
        if (index > at) questionCache.current.questions.delete(index);
      setQueue((q) => {
        const slot = Math.min(q.length, at + 1 + RETRY_AFTER);
        return [...q.slice(0, slot), { id: question.target, direction: question.direction, again: true }, ...q.slice(slot)];
      });
    }
  };
  const views = deck
      ? (questionWindow ?? []).map((item) => questionView(item, deck.cards))
      : [],
    view = views[0] ?? null;
  useEffect(() => {
    if (!view) return;
    preloadPortraits(
      views.flatMap((item) => [
        item.image,
        ...item.choices.map((choice) => choice.image),
      ]),
    );
  }, [view?.id]);
  if (!deck)
    return html`<p class="loading" role="status">Loading your class deck.</p>`;
  const now = Date.now();
  const seen = deck.cards.filter((c) => progress[c.id]).length;
  const due = deck.cards.filter((c) => progress[c.id]?.dueAt <= now).length;
  const known = deck.cards.filter((c) => progress[c.id]?.state === "review").length;
  const missing = keepMissing(progress, deck.cards);
  const card = deck.cards.find((c) => c.id === question?.target);
  const again = !!queue[at]?.again;
  const spans = question ? nextIntervals(progress[question.target], question.direction) : null;
  return html`<section>
    <div class="practice-head">
      <div class="row spread practice-controls">
        <h1>Practice</h1>
        <span class="small muted">Spaced repetition learning of names</span>
      </div>
      <div class="statline">
        ${`${seen} of ${deck.cards.length} classmates reviewed. ${known} known. ${due} due now.`}
      </div>
      <div class="meter">
        <span style=${`width:${(100 * known) / deck.cards.length}%`}></span>
      </div>
      ${missing.length > 0 && html`<details class="missing">
        <summary>Names you keep missing (${missing.length})</summary>
        <ul class="missing-list">${missing.map((m) => html`<li key=${m.id} class=${m.leech ? "leech" : ""}>
          <span class="mthumb"><${Photo} src=${m.image} alt="" className="choice-photo" /></span>
          <span class="mname">${m.name}</span>
          <span class="mcount small muted">${m.misses === 1 ? "missed once" : `missed ${m.misses} times`}${m.leech ? ", a tough one" : ""}</span>
        </li>`)}</ul>
      </details>`}
    </div>
    ${!question && at >= queue.length
      ? html`<section class="gsb-card narrow">
          <h2>You covered the whole deck.</h2>
          <p>
            ${saves.size
              ? "Your remaining reviews are still saving. You can keep practicing while they finish."
              : "Your next review is saved. You can keep practicing or return when more cards are due."}
          </p>
          <button
            class="btn btn-primary"
            onClick=${() => setRound((r) => r + 1)}
          >
            Review the deck again
          </button>
        </section>`
      : view &&
        html`<div class="question">
          <div class="row spread small muted">
            <span>Card ${at + 1} of ${queue.length}</span>
            <span>${again && html`<strong>Again</strong> · `}Right: ${describeSpan(spans.right)}, wrong: ${describeSpan(spans.wrong)}</span>
          </div>
          <${Answers}
            question=${view}
            onAnswer=${choose}
            disabled=${!!answer}
            picked=${answer?.choice ?? null}
            right=${answer
              ? String(question.options.indexOf(question.target))
              : null}
            wrong=${answer && !answer.correct ? [answer.choice] : []}
          />
          <div class="practice-feedback" aria-live="polite">
            ${answer &&
            html`<div class=${`notice ${answer.correct ? "success" : ""}`}>
                <strong
                  >${answer.correct
                    ? "Correct."
                    : `This is ${card.answer}.`}</strong
                >${" "}
                ${answer.correct
                  ? `Next in ${describeSpan(answer.dueIn)}.`
                  : `Back in a few cards, then in ${describeSpan(answer.dueIn)}.`}
              </div>
              ${saveError &&
              html`<div class="notice error" role="alert">
                ${saveError}${" "}
                ${[...saves.values()].some((item) => item.questionId === question.id) && html`<button
                  class="linkbtn"
                  onClick=${() => reviews.retry()}
                >
                  Retry save
                </button>`}
              </div>`}
              <button
                class="btn btn-primary"
                onClick=${() => setAt((i) => i + 1)}
              >
                ${at + 1 === queue.length
                  ? "Finish this deck"
                  : "Next classmate"}
              </button>`}
          </div>
        </div>`}
    ${saves.size > 0 &&
    html`<div class="notice small practice-save" role="status">
      ${[...saves.values()].some((review) => review.error)
        ? `${saves.size} ${saves.size === 1 ? "review still needs" : "reviews still need"} to save.`
        : `${saves.size} review${saves.size === 1 ? "" : "s"} saving.`}${" "}
      ${[...saves.values()].some((review) => review.error) &&
      html`<button
        class="linkbtn"
        onClick=${() => reviews.retry()}
      >
        Retry unsaved reviews
      </button>`}
    </div>`}
  </section>`;
}
function Room({ initial, account, run, onExit }) {
  const [snapshot, setSnapshot] = useState(initial),
    [busy, setBusy] = useState(false),
    [pendingAnswer, setPendingAnswer] = useState(null),
    [connection, setConnection] = useState("");
  const code = initial.room.code,
    now = useServerClock(snapshot),
    latest = useRef(snapshot),
    refresh = useRef(null),
    sending = useRef(false);
  latest.current = snapshot;
  const players = snapshot.room.players.length, playersBefore = useRef(players);
  useEffect(() => {
    if (players > playersBefore.current && snapshot.room.phase === "lobby") sfx.join();
    playersBefore.current = players;
  }, [players]);
  const accept = (s) => setSnapshot((old) => (s.v >= old.v ? s : old));
  useEffect(() => {
    let cancelled = false,
      timer,
      inFlight = false,
      urgent = false;
    const poll = async () => {
      if (cancelled) return;
      if (inFlight) { urgent = true; return; }
      inFlight = true;
      clearTimeout(timer);
      try {
        const s = await api(`rooms/${code}`);
        if (!cancelled) {
          accept(s);
          setConnection("");
        }
      } catch (e) {
        if (!cancelled) setConnection(e.message);
      } finally {
        inFlight = false;
        if (!cancelled)
          timer = setTimeout(
            poll,
            urgent ? 0 : document.hidden
              ? 5000
              : latest.current.room.phase === "playing"
                ? 850
                : 2500,
          );
        urgent = false;
      }
    };
    refresh.current = poll;
    timer = setTimeout(poll, 500);
    const wake = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        poll();
      }
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (refresh.current === poll) refresh.current = null;
      document.removeEventListener("visibilitychange", wake);
    };
  }, [code]);
  useEffect(() => {
    if (!["ready", "reveal"].includes(snapshot.view?.phase)) return;
    const delay = Math.max(0, snapshot.view.wakeAt - snapshot.now + 25);
    const timer = setTimeout(() => refresh.current?.(), delay);
    return () => clearTimeout(timer);
  }, [code, snapshot.v, snapshot.view?.phase, snapshot.view?.wakeAt]);
  const act = async (type, payload = {}) => {
    if (sending.current) return false;
    sending.current = true;
    setBusy(true);
    const success = await run(async () => {
      accept(await api(`rooms/${code}/actions`, { id: uid(), type, payload }));
      return true;
    });
    setBusy(false);
    sending.current = false;
    return !!success;
  };
  const r = snapshot.room,
    v = snapshot.view,
    me = v?.mine,
    question = v?.question;
  const name = (id) => r.players.find((p) => p.id === id)?.name || "Classmate";
  const ready = v?.phase === "ready",
    reveal = v?.phase === "reveal",
    deadline =
      (ready ? v?.wakeAt : v?.mode === "race" ? v?.endsAt : v?.wakeAt) ?? now,
    remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const choose = async (choice) => {
    if (sending.current) return false;
    setPendingAnswer({ questionId: question.id, choice });
    const accepted = await act("answer", { questionId: question.id, choice });
    setPendingAnswer(null);
    return accepted;
  };
  useEffect(() => {
    if (!question) return;
    preloadPortraits([
      question.image,
      ...question.choices.map((choice) => choice.image),
    ]);
  }, [question?.id]);
  return html`<section>
    <div class="row spread">
      <button class="linkbtn" onClick=${onExit}>Back to play</button
      ><span class="small muted"
        >${`Room ${code} · ${r.game.config.mode === "race" ? "Race" : "Together"}`}</span
      >
    </div>
    ${connection &&
    html`<p role="alert" class="notice error">
      ${connection} Reconnecting automatically.
    </p>`}${r.phase === "lobby"
      ? html`<div class="narrow gsb-card">
          <div class="eyebrow">Your room is ready.</div>
          <h1>Invite your classmates.</h1>
          <div class="room-code">${code}</div>
          <p class="muted">
            Share this code or link. Everyone signs in with their verified
            email.
          </p>
          <${ShareLink}
            url=${`${location.origin}/r/${code}`}
            title=${GAME_NAME}
            text=${ROOM_INVITE}
            label=${`Share the ${r.game.config.mode === "race" ? "race" : "quiz"}`}
          />
          <h2 class="players-heading">${r.players.length === 1 ? "Just you so far" : `${r.players.length} in the room`}</h2>
          <ul class="players" aria-live="polite">
            ${r.players.map(
              (p) =>
                html`<li>
                  <span class="player-name">${p.name}</span><span class="muted"
                    >${p.id === r.hostId ? "Host" : "Ready"}</span
                  >
                </li>`,
            )}
          </ul>
          <p class="small muted" style="margin-top:16px">
            ${`${directionLabel[r.game.config.direction]}. ${r.game.config.cards} questions. Players join before the game starts.`}
          </p>
          ${r.hostId === account.id
            ? html`<button
                class="btn btn-primary"
                disabled=${busy}
                onClick=${() => act("room/start")}
              >
                ${r.players.length === 1 ? "Start solo" : "Start game"}
              </button>`
            : html`<p role="status">
                Waiting for ${name(r.hostId)} to start.
              </p>`}
        </div>`
      : r.phase === "over"
        ? html`<section class="gsb-card narrow">
            <div class="eyebrow">
              ${v.void ? "Game stopped" : "The results are in."}
            </div>
            <h1>
              ${v.void
                ? "The deck changed."
                : snapshot.summary.winnerIds.length
                  ? snapshot.summary.winnerIds.includes(account.id)
                    ? "Nicely remembered."
                    : `${name(snapshot.summary.winnerIds[0])} takes the lead.`
                  : "Keep getting to know the class."}
            </h1>
            ${v.void
              ? html`<p>
                  A profile was removed during this game. This result does not
                  count toward scores or ratings.
                </p>`
              : html`<${Standings}
                    standings=${v.standings}
                    players=${r.players}
                    account=${account}
                    mode=${v.mode}
                    startedAt=${v.startedAt}
                  />
                  <p class="small muted" style="margin-top:16px">
                    Your result is saved. Multiplayer ratings compare your
                    finish with every opponent; each pair counts once per day.
                  </p>`}<button class="btn btn-primary" onClick=${onExit}>
              Play another game
            </button>
          </section>`
        : html`<div class="game-layout">
            <div class="question">
              <div class="row spread small">
                <span>Question ${v.progress.n} of ${v.progress.total}</span
                ><span class="clock" role="timer"
                  >${ready
                    ? `Starts in ${remaining}`
                    : reveal
                      ? "Answer revealed"
                      : `${remaining}s left`}</span
                >
              </div>
              <div class="meter">
                <span
                  style=${`width:${(100 * (v.mode === "race" ? (me?.index ?? 0) : v.progress.n - 1)) / v.progress.total}%`}
                ></span>
              </div>
              ${me?.finishedAt
                ? html`<div class="gsb-card">
                    <h2>You finished.</h2>
                    <p>
                      The other players have up to 30 seconds to finish. Your
                      time is saved.
                    </p>
                  </div>`
                : question
                  ? html`<${Answers}
                        question=${question}
                        onAnswer=${choose}
                        disabled=${busy ||
                        !!connection ||
                        ready ||
                        reveal ||
                        now < me?.blockedUntil}
                        picked=${pendingAnswer?.questionId === question.id
                          ? pendingAnswer.choice : me?.choice ?? null}
                        right=${v.reveal?.choice ?? null}
                        wrong=${me?.wrong ?? []}
                      />
                      <div class="status-line" aria-live="polite">
                        ${pendingAnswer?.questionId === question.id
                          ? "Answer selected."
                          : ready
                          ? ""
                          : reveal
                            ? `${v.reveal.name}. ${me.correctAnswer ? `Correct, +${me.points} points.` : "You will remember them next time."}`
                            : v.mode === "race" && me?.wrong?.length
                              ? "Try another answer. You need to get this one right to advance."
                              : me?.choice !== null && v.mode === "together"
                                ? `Answer saved. ${v.answeredCount} of ${r.players.length} players answered.`
                                : v.mode === "race"
                                  ? "Get each answer right to move forward."
                                  : "Correct answers earn points. Faster answers earn a bonus."}
                      </div>`
                  : html`<p>Waiting for the next question.</p>`}
            </div>
            <aside class="game-rail">
              <h3>At the table</h3>
              <${Standings}
                standings=${v.standings}
                players=${r.players}
                account=${account}
                mode=${v.mode}
                startedAt=${v.startedAt}
              />
            </aside>
          </div>`}<${Chat}
      room=${r}
      onSend=${(text) => act("chat/send", { text })}
      busy=${busy}
    />
  </section>`;
}
function Standings({ standings, players, account, mode, startedAt }) {
  return html`<ol class="players">
    ${standings.map(
      (p) =>
        html`<li class=${p.playerId === account.id ? "me" : ""}>
          <span
            >${players.find((x) => x.id === p.playerId)?.name ??
            "Classmate"}</span
          ><span class="number"
            >${mode === "race"
              ? p.finishedAt !== null
                ? `${((p.finishedAt - startedAt) / 1000).toFixed(1)}s`
                : `${p.index} correct`
              : p.score.toLocaleString()}</span
          >
        </li>`,
    )}
  </ol>`;
}
function Chat({ room, onSend, busy }) {
  const [text, setText] = useState("");
  return html`<details class="chat">
    <summary>
      Room chat${room.chat.length ? ` (${room.chat.length})` : ""}
    </summary>
    <ol>
      ${room.chat
        .slice(-30)
        .map(
          (m) =>
            html`<li>
              <strong
                >${room.players.find((p) => p.id === m.playerId)?.name ??
                "Classmate"}: </strong
              >${m.text}
            </li>`,
        )}
    </ol>
    <form
      onSubmit=${async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        if (await onSend(text)) setText("");
      }}
    >
      <input
        aria-label="Chat message"
        maxlength="280"
        placeholder="Say hello to your table"
        value=${text}
        onInput=${(e) => setText(e.target.value)}
      /><button class="btn btn-secondary" disabled=${busy || !text.trim()}>
        Send
      </button>
    </form>
  </details>`;
}
function Scores({ direction, setDirection, guestAvailable }) {
  const [mode, setMode] = useState("together"),
    [data, setData] = useState(null),
    [speedBest, setSpeedBest] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!guestAvailable) return;
    let active = true;
    api("guest/best").then((data) => { if (active) setSpeedBest(data.result); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [guestAvailable]);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    api(`leaderboard?mode=${mode}&direction=${direction}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [mode, direction]);
  return html`<section>
    <div class="hero">
      <div class="eyebrow">A friendly bit of competition.</div>
      <h1>Class standings</h1>
      <p>
        Play different classmates to build your rating. Practice is just for
        learning.
      </p>
    </div>
    <div class="row">
      <label class="form-field"
        >Game<select value=${mode} onChange=${(e) => setMode(e.target.value)}>
          <option value="together">Together</option>
          <option value="race">Race</option>
        </select></label
      ><${Direction} value=${direction} onChange=${setDirection} />
    </div>
    ${error
      ? html`<p role="alert" class="notice error">${error}</p>`
      : !data
        ? html`<p role="status">Loading scores.</p>`
        : html`<h2>Multiplayer ratings</h2>
            <div class="ranking-legend small">
              <span><span class="ranking-badge arjay">Arjay Miller Track</span> Top 10%</span>
              <span><span class="ranking-badge foam">FOAM Stars</span> Bottom 10%</span>
            </div>
            ${data.qualifyingCount < data.badgeThreshold && html`<p class="small muted">
              Badges begin once ${data.badgeThreshold} players have established ratings in this game.
            </p>`}
            ${!data.ratings.length
              ? html`<p class="empty">
                  The first multiplayer game will start these standings.
                </p>`
              : html`<div class="score-scroll">
                  <table class="scoretable">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Player</th>
                        <th>Rating</th>
                        <th>Wins</th>
                        <th>Opponents beaten</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${data.ratings.map(
                        (p) =>
                          html`<tr class=${p.id === data.myRating?.id ? "my-standing" : ""}>
                            <td>${p.rank ?? "·"}</td>
                            <td>
                              ${p.nickname}
                              ${p.badge && html`<span class=${`ranking-badge ${p.badge === "Arjay Miller Track" ? "arjay" : "foam"}`}>${p.badge}</span>`}
                              <span class="small muted ranking-meta"
                                >${!p.qualified
                                  ? "Provisional"
                                  : `${p.games} games`}</span
                              >
                            </td>
                            <td>${p.rating}</td>
                            <td>${p.wins}</td>
                            <td>${p.defeated}</td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>`}
            <hr class="divider" />
            <h2>
              ${mode === "race"
                ? "Fastest completed races"
                : "Personal best scores"}
            </h2>
            ${data.best.length
              ? html`<table class="scoretable">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>${mode === "race" ? "Time or progress" : "Score"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.best.map(
                      (p) =>
                        html`<tr>
                          <td>${p.nickname}</td>
                          <td>
                            ${mode === "race"
                              ? p.elapsed
                                ? `${(p.elapsed / 1000).toFixed(1)}s`
                                : `${p.score}/20`
                              : p.score}
                          </td>
                        </tr>`,
                    )}
                  </tbody>
                </table>`
              : html`<p class="empty">
                  Finish a game to add your first score.
                </p>`}`}
    ${speedBest && html`<section class="gsb-card" style="margin-top:24px">
      <h2>Your speed round</h2>
      <p>${speedBest.score.toLocaleString()} points · ${speedBest.correct} of ${speedBest.count} correct</p>
      <p class="small muted">Your personal warm-up score. This does not affect multiplayer ratings.</p>
    </section>`}
    <details style="margin-top:28px">
      <summary>How ratings work</summary>
      <p class="small muted" style="margin-top:14px">
        Everyone starts at 1,000. Your finish is compared with each opponent
        using Elo expectations, with a maximum of 24 points available across a
        game. Ties count as half a win. Each pair affects ratings once per
        calendar day in Los Angeles. The first 10 games and 5 distinct opponents
        are provisional. Solo play never affects ratings.
      </p>
      <p class="small muted">
        Arjay Miller Track and FOAM Stars are playful game labels for the top
        and bottom 10% of established ratings in the selected game. A rating
        becomes established after 10 games against at least 5 distinct
        opponents. Percentiles use the whole field, with at least 10 eligible
        players. Ties crossing a cutoff receive no badge.
      </p>
    </details>
  </section>`;
}
render(html`<${App} />`, document.getElementById("app"));
