// Complete first-visit and cross-browser invitation stories with local delivery and the real authentication API.
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
const origin = "http://127.0.0.1:3141";
async function sendLink(page, email) {
  await page.getByLabel("Your Stanford email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox." })).toBeVisible();
  const inbox = await (await page.request.get("/api/preview/inbox")).json();
  return inbox.messages.find(message => message.email === email).url;
}
async function confirm(page, url, nickname) {
  await page.goto(url);
  await page.getByRole("button", { name: "Continue to Classmates" }).click();
  await page.getByLabel("Nickname", { exact: true }).fill(nickname);
  await page.getByRole("button", { name: "Save nickname" }).click();
}
test("preview starts at countdown, captures email, creates nickname, saves guest score, and resets independently", async ({ page, browserName }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // Cookies for localhost (other dev servers) must not be touched by this separate host.
  await page.context().addCookies([{ name: "gsb", value: "other-dev-session", domain: "localhost", path: "/" }]);
  await page.goto("/api/preview");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Start a fresh visitor" }).click();
  const game = await popup;
  game.on("pageerror", e => errors.push(e.message));
  await expect(game.getByRole("status", { name: "Starting in 3" })).toBeVisible();
  await expect(game.getByLabel("Nickname", { exact: true })).toHaveCount(0);
  await expect(game.getByRole("status", { name: "Starting in 2" })).toBeVisible();
  await expect(game.getByRole("status", { name: "Starting in 1" })).toBeVisible();
  await expect(game.locator(".guest-round")).toBeVisible();
  const round = await (await game.request.get("/api/guest")).json();
  expect(round.count).toBe(10);
  for (let i = 0; i < 10; i++) {
    await expect(game.getByText(`${i + 1} / 10`, { exact: true })).toBeVisible();
    await game.locator(".guest-round .answer").nth(Number(round.questions[i].correctChoice)).tap();
  }
  await expect(game.locator(".guest-result")).toContainText("10 of 10 correct");
  const email = (await page.locator("#identity").textContent()).replace("Use this new account: ", "");
  await sendLink(game, email);
  await page.getByRole("button", { name: "Refresh inbox" }).click();
  const message = page.locator("article").filter({ hasText: email });
  await expect(message).toContainText("Your Classmates sign-in link");
  await mkdir(`output/gsb-screenshots/${browserName}`, { recursive: true });
  await page.screenshot({ path: `output/gsb-screenshots/${browserName}/onboarding-inbox.png`, fullPage: true });
  const emailTab = page.context().waitForEvent("page");
  await message.getByRole("link", { name: "Sign in to Classmates" }).click();
  const signup = await emailTab;
  await signup.getByRole("button", { name: "Continue to Classmates" }).click();
  await expect(signup.getByLabel("Nickname", { exact: true })).toHaveValue(email.split("@")[0]);
  await expect(signup.locator("#nickname-help")).toContainText("Your nickname appears in games, chat, and scores. And you can change it anytime. Your email stays private.");
  await expect(signup.getByText("Your face history", { exact: true })).toHaveCount(0);
  await signup.screenshot({ path: `output/gsb-screenshots/${browserName}/onboarding-nickname-phone.png`, fullPage: true });
  await signup.setViewportSize({ width: 1365, height: 900 });
  await signup.screenshot({ path: `output/gsb-screenshots/${browserName}/onboarding-nickname-desktop.png`, fullPage: true });
  await signup.getByRole("button", { name: "Save nickname" }).click();
  await expect(signup.getByText(/Speed round saved:/)).toBeVisible();
  await expect(signup.getByRole("button", { name: "10 classmates", exact: true })).toHaveAttribute("aria-pressed", "true");
  await signup.close(); await game.close();
  const nextTab = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Start a fresh visitor" }).click();
  const next = await nextTab;
  await expect(next.getByRole("status", { name: "Starting in 3" })).toBeVisible();
  expect((await (await next.request.get("/api/session")).json()).account).toBeNull();
  expect((await page.context().cookies("http://localhost:3137")).find(cookie => cookie.name === "gsb").value).toBe("other-dev-session");
  expect(errors).toEqual([]);
});
for (const kind of ["duel", "room"]) test(`${kind} invitation survives email opened in another browser without a guest detour`, async ({ page, browser }) => {
  await page.goto("/login");
  await confirm(page, await sendLink(page, `host-${randomUUID()}@stanford.edu`), "Inviting classmate");
  await expect(page.getByRole("button", { name: "Start the clock" })).toBeVisible();
  const response = await page.request.post(kind === "duel" ? "/api/sprint/challenge" : "/api/rooms", {
    headers: { Origin: origin }, data: kind === "duel" ? { mode: "duel", direction: "face", length: "quick" } : { gameId: "together:face" },
  });
  expect(response.ok()).toBe(true);
  const created = await response.json(), code = kind === "duel" ? created.code : created.room.code;
  const path = `/${kind === "duel" ? "speed" : "r"}/${code}`;
  const inviteContext = await browser.newContext({ baseURL: origin });
  const invite = await inviteContext.newPage();
  await invite.goto(path);
  await expect(invite.locator(".notice", { hasText: "Sign in to join" })).toContainText(code);
  await expect(invite.getByRole("button", { name: "Try a 10-face speed round" })).toHaveCount(0);
  await expect(invite.getByRole("status", { name: /Starting in/ })).toHaveCount(0);
  const email = `invited-${randomUUID()}@stanford.edu`;
  const url = await sendLink(invite, email);
  await inviteContext.close();
  const emailContext = await browser.newContext({ baseURL: origin });
  const recipient = await emailContext.newPage();
  await recipient.goto(url);
  await expect(recipient.locator(".notice", { hasText: "Sign in to join" })).toContainText(code);
  await recipient.reload(); // The normalized credential still retains its destination.
  await recipient.getByRole("button", { name: "Continue to Classmates" }).click();
  await recipient.getByLabel("Nickname", { exact: true }).fill("New invited classmate");
  await recipient.reload(); // Nickname setup can be interrupted without losing the invite.
  await recipient.getByLabel("Nickname", { exact: true }).fill("New invited classmate");
  await recipient.getByRole("button", { name: "Save nickname" }).click();
  await expect(recipient).toHaveURL(origin + path);
  if (kind === "duel") await expect(recipient.getByRole("button", { name: "I'm ready" })).toBeVisible();
  else await expect(recipient.getByText("Waiting for Inviting classmate to start.", { exact: true })).toBeVisible();
  await expect(recipient.locator(".guest-round")).toHaveCount(0);
  await emailContext.close();
});
