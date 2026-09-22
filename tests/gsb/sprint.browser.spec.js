// Real browser sprints prove tap-to-next rendering is independent of HTTP and records survive failed saves.
import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
test.use({ actionTimeout: 15000 });

async function login(page) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8::${randomUUID().slice(0, 8)}` });
  const email = `sprint-${randomUUID()}@stanford.edu`;
  await page.goto("/");
  await page.getByLabel("Your Stanford email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox." })).toBeVisible();
  const lines = (await readFile("/tmp/gsb-test-mail.jsonl", "utf8")).trim().split("\n").map(line => JSON.parse(line));
  await page.goto([...lines].reverse().find(line => line.email === email).url);
  await page.getByRole("button", { name: "Continue to Classmates" }).click();
  await page.getByLabel("Nickname", { exact: true }).fill("Speed learner");
  await page.getByRole("button", { name: "Save nickname" }).click();
  await expect(page.getByRole("button", { name: "10 classmates" })).toBeVisible();
  // The four-corner round these cases cover lives at its own path now; the home opens the two-door round.
  await page.goto("/speed/classic");
  await expect(page).toHaveURL(/\/speed\/classic$/);
}
// The screen prepares a round on its own as soon as it opens, and again shortly after a setting changes.
// Wait for the first round, then change to the requested direction (by way of another one when it is already
// selected) and hold the round that change prepares, so the test plays exactly the round it knows.
const preparedFor = (page, direction, length = "short") => page.waitForResponse(r => r.url().endsWith("/api/sprint/prepare") && r.ok()
  && r.request().postDataJSON()?.direction === direction && r.request().postDataJSON()?.length === length);
async function changeDirection(page, direction = "face") {
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  const match = page.getByRole("combobox", { name: "Match", exact: true });
  const prepared = preparedFor(page, direction);
  if (direction === "face") await match.selectOption("name");
  await match.selectOption(direction);
  return prepared;
}
async function prepare(page, direction = "face") {
  const round = await (await changeDirection(page, direction)).json();
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  await page.getByRole("button", { name: "Start the clock" }).click();
  await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", round.questions[0].id);
  return round;
}

test("setup avoids duplicate records reads and a superseded preparation cannot replace the new round",async({page})=>{
  const records=[];
  page.on('request',request=>{if(request.url().includes('/api/sprint/records'))records.push(request.url());});
  await login(page);
  await expect(page.getByRole('button',{name:'Start the clock'})).toBeVisible();
  let release=()=>{}, entered=()=>{};
  const held=new Promise(resolve=>{release=()=>resolve(undefined);});
  const intercepted=new Promise(resolve=>{entered=()=>resolve(undefined);});
  await page.route('**/api/sprint/prepare',async route=>{
    if(route.request().postDataJSON()?.direction!=='name')return route.continue();
    entered();await held;
    // A late failure from the cancelled request must not replace the working screen.
    await route.fulfill({status:503,contentType:'text/html',body:'Unavailable'}).catch(()=>{});
  });
  await page.getByRole('combobox',{name:'Match',exact:true}).selectOption('name');
  await intercepted;
  const fresh=preparedFor(page,'mixed');
  await page.getByRole('combobox',{name:'Match',exact:true}).selectOption('mixed');
  const round=await(await fresh).json();
  release();
  await expect(page.getByRole('button',{name:'Start the clock'})).toBeVisible();
  expect(records).toEqual([]);
  await page.getByRole('button',{name:'Start the clock'}).click();
  await expect(page.locator('.sprint-play')).toHaveAttribute('data-question-id',round.questions[0].id);
  await page.keyboard.press('1');
  await expect(page.locator('.sprint-play')).toHaveAttribute('data-question-id',round.questions[1].id);
});

test("twenty ready faces become two instant tens without preparing or fetching photos again", async ({ page, browserName }) => {
  await page.addInitScript(() => {
    const stats = window["sprintBlobs"] = { made: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); stats.made.push(url); return url; };
    URL.revokeObjectURL = url => { stats.revoked.push(url); revoke(url); };
  });
  const prepared = preparedFor(page, "face");
  await login(page);
  const full = await (await prepared).json();
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  const reloads = [], starts = [], errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => {
    if (/\/api\/sprint\/prepare|\/gsb\/fixture|\/api\/media/.test(r.url())) reloads.push(r.url());
    if (r.url().endsWith("/api/sprint/start")) starts.push(r.postDataJSON().id);
  });
  const latencies = [];
  for (const count of [10, 20, 10]) {
    latencies.push(await page.evaluate(count => new Promise(resolve => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if ([...document.querySelectorAll(".sprint-setup p")].some(p => p.textContent.startsWith(`${count} classmates are ready.`))) {
          observer.disconnect(); resolve(performance.now() - started);
        }
      });
      observer.observe(document.querySelector(".sprint-setup"), { subtree: true, childList: true, characterData: true });
      [...document.querySelectorAll("button")].find(b => b.textContent === `${count} classmates`).click();
    }), count));
    await expect(page.getByRole("button", { name: "Start the clock" })).toBeEnabled();
  }
  console.log(`${browserName} ready length changes (ms): ${latencies.join(", ")}`);
  expect(Math.max(...latencies)).toBeLessThan(100);
  for (const [i, segment] of full.segments.entries()) {
    await page.getByRole("button", { name: "Start the clock" }).click();
    for (const q of full.questions.slice(segment.offset, segment.offset + segment.count)) {
      await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", q.id);
      await expect(page.locator(".sprint-play .piece .portrait")).toBeVisible();
      await expect.poll(() => page.locator(".sprint-play .piece .portrait").evaluate(img => /** @type {HTMLImageElement} */(img).naturalWidth)).toBeGreaterThan(0);
      await page.keyboard.press(String(Number(q.correctChoice) + 1));
    }
    await expect(page.locator(".sprint-result")).toContainText("10 of 10 correct");
    await expect(page.getByText("Saved to your speed records.", { exact: true })).toBeVisible();
    if (i === 0) {
      // Allow the result-screen prefetch timer to run: it must use the remaining half.
      await page.waitForTimeout(500);
      expect(reloads).toEqual([]);
      const contrast = await page.evaluate(() => new Promise(resolve => {
        const observer = new MutationObserver(() => {
          const button = [...document.querySelectorAll(".sprint-setup button")].find(b => b.textContent === "Challenge classmates");
          if (!button) return;
          observer.disconnect();
          const style = getComputedStyle(button);
          // Read the first committed frame, before a background transition could finish.
          const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
            v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
          const a = luminance(style.color), b = luminance(style.backgroundColor);
          resolve((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
        });
        observer.observe(document.querySelector("#app"), { childList: true, subtree: true, characterData: true });
        [...document.querySelectorAll("button")].find(b => b.textContent === "Play again").click();
      }));
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      await expect(page.getByRole("button", { name: "Start the clock" })).toBeEnabled();
      await expect(page.getByText("No completed round yet", { exact: true })).toHaveCount(0);
      expect(reloads).toEqual([]);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await mkdir(`output/gsb-screenshots/${browserName}`, { recursive: true });
      await page.screenshot({ path: `output/gsb-screenshots/${browserName}/sprint-buffer-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
    }
  }
  expect(starts).toEqual(full.segments.map(s => s.id));
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Back to games", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const s = window["sprintBlobs"]; return s.made.length > 0 && s.made.every(url => s.revoked.includes(url));
  })).toBe(true);
});

test("length changes keep an in-flight twenty and a failed start retries the selected ten", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  let release = () => {}, entered = () => {}, releasePhotos = () => {};
  const held = new Promise(resolve => { release = () => resolve(undefined); });
  const intercepted = new Promise(resolve => { entered = () => resolve(undefined); });
  const heldPhotos = new Promise(resolve => { releasePhotos = () => resolve(undefined); });
  const requests = [], images = [], startIds = [];
  page.on("request", r => {
    if (r.url().endsWith("/api/sprint/prepare")) requests.push(r.postDataJSON());
    if (r.url().endsWith("/api/sprint/start")) startIds.push(r.postDataJSON().id);
  });
  await page.route("**/api/sprint/prepare", async route => {
    const response = await route.fetch(); entered(); await held;
    await route.fulfill({ response });
  });
  await page.route("**/gsb/fixture.svg?*", async route => {
    images.push(route.request().url()); await heldPhotos; await route.continue();
  });
  const prepared = preparedFor(page, "mixed");
  await page.getByRole("combobox", { name: "Match", exact: true }).selectOption("mixed");
  await intercepted;
  await page.getByRole("button", { name: "10 classmates", exact: true }).click();
  release();
  const full = await (await prepared).json();
  await expect.poll(() => images.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "20 classmates", exact: true }).click();
  await page.getByRole("button", { name: "10 classmates", exact: true }).click();
  releasePhotos();
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  expect(requests).toEqual([{ direction: "mixed", length: "short", choices: 4 }]);
  expect(new Set(images).size).toBe(images.length);
  await page.route("**/api/sprint/start", route => route.fulfill({ status: 503, json: { error: "Start failed. Please retry." } }), { times: 1 });
  await page.getByRole("button", { name: "Start the clock" }).click();
  await expect(page.getByRole("alert")).toContainText("Start failed");
  await page.getByRole("button", { name: "Start the clock" }).click();
  await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", full.questions[0].id);
  expect(startIds).toEqual([full.segments[0].id, full.segments[0].id]);
});

test("an HTML gateway error keeps a completed score retryable without leaking response markup",async({page})=>{
  await login(page);const round=await prepare(page);
  await page.route('**/api/sprint/finish',route=>route.fulfill({status:502,contentType:'text/html',body:'<h1>Gateway failed</h1>'}),{times:1});
  for(const q of round.questions){
    await expect(page.locator('.sprint-play')).toHaveAttribute('data-question-id',q.id);
    await page.keyboard.press(String(Number(q.correctChoice)+1));
  }
  await expect(page.getByText('The server could not respond. Please try again.',{exact:true})).toBeVisible();
  await expect(page.locator('.sprint-result')).toContainText('20 of 20 correct');
  await page.getByRole('button',{name:'Retry saving result'}).click();
  await expect(page.getByText('Saved to your speed records.',{exact:true})).toBeVisible();
});

test("continuous sprint has no inter-question HTTP, survives a failed save, and records a perfect time", async ({ page, browserName }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await login(page);
  const round = await prepare(page);
  expect(round.count).toBe(20);
  await mkdir(`output/gsb-screenshots/${browserName}`, { recursive: true });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/sprint-phone.png`, fullPage: true });
  const requests = [];
  const recordRequest = req => { if (/^http/.test(req.url())) requests.push(req.url()); };
  page.on("request", recordRequest);
  // Capture time from a real click event to the DOM committing the next question.
  await page.evaluate(() => {
    const state = window["sprintTiming"] = { clicked: 0, latencies: [] };
    document.querySelector(".sprint-play").addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest("button.answer")) state.clicked = performance.now();
    }, true);
    new MutationObserver(() => {
      if (state.clicked) { state.latencies.push(performance.now() - state.clicked); state.clicked = 0; }
    }).observe(document.querySelector(".sprint-play"), { attributes: true, attributeFilter: ["data-question-id"] });
  });
  await page.route("**/api/sprint/finish", route => route.abort("connectionfailed"), { times: 1 });
  for (let i = 0; i < round.count; i++) {
    await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", round.questions[i].id);
    await page.locator(".sprint-play .answer").nth(Number(round.questions[i].correctChoice)).click();
  }
  await expect(page.locator(".sprint-result")).toContainText("20 of 20 correct");
  page.off("request", recordRequest);
  await expect(page.getByRole("button", { name: "Retry saving result" })).toBeEnabled();
  expect(requests.filter(url => !url.endsWith("/api/sprint/finish"))).toEqual([]);
  const timings = await page.evaluate(() => window["sprintTiming"].latencies);
  expect(timings).toHaveLength(20); // Nineteen question changes, then immediate result rendering.
  expect(Math.max(...timings)).toBeLessThan(100);
  console.log(`${browserName} sprint tap-to-next max ${Math.max(...timings).toFixed(1)}ms`);
  // Reload retries the exact unsaved log, rather than requiring a replay or losing the result.
  await page.reload();
  await expect(page.getByText("Saved to your speed records.", { exact: true })).toBeVisible();
  await expect(page.locator(".sprint-records")).toContainText("Fastest 100%");
  const record = await (await page.request.get("/api/sprint/records?direction=face&length=short&choices=2")).json();
  expect(record.fastestPerfect.correct).toBe(20);
  expect(record.bestScore.score).toBeGreaterThanOrEqual(20000);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/sprint-result-desktop.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("name-to-face sprint preloads all choices, ignores held keys, and keeps imperfect runs out of perfect records", async ({ page }) => {
  await login(page);
  const round = await prepare(page, "name");
  const requests = [];
  const recordRequest = req => { if (/^http/.test(req.url())) requests.push(req.url()); };
  page.on("request", recordRequest);
  await page.keyboard.down("1");
  await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", round.questions[1].id);
  await page.keyboard.down("1"); // A held key repeats without a fresh physical press.
  await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", round.questions[1].id);
  await page.keyboard.up("1");
  for (let i = 1; i < round.count; i++) {
    const imgs = page.locator(".sprint-play .choice-photo");
    await expect(imgs).toHaveCount(4);
    await expect.poll(() => imgs.evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    const choice = i === 1 ? (Number(round.questions[i].correctChoice) + 1) % 4 : Number(round.questions[i].correctChoice);
    await page.keyboard.press(String(choice + 1));
    if (i < round.count - 1) await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", round.questions[i + 1].id);
  }
  await expect(page.locator(".sprint-result")).toBeVisible();
  page.off("request", recordRequest);
  await expect(page.getByText("Saved to your speed records.", { exact: true })).toBeVisible();
  const record = await (await page.request.get("/api/sprint/records?direction=name&length=short")).json();
  expect(record.fastestPerfect).toBeNull();
  expect(record.bestScore.correct).toBeLessThan(20);
  expect(requests.filter(url => /fixture|media/.test(url))).toEqual([]);
});

test("sprint cannot start with missing portraits and loading can be retried", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  await page.route("**/gsb/fixture.svg?*", route => route.abort(), { times: 1 });
  await page.getByRole("combobox", { name: "Match", exact: true }).selectOption("name");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start the clock" })).toHaveCount(0);
  // A failed prepare is not retried on its own; the button is back.
  await page.getByRole("button", { name: "Get 20 classmates ready" }).click();
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
});

test("an expired completed run offers a fresh round instead of a permanent save loop", async ({ page }) => {
  await login(page);
  const round = await (await changeDirection(page)).json();
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  await page.getByRole("button", { name: "10 classmates", exact: true }).click();
  await page.getByRole("button", { name: "Start the clock" }).click();
  await page.route("**/api/sprint/finish", route => route.fulfill({
    status: 410, contentType: "application/json",
    body: JSON.stringify({ code: "sprint_expired", error: "This sprint has expired." }),
  }), { times: 1 });
  for (const q of round.questions.slice(0, 10)) {
    await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", q.id);
    await page.locator(".sprint-play .answer").nth(Number(q.correctChoice)).click();
  }
  await expect(page.getByRole("button", { name: "Play again", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Retry saving result" })).toHaveCount(0);
  const fresh = preparedFor(page, "face", "quick");
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  expect((await (await fresh).json()).id).not.toBe(round.segments[1].id);
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  await page.reload();
  // A fresh round is prepared on its own after the rejected result is cleared.
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
});

test("held Enter cannot answer later questions and result focus is announced", async ({ page }) => {
  await login(page);
  const round = await prepare(page);
  await page.locator(".sprint-play .answer").first().focus();
  await page.keyboard.down("Enter");
  await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", round.questions[1].id);
  await page.keyboard.down("Enter");
  await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", round.questions[1].id);
  await page.keyboard.up("Enter");
  for (const q of round.questions.slice(1)) {
    await page.locator(".sprint-play .answer").nth(Number(q.correctChoice)).click();
  }
  await expect(page.locator(".sprint-result h1")).toBeFocused();
});

test("small-phone answer targets stay visible and still with long names in either direction", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await login(page);
  await page.route("**/api/sprint/prepare", async route => {
    const response = await route.fetch(), data = await response.json();
    for (const [i, q] of data.questions.entries()) {
      if (q.direction === "name") q.prompt = `Which face belongs to ${i % 2 ? "Alexandria Catherine Montgomery Williamson" : "Alex Li"}?`;
      else q.choices[0].label = "Alexandria Catherine Montgomery Williamson";
    }
    await route.fulfill({ response, json: data });
  });
  for (const direction of ["face", "name"]) {
    const round = await prepare(page, direction);
    const bounds = () => page.locator(".sprint-play .answer").evaluateAll(buttons => buttons.map(button => {
      const r = button.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
    }));
    const before = await bounds();
    if (direction === "face") {
      const labels = await page.locator(".answer.door .plate .pname").evaluateAll(names => names.map(name => {
        const text = name.getBoundingClientRect(), plate = name.parentElement.getBoundingClientRect();
        return {top:text.top,bottom:text.bottom,plateTop:plate.top,plateBottom:plate.bottom};
      }));
      for (const label of labels) { expect(label.top).toBeGreaterThanOrEqual(label.plateTop); expect(label.bottom).toBeLessThanOrEqual(label.plateBottom); }
    }
    for (const r of before) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(320);
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(568);
    }
    await page.locator(".sprint-play .answer").first().click();
    await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", round.questions[1].id);
    expect(await bounds()).toEqual(before);
    await expect(page.locator(".sprint-play .dealt")).toHaveCount(0);
    await mkdir(`output/gsb-screenshots/${browserName}`, { recursive: true });
    await page.screenshot({ path: `output/gsb-screenshots/${browserName}/sprint-narrow-${direction}.png` });
    await page.getByRole("button", { name: "Leave round" }).click();
    await page.goto("/speed/classic");
  }
});

test("leaving while photos load releases private media and a fresh round still works", async ({ page }) => {
  await page.addInitScript(() => {
    const stats = window["sprintBlobs"] = { made: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); stats.made.push(url); return url; };
    URL.revokeObjectURL = url => { stats.revoked.push(url); revoke(url); };
  });
  await login(page);
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  let release = () => {};
  const blocked = new Promise(resolve => { release = () => resolve(undefined); });
  let images = 0;
  await page.route("**/gsb/fixture.svg?*", async route => {
    if (++images > 6) await blocked;
    try { await route.continue(); } catch {} // Leaving the round intentionally cancels these requests.
  });
  await page.getByRole("combobox", { name: "Match", exact: true }).selectOption("name");
  await expect.poll(() => page.evaluate(() => window["sprintBlobs"].made.length)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Back to games", exact: true }).click();
  release();
  await expect.poll(() => page.evaluate(() => {
    const s = window["sprintBlobs"];
    return s.made.every(url => s.revoked.includes(url));
  })).toBe(true);
  await page.unroute("**/gsb/fixture.svg?*");
  await page.goto("/speed/classic");
  await prepare(page);
  await expect(page.locator(".sprint-play .portrait")).toBeVisible();
});

test("an offline round completes locally and saves after reconnecting", async ({ page, context }) => {
  await login(page);
  const round = await prepare(page);
  await context.setOffline(true);
  for (const q of round.questions) {
    await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", q.id);
    await page.locator(".sprint-play .answer").nth(Number(q.correctChoice)).click();
  }
  await expect(page.locator(".sprint-result")).toContainText("20 of 20 correct");
  await expect(page.getByRole("button", { name: "Retry saving result" })).toBeEnabled();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Retry saving result" }).click();
  await expect(page.getByText("Saved to your speed records.", { exact: true })).toBeVisible();
});

test("a ten-classmate round in both directions ends with a review, and the next round is ready before Play again", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  const prepared = preparedFor(page, "mixed", "quick");
  await page.getByRole("combobox", { name: "Match", exact: true }).selectOption("mixed");
  await page.getByRole("button", { name: "10 classmates", exact: true }).click();
  const round = await (await prepared).json();
  expect(round.count).toBe(10);
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  expect(new Set(round.questions.map(q => q.direction)).size).toBe(2);
  await page.getByRole("button", { name: "Start the clock" }).click();
  for (const [i, q] of round.questions.entries()) {
    await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", q.id);
    const choice = i === 0 ? (Number(q.correctChoice) + 1) % q.choices.length : Number(q.correctChoice);
    await page.locator(".sprint-play .answer").nth(choice).click();
  }
  await expect(page.locator(".sprint-result")).toContainText("9 of 10 correct");
  await expect(page.locator(".sprint-result .review h2.no")).toHaveText("Missed (1)");
  await expect(page.locator(".sprint-result .pair.no")).toHaveCount(1);
  await expect(page.locator(".sprint-result .pair.ok")).toHaveCount(9);
  await expect(page.locator(".sprint-result .pair img").first()).toBeVisible();
  await expect(page.getByText("Saved to your speed records.", { exact: true })).toBeVisible();
  const nextPrepare = page.waitForRequest(r => r.url().endsWith("/api/sprint/prepare"), { timeout: 5000 }).catch(() => null);
  await nextPrepare;
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole("button", { name: "Get 10 classmates ready" })).toHaveCount(0);
});

test("a speed challenge shares one round between two classmates and ranks them", async ({ page, browser }) => {
  await login(page);
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  const created = page.waitForResponse(r => r.url().endsWith("/api/sprint/challenge") && r.status() === 201);
  await page.getByRole("button", { name: "Challenge classmates" }).click();
  const challenge = await (await created).json();
  await expect(page).toHaveURL(new RegExp(`/speed/${challenge.code}$`));
  await expect(page.locator(".challenge-code")).toHaveText(challenge.code);
  await expect(page.locator(".challenge-standings li")).toHaveCount(1);
  // A second classmate opens the invite link and plays the same questions.
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await other.newPage();
  await login(guest);
  const joined = guest.waitForResponse(r => r.url().includes(`/api/sprint/challenge/${challenge.code}/join`) && r.ok());
  await guest.goto(`/speed/${challenge.code}`);
  const run = await (await joined).json();
  expect(run.questions.map(q => q.id)).toEqual(challenge.questions.map(q => q.id));
  await expect(page.locator(".challenge-standings li")).toHaveCount(2, { timeout: 10000 });
  await guest.getByRole("button", { name: "Start the clock" }).click();
  for (const [i, q] of run.questions.entries()) {
    await expect(guest.locator(".sprint-play")).toHaveAttribute("data-question-id", q.id);
    await guest.locator(".sprint-play .answer").nth(i === 0 ? (Number(q.correctChoice) + 1) % q.choices.length : Number(q.correctChoice)).click();
  }
  await expect(guest.locator(".sprint-result")).toContainText("19 of 20 correct");
  await expect(guest.getByText("Saved to your speed records.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start the clock" }).click();
  for (const q of challenge.questions) {
    await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", q.id);
    await page.locator(".sprint-play .answer").nth(Number(q.correctChoice)).click();
  }
  await expect(page.locator(".sprint-result")).toContainText("20 of 20 correct");
  await expect(page.getByText("Saved to your speed records.", { exact: true })).toBeVisible();
  const rows = page.locator(".sprint-result .challenge-standings li");
  await expect(rows).toHaveCount(2, { timeout: 10000 });
  await expect(rows.first()).toContainText("Speed learner");
  await expect(rows.first()).toHaveClass(/me/);
  await expect(guest.locator(".sprint-result .challenge-standings li").first()).not.toHaveClass(/me/, { timeout: 10000 });
  await other.close();
});

test("an invite link opened while signed out still ends at the challenge after sign-in and the nickname step", async ({ page, browser }) => {
  await login(page);
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  const created = page.waitForResponse(r => r.url().endsWith("/api/sprint/challenge") && r.status() === 201);
  await page.getByRole("button", { name: "Challenge classmates" }).click();
  const challenge = await (await created).json();
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await other.newPage();
  await guest.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8::${randomUUID().slice(0, 8)}` });
  const email = `invite-${randomUUID()}@stanford.edu`;
  await guest.goto(`/speed/${challenge.code}`);
  await expect(guest.locator(".notice", { hasText: "Sign in to join speed challenge" })).toContainText(challenge.code);
  await guest.getByLabel("Your Stanford email").fill(email);
  await guest.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(guest.getByRole("heading", { name: "Check your inbox." })).toBeVisible();
  const lines = (await readFile("/tmp/gsb-test-mail.jsonl", "utf8")).trim().split("\n").map(line => JSON.parse(line));
  // The sign-in link lands on /login, and the nickname step follows: the invite still wins at the end.
  await guest.goto([...lines].reverse().find(line => line.email === email).url);
  await guest.getByRole("button", { name: "Continue to Classmates" }).click();
  await guest.getByLabel("Nickname", { exact: true }).fill("Invited learner");
  await guest.getByRole("button", { name: "Save nickname" }).click();
  await expect(guest).toHaveURL(new RegExp(`/speed/${challenge.code}$`));
  await expect(guest.locator(".challenge-code")).toHaveText(challenge.code);
  await expect(guest.getByRole("button", { name: "Start the clock" })).toBeVisible();
  await expect(page.locator(".challenge-standings li")).toHaveCount(2, { timeout: 10000 });
  await other.close();
});

test("a duel starts both players on the host's count, shows the other's progress, and ranks them", async ({ page, browser }) => {
  await login(page);
  await page.goto("/speed");
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  const created = page.waitForResponse(r => r.url().endsWith("/api/sprint/challenge") && r.status() === 201);
  await page.getByRole("button", { name: "Challenge classmates" }).click();
  let duel = await (await created).json();
  expect(duel.mode).toBe("duel");
  expect(duel.questions.every(q => q.choices.length === 2)).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/speed/${duel.code}$`));
  await expect(page.getByRole("button", { name: "Start the count" })).toBeEnabled();
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await other.newPage();
  await login(guest);
  const joined = guest.waitForResponse(r=>r.url().endsWith(`/api/sprint/challenge/${duel.code}/join`) && r.ok());
  await guest.goto(`/speed/${duel.code}`);
  duel = await (await joined).json();
  await expect(guest.getByRole("button", { name: "I'm ready" })).toBeVisible();
  // The host cannot start while somebody who joined has not tapped Ready, on screen or over the wire.
  await expect(page.locator(".seats li")).toHaveCount(2, { timeout: 10000 });
  await expect(page.getByRole("button", { name: "Start the count" })).toBeDisabled();
  expect((await page.request.post(`/api/sprint/challenge/${duel.code}/begin`, { headers: { Origin: new URL(page.url()).origin }, data: {} })).status()).toBe(409);
  await guest.getByRole("button", { name: "I'm ready" }).click();
  await expect(page.getByText("is ready. The count is 3, 2, 1.")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Start the count" }).click();
  await expect(page.locator(".countdown")).toBeVisible();
  await expect(guest.locator(".countdown")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".sprint-play")).toBeVisible({ timeout: 8000 });
  await expect(guest.locator(".sprint-play")).toBeVisible({ timeout: 8000 });
  // The guest clears the ten; the host sees the row empty out and the lead line change.
  for (const q of duel.questions) {
    await expect(guest.locator(".sprint-play")).toHaveAttribute("data-question-id", q.id);
    await guest.locator(".sprint-play .answer").nth(Number(q.correctChoice)).click();
  }
  await expect(guest.locator(".sprint-result")).toContainText("10 of 10 correct");
  await expect(guest.getByText("Saved to your speed records.", { exact: true })).toBeVisible();
  await expect(page.locator(".lead")).toContainText("ahead", { timeout: 8000 });
  await expect(page.locator(".lane.them .head.gone")).toHaveCount(10, { timeout: 8000 });
  for (const [i, q] of duel.questions.entries()) {
    await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", q.id);
    await page.locator(".sprint-play .answer").nth(i === 0 ? 1 - Number(q.correctChoice) : Number(q.correctChoice)).click();
  }
  await expect(page.locator(".sprint-result")).toContainText("9 of 10 correct");
  await expect(page.getByText("Saved to your speed records.", { exact: true })).toBeVisible();
  await expect(page.locator(".sprint-result h1")).toContainText("takes it", { timeout: 10000 });
  await expect(page.locator(".versus li").first()).not.toHaveClass(/me/);
  await expect(page.locator(".versus li").nth(1)).toHaveClass(/me/);
  // The host's rematch is a new duel the other player can follow.
  const rematch = page.waitForResponse(r => r.url().endsWith("/rematch") && r.status() === 201);
  await page.getByRole("button", { name: "Rematch", exact: true }).click();
  const next = await (await rematch).json();
  await expect(page).toHaveURL(new RegExp(`/speed/${next.code}$`));
  await expect(guest.getByRole("button", { name: "Join the rematch" })).toBeVisible({ timeout: 10000 });
  await guest.getByRole("button", { name: "Join the rematch" }).click();
  await expect(guest).toHaveURL(new RegExp(`/speed/${next.code}$`));
  await expect(page.locator(".seats li")).toHaveCount(2, { timeout: 10000 });
  await other.close();
});


test("default two-door solo accepts arrows and keeps classic four-choice play selectable", async ({page}) => {
  await login(page);
  const round = await prepare(page);
  expect(round.choices).toBe(2);
  await expect(page.locator(".sprint-play .answer.door")).toHaveCount(2);
  await page.keyboard.press("3"); await page.keyboard.press("4");
  await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id",round.questions[0].id);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id",round.questions[1].id);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id",round.questions[2].id);
  await page.getByRole("button",{name:"Leave round"}).click();
  // The classic path opens on four choices of its own accord; its match setting shows that selected.
  const prepared = page.waitForResponse(r=>r.url().endsWith("/api/sprint/prepare") && r.ok() && r.request().postDataJSON()?.choices===4);
  await page.goto("/speed/classic");
  const classic = await (await prepared).json();
  await expect(page.getByRole("button",{name:"Start the clock"})).toBeVisible();
  await expect(page.getByRole("combobox",{name:"Match",exact:true})).toHaveValue("classic");
  expect(classic.choices).toBe(4);
  await page.getByRole("button",{name:"Start the clock"}).click();
  await expect(page.locator(".sprint-play .answer")).toHaveCount(4);
  await expect(page.locator(".sprint-play .answer.door")).toHaveCount(0);
  await page.keyboard.press("4");
  await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id",classic.questions[1].id);
});
