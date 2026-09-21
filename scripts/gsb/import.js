// Explicit, minimal BrightCrowd importer. Source contact details and biographies never leave this process.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { put } from "@vercel/blob";
import { database } from "../../server/gsb/db.js";
const run = promisify(execFile),
  { query } = database();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const filename = process.argv[2];
if (!filename) throw new Error("Pass the local MBA 2027 JSONL path.");
const rows = (await readFile(filename, "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
await mkdir(".private/portraits", { recursive: true });
const cards = [];
let done = 0;
for (let offset = 0; offset < rows.length; offset += 4) {
  await Promise.all(
    rows.slice(offset, offset + 4).map(async (row) => {
      if (!row.name || !row.photo_url || !row.profile_url)
        throw new Error("A roster row is incomplete.");
      const source = new URL(row.photo_url);
      if (
        source.protocol !== "https:" ||
        source.hostname !== "stanford.brightcrowd.com"
      )
        throw new Error("Unexpected photo source.");
      const id = hash(row.profile_url).slice(0, 24),
        name = String(row.name).trim();
      const cached = await query(
        "select name,blob_path,revision from gsb_people where id=$1",
        [id],
      );
      let assetId = cached[0]?.revision;
      if (!assetId) {
        const response = await fetch(source, {
          signal: AbortSignal.timeout(30000),
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.startsWith("image/")
        )
          throw new Error(
            `Photo download failed for ${id}: ${response.status}`,
          );
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 10 * 1024 * 1024)
          throw new Error("Photo exceeded size limit.");
        const path = `.private/portraits/${id}.jpg`;
        await writeFile(path, bytes);
        await run("/usr/bin/sips", [
          "-Z",
          "480",
          "-s",
          "format",
          "jpeg",
          "-s",
          "formatOptions",
          "75",
          path,
          "--out",
          path,
        ]);
        const optimized = await readFile(path);
        assetId = `${id}-${hash(optimized).slice(0, 12)}`;
        const blob = await put(`portraits/${assetId}.jpg`, optimized, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "image/jpeg",
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        await query(
          "insert into gsb_people(id,name,blob_path,revision) values($1,$2,$3,$4) on conflict(id) do update set name=excluded.name,blob_path=excluded.blob_path,revision=excluded.revision",
          [id, name, blob.pathname, assetId],
        );
        await query(
          "insert into gsb_assets(id,person_id,path) values($1,$2,$3) on conflict do nothing",
          [assetId, id, blob.pathname],
        );
      } else if (cached[0].name !== name)
        await query("update gsb_people set name=$2 where id=$1", [id, name]);
      cards.push({
        id,
        prompt: "Recognize a classmate.",
        answer: name,
        image: `/api/media/${assetId}`,
      });
      done++;
    }),
  );
  if (done % 40 === 0 || done === rows.length)
    console.log(`Imported ${done}/${rows.length} portraits.`);
}
cards.sort((a, b) => a.id.localeCompare(b.id));
const revision = `mba2027-${hash(JSON.stringify(cards)).slice(0, 16)}`;
await query(
  "insert into gsb_revisions(id,cards) values($1,$2::jsonb) on conflict do nothing",
  [revision, JSON.stringify(cards)],
);
console.log(
  JSON.stringify({
    revision,
    people: cards.length,
    content: "Names and private portraits only.",
  }),
);
