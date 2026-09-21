// Synthetic-only guest preview harness; it cannot run on Vercel or use the real class schema.
import { startDevServer } from "../../server/dev.js";
import { createGsbHandler } from "../../server/gsb/router.js";
if (process.env.VERCEL || process.env.NODE_ENV !== "test" ||
  process.env.GSB_TEST_SCHEMA !== "gsb_test_guest")
  throw new Error("Guest preview tests require the isolated synthetic schema.");
await startDevServer({ port: 3139, handler: createGsbHandler({
  guestOptions: { mediaUrl: (card) => card.image },
}) });
console.log("Synthetic guest preview ready on localhost:3139.");
