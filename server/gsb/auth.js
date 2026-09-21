// Passwordless identity for allowed email domains: one-use links and revocable HttpOnly sessions.
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { PlatformError } from "../../public/shared/errors.js";
import { sendDescopeLink, verifyDescopeLink } from "./descope.js";
import { emailDomains } from './site-config.js';
const token = () => randomBytes(32).toString("base64url");
/** Hash bearer secrets before persistence. */
export const hash = (value) => createHash("sha256").update(value).digest("hex");
/** Accept one unambiguous address at an explicitly allowed domain. Stanford is the default. */
export function stanfordEmail(value) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&\x27*+/=?^_\x60{|}~-]+@[a-z0-9.-]+$/.test(email) ||
    !emailDomains().includes(email.split('@')[1]) ||
    email.startsWith(".") ||
    email.includes("..") ||
    email.includes(".@")
  )
    throw new PlatformError(
      400,
      "email",
      `Use your ${emailDomains().join(' or ')} email address.`,
    );
  return email;
}
/** Require a configured origin rather than trusting the incoming Host header for emailed links. */
export function appOrigin() {
  const origin = process.env.APP_ORIGIN;
  if (!origin)
    throw new PlatformError(
      503,
      "configuration",
      "Login email is not configured yet.",
    );
  const url = new URL(origin);
  const local = !process.env.VERCEL && url.protocol === 'http:' && url.hostname === 'localhost';
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.protocol !== 'https:' && !local)
    throw new Error("APP_ORIGIN must be an HTTPS origin (HTTP localhost is allowed locally).");
  return url.origin;
}
/** Modular delivery adapter. The local test outbox can never run on Vercel. */
export function emailReady() {
  return (
    !!process.env.DESCOPE_PROJECT_ID ||
    !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) ||
    !!(
      !process.env.VERCEL &&
      process.env.NODE_ENV === "test" &&
      process.env.GSB_TEST_EMAIL_OUTBOX
    )
  );
}
/** Send a real login link using a replaceable transactional-email service. */
export async function deliverLink(email, url) {
  if (
    !process.env.VERCEL &&
    process.env.NODE_ENV === "test" &&
    process.env.GSB_TEST_EMAIL_OUTBOX
  ) {
    await appendFile(
      process.env.GSB_TEST_EMAIL_OUTBOX,
      JSON.stringify({ email, url }) + "\n",
      { mode: 0o600 },
    );
    return;
  }
  if (!emailReady())
    throw new PlatformError(
      503,
      "email_pending",
      "Login email is being connected. Please try again later.",
    );
  if (process.env.DESCOPE_PROJECT_ID) return sendDescopeLink(email, url);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Your Classmates sign-in link",
      text: `Sign in to Classmates:\n\n${url}\n\nThis link expires in 15 minutes and works once. If you did not request it, you can ignore this email.`,
    }),
  });
  if (!response.ok)
    throw new PlatformError(
      503,
      "email_unavailable",
      "We could not send your link. Please try again shortly.",
    );
}
/** Store an origin-bound one-use link for server delivery or an explicit operator grant. Never expose it through an API response. */
export async function issueLink(db, value, purpose = "email") {
  if (!["email", "descope", "owner-preview"].includes(purpose))
    throw new Error("Unknown sign-in purpose.");
  const email = stanfordEmail(value),
    secret = token();
  const origin = appOrigin();
  const url = `${origin}/login#token=${secret}`;
  await db.query(
    "insert into gsb_links(hash,email,expires_at,origin,purpose) values($1,$2,now()+interval '15 minutes',$3,$4)",
    [hash(secret), email, origin, purpose],
  );
  return { email, url, hash: hash(secret) };
}
/** Send a one-use email link. Only the server-selected delivery adapter sees the credential. */
export async function requestLink(db, value, send = deliverLink) {
  const localOutbox =
    !process.env.VERCEL &&
    process.env.NODE_ENV === "test" &&
    process.env.GSB_TEST_EMAIL_OUTBOX;
  const purpose =
    send === deliverLink && process.env.DESCOPE_PROJECT_ID && !localOutbox
      ? "descope"
      : "email";
  const link = await issueLink(db, value, purpose);
  try {
    await send(link.email, link.url);
  } catch (error) {
    await db.query("delete from gsb_links where hash=$1", [link.hash]);
    throw error;
  }
}
/** Verify email proof where required, then atomically consume the link and establish its scoped session. */
export async function consumeLink(db, secret, proof = undefined) {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw new PlatformError(
      400,
      "link",
      "This sign-in link is invalid. Request a new one.",
    );
  const [pending] = await db.query(
    "select email,purpose from gsb_links where hash=$1 and expires_at>now() and origin=$2",
    [hash(secret), appOrigin()],
  );
  if (!pending)
    throw new PlatformError(
      400,
      "link",
      "This link has expired or was already used. Request a new one.",
    );
  // A policy change also applies to already-issued links, regardless of provider.
  stanfordEmail(pending.email);
  if (pending.purpose === "descope")
    await verifyDescopeLink(proof, stanfordEmail(pending.email));
  const session = token(),
    id = token().slice(0, 22);
  const rows = await db.query(
    `with consumed as (delete from gsb_links where hash=$1 and expires_at>now() and origin=$4 returning email,purpose),
    account as (insert into gsb_accounts(id,email,email_verified_at)
      select $2,email,case when purpose in ('email','descope') then now() end from consumed
      on conflict(email) do update set email_verified_at=coalesce(excluded.email_verified_at,gsb_accounts.email_verified_at)
      returning id,email,nickname),
    session as (insert into gsb_sessions(hash,account_id,expires_at,purpose)
      select $3,a.id,now()+case when c.purpose='owner-preview' then interval '1 day' else interval '30 days' end,c.purpose from account a cross join consumed c)
    select a.id,a.email,a.nickname,c.purpose as access from account a cross join consumed c`,
    [hash(secret), id, hash(session), appOrigin()],
  );
  if (!rows.length)
    throw new PlatformError(
      400,
      "link",
      "This link has expired or was already used. Request a new one.",
    );
  return { account: rows[0], session };
}
/** Cookie name uses the host-only secure prefix in production. */
export const cookieName = () => (process.env.VERCEL ? "__Host-gsb" : "gsb");
/** Set or clear the app's host-only, HttpOnly session cookie. */
export function sessionCookie(res, value) {
  res.setHeader(
    "Set-Cookie",
    `${cookieName()}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? 2592000 : 0}${process.env.VERCEL || process.env.APP_ORIGIN?.startsWith("https:") ? "; Secure" : ""}`,
  );
}
/** Resolve the account from a cookie; no email, account ID, or room secret supplied by the client is trusted. */
export async function authenticate(db, req) {
  const raw = String(req.headers.cookie ?? "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(cookieName() + "="))
    ?.split("=")[1];
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const rows = await db.query(
    "select a.id,a.email,a.nickname,s.purpose as access from gsb_sessions s join gsb_accounts a on a.id=s.account_id where s.hash=$1 and s.expires_at>now()",
    [hash(raw)],
  );
  const account = rows[0] ?? null;
  // Keep explicit tester/owner grants, while disallowing normal sessions if the
  // deployment owner removes their email domain from the allowed cohort.
  if (account && account.access !== 'door' && account.access !== 'owner-preview') {
    try { stanfordEmail(account.email); }
    catch (error) { if (error.status === 400) return null; throw error; }
  }
  return account;
}
/** Derive a server-only seat credential from the verified account and a deployment secret. */
export function roomIdentity(account) {
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)
    throw new PlatformError(
      503,
      "configuration",
      "Account security is not configured yet.",
    );
  return {
    playerId: account.id,
    secret: createHmac("sha256", process.env.AUTH_SECRET)
      .update(account.id)
      .digest("hex"),
  };
}

// ---------- the test door: sign in without an email while an operator holds it open ----------
// `scripts/gsb/door.js open` stores a code in gsb_settings and prints a link; `close` removes it and ends
// every door session at once. Nothing public can open the door, and a door account never counts as verified.
const DOOR_KEY = "door";
/** The door's current code, or null when it is closed. */
export async function doorState(db) {
  const [row] = await db.query("select value,updated_at from gsb_settings where key=$1", [DOOR_KEY]);
  return row ? { code: String(row.value.code), openedAt: new Date(row.updated_at).getTime() } : null;
}
/** Hold the door open under a fresh code (or the one given) and return it. */
export async function openDoorSwitch(db, code = null) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const value = code || [...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join("");
  await db.query("insert into gsb_settings(key,value,updated_at) values($1,$2::jsonb,now()) on conflict(key) do update set value=excluded.value,updated_at=now()", [DOOR_KEY, JSON.stringify({ code: value })]);
  return value;
}
/** Close the door and end every session that came through it. Returns how many sessions ended. */
export async function closeDoorSwitch(db) {
  await db.query("delete from gsb_settings where key=$1", [DOOR_KEY]);
  const gone = await db.query("delete from gsb_sessions where purpose='door' returning hash");
  return gone.length;
}
/** Come in through the open door: a fresh unverified account with a week-long session. */
export async function enterDoor(db, code) {
  const given = String(code ?? "").trim().toUpperCase();
  const door = await doorState(db);
  const closed = () => { throw new PlatformError(404, "door_closed", "The test door is closed. Sign in with your email."); };
  if (!door || !/^[A-Z0-9]{6}$/.test(given) || given.length !== door.code.length) closed();
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(door.code))) closed();
  const session = token(), id = token().slice(0, 22);
  const rows = await db.query(
    `with account as (insert into gsb_accounts(id,email) values($1,$2) returning id,email,nickname),
    session as (insert into gsb_sessions(hash,account_id,expires_at,purpose) select $3,id,now()+interval '7 days','door' from account)
    select id,email,nickname,'door' as access from account`,
    [id, `door-${id.toLowerCase()}@door.invalid`, hash(session)],
  );
  return { account: rows[0], session };
}
/** Accounts that came in through the door, for the close step's purge. */
export async function doorAccounts(db) {
  return (await db.query("select id,nickname from gsb_accounts where email like 'door-%@door.invalid' order by created_at")).map((r) => ({ id: r.id, nickname: r.nickname }));
}
