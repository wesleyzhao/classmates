// Operator maintenance removes expired credentials and bounded retry ledgers, while preserving match history.
import { database } from "../../server/gsb/db.js";
const { query, store } = database();
await query("delete from gsb_links where expires_at<now()");
await query("delete from gsb_sessions where expires_at<now()");
await query("delete from gsb_guest_runs where expires_at<now() and claimed_account_id is null");
await query(
  "delete from gsb_reviews where created_at<now()-interval '30 days'",
);
await query("delete from limits where window_start<now()-interval '2 days'");
console.log(
  JSON.stringify({
    cleaned: true,
    staleRooms: await store.deleteStaleRooms(30 * 86400000),
  }),
);
