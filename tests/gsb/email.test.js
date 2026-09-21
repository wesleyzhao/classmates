// Provider contract tests enforce recipient binding and require verified email proof, not a decoded JWT.
import test from "node:test";
import assert from "node:assert/strict";
import {
  sendDescopeLink,
  verifyDescopeLink,
} from "../../server/gsb/descope.js";
import { loginLink } from "../../public/gsb/login-link.js";
import { requestLink, consumeLink, hash } from "../../server/gsb/auth.js";
process.env.DESCOPE_PROJECT_ID = "test-project";
process.env.APP_ORIGIN = "https://classmates.example";
test("provider sends to the entered recipient with the configured app challenge", async () => {
  await sendDescopeLink(
    "person@stanford.edu",
    "https://classmates.example/login#token=app-challenge",
    async (url, init) => {
      assert.equal(
        url,
        "https://api.descope.com/v1/auth/magiclink/signup-in/email",
      );
      const body = JSON.parse(init.body);
      assert.equal(body.loginId, "person@stanford.edu");
      const redirect = new URL(body.redirectUrl);
      assert.equal(redirect.origin, "https://classmates.example");
      assert.equal(redirect.searchParams.get("state"), "app-challenge");
      assert.equal(redirect.searchParams.get("provider"), "descope");
      return new Response("{}", { status: 200 });
    },
  );
});
test("provider proof must verify exactly the intended real email", async () => {
  const valid = {
    email: "person@stanford.edu",
    verifiedEmail: true,
    test: false,
  };
  const response = (user) => async () =>
    new Response(JSON.stringify({ user }), { status: 200 });
  await verifyDescopeLink("proof", "person@stanford.edu", response(valid));
  for (const user of [
    { ...valid, email: "other@stanford.edu" },
    { ...valid, verifiedEmail: false },
    { ...valid, test: true },
    {},
  ])
    await assert.rejects(
      verifyDescopeLink("proof", "person@stanford.edu", response(user)),
      /does not verify/,
    );
  await assert.rejects(
    verifyDescopeLink(null, "person@stanford.edu", response(valid)),
    /complete sign-in link/,
  );
});
test("a provider error fails closed without disclosing its response body", async () => {
  await assert.rejects(
    verifyDescopeLink(
      "proof",
      "person@stanford.edu",
      async () =>
        new Response('{"errorCode":"E_INVALID","private":"hidden"}', {
          status: 401,
        }),
    ),
    /expired or was already used/,
  );
  await assert.rejects(
    sendDescopeLink(
      "person@stanford.edu",
      "https://classmates.example/login#token=x",
      async () => {
        throw new Error("network secret");
      },
    ),
    /email service is unavailable/,
  );
});
test("email callbacks retain both proofs and fragments survive a reload", () => {
  assert.deepEqual(
    loginLink(
      "https://classmates.example/login?provider=descope&state=challenge&t=proof",
    ),
    { token: "challenge", proof: "proof" },
  );
  assert.deepEqual(
    loginLink("https://classmates.example/login#token=challenge&proof=proof"),
    { token: "challenge", proof: "proof" },
  );
  assert.deepEqual(loginLink("https://classmates.example/login#token=local"), {
    token: "local",
    proof: null,
  });
  assert.equal(loginLink("https://classmates.example/"), null);
});
test("the app challenge alone cannot consume a managed-email login", async () => {
  const secret = "a".repeat(43);
  let mutated = false;
  const db = {
    query: async (sql, params) => {
      assert.ok(sql.startsWith("select email,purpose"));
      assert.equal(params[0], hash(secret));
      if (!sql.startsWith("select")) mutated = true;
      return [{ email: "person@stanford.edu", purpose: "descope" }];
    },
  };
  await assert.rejects(consumeLink(db, secret), /complete sign-in link/);
  assert.equal(mutated, false);
});
test("failed delivery removes its pending app challenge", async () => {
  const sql = [];
  await assert.rejects(
    requestLink(
      {
        query: async (q) => {
          sql.push(q);
          return [];
        },
      },
      "person@stanford.edu",
      async () => {
        throw new Error("delivery failed");
      },
    ),
    /delivery failed/,
  );
  assert.equal(sql.length, 2);
  assert.ok(sql[1].startsWith("delete from gsb_links"));
});
