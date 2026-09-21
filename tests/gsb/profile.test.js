// Nickname boundaries protect display names while preserving international text and account identity.
import test from "node:test";
import assert from "node:assert/strict";
import { defaultNickname, normalizeNickname, nicknameError, NICKNAME_MAX } from "../../public/gsb/profile.js";
import { saveNickname } from "../../server/gsb/profile.js";

test("email username defaults stay editable and do not guess a real name", () => {
  assert.equal(defaultNickname("test.learner@example.invalid"), "test.learner");
  assert.equal(defaultNickname("alex.jones@example.invalid"), "alex.jones");
  assert.equal(defaultNickname(`${"a".repeat(64)}@example.invalid`), "a".repeat(NICKNAME_MAX));
  assert.equal(defaultNickname("x@example.invalid"), "Classmate");
});

test("nickname validation counts Unicode characters and strips invisible controls", () => {
  assert.equal(normalizeNickname("  Jose\u0301  \u202e Jones\u0000  "), "José Jones");
  assert.equal(nicknameError("alexandra-finlay-jones"), "");
  assert.equal(nicknameError("🎓".repeat(48)), "");
  assert.ok(nicknameError("🎓".repeat(49)));
  assert.ok(nicknameError("\u202e a\u0000"));
});

test("invalid nicknames are rejected before any account or room write", async () => {
  const db = { query: async () => { throw new Error("Must not write"); } };
  for (const value of ["", "a", "a".repeat(49), "\u0000\u202e"])
    await assert.rejects(saveNickname(db, "account", value), { status: 400, code: "nickname" });
});
