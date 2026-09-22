// Enabled guest flows use fictional people only; the ordinary suite proves the feature stays disabled.
import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8::${randomUUID().slice(0, 8)}` });
});
async function openRound(page) {
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Starting in 3" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Starting in 2" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Starting in 1" })).toBeVisible();
  await expect(page.locator(".guest-round img.portrait")).toBeVisible();
  return (await page.request.get("/api/guest")).json();
}
test("guest sprint finishes once, retries safely, and saves only after email sign-in", async ({ page, browserName }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let failFinish = true;
  await page.route("**/api/guest/finish", (route) => {
    if (failFinish) { failFinish = false; return route.abort("connectionfailed"); }
    return route.continue();
  });
  const round = await openRound(page);
  expect(round.count).toBe(10);
  expect(round.questions.every(q => q.choices.length === 2)).toBe(true);
  await expect(page.locator(".guest-round .answer.door")).toHaveCount(2);
  expect(round.questions).toHaveLength(10);
  expect(new Set(round.questions.map((q) => q.image)).size).toBe(10);
  expect((await page.request.get("/api/deck")).status()).toBe(401);
  await mkdir(`output/gsb-screenshots/${browserName}`, { recursive: true });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/guest-phone.png`, fullPage: true });
  for (let i = 0; i < round.count; i++) {
    await expect(page.getByText(`${i + 1} / 10`, { exact: true })).toBeVisible();
    const choice = i === 2 ? (Number(round.questions[i].correctChoice) + 1) % 2 : Number(round.questions[i].correctChoice);
    await page.locator(".guest-round .answer").nth(choice).tap();
  }
  await expect(page.getByRole("button", { name: "Retry saving round" })).toBeVisible();
  await page.getByRole("button", { name: "Retry saving round" }).click();
  await expect(page.locator(".guest-result")).toContainText("9 of 10 correct");
  const completed = await (await page.request.get("/api/guest")).json();
  expect(completed.status).toBe("complete");
  expect(completed.result.score).toBeGreaterThanOrEqual(9000);
  await page.reload();
  await expect(page.locator(".guest-result")).toContainText("9 of 10 correct");
  const same = await (await page.request.post("/api/guest/start", { headers: { Origin: "http://localhost:3139" }, data: {} })).json();
  expect(same.id).toBe(round.id);
  expect(same.status).toBe("complete");
  expect((await page.request.post("/api/guest/claim", { headers: { Origin: "http://localhost:3139" }, data: {} })).status()).toBe(401);
  await expect(page.getByRole("button", { name: "Play again", exact: true })).toHaveCount(0);
  await page.getByLabel("Your Stanford email").fill("fixture@unrelated.example");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.locator(".guest-result [role=alert]")).toContainText("stanford.edu");
  const email = `guest-${randomUUID()}@stanford.edu`;
  await page.getByLabel("Your Stanford email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox." })).toBeVisible();
  const messages = (await readFile("/tmp/gsb-guest-mail.jsonl", "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  await page.goto([...messages].reverse().find((message) => message.email === email).url);
  await page.getByRole("button", { name: "Continue to Classmates" }).click();
  await page.getByLabel("Nickname", { exact: true }).fill("Sprint learner");
  await page.getByRole("button", { name: "Save nickname" }).click();
  await expect(page.getByText(/Speed round saved:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "10 classmates", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "10 classmates", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Back to games", exact: true }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByRole("button", { name: "10 classmates", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Scores", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your speed round" })).toBeVisible();
  const best = await (await page.request.get("/api/guest/best")).json();
  expect(best.result.score).toBe(completed.result.score);
  expect((await (await page.request.get("/api/guest")).json()).claimed).toBe(true);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/guest-saved-desktop.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("guest timeout advances and refresh resumes the same bounded round", async ({ page }) => {
  const round = await openRound(page);
  await expect(page.getByText("2 / 10", { exact: true })).toBeVisible({ timeout: 11000 });
  const state = await page.evaluate((id) => JSON.parse(localStorage.getItem(`gsb-guest-attempt:${id}`)), round.id);
  expect(state.answers[0]).toEqual({ questionId: "0", choice: null, elapsedMs: 8000 });
  await page.reload();
  await expect(page.getByText("2 / 10", { exact: true })).toBeVisible();
  const resumed = await (await page.request.get("/api/guest")).json();
  expect(resumed.id).toBe(round.id);
  expect(resumed.questions.map((q) => q.image)).toEqual(round.questions.map((q) => q.image));
});

test("countdown overlaps preload; rapid taps have no network pauses and duplicate events count once", async ({ page, browserName }) => {
  let release = () => {};
  const held = new Promise(resolve => { release = () => resolve(undefined); });
  await page.route("**/gsb/fixture.svg?*", async route => { await held; await route.continue(); });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Starting in 3" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Starting in 2" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Starting in 1" })).toBeVisible();
  await page.waitForTimeout(1100);
  await expect(page.locator(".guest-round")).toHaveCount(0);
  await expect(page.locator(".guest-loading")).toHaveCount(0);
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/guest-countdown-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/guest-countdown-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const readyAt = Date.now();
  release();
  await expect(page.locator(".guest-round")).toHaveAttribute("data-question-id", "0");
  expect(Date.now() - readyAt).toBeLessThan(2000);
  const round = await (await page.request.get("/api/guest")).json();
  const requests = [];
  page.on("request", r => { if (/\/api\/|\/gsb\/fixture/.test(r.url())) requests.push(r.url()); });
  const latencies = [];
  for (let i = 0; i < 9; i++) {
    const q = round.questions[i];
    await expect(page.locator(".guest-round")).toHaveAttribute("data-question-id", q.id);
    await expect.poll(() => page.locator(".guest-round .piece img").evaluate(img => /** @type {HTMLImageElement} */(img).naturalWidth)).toBeGreaterThan(0);
    latencies.push(await page.evaluate(({ choice, next, finalChoice }) => new Promise(resolve => {
      const start = performance.now(), region = document.querySelector(".guest-round");
      const observer = new MutationObserver(() => {
        if (region.getAttribute("data-question-id") === next) {
          observer.disconnect(); resolve(performance.now() - start);
          // A key can arrive after DOM commit but before passive effects rebind handlers.
          if (finalChoice !== null) window.dispatchEvent(new KeyboardEvent('keydown', {key: String(Number(finalChoice) + 1), bubbles: true}));
        }
      });
      observer.observe(region, { attributes: true });
      const button = /** @type {HTMLButtonElement} */(document.querySelectorAll(".guest-round .answer")[Number(choice)]);
      button.click(); button.click();
    }), { choice: q.correctChoice, next: String(i + 1), finalChoice: i === 8 ? round.questions[9].correctChoice : null }));
  }
  expect(requests.filter(url => !url.endsWith("/api/guest/finish"))).toEqual([]);
  expect(Math.max(...latencies)).toBeLessThan(100);
  console.log(`${browserName} guest tap-to-next ms: ${latencies.join(", ")}`);
  await expect(page.locator(".guest-result")).toContainText("10 of 10 correct");
  expect(requests.filter(url => url.endsWith("/api/guest/finish"))).toHaveLength(1);
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/guest-result-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/guest-result-desktop.png`, fullPage: true });
});

test("guest entry shows the countdown while the round request is pending, without a start screen", async ({ page }) => {
  let release = () => {}, releaseSession = () => {};
  const held = new Promise(resolve => { release = () => resolve(undefined); });
  const sessionHeld = new Promise(resolve => { releaseSession = () => resolve(undefined); });
  await page.route("**/api/session", async route => { await sessionHeld; await route.continue(); });
  await page.route("**/api/guest/start", async route => { await held; await route.continue(); });
  await page.goto("/");
  await expect(page.locator(".sprint-opening")).toBeVisible();
  await expect(page.locator(".guest-countdown")).toHaveCount(0);
  releaseSession();
  await expect(page.getByRole("status", { name: "Starting in 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start the clock", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "10 classmates", exact: true })).toHaveCount(0);
  await expect(page.getByText("Meet ten classmates.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Loading your ten faces.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Starting in 2" })).toBeVisible();
  release();
  await expect(page.getByRole("status", { name: "Starting in 1" })).toBeVisible();
  await expect(page.locator(".guest-round")).toHaveAttribute("data-question-id", "0");
  await expect(page.getByText("1 / 10", { exact: true })).toBeVisible();
});

test("failed photo preparation retries the same guest run and releases its blobs on exit", async ({ page }) => {
  await page.addInitScript(() => {
    const stats = window["guestBlobs"] = { made: [], revoked: [] };
    const make = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = make(blob); stats.made.push(url); return url; };
    URL.revokeObjectURL = url => { stats.revoked.push(url); revoke(url); };
  });
  let failPhoto = true;
  await page.route("**/gsb/fixture.svg?*", route => {
    if (failPhoto) { failPhoto = false; return route.fulfill({ status: 503, body: "Unavailable" }); }
    return route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Retry loading" })).toBeVisible();
  const first = await (await page.request.get("/api/guest")).json();
  await page.getByRole("button", { name: "Retry loading" }).click();
  await expect(page.getByRole("status", { name: "Starting in 3" })).toBeVisible();
  const resumed = await (await page.request.get("/api/guest")).json();
  expect(resumed.id).toBe(first.id);
  await page.getByRole("button", { name: "Sign in instead" }).click();
  await expect(page.getByLabel("Your Stanford email")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window["guestBlobs"].made.every(url => window["guestBlobs"].revoked.includes(url)))).toBe(true);
});

test("login and invitation links bypass autoplay; an expired cookie requires sign-in", async ({ page }) => {
  let starts = 0;
  page.on("request", r => { if (r.url().endsWith("/api/guest/start")) starts++; });
  for (const path of ["/login", "/speed/ABCD", "/r/ABCD"]) {
    await page.goto(path);
    await expect(page.getByLabel("Your Stanford email")).toBeVisible();
    await expect(page.locator(".guest-countdown")).toHaveCount(0);
  }
  expect(starts).toBe(0);
  await page.route("**/api/guest/start", route => route.fulfill({ json: { status: "expired" } }));
  await page.goto("/");
  await expect(page.locator(".guest-result")).toContainText("Sign in to play another round.");
  await expect(page.getByLabel("Your Stanford email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry loading" })).toHaveCount(0);
});

test("a background countdown waits for visibility and held answer keys do not repeat", async ({ page }) => {
  await page.addInitScript(() => {
    window["guestHidden"] = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => window["guestHidden"] });
  });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Starting in 3" })).toBeVisible();
  await page.waitForTimeout(3200);
  await expect(page.locator(".guest-round")).toHaveCount(0);
  await page.evaluate(() => { window["guestHidden"] = false; document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("status", { name: "Starting in 3" })).toBeVisible();
  await expect(page.locator(".guest-round")).toHaveAttribute("data-question-id", "0");
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", repeat: true, bubbles: true })));
  await expect(page.locator(".guest-round")).toHaveAttribute("data-question-id", "0");
  await page.keyboard.press("1");
  await expect(page.locator(".guest-round")).toHaveAttribute("data-question-id", "1");
});


test("two doors accept left and right drops and arrow keys, ignoring unavailable choices", async ({ page, browserName }) => {
  const round = await openRound(page), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.screenshot({path:`output/gsb-screenshots/${browserName}/guest-two-doors-phone.png`,fullPage:true});
  await page.keyboard.press("3"); await page.keyboard.press("4");
  await expect(page.locator(".guest-round")).toHaveAttribute("data-question-id", "0");
  for (let i=0;i<2;i++) {
    const piece = await page.locator(".guest-round .piece .slot").boundingBox();
    const door = await page.locator(".guest-round .answer.door .slot").nth(i).boundingBox();
    await page.mouse.move(piece.x+piece.width/2,piece.y+piece.height/2);
    await page.mouse.down();
    await page.mouse.move(door.x+door.width/2,door.y+door.height/2,{steps:8});
    await page.mouse.up();
    await expect(page.locator(".guest-round")).toHaveAttribute("data-question-id",String(i+1));
  }
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".guest-round")).toHaveAttribute("data-question-id","3");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".guest-round")).toHaveAttribute("data-question-id","4");
  const state = await page.evaluate(id=>JSON.parse(localStorage.getItem(`gsb-guest-attempt:${id}`)),round.id);
  expect(state.answers.map(a=>a.choice)).toEqual(["0","1","0","1"]);
  await expect(page.locator(".guest-round .dealt")).toHaveCount(0);
  await page.setViewportSize({width:1365,height:900});
  await page.screenshot({path:`output/gsb-screenshots/${browserName}/guest-two-doors-desktop.png`,fullPage:true});
  expect(errors).toEqual([]);
});
