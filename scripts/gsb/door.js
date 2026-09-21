// The test door: let people in without a Stanford email while it is open, and shut it in one command.
//   npm run gsb:door -- open            prints the link to hand out
//   npm run gsb:door -- close           shuts it and signs every door account out at once
//   npm run gsb:door -- close --purge   also deletes the door accounts and everything they scored
//   npm run gsb:door -- status
import { database } from "../../server/gsb/db.js";
import { appOrigin, closeDoorSwitch, doorAccounts, doorState, openDoorSwitch } from "../../server/gsb/auth.js";
if (process.env.VERCEL) throw new Error("Run the door locally against the class database.");
const [command = "status", ...flags] = process.argv.slice(2);
const origin = (flags.find((f) => f.startsWith("--origin=")) || "").slice(9) || process.env.GSB_DOOR_ORIGIN || appOrigin();
const db = database();
const link = (code) => `${origin}/door/${code}`;
if (command === "open") {
  const current = await doorState(db);
  const code = await openDoorSwitch(db, current?.code ?? null);
  console.log(`${current ? "The door is already open" : "The door is open"}. Hand out this link:\n\n  ${link(code)}\n\nAnyone who opens it gets a week-long session with no email. Close it with: npm run gsb:door -- close`);
} else if (command === "close") {
  const people = await doorAccounts(db);
  const ended = await closeDoorSwitch(db);
  let purged = "";
  if (flags.includes("--purge") && people.length) {
    const ids = people.map((p) => p.id);
    await db.query("delete from gsb_sessions where account_id=any($1::text[])", [ids]);
    await db.query("delete from gsb_sprint_runs where account_id=any($1::text[]) or challenge_code in (select code from gsb_sprint_challenges where host_id=any($1::text[]))", [ids]);
    await db.query("delete from gsb_sprint_challenges where host_id=any($1::text[])", [ids]);
    await db.query("delete from gsb_progress where account_id=any($1::text[])", [ids]);
    await db.query("delete from gsb_reviews where account_id=any($1::text[])", [ids]);
    await db.query("delete from gsb_ratings where account_id=any($1::text[])", [ids]);
    await db.query("delete from gsb_opponents where account_id=any($1::text[]) or opponent_id=any($1::text[])", [ids]);
    await db.query("delete from gsb_pair_days where low_id=any($1::text[]) or high_id=any($1::text[])", [ids]);
    await db.query("update gsb_guest_runs set claimed_account_id=null where claimed_account_id=any($1::text[])", [ids]);
    await db.query("delete from gsb_accounts where id=any($1::text[])", [ids]);
    purged = ` ${people.length} door ${people.length === 1 ? "account" : "accounts"} and their scores were deleted.`;
  }
  console.log(`The door is closed. ${ended} ${ended === 1 ? "session" : "sessions"} ended.${purged}${!flags.includes("--purge") && people.length ? ` ${people.length} door ${people.length === 1 ? "account remains" : "accounts remain"} in the standings; run close --purge to remove them.` : ""}`);
} else if (command === "status") {
  const current = await doorState(db), people = await doorAccounts(db);
  console.log(current
    ? `The door is open since ${new Date(current.openedAt).toLocaleString()}: ${link(current.code)}\n${people.length} door ${people.length === 1 ? "account" : "accounts"} so far${people.length ? ": " + people.map((p) => p.nickname || "(no nickname yet)").join(", ") : ""}.`
    : `The door is closed.${people.length ? ` ${people.length} door ${people.length === 1 ? "account remains" : "accounts remain"} from earlier; close --purge removes them.` : ""}`);
} else {
  throw new Error("Use open, close, close --purge, or status.");
}
