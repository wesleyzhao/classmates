// Enabled guest flows use fictional people only; the ordinary suite proves the feature stays disabled.
import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8::${randomUUID().slice(0, 8)}` });
});
async function openRound(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try an 8-face speed round" }).click();
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
  expect(round.count).toBe(8);
  expect(round.questions).toHaveLength(8);
  expect(new Set(round.questions.map((q) => q.image)).size).toBe(8);
  expect((await page.request.get("/api/deck")).status()).toBe(401);
  await mkdir(`output/gsb-screenshots/${browserName}`, { recursive: true });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/guest-phone.png`, fullPage: true });
  for (let i = 0; i < round.count; i++) {
    await expect(page.getByText(`${i + 1} / 8`, { exact: true })).toBeVisible();
    const choice = i === 2 ? (Number(round.questions[i].correctChoice) + 1) % 4 : Number(round.questions[i].correctChoice);
    await page.locator(".guest-round .answer").nth(choice).click();
  }
  await expect(page.getByRole("button", { name: "Retry saving round" })).toBeVisible();
  await page.getByRole("button", { name: "Retry saving round" }).click();
  await expect(page.locator(".guest-result")).toContainText("7 of 8 correct");
  const completed = await (await page.request.get("/api/guest")).json();
  expect(completed.status).toBe("complete");
  expect(completed.result.score).toBeGreaterThanOrEqual(7000);
  await page.reload();
  await expect(page.locator(".guest-result")).toContainText("7 of 8 correct");
  const same = await (await page.request.post("/api/guest/start", { headers: { Origin: "http://localhost:3139" }, data: {} })).json();
  expect(same.id).toBe(round.id);
  expect(same.status).toBe("complete");
  expect((await page.request.post("/api/guest/claim", { headers: { Origin: "http://localhost:3139" }, data: {} })).status()).toBe(401);
  await page.getByRole("button", { name: "Sign in to save my score" }).click();
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
  await expect(page.getByText("2 / 8", { exact: true })).toBeVisible({ timeout: 11000 });
  const state = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`gsb-guest-attempt:${id}`)), round.id);
  expect(state.answers[0]).toEqual({ questionId: "0", choice: null, elapsedMs: 8000 });
  await page.reload();
  await expect(page.getByText("2 / 8", { exact: true })).toBeVisible();
  const resumed = await (await page.request.get("/api/guest")).json();
  expect(resumed.id).toBe(round.id);
  expect(resumed.questions.map((q) => q.image)).toEqual(round.questions.map((q) => q.image));
});
