// Private GSB repository layered over Parlor's existing Neon room store.
import { neon } from "@neondatabase/serverless";
import { createNeonStore } from "../store/neon.js";
import { ranked } from "../../public/kits/recognition/kit.js";
import { PlatformError } from "../../public/shared/errors.js";
let instance;
/** Lazily bind the deployment's dedicated database; never fall back to memory on Vercel. */
export function database() {
  if (instance) return instance;
  if (!process.env.DATABASE_URL)
    throw new PlatformError(
      503,
      "configuration",
      "The private game database is not configured yet.",
    );
  const sql = neon(process.env.DATABASE_URL);
  const schema =
    !process.env.VERCEL && process.env.NODE_ENV === "test"
      ? process.env.GSB_TEST_SCHEMA
      : null;
  if (schema && !/^gsb_test_[a-z0-9_]+$/.test(schema))
    throw new Error("Invalid isolated test schema.");
  const query = (text, params = []) =>
    schema
      ? sql
          .transaction([
            sql.query(`set local search_path to ${schema}`),
            sql.query(text, params),
          ])
          .then((r) => r[1])
      : sql.query(text, params);
  const base = createNeonStore({ sql: { query } });
  const store = {
    ...base,
    async casRoom(code, v, doc) {
      const s = doc.s;
      const result =
        doc.phase === "over" && s
          ? {
              id: s.$seed,
              mode: s.mode,
              direction: doc.game.config.direction,
              revision: doc.game.content.decks[0],
              finishedAt: s.finishedAt ?? doc.updatedAt,
              void: s.void,
              results: ranked(s).map(
                ({ playerId, score, correct, rank, attempts, finishedAt }) => ({
                  playerId,
                  score,
                  correct,
                  rank,
                  attempts,
                  finishedAt,
                  elapsedMs:
                    finishedAt === null ? null : finishedAt - s.startedAt,
                }),
              ),
            }
          : null;
      const rows = await query(
        "select gsb_commit_room($1,$2,$3::jsonb,$4::jsonb) as v",
        [code, v, JSON.stringify(doc), result ? JSON.stringify(result) : null],
      );
      return rows[0].v === null ? null : Number(rows[0].v);
    },
  };
  instance = { query, store };
  return instance;
}
/** Immutable content revision with live exclusions applied on every use. */
export async function loadDecks(ids) {
  const { query } = database();
  const rows = await query(
    "select r.id,r.cards,array(select id from gsb_people where excluded=true) as excluded from gsb_revisions r where r.id=any($1::text[])",
    [ids],
  );
  return Object.fromEntries(rows.map((row) => [row.id, privateDeck(row)]));
}
// Keep exclusions in the same database snapshot as the revision, without a second network round trip.
function privateDeck(row) {
  const excluded = new Set(row.excluded);
  return {
    id: row.id,
    title: "MBA 2027",
    version: 1,
    cards: row.cards.filter((card) => !excluded.has(card.id)),
  };
}
/** Find the most recently imported cohort. */
export async function latestDeck() {
  const rows = await database().query(
    "select r.id,r.cards,array(select id from gsb_people where excluded=true) as excluded from gsb_revisions r order by created_at desc limit 1",
  );
  if (!rows.length)
    throw new PlatformError(
      503,
      "content_pending",
      "The class deck is being prepared. Please come back shortly.",
    );
  return privateDeck(rows[0]);
}
