// A reusable visual recognition kit: shared timed rounds and individual correct-to-advance racing.
import { KitError } from "../../shared/errors.js";
import { questions, questionView, speedPoints } from "./questions.js";

const cardsOf = (ctx) => Object.values(ctx.decks).flatMap((d) => d.cards);
const fail = (code, message) => {
  throw new KitError(code, message);
};
const entries = (s) =>
  Object.entries(s.players).map(([playerId, p]) => ({ playerId, ...p }));
/** @type {import('../../../types/parlor.js').Kit<any>} */
const kit = {
  id: "recognition",
  hidden: true,
  name: "Recognition",
  tagline: "Learn a deck of faces, flags, or other images.",
  version: 1,
  minPlayers: 1,
  maxPlayers: 8,
  joinMidGame: "spectate",
  config: {
    mode: {
      type: "choice",
      label: "Game",
      options: [
        { value: "together", label: "Together" },
        { value: "race", label: "Race" },
      ],
      default: "together",
    },
    direction: {
      type: "choice",
      label: "Direction",
      options: [
        { value: "face", label: "Face to name" },
        { value: "name", label: "Name to face" },
        { value: "mixed", label: "Both directions" },
      ],
      default: "mixed",
    },
    cards: { type: "number", label: "Questions", min: 3, max: 20, default: 10 },
    distractors: {
      type: "choice",
      label: "Answer choices",
      options: [
        { value: "random", label: "Varied choices" },
        { value: "similar-names", label: "Similar names" },
        { value: "similar-portraits", label: "Reviewed portraits" },
      ],
      default: "random",
    },
  },
  content: {
    decks: {
      type: "decks",
      label: "Content",
      min: 1,
      cardFields: ["answer", "image"],
    },
  },
  setup(ctx) {
    const order = questions(
      cardsOf(ctx),
      ctx.config.cards,
      ctx.config.direction,
      ctx.rng,
      { distractors: ctx.config.distractors, targets: ctx.targets },
    );
    return {
      $seed: "",
      $rng: 0,
      phase: "ready",
      index: 0,
      _order: order,
      _answers: {},
      _history: {},
      _seen: {},
      mode: ctx.config.mode,
      players: Object.fromEntries(
        ctx.players.map((p) => [
          p.id,
          {
            score: 0,
            correct: 0,
            index: 0,
            wrong: [],
            blockedUntil: 0,
            finishedAt: null,
            attempts: 0,
          },
        ]),
      ),
      startedAt: ctx.now + 1000,
      roundAt: ctx.now + 1000,
      wakeAt: ctx.now + 1000,
      endsAt: ctx.now + 301000,
      void: false,
    };
  },
  reduce(s, action, ctx) {
    if (/^(player|host|game)\//.test(action.type)) return s;
    if (action.type !== "answer")
      return fail("bad_action", "Choose an answer to continue.");
    if (s.phase !== "question")
      return fail("wrong_phase", "Wait for the next question.");
    const p = s.players[ctx.me];
    if (!p) return fail("not_playing", "You are not in this game.");
    const q = s._order[s.mode === "race" ? p.index : s.index];
    if (!q || action.payload?.questionId !== q.id)
      return fail("stale", "That question has moved on.");
    const choice = String(action.payload?.choice ?? "");
    if (!/^[0-3]$/.test(choice))
      return fail("bad_answer", "Choose one of the four answers.");
    if (s.mode === "together" && s._answers[ctx.me]) return s;
    if (p.blockedUntil > ctx.now || p.wrong.includes(choice))
      return fail("cooldown", "Take a moment, then try another answer.");
    const correct = q.options[Number(choice)] === q.target;
    const next = structuredClone(s);
    const mine = next.players[ctx.me];
    mine.attempts++;
    next._history ??= {};
    next._history[ctx.me] ??= {};
    const old = next._history[ctx.me][q.id];
    next._history[ctx.me][q.id] = {
      firstCorrect: old?.firstCorrect ?? correct,
      attempts: (old?.attempts ?? 0) + 1,
      mistakes: (old?.mistakes ?? 0) + Number(!correct),
    };
    if (s.mode === "together") {
      next._answers[ctx.me] = {
        choice,
        correct,
        points: correct ? speedPoints(ctx.now - s.roundAt) : 0,
      };
      if (Object.keys(next._answers).length === Object.keys(s.players).length)
        return reveal(next, ctx.now);
    } else if (correct) {
      mine.index++;
      next._seen ??= {};
      next._seen[ctx.me] = Math.min(mine.index + 1, s._order.length);
      mine.correct++;
      mine.score++;
      mine.wrong = [];
      mine.blockedUntil = ctx.now + 400;
      if (mine.index === s._order.length) {
        mine.finishedAt = ctx.now;
        next.endsAt = Math.min(next.endsAt, ctx.now + 30000);
        next.wakeAt = next.endsAt;
        if (entries(next).every((p) => p.finishedAt !== null))
          return finish(next, ctx.now);
      }
    } else {
      mine.wrong.push(choice);
      mine.blockedUntil = ctx.now + 1500;
    }
    return next;
  },
  tick(s, ctx) {
    if (s.wakeAt === null || ctx.now < s.wakeAt) return s;
    if (s.phase === "ready")
      return {
        ...s,
        phase: "question",
        _seen: Object.fromEntries(Object.entries(s.players).map(([id,p]) => [id,Math.min((s.mode === "race" ? p.index : s.index)+1,s._order.length)])),
        roundAt: ctx.now,
        wakeAt: s.mode === "race" ? s.endsAt : ctx.now + 15000,
      };
    if (s.phase === "question")
      return s.mode === "race" ? finish(s, ctx.now) : reveal(s, ctx.now);
    if (s.phase === "reveal") {
      if (s.index + 1 >= s._order.length) return finish(s, ctx.now);
      return {
        ...s,
        phase: "ready",
        index: s.index + 1,
        _answers: {},
        roundAt: ctx.now + 500,
        wakeAt: ctx.now + 500,
      };
    }
    return s;
  },
  view(s, ctx) {
    const p = s.players[ctx.me];
    const q = s._order[s.mode === "race" ? (p?.index ?? 0) : s.index];
    const answer = s._answers[ctx.me];
    const revealed = s.phase === "reveal";
    const card = cardsOf(ctx).find((c) => c.id === q?.target);
    return {
      phase: s.phase,
      mode: s.mode,
      question: questionView(q, cardsOf(ctx)),
      progress: {
        n: Math.min(
          (s.mode === "race" ? (p?.index ?? 0) : s.index) + 1,
          s._order.length,
        ),
        total: s._order.length,
      },
      mine: p
        ? {
            ...p,
            choice: answer?.choice ?? null,
            ...(revealed
              ? {
                  correctAnswer: answer?.correct ?? false,
                  points: answer?.points ?? 0,
                }
              : {}),
          }
        : null,
      reveal: revealed
        ? {
            choice: String(q.options.indexOf(q.target)),
            name: card?.answer ?? "",
            image: card?.image ?? null,
          }
        : null,
      standings: ranked(s).map(
        ({ playerId, score, correct, index, finishedAt, rank }) => ({
          playerId,
          score,
          correct,
          index,
          finishedAt,
          rank,
        }),
      ),
      wakeAt: s.wakeAt,
      roundAt: s.roundAt,
      startedAt: s.startedAt,
      endsAt: s.endsAt,
      void: s.void,
      actions: [],
      waitingOn: [],
      answeredCount: Object.keys(s._answers).length,
    };
  },
  summary(s) {
    const scores = ranked(s).map(({ playerId, score, correct, rank }) => ({
      playerId,
      score,
      correct,
      rank,
    }));
    return {
      phase: s.phase === "over" ? "over" : "playing",
      scores,
      winnerIds: s.void
        ? []
        : scores
            .filter((p) => p.rank === 1 && p.correct > 0)
            .map((p) => p.playerId),
      label: s.void
        ? "Content changed. Please start a new game."
        : s.phase === "over"
          ? "Finished"
          : "Playing",
    };
  },
  demoConfig: { mode: "together", direction: "face", cards: 3 },
  demoContent: { decks: ["demo"] },
  demoDecks: ["demo"],
  demoScript: [["@wait", 120000]],
};
function reveal(s, now) {
  const players = structuredClone(s.players);
  for (const [id, a] of Object.entries(s._answers)) {
    players[id].score += a.points;
    if (a.correct) players[id].correct++;
  }
  return { ...s, players, phase: "reveal", wakeAt: now + 1500 };
}
function finish(s, now) {
  return { ...s, phase: "over", wakeAt: null, finishedAt: now };
}
/** Rank multiplayer results with exact ties; race finishers precede unfinished players. */
export function ranked(s) {
  const rows = entries(s).map((p) => ({
    ...p,
    value:
      s.mode === "race"
        ? p.finishedAt !== null
          ? 1000000 - (p.finishedAt - s.startedAt)
          : p.index * 1000
        : p.score,
  }));
  rows.sort(
    (a, b) => b.value - a.value || a.playerId.localeCompare(b.playerId),
  );
  return rows.map((p, i) => ({
    ...p,
    rank: 1 + rows.filter((other) => other.value > p.value).length,
  }));
}
export default kit;
