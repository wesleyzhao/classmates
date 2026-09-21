// Create synthetic fixtures in an isolated Postgres schema, never in the production class ledger.
import { neon } from "@neondatabase/serverless";
import { database } from "../../server/gsb/db.js";
const schema = process.env.GSB_TEST_SCHEMA;
if (
  process.env.VERCEL ||
  process.env.NODE_ENV !== "test" ||
  !/^gsb_test_[a-z0-9_]+$/.test(schema ?? "")
)
  throw new Error("An isolated test schema is required.");
const sql = neon(process.env.DATABASE_URL);
await sql.query(`create schema if not exists ${schema}`);
await import("./migrate.js");
const { query } = database();
await query("delete from limits");
const cards = Array.from({ length: 24 }, (_, i) => ({
  id: `fixture-${i}`,
  prompt: "Recognize a fictional classmate.",
  answer: `Student ${String.fromCharCode(65 + i)}`,
  image: `/gsb/fixture.svg?person=${i}`,
}));
for (const card of cards)
  await query(
    "insert into gsb_people(id,name,blob_path,revision) values($1,$2,$3,$4) on conflict do nothing",
    [card.id, card.answer, "fixture", "fixture"],
  );
await query(
  "insert into gsb_revisions(id,cards) values($1,$2::jsonb) on conflict do nothing",
  ["synthetic-2027", JSON.stringify(cards)],
);
// A complete synthetic rating field exercises both percentile bands, separate from game-test accounts.
for (let i = 0; i < 10; i++) {
  const id = `ranking-fixture-${i}`;
  await query("insert into gsb_accounts(id,email,nickname) values($1,$2,$3) on conflict do nothing",
    [id, `${id}@stanford.edu`, `Rank player ${i + 1}`]);
  await query("insert into gsb_ratings(account_id,mode,rating,games,wins) values($1,'together:name',$2,10,1) on conflict(account_id,mode) do update set rating=excluded.rating,games=10",
    [id, 1500 - i * 50]);
  for (let j = 1; j <= 5; j++)
    await query("insert into gsb_opponents(account_id,opponent_id,mode,wins) values($1,$2,'together:name',1) on conflict do nothing",
      [id, `ranking-fixture-${(i + j) % 10}`]);
}
console.log(`Synthetic test schema ${schema} is ready.`);
