// The page a shared link lands on, with a preview that says who is asking and for what. iMessage and the
// other chat apps fetch it without a session, so it carries a nickname and a code and nothing else about
// the class: no face, no classmate's name, no score. The visual title in the tab stays the game's name.
import { readFile } from "node:fs/promises";
import { siteMetadata } from "../../scripts/lib/site-metadata.js";
import { normalizeCode } from "../../public/shared/codes.js";

const SHELL = new URL("../../public/gsb/index.html", import.meta.url);
let shell = null;
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** What the preview should say for a link, or null for the plain page. */
export async function inviteFor(db, kind, code) {
  code = normalizeCode(code);
  if (!code) return null;
  if (kind === "speed") {
    const [row] = await db.query("select c.mode,c.count,a.nickname from gsb_sprint_challenges c join gsb_accounts a on a.id=c.host_id where c.code=$1 and c.expires_at>now()", [code]);
    if (!row || !row.nickname) return null;
    return {
      path: `/speed/${code}`,
      title: `Do you know your classmates better than ${row.nickname}?`,
      description: row.mode === "duel" ? `First to name all ${row.count} classmates wins.` : `The same ${row.count} classmates, whenever you like. Your turn.`,
    };
  }
  if (kind === "room") {
    const room = await db.store.getRoom(code);
    const host = room?.doc?.players?.find((p) => p.id === room.doc.hostId);
    if (!room || !host?.name || room.doc.phase === "over") return null;
    const race = room.doc.game?.config?.mode === "race";
    return { path: `/r/${code}`, title: `${host.name} started a ${race ? "race" : "quiz"}: room ${code}`, description: race ? "Twenty faces, first to finish wins." : "Ten shared questions. Jump in." };
  }
  return null;
}

/** The app shell with the preview tags for this link swapped in. */
export async function inviteShell(invite, env = process.env) {
  shell ??= siteMetadata(await readFile(SHELL, "utf8"), env);
  if (!invite) return shell;
  const origin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : "";
  const set = (source, key, value) => source.replace(new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*("\\s*/?>)`), (_, before, after) => before + escape(value) + after);
  let html = shell;
  for (const key of ["og:title", "twitter:title"]) html = set(html, key, invite.title);
  html = set(html, "og:description", invite.description);
  if (origin) html = set(html, "og:url", origin + invite.path);
  return html;
}
