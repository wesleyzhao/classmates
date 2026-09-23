// Disabled-by-default guest practice with a single bounded, cookie-backed round.
import { randomBytes } from "node:crypto";
import { PlatformError } from "../../public/shared/errors.js";
import { makeRng } from "../../public/kits/_lib/rng.js";
import { hash } from "./auth.js";
import { scoreSprint } from "../../public/kits/recognition/sprint.js";
import { recordGuestRun } from "./sprint.js";

const LIFE_MS = 7 * 86400000;
export const GUEST_ROUND_SIZE = 10;
const ROUND_SIZE = GUEST_ROUND_SIZE;
const fail = (status, code, message) => {
  throw new PlatformError(status, code, message);
};
const cookieName = () =>
  process.env.VERCEL ? "__Host-gsb-guest" : "gsb-guest";

/** Return the explicit, bounded person allowlist, or null while preview is disabled. */
export function guestConfig() {
  if (process.env.GSB_GUEST_PREVIEW !== "true") return null;
  const raw = process.env.GSB_GUEST_PERSON_IDS;
  if (!raw) return null;
  const ids = raw.split(",").map((value) => value.trim());
  if (
    ids.length < ROUND_SIZE ||
    ids.length > 32 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[A-Za-z0-9_-]{1,80}$/.test(id))
  ) return null;
  return new Set(ids);
}

function configured() {
  const allowed = guestConfig();
  if (!allowed)
    fail(404, "guest_unavailable", "Guest practice is not available.");
  return allowed;
}

function cookie(req) {
  const value = String(req.headers?.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName()}=`))
    ?.slice(cookieName().length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

/** Set a one-year, HttpOnly capability cookie on an HTTP response. */
export function guestCookie(res, value) {
  res.setHeader(
    "Set-Cookie",
    `${cookieName()}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? 31536000 : 0}${process.env.VERCEL || process.env.APP_ORIGIN?.startsWith("https:") ? "; Secure" : ""}`,
  );
}

const allIds = (doc) => [
  ...new Set(doc.questions.flatMap((question) => question.options)),
];

async function activeRun(db, doc, allowed) {
  const ids = allIds(doc);
  if (ids.length > 32 || ids.some((id) => !allowed.has(id))) return false;
  const rows = await db.query(
    "select id from gsb_people where id=any($1::text[]) and not excluded",
    [ids],
  );
  return rows.length === ids.length;
}

function publicRun(row) {
  const doc = row.doc;
  return {
    id: row.hash.slice(0, 24),
    status: doc.result ? "complete" : "ready",
    direction: "face",
    count: doc.questions.length,
    expiresAt: Number(new Date(row.expires_at)),
    claimed: !!row.claimed_account_id,
    questions: doc.questions.map(({ id, image, choices, correctChoice }) => ({
      id, direction: "face", image, choices, correctChoice,
    })),
    result: doc.result ?? null,
  };
}

/** Read a previously started run; a valid cookie cannot create another run. */
export async function getGuestRun(db, req) {
  const allowed = configured(), secret = cookie(req);
  if (!secret) return null;
  const [row] = await db.query(
    "select hash,doc,expires_at,claimed_account_id from gsb_guest_runs where hash=$1 and expires_at>now()",
    [hash(secret)],
  );
  if (!row) return { status: "expired" };
  if (!(await activeRun(db, row.doc, allowed)))
    fail(410, "guest_content_removed", "This practice round is no longer available.");
  return publicRun(row);
}

/** Start exactly one cookie-backed, ten-face round from the approved deck subset.
 * @param {any} db
 * @param {any} req
 * @param {any} res
 * @param {{id:string,cards:Array<{id:string,answer:string,image:string}>}} deck
 * @param {{mediaUrl?:(card:{id:string,answer:string,image:string})=>string}} [options]
 */
export async function startGuestRun(db, req, res, deck, options = {}) {
  const allowed = configured();
  const existing = await getGuestRun(db, req);
  if (existing) return existing;
  const cards = deck.cards.filter((card) => allowed.has(card.id));
  if (cards.length !== allowed.size)
    fail(503, "guest_content_pending", "Guest practice is not ready.");
  const secret = randomBytes(32).toString("base64url");
  const rng = makeRng(secret);
  const targets = rng.shuffle(cards).slice(0, ROUND_SIZE);
  const doc = {
    revision: deck.id,
    questions: targets.map((target, index) => {
      const choices = rng.shuffle([
        target,
        ...rng.shuffle(cards.filter((card) => card.id !== target.id)).slice(0, 1),
      ]);
      const asset = /^\/api\/media\/([A-Za-z0-9_-]{1,80})$/.exec(target.image);
      if (!options.mediaUrl && !asset)
        fail(503, "guest_media", "Guest practice media is not configured.");
      const image = options.mediaUrl
        ? options.mediaUrl(target)
        : `/api/guest/media/${asset[1]}`;
      const guestAsset = /^\/api\/guest\/media\/([A-Za-z0-9_-]{1,80})$/.exec(image);
      return {
        id: String(index),
        target: target.id,
        image,
        assetId: guestAsset?.[1] ?? null,
        options: choices.map((card) => card.id),
        choices: choices.map((card, choice) => ({ id: String(choice), label: card.answer })),
        correctChoice: String(choices.findIndex((card) => card.id === target.id)),
      };
    }),
  };
  const expiresAt = new Date(Date.now() + LIFE_MS);
  await db.query(
    "insert into gsb_guest_runs(hash,doc,expires_at) values($1,$2::jsonb,$3)",
    [hash(secret), JSON.stringify(doc), expiresAt.toISOString()],
  );
  guestCookie(res, secret);
  return publicRun({ hash: hash(secret), doc, expires_at: expiresAt });
}

/** Score a guest round the way a speed run is scored: 1,000 a correct answer and up to 999 for a fast round. */
export function scoreGuestRun(doc, answers, elapsedMs) {
  if (!Array.isArray(answers) || answers.length !== doc.questions.length)
    fail(400, "guest_answers", "Submit every answer in your round.");
  answers.forEach((answer, index) => {
    const question = doc.questions[index];
    if (!answer || answer.questionId !== question.id || typeof answer.choice !== "string" || !question.choices.some((c) => c.id === answer.choice))
      fail(400, "guest_answers", "That practice log is not valid.");
  });
  if (!Number.isInteger(elapsedMs) || elapsedMs <= 0 || elapsedMs > 3600000)
    fail(400, "guest_answers", "That round time is not valid.");
  const scored = scoreSprint(doc.questions.map((q) => ({ id: q.id, correctChoice: q.correctChoice })), answers.map((a) => ({ questionId: a.questionId, choice: a.choice })), elapsedMs);
  return { ...scored, answers: answers.map((a) => a.choice) };
}

/** Atomically complete a run once; retries return the first persisted result. */
export async function finishGuestRun(db, req, body) {
  const allowed = configured(), secret = cookie(req);
  if (!secret) fail(401, "guest_cookie", "Open your practice round in this browser.");
  const key = hash(secret);
  const [row] = await db.query(
    "select doc,expires_at from gsb_guest_runs where hash=$1 and expires_at>now()",
    [key],
  );
  if (!row) fail(410, "guest_expired", "This practice round has expired.");
  if (!(await activeRun(db, row.doc, allowed)))
    fail(410, "guest_content_removed", "This practice round is no longer available.");
  if (row.doc.result) return row.doc.result;
  const result = scoreGuestRun(row.doc, body?.answers, body?.elapsedMs);
  // The round began after the cookie was minted, so the clock cannot claim more than that.
  if (result.elapsedMs > Date.now() - (new Date(row.expires_at).getTime() - LIFE_MS) + 1000)
    fail(400, "guest_answers", "That round time is not valid.");
  const [saved] = await db.query(
    "update gsb_guest_runs set doc=jsonb_set(doc,'{result}',$2::jsonb),finished_at=now() where hash=$1 and expires_at>now() and not (doc ? 'result') returning doc->'result' as result",
    [key, JSON.stringify(result)],
  );
  if (saved) return saved.result;
  const [winner] = await db.query(
    "select doc->'result' as result from gsb_guest_runs where hash=$1 and expires_at>now()",
    [key],
  );
  if (!winner?.result) fail(410, "guest_expired", "This practice round has expired.");
  return winner.result;
}

/** Attach a completed result once to a verified email account; with the deck, it is recorded as a speed run too. */
export async function claimGuestRun(db, req, account, deck = null) {
  const allowed = configured(), secret = cookie(req);
  if (!secret || !account?.id || account.access !== "email") return null;
  const key = hash(secret);
  const [row] = await db.query(
    "select doc,claimed_account_id from gsb_guest_runs where hash=$1 and expires_at>now()",
    [key],
  );
  if (!row?.doc.result || !(await activeRun(db, row.doc, allowed))) return null;
  if (row.claimed_account_id === account.id) { if (deck) await recordGuestRun(db, account, deck, key, row.doc); return row.doc.result; }
  if (row.claimed_account_id) return null;
  const [claimed] = await db.query(
    "update gsb_guest_runs set claimed_account_id=$2 where hash=$1 and expires_at>now() and finished_at is not null and claimed_account_id is null and exists(select 1 from gsb_accounts where id=$2 and email_verified_at is not null) returning doc->'result' as result",
    [key, account.id],
  );
  if (claimed) { if (deck) await recordGuestRun(db, account, deck, key, row.doc); return claimed.result; }
  const [winner] = await db.query(
    "select claimed_account_id,doc->'result' as result from gsb_guest_runs where hash=$1 and expires_at>now()",
    [key],
  );
  return winner?.claimed_account_id === account.id ? winner.result : null;
}

/** Return the account's best guest score; a claimed one is also recorded as a speed run. */
export async function guestBest(db, account) {
  const allowed = configured();
  if (!account?.id || account.access !== "email") return null;
  const rows = await db.query(
    "select doc from gsb_guest_runs where claimed_account_id=$1 and finished_at is not null order by (doc->'result'->>'score')::integer desc,finished_at asc",
    [account.id],
  );
  for (const row of rows)
    if (await activeRun(db, row.doc, allowed)) return row.doc.result;
  return null;
}

/** Resolve only an assigned, currently included private asset for this guest cookie. */
export async function guestMediaPath(db, req, assetId) {
  const allowed = configured(), secret = cookie(req);
  if (!secret || !/^[A-Za-z0-9_-]{1,80}$/.test(String(assetId))) return null;
  const [row] = await db.query(
    "select doc from gsb_guest_runs where hash=$1 and expires_at>now()",
    [hash(secret)],
  );
  if (!row || !(await activeRun(db, row.doc, allowed))) return null;
  const [asset] = await db.query(
    "select a.path,a.person_id from gsb_assets a join gsb_people p on p.id=a.person_id where a.id=$1 and not p.excluded",
    [assetId],
  );
  if (!asset || !allowed.has(asset.person_id) || !row.doc.questions.some((question) => question.target === asset.person_id && question.assetId === assetId)) return null;
  return asset.path;
}
