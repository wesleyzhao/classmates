// Phone and desktop stories use real HTTP, cookies, the Parlor service, and isolated Postgres rows.
import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
async function login(page, name) {
  const email = `gsb-${randomUUID()}@stanford.edu`;
  // Model separate clients on the local test server without weakening the production limiter.
  const network = randomUUID().replaceAll("-", "").slice(0, 24).match(/.{4}/g);
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": `2001:db8:${network.join(":")}`,
  });
  await page.goto("/");
  await page.getByLabel("Your Stanford email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox." }),
  ).toBeVisible();
  const lines = (await readFile("/tmp/gsb-test-mail.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const link = [...lines].reverse().find((l) => l.email === email);
  expect(link).toBeTruthy();
  await page.goto(link.url);
  await page.getByRole("button", { name: "Continue to Classmates" }).click();
  await expect(page.getByLabel("Nickname", { exact: true })).toHaveValue(email.split("@")[0]);
  if (name === null) return email;
  await page.getByLabel("Nickname", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save nickname" }).click();
  await expect(
    page.getByRole("heading", { name: "Names worth knowing." }),
  ).toBeVisible();
  return email;
}
async function snapshot(page, code) {
  return (await page.request.get(`/api/rooms/${code}`)).json();
}
/** The practice card on screen, whichever way round it is asked: who it is about and how to answer it. */
async function practiceCard(page, deck) {
  const prompt = page.locator(".question h2.prompt");
  await expect(page.locator(".question .answer")).toHaveCount(4);
  if (await prompt.count()) {
    const name = (await prompt.innerText()).trim();
    const target = deck.cards.find((card) => card.answer === name);
    const answers = page.locator(".question .answer");
    let right = -1;
    for (let i = 0; i < 4; i++)
      if ((await answers.nth(i).locator("img").getAttribute("data-source")) === target.image) right = i;
    expect(right).toBeGreaterThanOrEqual(0);
    return { target, direction: "name", right: answers.nth(right), wrong: answers.nth((right + 1) % 4) };
  }
  const image = await page.locator(".question img.portrait").getAttribute("data-source");
  const target = deck.cards.find((card) => card.image === image);
  return {
    target, direction: "face",
    right: page.getByRole("button", { name: target.answer, exact: true }),
    wrong: page.locator(".question .answer").filter({ hasNotText: target.answer }).first(),
  };
}
test("email defaults and discoverable nickname edits persist across rooms and reloads", async ({ page, browserName }) => {
  const email = await login(page, null);
  await expect(page.getByText("We started with your email username.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Your name", { exact: true })).toHaveCount(0);
  await mkdir(`output/gsb-screenshots/${browserName}`, { recursive: true });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/nickname-first-login.png`, fullPage: true });
  await page.getByRole("button", { name: "Save nickname" }).click();
  const initial = email.split("@")[0];
  await page.getByRole("button", { name: `Edit nickname for ${initial}`, exact: true }).click();
  const name = "alexandra-finlay-jones";
  const input = page.getByLabel("Nickname", { exact: true });
  await input.fill("x".repeat(49));
  expect(await input.evaluate((el) => el instanceof HTMLInputElement && el.checkValidity())).toBe(false);
  await input.fill(name);
  // A failed save must keep the editable draft and offer the same Save action again.
  await page.route("**/api/profile", route => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ code: "store_unavailable", error: "Try saving again." }),
  }), { times: 1 });
  await page.getByRole("button", { name: "Save nickname" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue(name);
  await page.getByRole("button", { name: "Save nickname" }).click();
  await expect(page.getByRole("heading", { name: "Names worth knowing." })).toBeVisible();
  const created = await page.request.post("/api/rooms", {
    headers: { Origin: "http://localhost:3138" }, data: { gameId: "together:mixed" },
  });
  expect(created.ok()).toBe(true);
  const room = await created.json();
  await page.goto(`/r/${room.room.code}`);
  await expect(page.locator(".players")).toContainText(name);
  const accountId = (await (await page.request.get("/api/session")).json()).account.id;
  await page.getByRole("button", { name: `Edit nickname for ${name}`, exact: true }).click();
  const renamed = "alexandra-finlay-jones-2027";
  await page.getByLabel("Nickname", { exact: true }).fill(renamed);
  await page.getByRole("button", { name: "Save nickname" }).click();
  await page.getByRole("button", { name: `Return to room ${room.room.code}` }).click();
  await expect(page.locator(".players")).toContainText(renamed);
  await page.getByRole("button", { name: `Edit nickname for ${renamed}`, exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Nickname", { exact: true })).toHaveValue(renamed);
  expect((await (await page.request.get("/api/session")).json()).account.id).toBe(accountId);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/nickname-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/nickname-desktop.png`, fullPage: true });
});
async function correct(page, code) {
  const s = await snapshot(page, code),
    q = s.view.question;
  const d = await (await page.request.get("/api/deck")).json();
  const c =
    q.direction === "face"
      ? q.choices.find(
          (c) => c.label === d.cards.find((c) => c.image === q.image).answer,
        )
      : q.choices.find(
          (c) =>
            c.image ===
            d.cards.find(
              (c) => q.prompt === `Which face belongs to ${c.answer}?`,
            ).image,
        );
  return { q, choice: c.id };
}
async function motion(page, beta, gamma, duration = 480) {
  await page.evaluate(
    async ({ beta, gamma, duration }) => {
      const end = performance.now() + duration;
      do {
        window.dispatchEvent(
          new DeviceOrientationEvent("deviceorientation", { beta, gamma }),
        );
        await new Promise((resolve) => setTimeout(resolve, 60));
      } while (performance.now() < end);
    },
    { beta, gamma, duration },
  );
}
test("used or expired email links have a direct recovery path", async ({
  page,
}) => {
  await page.goto(
    `/login?provider=descope&state=${"a".repeat(43)}&t=invalid-proof`,
  );
  await expect(page).toHaveURL(/\/login#token=/);
  await page.getByRole("button", { name: "Continue to Classmates" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "expired or was already used",
  );
  await page
    .getByRole("button", { name: "Request a new link", exact: true })
    .click();
  await expect(page.getByLabel("Your Stanford email")).toBeVisible();
  await expect(page).toHaveURL("http://localhost:3138/login");
  // Following a fragment-only link in the same tab must still open confirmation.
  await page.goto(`/login#token=${"b".repeat(43)}`);
  await expect(page.getByRole("button", { name: "Continue to Classmates" })).toBeVisible();
  expect((await page.request.get("/api/deck")).status()).toBe(401);
});
test("guest experiment is absent and inaccessible while disabled", async ({ page }) => {
  const loaded = [];
  page.on("request", (request) => loaded.push(request.url()));
  await page.goto("/?guest=true");
  await expect(page.getByLabel("Your Stanford email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try an 8-face speed round" })).toHaveCount(0);
  expect((await (await page.request.get("/api/session")).json()).guest.enabled).toBe(false);
  for (const path of ["/api/guest", "/api/guest/media/fixture-0", "/api/guest/best"])
    expect((await page.request.get(path)).status()).toBe(404);
  expect((await page.request.post("/api/guest/start", { headers: { Origin: "http://localhost:3138" }, data: {} })).status()).toBe(404);
  expect(loaded.some((url) => url.includes("guest-round.js"))).toBe(false);
});
test("GSB ranking badges show both ends of the full qualifying field", async ({ page, browserName }) => {
  await login(page, "Ranking viewer");
  await page.getByRole("button", { name: "Scores", exact: true }).click();
  await page.getByLabel("What would you like to practice?").selectOption("name");
  const rows = page.locator(".score-scroll tbody tr");
  await expect(rows).toHaveCount(10);
  await expect(rows.filter({ hasText: "Rank player 1" }).first()).toContainText("Arjay Miller Track");
  await expect(rows.filter({ hasText: "Rank player 10" })).toContainText("FOAM Stars");
  await mkdir(`output/gsb-screenshots/${browserName}`, { recursive: true });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/rankings-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/rankings-desktop.png`, fullPage: true });
});
test("simulated iPhone permission and four tilt directions reach actual answer controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class MotionEvent extends Event {
      beta;
      gamma;
      constructor(type, init) {
        super(type);
        this.beta = init.beta;
        this.gamma = init.gamma;
      }
      static async requestPermission() {
        document.documentElement.dataset.motionGesture = String(
          navigator.userActivation.isActive,
        );
        return "granted";
      }
    }
    Object.defineProperty(window, "DeviceOrientationEvent", {
      value: MotionEvent,
      configurable: true,
    });
  });
  await login(page, "Tilt learner");
  await page.getByRole("button", { name: "Practice the class deck" }).click();
  await page.getByRole("button", { name: "Use tilt controls" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-motion-gesture",
    "true",
  );
  const directions = [
    [40, -30],
    [40, 30],
    [10, 0],
    [70, 0],
  ];
  for (let i = 0; i < directions.length; i++) {
    await motion(page, 40, 0, 120);
    await motion(page, ...directions[i]);
    await expect(page.locator(".answer").nth(i)).toHaveAttribute(
      "data-picked",
      "true",
    );
    await page.getByRole("button", { name: "Next classmate" }).click();
    await motion(page, ...directions[i]);
    await expect(page.locator('.answer[data-picked="true"]')).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Turn off tilt" }).click();
  await motion(page, 40, 0, 120);
  await motion(page, 40, -30);
  await expect(page.locator('.answer[data-picked="true"]')).toHaveCount(0);
});
test("declined iPhone motion permission keeps tap input available", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "DeviceOrientationEvent", {
      value: { requestPermission: async () => "denied" },
      configurable: true,
    }),
  );
  await login(page, "Tap learner");
  await page.getByRole("button", { name: "Practice the class deck" }).click();
  await page.getByRole("button", { name: "Use tilt controls" }).click();
  await expect(
    page.getByText("Motion permission was declined. Tap answers instead.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.locator(".answer").first().click();
  await expect(page.locator(".answer").first()).toHaveAttribute(
    "data-picked",
    "true",
  );
});
test("magic links, private content, profile, whole-deck practice and desktop layout", async ({
  page,
  browserName,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  expect((await page.request.get("/api/deck")).status()).toBe(401);
  await login(page, "Test learner");
  expect(
    (
      await page.request.post("/api/profile", {
        headers: { Origin: "https://evil.invalid" },
        data: { nickname: "Hijack" },
      })
    ).status(),
  ).toBe(403);
  await page.getByRole("button", { name: "Practice the class deck" }).click();
  await expect(page.getByText("Card 1 of 24", { exact: true })).toBeVisible();
  await expect(page.locator("h2.prompt")).toHaveCount(0);
  const image = await page.locator("img.portrait").getAttribute("data-source"),
    d = await (await page.request.get("/api/deck")).json(),
    name = d.cards.find((c) => c.image === image).answer;
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next classmate" }).click();
  await expect(page.getByText("Card 2 of 24", { exact: true })).toBeVisible();
  // The second new card is asked the other way round: four faces under a name.
  await expect(page.locator(".choices img")).toHaveCount(4);
  await expect(page.locator("h2.prompt")).not.toContainText(
    "Which face belongs to",
  );
  await page.getByRole("button", { name: "Use tilt controls" }).click();
  await expect(page.locator(".tilt-help")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await mkdir(`output/gsb-screenshots/${browserName}`, { recursive: true });
  await page.screenshot({
    path: `output/gsb-screenshots/${browserName}/practice-phone.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({
    path: `output/gsb-screenshots/${browserName}/home-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit nickname for Test learner", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Your Stanford email")).toBeVisible();
  expect((await page.request.get("/api/deck")).status()).toBe(401);
  expect(errors).toEqual([]);
});
test("practice stays responsive while reviews save and retries keep one action ID", async ({
  page,
}) => {
  await login(page, "Queue learner");
  const ids = [];
  let calls = 0,
    releaseFirst = () => {};
  await page.route("**/api/progress", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    ids.push(route.request().postDataJSON().id);
    if (calls === 1)
      await new Promise((resolve) => {
        releaseFirst = () => resolve();
      });
    if (calls === 2) return route.abort("connectionfailed");
    return route.continue();
  });
  const deck = await (await page.request.get("/api/deck")).json();
  const answerCurrent = async () => {
    const portrait = page.locator(".question img.portrait");
    await expect(portrait).toBeVisible();
    const image = await portrait.getAttribute("data-source");
    const name = deck.cards.find((card) => card.image === image).answer;
    await page.getByRole("button", { name, exact: true }).click();
  };
  await page.getByRole("button", { name: "Practice the class deck" }).click();
  await answerCurrent();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  const next = page.getByRole("button", { name: "Next classmate" });
  await expect(next).toBeEnabled();
  await next.click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/progress") &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  releaseFirst();
  await saved;
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.getByText(/1 of 24 classmates reviewed/)).toBeVisible();
  await answerCurrent();
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  const retried = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/progress") &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Retry save" }).click();
  await retried;
  expect(ids[2]).toBe(ids[1]);
  await expect(page.getByText(/review still needs to save/)).toHaveCount(0);
});
test("practice remembers wrong answers through lost requests and reloads, then prioritizes them when due", async ({ page, browserName }) => {
  await login(page, "Missed-card learner");
  const deck = await (await page.request.get("/api/deck")).json();
  const account = (await (await page.request.get("/api/session")).json()).account.id;
  const storageKey = `gsb-practice-pending:${account}`;
  const missed = [];
  await page.getByRole("button", { name: "Practice the class deck" }).click();
  for (const committed of [false, true]) {
    /** @type {{id: string, personId: string, direction: string, correct: boolean}} */
    let original;
    await page.route("**/api/progress", async route => {
      if (route.request().method() !== "POST") return route.continue();
      original = route.request().postDataJSON();
      if (committed) expect((await route.fetch()).ok()).toBe(true);
      await route.abort("connectionfailed");
    });
    const portrait = page.locator(".question img.portrait");
    await expect(portrait).toBeVisible();
    const source = await portrait.getAttribute("data-source");
    const target = deck.cards.find(card => card.image === source);
    const choices = page.locator(".question .answer");
    await choices.filter({ hasNotText: target.answer }).first().click();
    await expect(page.getByText(`This is ${target.answer}.`, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
    expect(original.correct).toBe(false);
    missed.push(original.personId);
    expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key))[0].correct, storageKey)).toBe(false);
    if (!committed) {
      await mkdir(`output/gsb-screenshots/${browserName}`, { recursive: true });
      await page.screenshot({ path: `output/gsb-screenshots/${browserName}/practice-missed-phone.png`, fullPage: true });
      await page.setViewportSize({ width: 1365, height: 900 });
      await page.screenshot({ path: `output/gsb-screenshots/${browserName}/practice-missed-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.unroute("**/api/progress");
    const recovered = page.waitForResponse(response => response.url().endsWith("/api/progress") && response.request().method() === "POST" && response.ok());
    await page.reload();
    const response = await recovered;
    expect(response.request().postDataJSON()).toEqual(original);
    const progress = (await response.json()).progress;
    expect(progress.reviews).toBe(1);
    expect(progress.correct).toBe(0);
    expect(progress.stage).toBe(0);
    expect(progress.dueAt - progress.lastAt).toBe(60000);
    await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBeNull();
    await expect(page.getByText(new RegExp(`${missed.length} of 24 classmates reviewed`))).toBeVisible();
  }
  // Advancing only the client clock makes the saved one-minute due dates eligible without waiting.
  await page.addInitScript(() => { const realNow = Date.now.bind(Date); Date.now = () => realNow() + 61000; });
  await page.reload();
  await expect(page.getByText(/2 due now/)).toBeVisible();
  await expect(page.locator(".question img.portrait")).toHaveAttribute("data-source", deck.cards.find(card => card.id === missed[0]).image);
  const stored = (await (await page.request.get("/api/progress")).json()).progress;
  expect(stored).toHaveLength(2);
  expect(stored.every(row => row.direction === "both" && row.doc.reviews === 1 && row.doc.correct === 0 && row.doc.missed.face === 1)).toBe(true);
});
test("a missed classmate comes back a few cards later in the same session, the same way round", async ({ page }) => {
  await login(page, "Again learner");
  const deck = await (await page.request.get("/api/deck")).json();
  await page.getByRole("button", { name: "Practice the class deck" }).click();
  await expect(page.getByText("Card 1 of 24", { exact: true })).toBeVisible();
  const first = await practiceCard(page, deck);
  await first.wrong.click();
  await expect(page.getByText(`This is ${first.target.answer}.`, { exact: true })).toBeVisible();
  await expect(page.getByText("Card 1 of 25", { exact: true })).toBeVisible();
  for (let i = 2; i <= 6; i++) {
    await page.getByRole("button", { name: "Next classmate" }).click();
    await expect(page.getByText(`Card ${i} of 25`, { exact: true })).toBeVisible();
    const card = await practiceCard(page, deck);
    expect(card.target.id).not.toBe(first.target.id);
    await card.right.click();
    await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Next classmate" }).click();
  await expect(page.getByText("Card 7 of 25", { exact: true })).toBeVisible();
  await expect(page.getByText("Again", { exact: true })).toBeVisible();
  const again = await practiceCard(page, deck);
  expect(again.target.id).toBe(first.target.id);
  expect(again.direction).toBe(first.direction);
  await again.right.click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await expect(page.locator(".missing summary")).toContainText("Names you keep missing (1)");
  await page.locator(".missing summary").click();
  await expect(page.locator(".missing-list li")).toContainText(first.target.answer);
});

test("reverse practice preloads the next question's four portraits", async ({
  page,
}) => {
  const requestsAfterNext = [];
  page.on("request", (request) => requestsAfterNext.push(request.url()));
  await login(page, "Preload learner");
  const deck = await (await page.request.get("/api/deck")).json();
  await page.getByRole("button", { name: "Practice the class deck" }).click();
  await expect(page.getByText("Card 1 of 24", { exact: true })).toBeVisible();
  let previous = -1,
    stable = 0;
  for (let i = 0; i < 12 && stable < 2; i++) {
    await page.waitForTimeout(150);
    const count = await page.evaluate(
      () => performance.getEntriesByType("resource").length,
    );
    stable = count === previous ? stable + 1 : 0;
    previous = count;
  }
  const loadedBeforeNext = new Set(
    await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    ),
  );
  await (await practiceCard(page, deck)).right.click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  requestsAfterNext.length = 0;
  // The second card asks the other way round: its four faces were fetched while the first card was up.
  await page.getByRole("button", { name: "Next classmate" }).click();
  await expect(page.getByText("Card 2 of 24", { exact: true })).toBeVisible();
  await expect(page.locator(".choices img")).toHaveCount(4);
  const nextSources = await page.locator(".choices img").evaluateAll((images) =>
    images.map((image) => image.getAttribute("data-source")),
  );
  for (const source of nextSources) {
    expect(source).toBeTruthy();
    expect(
      [...loadedBeforeNext].some((url) => url.endsWith(source ?? "")),
    ).toBeTruthy();
    expect(
      requestsAfterNext.some((url) => url.endsWith(source ?? "")),
    ).toBeFalsy();
  }
});
test("two classmates join, chat, answer shared questions, and recover the same seat", async ({
  page,
  browser,
  browserName,
}) => {
  await login(page, "Player One");
  const other = await browser.newContext({
      baseURL: "http://localhost:3138",
      viewport: { width: 390, height: 844 },
    }),
    p2 = await other.newPage();
  await login(p2, "Player Two");
  await page.getByRole("button", { name: "Start a quiz" }).click();
  await expect(page.locator(".room-code")).toBeVisible();
  const code = (await page.locator(".room-code").innerText()).trim();
  await p2.goto(`/r/${code}`);
  await expect(
    p2.getByText("Waiting for Player One to start.", { exact: true }),
  ).toBeVisible();
  await page.getByText("Room chat", { exact: true }).click();
  await page.getByLabel("Chat message").fill("Hello from the table.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Hello from the table.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const before = await snapshot(page, code);
  expect(before.room.players).toHaveLength(2);
  expect(JSON.stringify(before)).not.toContain("_order");
  await expect(page.locator(".answer").first()).toBeEnabled();
  await expect(p2.locator(".answer").first()).toBeEnabled();
  const c = await correct(page, code);
  let releaseAnswer = () => {}, answerCaptured = false;
  await page.route(`**/api/rooms/${code}/actions`, async (route) => {
    if (route.request().postDataJSON().type === "answer")
      await new Promise((resolve) => {
        releaseAnswer = () => resolve(undefined);
        answerCaptured = true;
      });
    return route.continue();
  });
  await page.locator(".answer").nth(Number(c.choice)).click();
  await expect(page.locator(".answer").nth(Number(c.choice))).toHaveAttribute("data-picked", "true");
  await expect(page.getByText("Answer selected.", { exact: true })).toBeVisible();
  await expect.poll(() => answerCaptured).toBe(true);
  releaseAnswer();
  await expect(page.getByText(/Answer saved\./)).toBeVisible();
  await page.unroute(`**/api/rooms/${code}/actions`);
  const hidden = await snapshot(p2, code);
  expect(hidden.view.reveal).toBeNull();
  expect(hidden.view.standings.every((p) => p.score === 0)).toBeTruthy();
  await p2.locator(".answer").nth(Number(c.choice)).click();
  await expect(page.getByText(/Correct, \+/)).toBeVisible();
  await page.screenshot({
    path: `output/gsb-screenshots/${browserName}/together-phone.png`,
    fullPage: true,
  });
  await p2.reload();
  await expect(
    p2.getByText(`Room ${code} · Together`, { exact: true }),
  ).toBeVisible();
  expect((await snapshot(p2, code)).room.players).toHaveLength(2);
  const refused = await page.request.post(`/api/rooms/${code}/actions`, {
    headers: { Origin: "http://localhost:3138" },
    data: { id: randomUUID(), type: "room/undo" },
  });
  expect(refused.status()).toBe(403);
  await other.close();
});
test("race mistakes keep the player on the question and correct answers advance", async ({
  page,
  browserName,
}) => {
  await login(page, "Race tester");
  await page.getByRole("button", { name: "Start a race" }).click();
  const code = (await page.locator(".room-code").innerText()).trim();
  await page.getByRole("button", { name: "Start solo" }).click();
  await expect(page.locator(".answer").first()).toBeEnabled();
  const { choice, q } = await correct(page, code),
    wrong = (Number(choice) + 1) % 4;
  await page.locator(".answer").nth(wrong).click();
  await expect(
    page.getByText(
      "Try another answer. You need to get this one right to advance.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await snapshot(page, code)).view.question.id).toBe(q.id);
  await expect(page.locator(".answer").nth(Number(choice))).toBeEnabled();
  await page.locator(".answer").nth(Number(choice)).press(String(Number(choice) + 1));
  await expect(
    page.getByText("Question 2 of 20", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `output/gsb-screenshots/${browserName}/race-phone.png`,
    fullPage: true,
  });
});
test("the complete practice deck is reachable and saved, including on a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await login(page, "Deck learner");
  await page.getByRole("button", { name: "Practice the class deck" }).click();
  const deck = await (await page.request.get("/api/deck")).json(),
    seen = new Set();
  for (let i = 0; i < deck.cards.length; i++) {
    await expect(
      page.getByText(`Card ${i + 1} of 24`, { exact: true }),
    ).toBeVisible();
    const card = await practiceCard(page, deck);
    seen.add(card.target.id);
    await card.right.click();
    await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page
      .getByRole("button", {
        name: i === 23 ? "Finish this deck" : "Next classmate",
        exact: true,
      })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "You covered the whole deck." }),
  ).toBeVisible();
  await expect(page.getByText(/review.*saving/i)).toHaveCount(0);
  expect(seen.size).toBe(24);
  const progress = await (await page.request.get("/api/progress")).json();
  expect(progress.progress.filter((p) => p.direction === "both")).toHaveLength(
    24,
  );
  expect(new Set(progress.progress.map((p) => p.doc.lastDirection)).size).toBe(2);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Practice", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/24 of 24 classmates reviewed/)).toBeVisible();
});
