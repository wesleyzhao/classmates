// Mobile browser touch events exercise the same immediate speed controller without emulating a physical iPhone.
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("twenty mobile taps advance once each without zoom or portrait requests", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8::${randomUUID().slice(0, 8)}` });
  const email = `touch-${randomUUID()}@stanford.edu`;
  await page.goto("/");
  await page.getByLabel("Your Stanford email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox." })).toBeVisible();
  const mail = (await readFile("/tmp/gsb-test-mail.jsonl", "utf8")).trim().split("\n").map(line => JSON.parse(line));
  await page.goto([...mail].reverse().find(item => item.email === email).url);
  await page.getByRole("button", { name: "Continue to Classmates" }).click();
  await page.getByRole("button", { name: "Save nickname" }).click();
  // The speed screen prepares its round on its own; the response registered before opening it is the round played.
  const prepared = page.waitForResponse(r => r.url().endsWith("/api/sprint/prepare") && r.ok());
  await page.getByRole("button", { name: "20 classmates" }).tap();
  const round = await (await prepared).json();
  await page.getByRole("button", { name: "Start the clock" }).tap();
  const photos = [];
  const record = r => { if (/fixture|media/.test(r.url())) photos.push(r.url()); };
  page.on("request", record);
  for (const q of round.questions) {
    await expect(page.locator(".sprint-play")).toHaveAttribute("data-question-id", q.id);
    await page.locator(".sprint-play .answer").nth(Number(q.correctChoice)).tap();
  }
  await expect(page.locator(".sprint-result")).toContainText("20 of 20 correct");
  page.off("request", record);
  await expect(page.getByText("Saved to your speed records.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.visualViewport.scale)).toBe(1);
  expect(photos).toEqual([]);
});
