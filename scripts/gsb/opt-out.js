// Operator-only exclusion. Exclusions survive content imports and are checked by every private media request.
import { database } from "../../server/gsb/db.js";
const [id, operation] = process.argv.slice(2);
if (!id || !["exclude", "restore"].includes(operation))
  throw new Error("Usage: opt-out.js <person-id> exclude|restore");
const rows = await database().query(
  "update gsb_people set excluded=$2 where id=$1 returning id,excluded",
  [id, operation === "exclude"],
);
if (!rows.length) throw new Error("No profile with that ID.");
console.log(JSON.stringify(rows[0]));
