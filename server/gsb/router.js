// Same-origin private class API, with a separately gated, cookie-bound guest sample experiment.
import { get } from "@vercel/blob";
import { database, latestDeck } from "./db.js";
import { classRooms } from "./rooms.js";
import { loadLeaderboard } from "./leaderboard.js";
import { saveNickname } from "./profile.js";
import { guestConfig, getGuestRun, startGuestRun, finishGuestRun, claimGuestRun, guestBest, guestMediaPath } from "./guest.js";
import { faceHistories, faceSummary } from "./face-history.js";
import { publicSiteConfig } from './site-config.js';
import { createChallenge, joinChallenge, challengeView, rematchChallenge, readyChallenge, beginChallenge, progressChallenge, prepareSprint, startSprint, finishSprint, sprintRecords, checkpointSprint } from "./sprint.js";
import {
  authenticate,
  appOrigin,
  consumeLink,
  cookieName,
  deliverLink,
  emailReady,
  enterDoor,
  hash,
  requestLink,
  roomIdentity,
  sessionCookie,
  stanfordEmail,
} from "./auth.js";
import {
  readJsonBody,
  sendJson,
  errorBody,
  parsePath,
  clientIp,
} from "../http.js";
import { PlatformError } from "../../public/shared/errors.js";
const bad = (status, code, message) => {
  throw new PlatformError(status, code, message);
};
/** Dependency injection is server-only and used by API tests, never by request parameters. */
export function createGsbHandler(deps = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const { segments: p, query: q } = parsePath(req),
        method = req.method ?? "GET";
      const db = deps.db ?? database();
      const rooms = deps.rooms ?? classRooms(db.store);
      const ip = hash(clientIp(req)).slice(0, 24);
      const limit = async (key, max, ms = 60000) => {
        if (!(await db.store.bumpLimit(`gsb:${key}`, ms, max)).allowed)
          bad(429, "rate_limited", "Please wait a little before trying again.");
      };
      if (method === "GET" && p[0] === "health")
        return sendJson(res, 200, {
          ok: true,
          profile: "gsb",
          emailReady: emailReady(),
        });
      if (method === "POST") {
        if (req.headers.origin !== appOrigin())
          bad(403, "origin", "Please open the game in its own browser tab.");
        if (!String(req.headers["content-type"]).startsWith("application/json"))
          bad(415, "content_type", "Send a JSON request.");
      } else if (method !== "GET")
        bad(405, "method", "That method is not supported.");
      // The experiment is server-controlled. A client URL or parameter cannot enable it.
      if (p[0] === "guest") {
        if (!guestConfig()) bad(404, "guest_unavailable", "Guest practice is not available.");
        if (p.length === 1 && method === "GET")
          return sendJson(res, 200, await getGuestRun(db, req) ?? { status: "new" });
        if (p[1] === "start" && p.length === 2 && method === "POST") {
          await limit(`guest-start:${ip}`, 5, 3600000);
          await limit("guest-start-day", 200, 86400000);
          const deck = await (deps.latestDeck ?? latestDeck)();
          return sendJson(res, 200, await startGuestRun(db, req, res, deck, deps.guestOptions));
        }
        if (p[1] === "finish" && p.length === 2 && method === "POST") {
          await limit(`guest-finish:${ip}`, 20, 3600000);
          const body = await readJsonBody(req, { maxBytes: 8192 });
          return sendJson(res, 200, await finishGuestRun(db, req, body));
        }
        if (p[1] === "media" && p.length === 3 && method === "GET") {
          const path = await guestMediaPath(db, req, p[2]);
          if (!path) bad(404, "media", "This photo is no longer available.");
          await sendPortrait(path, res, deps.getBlob);
          return;
        }
      }
      if (p[0] === "auth" && p[1] === "request" && method === "POST") {
        const body = await readJsonBody(req, { maxBytes: 4096 }),
          email = stanfordEmail(body.email);
        await limit(`email-ip:${ip}`, 10, 900000);
        await limit(`email:${hash(email)}`, 3, 900000);
        await limit("email-day", 90, 86400000);
        await requestLink(db, email, deps.send ?? deliverLink);
        return sendJson(res, 200, { sent: true });
      }
      if (p[0] === "auth" && p[1] === "door" && method === "POST") {
        // The test door: open only while an operator holds it open (scripts/gsb/door.js).
        await limit(`door:${ip}`, 10, 900000);
        const body = await readJsonBody(req, { maxBytes: 1024 }),
          result = await enterDoor(db, body.code);
        sessionCookie(res, result.session);
        return sendJson(res, 200, { account: result.account });
      }
      if (p[0] === "auth" && p[1] === "verify" && method === "POST") {
        await limit(`verify:${ip}`, 20, 900000);
        const body = await readJsonBody(req, { maxBytes: 4096 }),
          result = await consumeLink(db, body.token, body.proof);
        sessionCookie(res, result.session);
        return sendJson(res, 200, { account: result.account });
      }
      const account = await authenticate(db, req);
      if (p[0] === "session" && method === "GET")
        return sendJson(res, 200, {
          account,
          site: publicSiteConfig(),
          emailReady: emailReady(),
          guest: { enabled: !!guestConfig(), count: 8 },
          demo:
            !process.env.VERCEL &&
            process.env.NODE_ENV === "test" &&
            !!process.env.GSB_TEST_SCHEMA,
        });
      if (!account)
        bad(401, "login", "Sign in with your email to continue.");
      if (p[0] === "guest" && p.length === 2) {
        if (p[1] === "claim" && method === "POST")
          return sendJson(res, 200, { result: await claimGuestRun(db, req, account) });
        if (p[1] === "best" && method === "GET")
          return sendJson(res, 200, { result: await guestBest(db, account) });
      }
      if (p[0] === "auth" && p[1] === "logout" && method === "POST") {
        const raw = String(req.headers.cookie ?? "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(cookieName() + "="))
          ?.split("=")[1];
        if (raw)
          await db.query("delete from gsb_sessions where hash=$1", [hash(raw)]);
        sessionCookie(res, "");
        return sendJson(res, 200, { ok: true });
      }
      if (p[0] === "profile" && method === "POST") {
        const body = await readJsonBody(req, { maxBytes: 4096 });
        const nickname = await saveNickname(db, account.id, body.nickname);
        return sendJson(res, 200, { account: { ...account, nickname } });
      }
      if (p[0] === "deck" && method === "GET") {
        const deck = await latestDeck();
        return sendJson(res, 200, { revision: deck.id, cards: deck.cards });
      }
      if (p[0] === "learning" && method === "GET") {
        return sendJson(res,200,await faceSummary(db,account.id,await (deps.latestDeck ?? latestDeck)()));
      }
      if (p[0] === "progress" && method === "GET") {
        const [rows,[exposure]] = await Promise.all([
          db.query("select person_id,direction,doc from gsb_progress where account_id=$1",[account.id]),
          faceHistories(db,[account.id]),
        ]);
        return sendJson(res, 200, { progress: rows, exposure });
      }
      if (p[0] === "progress" && method === "POST") {
        await limit(`review:${account.id}`, 120);
        const b = await readJsonBody(req, { maxBytes: 4096 });
        if (
          !/^[a-zA-Z0-9-]{16,80}$/.test(b.id ?? "") ||
          !["face", "name"].includes(b.direction) ||
          typeof b.correct !== "boolean"
        )
          bad(400, "review", "That review is not valid.");
        const person = await db.query(
          "select id from gsb_people where id=$1 and not excluded",
          [String(b.personId ?? "")],
        );
        if (!person.length)
          bad(404, "person", "This card is no longer available.");
        const rows = await db.query(
          "select gsb_review($1,$2,$3,$4,$5,$6) as doc",
          [
            `${account.id}:${b.id}`,
            account.id,
            b.personId,
            b.direction,
            b.correct,
            Date.now(),
          ],
        );
        return sendJson(res, 200, { progress: rows[0].doc });
      }
      if (p[0] === "media" && p.length === 2 && method === "GET") {
        const rows = await db.query(
          "select a.path from gsb_assets a join gsb_people p on p.id=a.person_id where a.id=$1 and not p.excluded",
          [p[1]],
        );
        if (!rows.length)
          bad(404, "media", "This photo is no longer available.");
        await sendPortrait(rows[0].path, res, deps.getBlob);
        return;
      }
      if (p[0] === "leaderboard" && method === "GET") {
        const mode = /** @type {"race"|"together"} */ (["race", "together"].includes(q.mode)
            ? q.mode
            : "together"),
          direction = /** @type {"face"|"name"|"mixed"} */ (["face", "name", "mixed"].includes(q.direction)
            ? q.direction
            : "mixed");
        return sendJson(res, 200, await loadLeaderboard(db, mode, direction, account.id));
      }
      if (p[0] === "sprint" && p[1] === "challenge") {
        if (!account.nickname) bad(400, "nickname", "Choose a nickname before joining a challenge.");
        const deck = await (deps.latestDeck ?? latestDeck)();
        if (p.length === 2 && method === "POST") {
          await limit(`challenge-create:${account.id}`, 10, 3600000);
          const b = await readJsonBody(req, { maxBytes: 4096 });
          return sendJson(res, 201, await createChallenge(db, account, deck, b.direction, b.length, b.mode ?? "solo"));
        }
        if (p.length === 4 && p[3] === "join" && method === "POST") {
          await limit(`challenge-join:${account.id}`, 60, 3600000);
          return sendJson(res, 200, await joinChallenge(db, account, deck, p[2]));
        }
        // Duels: ready up, the host starts the count, progress is live, and a rematch follows the old code.
        if (p.length === 4 && p[3] === "ready" && method === "POST") {
          await limit(`challenge-ready:${account.id}`, 60, 3600000);
          return sendJson(res, 200, await readyChallenge(db, account, p[2], (await readJsonBody(req,{maxBytes:1024})).version));
        }
        if (p.length === 4 && p[3] === "begin" && method === "POST") {
          await limit(`challenge-begin:${account.id}`, 30, 3600000);
          return sendJson(res, 200, await beginChallenge(db, account, p[2], (await readJsonBody(req,{maxBytes:1024})).version));
        }
        if (p.length === 4 && p[3] === "progress" && method === "POST") {
          await limit(`challenge-progress:${account.id}`, 300, 60000);
          const b = await readJsonBody(req, { maxBytes: 1024 });
          return sendJson(res, 200, await progressChallenge(db, account, p[2], b.index, b.right));
        }
        if (p.length === 4 && p[3] === "rematch" && method === "POST") {
          await limit(`challenge-create:${account.id}`, 10, 3600000);
          return sendJson(res, 201, await rematchChallenge(db, account, deck, p[2]));
        }
        if (p.length === 3 && method === "GET") return sendJson(res, 200, await challengeView(db, p[2]));
      }
      if (p[0] === "sprint" && p.length === 2) {
        if (p[1] === "records" && method === "GET") {
          const deck = await (deps.latestDeck ?? latestDeck)();
          return sendJson(res, 200, await sprintRecords(db, account, deck, q.direction, q.length));
        }
        if (p[1] === "prepare" && method === "POST") {
          await limit(`sprint-prepare:${account.id}`, 20, 60000);
          const b = await readJsonBody(req, { maxBytes: 4096 });
          const deck = await (deps.latestDeck ?? latestDeck)();
          return sendJson(res, 200, await prepareSprint(db, account, deck, b.direction, b.length));
        }
        if (p[1] === "start" && method === "POST") {
          await limit(`sprint-start:${account.id}`, 40, 60000);
          const b = await readJsonBody(req, { maxBytes: 4096 });
          return sendJson(res, 200, await startSprint(db, account, b.id));
        }
        if (p[1] === "history" && method === "POST") {
          await limit(`sprint-history:${account.id}`,120,60000);
          const b = await readJsonBody(req,{maxBytes:8192});
          return sendJson(res,200,await checkpointSprint(db,account,b.id,b.answers,b.seen,b.epoch));
        }
        if (p[1] === "finish" && method === "POST") {
          await limit(`sprint-finish:${account.id}`, 40, 60000);
          const b = await readJsonBody(req, { maxBytes: 65536 });
          return sendJson(res, 200, await finishSprint(db, account, b.id, b.answers, b.elapsedMs,b.epoch));
        }
      }
      if (p[0] === "rooms") {
        if (!account.nickname)
          bad(400, "nickname", "Choose a nickname before joining a game.");
        const identity = roomIdentity(account);
        if (p.length === 1 && method === "POST") {
          await limit(`create:${account.id}`, 10, 3600000);
          const b = await readJsonBody(req, { maxBytes: 4096 });
          const created = await rooms.create({
            gameId: String(b.gameId),
            name: account.nickname,
            account,
          });
          return sendJson(
            res,
            201,
            await rooms.snapshot(created.code, identity),
          );
        }
        const code = String(p[1] ?? "").toUpperCase();
        if (!/^[A-Z]{4}$/.test(code))
          bad(404, "room", "Enter the four-letter room code.");
        if (p[2] === "join" && method === "POST") {
          await limit(`join:${account.id}`, 30, 3600000);
          await rooms.join(code, { name: account.nickname, account });
          return sendJson(res, 200, await rooms.snapshot(code, identity));
        }
        // ClassRooms checks membership inside every authoritative read/action, including CAS retries.
        if (p[2] === "actions" && method === "POST") {
          const b = await readJsonBody(req, { maxBytes: 8192 });
          if (!/^[A-Za-z0-9-]{8,64}$/.test(b.id ?? ""))
            bad(400, "action", "This action needs a valid identifier.");
          return sendJson(
            res,
            200,
            await rooms.act(code, identity, {
              ...b,
              id: `${account.id}:${b.id}`,
            }),
          );
        }
        if (method === "GET" && p.length === 2)
          return sendJson(res, 200, await rooms.snapshot(code, identity));
      }
      bad(404, "not_found", "That page is not available.");
    } catch (error) {
      const out = errorBody(error);
      sendJson(res, out.status, out.body);
    }
  };
}

// Both delivery paths share private Blob handling after their own authorization check.
async function sendPortrait(path, res, getBlob = get) {
  const blob = await getBlob(path, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN });
  if (!blob || blob.statusCode !== 200)
    bad(404, "media", "This photo could not be loaded.");
  const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Content-Length", bytes.length);
  res.end(bytes);
}
