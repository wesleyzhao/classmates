// Compile private manual portrait reviews into opaque peer IDs; publishing is explicit.
import { readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { database } from "../../server/gsb/db.js";
import { nameSimilarity } from "../../public/kits/recognition/name-similarity.js";
import {
  buildPortraitPeers,
  validatePortraitTuple,
} from "../../public/kits/recognition/portrait-similarity.js";

const args = new Set(process.argv.slice(2));
const publish = args.has("--publish");
const preview = args.has("--preview");
const root = new URL("../../.private/portrait-review/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", root), "utf8"),
);
if (!Array.isArray(manifest))
  throw new Error("Portrait manifest must be an array.");
const raw = {};
for (const part of [0, 1, 2]) {
  const entries = JSON.parse(
    await readFile(new URL(`part-${part}.json`, root), "utf8"),
  );
  if (!entries || Array.isArray(entries) || typeof entries !== "object")
    throw new Error(`Review part ${part} must be an object.`);
  for (const [key, value] of Object.entries(entries)) {
    if (Object.hasOwn(raw, key))
      throw new Error(`Duplicate review index ${key}.`);
    raw[key] = value;
  }
}
if (Object.keys(raw).length !== manifest.length)
  throw new Error(
    `Review coverage is ${Object.keys(raw).length}/${manifest.length}.`,
  );
const reviews = {};
const manifestIds = new Set();
for (const [position, item] of manifest.entries()) {
  if (item.index !== position || !/^[a-f0-9]{24}$/.test(item.id))
    throw new Error(`Unexpected manifest entry ${position}.`);
  if (manifestIds.has(item.id))
    throw new Error(`Duplicate manifest ID ${item.id}.`);
  manifestIds.add(item.id);
  await stat(item.path);
  const key = String(position).padStart(3, "0");
  reviews[item.id] = validatePortraitTuple(raw[key], key);
}
if (
  Object.keys(raw).some(
    (key) => !/^\d{3}$/.test(key) || Number(key) >= manifest.length,
  )
)
  throw new Error("Review contains an unexpected index or field schema.");

const rows = await database().query(
  "select id,cards from gsb_revisions order by created_at desc limit 1",
);
if (!rows.length) throw new Error("The class deck has not been imported.");
const deck = { id: rows[0].id, cards: rows[0].cards };
const ids = new Set(deck.cards.map((card) => card.id));
if (ids.size !== manifest.length || manifest.some((item) => !ids.has(item.id)))
  throw new Error("Manifest does not exactly match the current deck.");
for (const item of manifest) {
  const card = deck.cards.find((value) => value.id === item.id);
  const asset = String(card.image).match(
    /^\/api\/media\/([a-f0-9]{24})-([a-f0-9]{12})$/,
  );
  if (!asset || asset[1] !== item.id)
    throw new Error(`Unexpected media asset for ${item.id}.`);
  const localHash = createHash("sha256")
    .update(await readFile(item.path))
    .digest("hex")
    .slice(0, 12);
  if (localHash !== asset[2])
    throw new Error(`Local portrait hash mismatch for ${item.id}.`);
}
const peers = buildPortraitPeers(deck.cards, reviews, 16, nameSimilarity);
const cards = deck.cards.map((card) => ({
  ...card,
  portraitPeers: peers[card.id],
}));
const digest = createHash("sha256")
  .update(JSON.stringify(cards))
  .digest("hex")
  .slice(0, 16);
const revision = `${deck.id.replace(/-portraits-[a-f0-9]+$/, "")}-portraits-${digest}`;
if (publish) {
  await database().query(
    "insert into gsb_revisions(id,cards) values($1,$2::jsonb) on conflict do nothing",
    [revision, JSON.stringify(cards)],
  );
}
if (preview) {
  const selected = [0, 41, 66, 92, 144, 200, 288, 360];
  const byId = new Map(cards.map((card) => [card.id, card]));
  const output = Object.fromEntries(
    selected.map((index) => {
      const card = cards.find((value) => value.id === manifest[index]?.id);
      if (!card) throw new Error(`Preview index ${index} is unavailable.`);
      return [
        String(index).padStart(3, "0"),
        {
          id: card.id,
          name: card.answer,
          image: card.image,
          peers: card.portraitPeers.map((id) => {
            const peer = byId.get(id);
            return { id, name: peer.answer, image: peer.image };
          }),
        },
      ];
    }),
  );
  await writeFile(
    new URL("peer-preview.json", root),
    JSON.stringify(output, null, 2) + "\n",
    { mode: 0o600 },
  );
}
console.log(
  JSON.stringify({
    mode: publish ? "published" : "dry-run",
    revision,
    people: cards.length,
    peers: 16,
    annotationsStored: false,
    preview,
  }),
);
