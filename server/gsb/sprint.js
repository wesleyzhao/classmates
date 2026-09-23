// Authenticated solo recognition runs and records, separate from multiplayer ratings.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PlatformError } from "../../public/shared/errors.js";
import { normalizeCode, randomCode } from "../../public/shared/codes.js";
import { makeRng } from "../../public/kits/_lib/rng.js";
import { questions, questionView } from "../../public/kits/recognition/questions.js";
import { scoreSprint } from "../../public/kits/recognition/sprint.js";

import { freshTargets } from "./face-history.js";

const VERSION = 1;
const LIFE_MS = 3600000;
const fail = (status, code, message) => { throw new PlatformError(status, code, message); };

const LENGTHS = { quick: 10, short: 20, class: 600 };

/** Validate the supported sprint sizes (quick 10, short 20, whole class) and directions (face, name, mixed). */
export function sprintOptions(direction, length) {
  if (!["face", "name", "mixed"].includes(direction) || typeof length !== "string" || !Object.hasOwn(LENGTHS, length))
    fail(400, "sprint_options", "Choose a sprint direction and length.");
  return { direction, length };
}

/** Validate difficulty independently of scoring; old API callers keep four choices.
 * @param {string} direction @param {unknown} [choices] @returns {number}
 */
export function sprintChoices(direction, choices = 4) {
  if (choices !== 2 && choices !== 4 || choices === 2 && direction !== "face")
    fail(400, "sprint_choices", "Choose two names or four choices.");
  return choices === 2 ? 2 : 4;
}

function context(deck, direction, length) {
  if (!deck?.id || !Array.isArray(deck.cards) || deck.cards.length < 4)
    fail(503, "sprint_content", "The class deck needs at least four available cards.");
  const cards = deck.cards.slice().sort((a, b) => a.id.localeCompare(b.id));
  const count = Math.min(LENGTHS[length], cards.length);
  const cohort = createHash("sha256").update(JSON.stringify(cards.map((c) => [c.id, c.answer, c.image, c.portraitPeers]))).digest("hex");
  return { revision: deck.id, cohort, direction, length, count, scoringVersion: VERSION };
}

function dimensions(c) {
  return [c.revision, c.cohort, c.direction, c.length, c.count, c.scoringVersion];
}

async function cleanExpired(db) {
  await db.query("delete from gsb_sprint_runs where id in (select id from gsb_sprint_runs where finished_at is null and expires_at<now() order by expires_at limit 50)");
}

/** Return current comparable personal records and class standings. */
export async function sprintRecords(db, account, deck, direction, length, choices = 4) {
  sprintChoices(direction, choices);
  sprintOptions(direction, length);
  const c = context(deck, direction, length), d = dimensions(c);
  const where = "revision=$1 and cohort=$2 and direction=$3 and length=$4 and count=$5 and scoring_version=$6 and coalesce((doc->>'choices')::integer,4)=$8 and result is not null";
  const [row] = await db.query(`
    with runs as (select r.account_id,r.result,r.finished_at from gsb_sprint_runs r join gsb_accounts g on g.id=r.account_id where ${where} and g.email not like 'guest-%@guest.invalid'),
    best as (select distinct on (account_id) account_id,result,finished_at from runs order by account_id,(result->>'score')::integer desc,(result->>'elapsedMs')::integer asc,finished_at asc),
    perfect as (select distinct on (account_id) account_id,result,finished_at from runs where (result->>'perfect')::boolean order by account_id,(result->>'elapsedMs')::integer asc,finished_at asc)
    select
      (select result from best where account_id=$7) as best_score,
      (select result from perfect where account_id=$7) as fastest_perfect,
      coalesce((select jsonb_agg(jsonb_build_object('nickname',nickname,'score',score,'correct',correct,'count',count,'elapsedMs',elapsed_ms) order by score desc,elapsed_ms asc,finished_at asc)
        from (select a.nickname,(b.result->>'score')::integer as score,(b.result->>'correct')::integer as correct,(b.result->>'count')::integer as count,(b.result->>'elapsedMs')::integer as elapsed_ms,b.finished_at from best b join gsb_accounts a on a.id=b.account_id order by score desc,elapsed_ms asc,b.finished_at asc limit 10) leaders), '[]'::jsonb) as leaders,
      coalesce((select jsonb_agg(jsonb_build_object('nickname',nickname,'elapsedMs',elapsed_ms) order by elapsed_ms asc,finished_at asc)
        from (select a.nickname,(p.result->>'elapsedMs')::integer as elapsed_ms,p.finished_at from perfect p join gsb_accounts a on a.id=p.account_id order by elapsed_ms asc,p.finished_at asc limit 10) leaders), '[]'::jsonb) as perfect_leaders
  `, [...d, account.id, choices]);
  return {
    bestScore: row.best_score,
    fastestPerfect: row.fastest_perfect,
    leaders: row.leaders,
    perfectLeaders: row.perfect_leaders,
  };
}

/** One question sequence with four choices each (two for a duel), for a solo run or a shared challenge. */
function buildSequence(deck, c, rng, targets, choices = 4) {
  const order = questions(deck.cards, c.count, c.direction, rng, { distractors: "similar-portraits", ...(targets ? { targets } : {}) }).map((q) => {
    if (choices === 2) {
      // Two doors: the person and their most confusable classmate, in a random order.
      const other = q.options.find((id) => id !== q.target) ?? rng.shuffle(deck.cards.filter((card) => card.id !== q.target))[0].id;
      return { ...q, options: rng.shuffle([q.target, other]) };
    }
    if (q.options.length === 4) return q;
    const remaining = rng.shuffle(deck.cards.filter((card) => !q.options.includes(card.id)));
    return { ...q, options: rng.shuffle([...q.options, ...remaining.slice(0, 4 - q.options.length).map((card) => card.id)]) };
  });
  const views = sequenceViews(order, deck, choices);
  if (!views) fail(503, "sprint_content", "The class deck could not make this sprint.");
  return { order, views };
}

/** Redacted questions with the answer key, or null when a card is no longer in the deck. */
function sequenceViews(order, deck, choices = 4) {
  const views = order.map((q) => ({ ...questionView(q, deck.cards), correctChoice: String(q.options.indexOf(q.target)) }));
  return views.some((q) => !q || q.choices.length !== choices) ? null : views;
}

/** Prepare one owner-bound run without starting its timer. */
export async function prepareSprint(db, account, deck, direction, length, choices = 4) {
  sprintChoices(direction, choices);
  sprintOptions(direction, length);
  const c = context(deck, direction, length);
  const rng = makeRng(randomBytes(32).toString("hex"));
  // These reads do not depend on removing expired, unfinished runs. Await all
  // work before returning, while avoiding three sequential database round trips.
  const split = length === "short", quickCount = Math.min(10, c.count);
  const [,targets,records,quickRecords] = await Promise.all([
    cleanExpired(db),
    freshTargets(db, [account.id], deck.cards, c.count, rng),
    sprintRecords(db, account, deck, direction, length, choices),
    split ? sprintRecords(db, account, deck, direction, "quick", choices) : null,
  ]);
  const { order, views } = buildSequence(deck, c, rng, targets, choices);
  const id = randomUUID();
  // Issue both halves in the same write. Selecting 10 later needs no HTTP, and
  // each half already has its own owner, answer order, timer, history and records.
  // These unused alternatives do not count as seen and expire with the full run.
  const segments = split ? Array.from({ length: Math.floor(c.count / quickCount) }, (_, i) =>
    ({ id: randomUUID(), offset: i * quickCount, count: quickCount, length: "quick" })) : [];
  const runs = [{ id, length, count: c.count, doc: { questions: order, choices } },
    ...segments.map(s => ({ id: s.id, length: s.length, count: s.count, doc: { questions: order.slice(s.offset, s.offset + s.count), choices } }))];
  await db.query(`insert into gsb_sprint_runs(id,account_id,revision,cohort,direction,length,count,scoring_version,doc,expires_at)
    select r.id,$1,$2,$3,$4,r.length,r.count,$5,r.doc,now()+interval '1 hour'
    from jsonb_to_recordset($6::jsonb) as r(id text,length text,count integer,doc jsonb)`,
  [account.id, c.revision, c.cohort, direction, VERSION, JSON.stringify(runs)]);
  return { id, direction, length, choices, count: c.count, revision: c.revision, questions: views, records,
    ...(split ? { segments, quickRecords } : {}) };
}

// ---------- challenges: the same sequence for everyone who opens the code, ranked by score then time ----------

function challengeCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) fail(404, "challenge_missing", "Enter the four-letter challenge code.");
  return normalized;
}

const MODES = ["solo", "duel"];
/** Create a shared sequence under a fresh code, then join it as the host. A duel has two doors and starts on one count. */
export async function createChallenge(db, account, deck, direction, length, mode = "solo", requestedChoices = 4) {
  sprintOptions(direction, length);
  if (!MODES.includes(mode)) fail(400, "challenge_mode", "Choose a challenge kind.");
  const c = context(deck, direction, length), choices = mode === "duel" ? 2 : requestedChoices;
  sprintChoices(direction, choices);
  const rng = makeRng(randomBytes(32).toString("hex"));
  const { order } = buildSequence(deck, c, rng, await freshTargets(db, [account.id], deck.cards, c.count, rng), choices);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const inserted = await db.query("insert into gsb_sprint_challenges(code,host_id,revision,cohort,direction,length,count,scoring_version,doc,expires_at,mode) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now()+interval '7 days',$10) on conflict (code) do nothing returning code", [code, account.id, ...dimensions(c), JSON.stringify({ questions: order, choices, selectionVersion: randomUUID() }), mode]);
    if (inserted.length) return joinChallenge(db, account, deck, code);
  }
  fail(503, "challenge_code", "A challenge code could not be made. Please try again.");
}

/** A rematch: the same settings under a new code, remembered on the old challenge so the others can follow. */
export async function rematchChallenge(db, account, deck, code) {
  code = challengeCode(code);
  const challenge = await loadChallenge(db, code);
  if (challenge.next_code) return joinChallenge(db, account, deck, challenge.next_code);
  const next = await createChallenge(db, account, deck, challenge.direction, challenge.length, challenge.mode, challenge.doc.choices ?? 4);
  await db.query("update gsb_sprint_challenges set next_code=$2 where code=$1 and next_code is null", [code, next.code]);
  // Two players pressing Rematch at once: the first one's duel is the rematch, and the other follows it.
  const [after] = await db.query("select next_code from gsb_sprint_challenges where code=$1", [code]);
  return after?.next_code && after.next_code !== next.code ? joinChallenge(db, account, deck, after.next_code) : next;
}

/** Confirm that the caller preloaded this exact lobby sequence, then mark ready or start atomically. */
async function lobbyAction(db, account, code, version, operation) {
  code = challengeCode(code);
  const [row] = await db.query("select gsb_duel_lobby($1,$2,$3,$4) as status", [code,account.id,version ?? null,operation]);
  const errors = {
    missing:[404,"challenge_missing","That challenge was not found or has ended."],
    member:[403,"challenge_member","Join this speed run first."],
    host:[403,"challenge_host","Only the host starts the count."],
    mode:[400,"challenge_mode","This challenge is played whenever you like."],
    version:[409,"challenge_version","The round changed. Reload if the shared questions do not refresh."],
    waiting:[409,"challenge_not_ready","Wait for every player to be ready."],
  };
  if (errors[row.status]) { const [status,code,message] = errors[row.status]; fail(status,code,message); }
  return challengeView(db,code);
}
/** Mark this account ready for the currently loaded duel sequence. */
export async function readyChallenge(db, account, code, version = null) {
  return lobbyAction(db,account,code,version,"ready");
}
/** Start the shared four-second count only when every guest loaded and readied the same sequence. */
export async function beginChallenge(db, account, code, version = null) {
  return lobbyAction(db,account,code,version,"begin");
}

/** Live progress during a duel: how many cleared, how many right. Never trusted for the score. */
export async function progressChallenge(db, account, code, index, right) {
  code = challengeCode(code);
  if (!Number.isInteger(index) || !Number.isInteger(right) || index < 0 || right < 0 || right > index || index > 600) fail(400, "challenge_progress", "That progress is not valid.");
  // Requests can arrive out of order on mobile connections. Only an advancing,
  // internally consistent prefix may replace the other player's live counter.
  await db.query(`update gsb_sprint_runs set progress=$3::jsonb
    where challenge_code=$1 and account_id=$2 and result is null
      and started_at<=now() and expires_at>now() and $4::integer<=count
      and $4::integer>coalesce((progress->>'index')::integer,0)
      and $5::integer>=coalesce((progress->>'right')::integer,0)
      and $5::integer-coalesce((progress->>'right')::integer,0)
        <=$4::integer-coalesce((progress->>'index')::integer,0)`,
    [code, account.id, JSON.stringify({ index, right, at: Date.now() }),index,right]);
  return { ok: true };
}

async function loadChallenge(db, code) {
  const [challenge] = await db.query("select * from gsb_sprint_challenges where code=$1 and expires_at>now()", [code]);
  if (!challenge) fail(404, "challenge_missing", "That challenge was not found or has ended.");
  return challenge;
}

/** Everyone in a challenge, finished players first by score then time, with current nicknames. */
export async function challengeStandings(db, code) {
  const rows = await db.query("select r.account_id,a.nickname,r.result,r.started_at,r.ready_at,r.progress,r.doc from gsb_sprint_runs r join gsb_accounts a on a.id=r.account_id where r.challenge_code=$1 order by (r.result->>'score')::integer desc nulls last,(r.result->>'elapsedMs')::integer asc nulls last,r.finished_at asc nulls last,r.created_at asc", [code]);
  return rows.map((r) => ({
    accountId: r.account_id, nickname: r.nickname,
    status: r.result ? "finished" : r.started_at ? "playing" : "waiting",
    ready: !!r.ready_at,
    progress: r.result ? { index: r.result.count, right: r.result.correct } : r.progress ? { index: r.progress.index, right: r.progress.right } : { index: 0, right: 0 },
    // Which questions (by position) a finished player got wrong, for the review the others see.
    missed: r.result && Array.isArray(r.result.answers) ? (r.doc?.questions ?? []).map((q, i) => (String(q.options.indexOf(q.target)) === r.result.answers[i] ? -1 : i)).filter((i) => i >= 0) : null,
    result: r.result ? { score: r.result.score, correct: r.result.correct, count: r.result.count, elapsedMs: r.result.elapsedMs, perfect: r.result.perfect } : null,
  }));
}

/** The challenge summary for polling: settings, host and standings, without any question. */
export async function challengeView(db, code) {
  code = challengeCode(code);
  const challenge = await loadChallenge(db, code);
  return {
    code, direction: challenge.direction, length: challenge.length, count: challenge.count, hostId: challenge.host_id,
    mode: challenge.mode, choices: challenge.doc?.choices ?? 4, startsAt: challenge.starts_at ? new Date(challenge.starts_at).getTime() : null,
    selectionVersion: challenge.doc?.selectionVersion ?? null, nextCode: challenge.next_code ?? null, now: Date.now(),
    expiresAt: new Date(challenge.expires_at).getTime(), standings: await challengeStandings(db, code),
  };
}

/** This account's run in a challenge, made on first join. A finished run returns its result; an unfinished one may start again. */
export async function joinChallenge(db, account, deck, code) {
  code = challengeCode(code);
  let challenge = await loadChallenge(db, code);
  if (challenge.revision !== deck.id) fail(410, "challenge_stale", "This challenge used an earlier class deck.");
  const own = () => db.query("select * from gsb_sprint_runs where challenge_code=$1 and account_id=$2", [code, account.id]);
  let [run] = await own();
  if (!run) {
    for (let attempt=0; attempt<8; attempt++) {
      const roster = await db.query("select account_id from gsb_sprint_runs where challenge_code=$1 order by account_id", [code]);
      const ids = [...new Set([...roster.map(r => r.account_id), account.id])].sort();
      const rng = makeRng(randomBytes(32).toString("hex"));
      const candidate = challenge.mode === "duel" && !challenge.starts_at
        ? { questions:buildSequence(deck,challenge,rng,await freshTargets(db,ids,deck.cards,challenge.count,rng),2).order,choices:2,selectionVersion:randomUUID() }
        : challenge.doc;
      const [joined] = await db.query("select gsb_join_challenge($1,$2,$3,$4,$5::jsonb) as ok",
        [code,account.id,randomUUID(),challenge.doc?.selectionVersion ?? null,JSON.stringify(candidate)]);
      challenge = await loadChallenge(db,code);
      if (joined.ok) break;
      if (attempt===7) fail(409,"busy","The lobby changed. Please try again.");
    }
    [run] = await own();
  } else if (!run.result && run.started_at && challenge.mode !== "duel") {
    // Casual by design: a run abandoned by a reload or a leave may be played again from the top.
    await db.query("update gsb_sprint_runs set started_at=null,history=null,doc=jsonb_set(doc,'{historyEpoch}',to_jsonb($3::text)),expires_at=$2 where id=$1 and result is null", [run.id, challenge.expires_at,randomUUID()]);
    [run] = await own();
  }
  // Joining a duel after the count: the run waits, unstarted, for this player's own Start (see startSprint),
  // so the photos load and the 3-2-1 runs before their clock does.
  const views = sequenceViews(run.doc.questions, deck, run.doc.choices ?? 4);
  if (!views) fail(410, "challenge_stale", "This challenge contains a card that is no longer available.");
  const records = await sprintRecords(db, account, deck, challenge.direction, challenge.length, run.doc.choices ?? 4);
  return {
    id: run.id, historyEpoch: run.doc.historyEpoch ?? "0", code, direction: challenge.direction, length: challenge.length, count: challenge.count, revision: challenge.revision,
    hostId: challenge.host_id, expiresAt: new Date(challenge.expires_at).getTime(), questions: views, result: run.result, records,
    mode: challenge.mode, choices: run.doc.choices ?? 4, startsAt: challenge.starts_at ? new Date(challenge.starts_at).getTime() : null,
    selectionVersion: run.doc?.selectionVersion ?? null, startedAt: run.started_at ? new Date(run.started_at).getTime() : null, nextCode: challenge.next_code ?? null, now: Date.now(),
    standings: await challengeStandings(db, code),
  };
}

function validId(id) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))
    fail(400, "sprint_id", "That sprint identifier is not valid.");
}

async function ownedRun(db, account, id) {
  validId(id);
  // Start timestamps come from Postgres. Compare them with that same clock rather
  // than the function host, whose clock may differ enough to reject a fast round.
  const [row] = await db.query("select *,clock_timestamp() as server_now from gsb_sprint_runs where id=$1 and account_id=$2", [id, account.id]);
  if (!row) fail(404, "sprint_missing", "This sprint was not found.");
  return row;
}

/** Arm a prepared run atomically; retries preserve its original start instant. */
export async function startSprint(db, account, id) {
  const row = await ownedRun(db, account, id);
  // A player who joined a speed run after its count starts alone: their clock begins four seconds out,
  // the same 3-2-1 the room had, so their time is measured the same way.
  let delay = "0 seconds";
  if (row.challenge_code) {
    const challenge = await loadChallenge(db,row.challenge_code);
    if (challenge.mode === "duel" && !challenge.starts_at)
      fail(409,"challenge_not_started","The host starts this speed run after everyone is ready.");
    if (challenge.mode === "duel") delay = "4 seconds";
  }
  if (!row.result && new Date(row.expires_at).getTime() <= new Date(row.server_now).getTime())
    fail(410, "sprint_expired", "This sprint has expired.");
  const [started] = await db.query("update gsb_sprint_runs set started_at=now()+$3::interval,expires_at=now()+$3::interval+interval '1 hour' where id=$1 and account_id=$2 and started_at is null and expires_at>now() returning started_at", [id, account.id, delay]);
  const [current] = started || row.started_at ? [] : await db.query("select started_at from gsb_sprint_runs where id=$1 and account_id=$2", [id, account.id]);
  const startedAt = started?.started_at ?? row.started_at ?? current?.started_at;
  if (!startedAt) fail(410, "sprint_expired", "This sprint has expired.");
  return { id, startedAt: new Date(startedAt).getTime() };
}

/** Finish once, checking live exclusions and elapsed time before storing the calculated result. */
export async function finishSprint(db, account, id, answers, elapsedMs, epoch = "0") {
  const row = await ownedRun(db, account, id);
  if (row.result) return row.result;
  if ((row.doc.historyEpoch ?? "0") !== epoch) fail(410,"sprint_attempt","This round was restarted in another tab.");
  if (!row.started_at) fail(409, "sprint_not_started", "Start this sprint before finishing it.");
  if (new Date(row.expires_at).getTime() <= new Date(row.server_now).getTime())
    fail(410, "sprint_expired", "This sprint has expired.");
  const serverElapsed = new Date(row.server_now).getTime() - new Date(row.started_at).getTime();
  if (serverElapsed < 0 || !Number.isInteger(elapsedMs) || elapsedMs <= 0 || elapsedMs > LIFE_MS || elapsedMs > serverElapsed + 1000)
    fail(400, "sprint_time", "That sprint time is not valid.");
  const order = row.doc.questions;
  const ids = [...new Set(order.flatMap((q) => [q.target, ...q.options]))];
  const active = await db.query("select id from gsb_people where id=any($1::text[]) and not excluded", [ids]);
  if (active.length !== ids.length)
    fail(410, "sprint_content_removed", "This sprint contains a card that is no longer available.");
  let scored;
  try {
    scored = scoreSprint(order.map((q) => ({ id: q.id, correctChoice: String(q.options.indexOf(q.target)) })), answers, elapsedMs);
  } catch {
    fail(400, "sprint_answers", "Submit one valid answer for each question, in order.");
  }
  if (answers.some((a,i) => !order[i].options[Number(a.choice)]) ||
      (row.history?.answers ?? []).some((choice,i) => choice !== answers[i]?.choice))
    fail(400,"sprint_answers","Your saved answers cannot be changed.");
  // The choices themselves are kept too, so a duel can show what each player missed.
  const result = { ...scored, direction: row.direction, length: row.length, revision: row.revision, answers: answers.map((a) => a.choice) };
  const [saved] = await db.query("update gsb_sprint_runs set result=$3::jsonb,finished_at=now() where id=$1 and account_id=$2 and result is null and started_at is not null and coalesce(doc->>'historyEpoch','0')=$6 and not exists(select 1 from jsonb_array_elements_text(coalesce(history->'answers','[]'::jsonb)) with ordinality a(choice,n) where a.choice is distinct from $3::jsonb->'answers'->>(a.n::int-1)) and expires_at>now() and $4::integer <= extract(epoch from (now()-started_at))*1000+1000 and (select count(*) from gsb_people where id=any($5::text[]) and not excluded)=cardinality($5::text[]) returning result", [id, account.id, JSON.stringify(result), elapsedMs, ids,epoch]);
  if (saved) return saved.result;
  const [winner] = await db.query("select result from gsb_sprint_runs where id=$1 and account_id=$2", [id, account.id]);
  if (winner?.result) return winner.result;
  const stillActive = await db.query("select id from gsb_people where id=any($1::text[]) and not excluded", [ids]);
  if (stillActive.length !== ids.length)
    fail(410, "sprint_content_removed", "This sprint contains a card that is no longer available.");
  fail(410, "sprint_expired", "This sprint has expired.");
}

/** Save a partial round's visited prefix in the background; never changes its score or Practice schedule. */
export async function checkpointSprint(db, account, id, answers, seen, epoch = "0") {
  const row = await ownedRun(db,account,id);
  const order = row.doc.questions;
  if (!Array.isArray(answers) || !Number.isInteger(seen) || seen<1 || seen>order.length ||
      answers.length>seen || seen>answers.length+1 || answers.some((choice,i) =>
        typeof choice!=="string" || !/^[0-3]$/.test(choice) || !order[i]?.options[Number(choice)]))
    fail(400,"sprint_history","That round history is not valid.");
  const [saved] = await db.query("select gsb_checkpoint_sprint($1,$2,$3::jsonb) as ok",[id,account.id,JSON.stringify({answers,seen,epoch})]);
  if (!saved.ok) fail(409,"sprint_history","This round history could not be saved.");
  return {ok:true};
}

/** Record a claimed guest round as this account's speed run, so it sits in the two-choice records with everyone
 * else's. The row's id is the guest run's key, so a repeated claim cannot record it twice. */
export async function recordGuestRun(db, account, deck, key, doc) {
  const result = doc?.result;
  if (!result || !Array.isArray(result.answers) || !Array.isArray(doc.questions)) return;
  const c = context(deck, "face", "quick");
  const order = doc.questions.map((q) => ({ id: q.id, direction: "face", target: q.target, options: q.options }));
  const stored = { ...result, direction: "face", length: "quick", revision: doc.revision };
  await db.query(`insert into gsb_sprint_runs(id,account_id,revision,cohort,direction,length,count,scoring_version,doc,started_at,expires_at,finished_at,result)
    values($1,$2,$3,$4,'face','quick',$5,$6,$7::jsonb,now()-($8::integer*interval '1 millisecond'),now(),now(),$9::jsonb) on conflict (id) do nothing`,
    [`guest-${key}`, account.id, doc.revision, c.cohort, order.length, VERSION, JSON.stringify({ questions: order, choices: 2, guest: true }), result.elapsedMs, JSON.stringify(stored)]);
}
