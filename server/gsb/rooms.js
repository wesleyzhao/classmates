// The GSB policy layer reuses Parlor rooms, chat, deadlines and CAS while fixing competitive seats.
import { RoomService } from "../rooms.js";
import { PlatformError } from "../../public/shared/errors.js";
import { roomIdentity } from "./auth.js";
import { latestDeck, loadDecks, database } from "./db.js";
import { NICKNAME_MAX } from "../../public/gsb/profile.js";
import { freshTargets } from "./face-history.js";
const allowed = new Set([
  "answer",
  "room/start",
  "room/hello",
  "room/away",
  "room/takeover",
  "chat/send",
  "chat/react",
]);
/** Construct the Parlor room service for account-backed recognition games. */
export function classRooms(store) {
  return new ClassRooms({
    store,
    nameMaxLength: NICKNAME_MAX,
    loadDecks,
    identity: (body) => roomIdentity(body.account),
    guard(doc, type) {
      if (type === "join") {
        if (doc.phase !== "lobby")
          throw new PlatformError(
            409,
            "started",
            "This game has started. Join the next game.",
          );
        return;
      }
      if (!allowed.has(type))
        throw new PlatformError(
          403,
          "fixed_rules",
          "This game uses fixed rules. Start a new room for another game.",
        );
    },
    loadGame: async (id) => {
      const [mode, direction] = id.split(":");
      if (
        !["together", "race"].includes(mode) ||
        !["face", "name", "mixed"].includes(direction)
      )
        return null;
      const deck = await latestDeck();
      return {
        id,
        slug: id,
        title: mode === "race" ? "Class race" : "Play together",
        description: "Recognize your classmates.",
        emoji: "🎓",
        kitId: "recognition",
        config: {
          mode,
          direction,
          cards: mode === "race" ? 20 : 10,
          distractors: "similar-portraits",
        },
        content: { decks: [deck.id] },
        theme: "editorial",
        accent: "red",
      };
    },
  });
}
class ClassRooms extends RoomService {
  async prepareSetup(doc, decks, ctx) {
    return { targets: await freshTargets(database(), doc.players.map(p => p.id).sort(),
      Object.values(decks).flatMap(d => d.cards),ctx.config.cards,ctx.rng) };
  }
  authenticate(doc, playerId, secret) {
    // Validate against the same room revision the action reads, avoiding a separate membership query.
    if (!doc.players.some((player) => player.id === playerId))
      throw new PlatformError(404, "room", "Join this room before opening it.");
    super.authenticate(doc, playerId, secret);
  }
  pushUndo() {} // Competitive state is never rewound; avoids copying private question sequences.
  runTicks(doc, kit, decks, now) {
    if (doc.phase === "playing" && doc.s) {
      const active = new Set(
        Object.values(decks).flatMap((d) => d.cards.map((c) => c.id)),
      );
      if (
        doc.s._order.some(
          (q) =>
            !active.has(q.target) || q.options.some((id) => !active.has(id)),
        )
      ) {
        doc.s = {
          ...doc.s,
          phase: "over",
          void: true,
          wakeAt: null,
          finishedAt: now,
        };
        doc.phase = "over";
        return;
      }
    }
    super.runTicks(doc, kit, decks, now);
  }
}
