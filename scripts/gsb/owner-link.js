// Explicit operator-only preview grant for the configured owner; no public route can issue these.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { database } from "../../server/gsb/db.js";
import { issueLink, stanfordEmail } from "../../server/gsb/auth.js";
if (process.env.VERCEL || process.env.GSB_TEST_SCHEMA)
  throw new Error("Run owner access locally against the real class database.");
const [origin, filename] = process.argv.slice(2);
if (!origin || !filename || !process.env.GSB_OWNER_EMAIL)
  throw new Error(
    "Set GSB_OWNER_EMAIL locally, then pass an origin and a private output filename.",
  );
process.env.APP_ORIGIN = origin;
const output = resolve(filename),
  root = resolve(".private");
if (!output.startsWith(root + "/"))
  throw new Error("Save the credential inside the ignored .private directory.");
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
const link = await issueLink(
  database(),
  stanfordEmail(process.env.GSB_OWNER_EMAIL),
  "owner-preview",
);
try {
  await writeFile(
    output,
    JSON.stringify({ url: link.url, expiresInMinutes: 15 }) + "\n",
    { mode: 0o600 },
  );
} catch (error) {
  await database().query("delete from gsb_links where hash=$1", [link.hash]);
  throw error;
}
console.log(
  `Private owner link saved to ${output}. It works once within 15 minutes; the preview session lasts 24 hours. No email was sent or marked verified.`,
);
