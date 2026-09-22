// Provider contract tests enforce recipient binding and require verified email proof, not a decoded JWT.
import test from "node:test";
import assert from "node:assert/strict";
import {
  sendDescopeLink,
  verifyDescopeLink,
} from "../../server/gsb/descope.js";
import { loginLink } from "../../public/gsb/login-link.js";
import { requestLink, consumeLink, authenticate, hash, cookieName } from "../../server/gsb/auth.js";
import { loginEmail } from "../../server/gsb/login-email.js";
import { invitePath } from "../../public/gsb/invite-path.js";
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
test("email invitations survive both delivery adapters and refuse external destinations", async () => {
  for (const path of ["/speed/abcd", "/r/efgh"]) {
    let link;
    await requestLink({ query: async () => [] }, "person@stanford.edu", async (email, url) => { link = url; }, path);
    const credential = loginLink(link);
    assert.equal(credential.returnTo, invitePath(path));
    await sendDescopeLink("person@stanford.edu", link, async (url, init) => {
      const redirect = new URL(JSON.parse(init.body).redirectUrl);
      redirect.searchParams.set("t", "provider-proof");
      assert.deepEqual(loginLink(redirect.href), { ...credential, proof: "provider-proof" });
      return new Response("{}", { status: 200 });
    });
  }
  for (const path of ["https://evil.example", "//evil.example/r/ABCD", "/r/ABCD?next=evil", "/r/ABC", "/door/ABCDEF", "/r/ABCD/../profile", { path: "/r/ABCD" }]) {
    assert.equal(invitePath(path), null);
    assert.equal(loginLink(`https://classmates.example/login#token=x&returnTo=${encodeURIComponent(String(path))}`).returnTo, undefined);
    await requestLink({ query: async () => [] }, "person@stanford.edu", async (email, url) => {
      assert.equal(new URLSearchParams(new URL(url).hash.slice(1)).has("returnTo"), false);
    }, path);
  }
});
test("managed email sign-in and restored sessions expose the same verified access as other email providers", async t => {
  const secret = "a".repeat(43), email = "person@stanford.edu";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.descope.com/v1/auth/magiclink/verify");
    assert.deepEqual(JSON.parse(init.body), { token: "provider-proof" });
    return new Response(JSON.stringify({ user: { email, verifiedEmail: true } }), { status: 200 });
  });
  const account = { id: "managed-account", email, nickname: "", access: "descope" };
  const verified = await consumeLink({ query: async sql => sql.startsWith("select email,purpose")
    ? [{ email, purpose: "descope" }] : [account] }, secret, "provider-proof");
  assert.equal(verified.account.access, "email");
  assert.equal(account.access, "descope"); // The persisted provider purpose does not change.
  const req = { headers: { cookie: `${cookieName()}=${secret}` } };
  for (const access of ["descope", "email", "door", "owner-preview"])
    assert.equal((await authenticate({ query: async () => [{ ...account, access }] }, req)).access,
      access === "descope" ? "email" : access);
});


test("custom delivery and preview share the requested login copy, with safe HTML links", () => {
  const url = "https://classmates.example/login#token=test&returnTo=/speed/ABCD";
  const message = loginEmail(url);
  assert.equal(message.intro, "Click on the button below to log-in to the GSB faces game");
  assert.equal(message.button, "Log In Now");
  assert.ok(message.text.includes(url));
  assert.ok(message.html.includes("test&amp;returnTo="));
  assert.ok(loginEmail(url, "<Fork>").html.includes("&lt;Fork&gt;"));
  assert.throws(() => loginEmail("javascript:alert(1)"));
});
