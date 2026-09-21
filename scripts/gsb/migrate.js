// Apply the idempotent private-app schema to the linked, dedicated GSB database.
import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { database } from "../../server/gsb/db.js";
await database().store.init();
const sql =
  process.env.NODE_ENV === "test" &&
  process.env.GSB_TEST_SCHEMA &&
  !process.env.VERCEL
    ? { query: database().query }
    : neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
const base = await readFile(
  new URL("../../server/gsb/schema.sql", import.meta.url),
  "utf8",
);
const split = base.indexOf("-- This single transaction");
if (split < 0) throw new Error("Schema function boundary is missing.");
const source = base.slice(0, split) + "\n" + await readFile(new URL("../../server/gsb/face-history.sql", import.meta.url), "utf8") + "\n" + await readFile(new URL("../../server/gsb/challenge-lobby.sql", import.meta.url), "utf8") + "\n" + base.slice(split) + "\n" + await readFile(new URL("../../server/gsb/face-history-backfill.sql", import.meta.url), "utf8");
let statement = "",
  inside = false;
for (const line of source.split("\n")) {
  statement += line + "\n";
  if ((line.match(/\$\$/g) || []).length % 2) inside = !inside;
  if (!inside && line.trim().endsWith(";")) {
    await sql.query(statement);
    statement = "";
  }
}
console.log("GSB schema is ready.");
