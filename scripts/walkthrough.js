// Drive a real game with two browsers and screenshot every step, for design review and for a
// quick end-to-end sanity check without the full Playwright suite.
//
//   node scripts/walkthrough.js http://127.0.0.1:3000 tally test-results/walkthrough
//   BROWSER=webkit node scripts/walkthrough.js http://127.0.0.1:3000 flags-world test-results/walkthrough
//
// Ann opens the game page and starts a room; Ben joins with the code; Ann starts the game. The
// script then presses whatever primary action the action bar offers, up to twenty times, taking
// a picture of both phones at each step. It does not know any game's rules, so it stops when
// nothing is offered; that is enough to see every screen the platform draws.

import { chromium, webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:3000', slug = 'tally', out = 'test-results/walkthrough'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
let shot = 0;
const snap = async (page, name) => { shot += 1; await page.screenshot({ path: `${out}/${String(shot).padStart(2, '0')}-${name}.png` }); };

async function seat(page, name) {
  const input = page.locator('#name-input');
  try { await input.waitFor({ timeout: 4000 }); } catch { return; } // this device already has a name
  await input.fill(name);
  await page.locator('.sheet button[type="submit"]').first().click();
}

const ann = await (await browser.newContext(phone)).newPage();
const ben = await (await browser.newContext(phone)).newPage();
await ann.goto(`${base}/g/${slug}`);
await snap(ann, 'game-page');
await ann.getByRole('button', { name: /start a room/i }).click();
await seat(ann, 'Ann');
await ann.waitForURL(/\/r\/[A-Z]{4}/);
const code = ann.url().match(/\/r\/([A-Z]{4})/)[1];
console.log('room', code);
await ann.waitForSelector('text=At the table');
await snap(ann, 'lobby-host');

await ben.goto(`${base}/r/${code}`);
await seat(ben, 'Ben');
await ben.waitForSelector('text=At the table');
await ann.waitForSelector('text=Ben');
await snap(ben, 'lobby-guest');
await snap(ann, 'lobby-host-two');

await ann.getByRole('button', { name: /^start game$/i }).click();
await ben.waitForSelector('text=At the table', { state: 'detached' });
await snap(ann, 'play-host');
await snap(ben, 'play-guest');

for (let i = 0; i < 20; i++) {
  const primary = ann.locator('.actionbar .btn-primary:not([disabled])').first();
  const benPrimary = ben.locator('.actionbar .btn-primary:not([disabled])').first();
  if (await primary.count()) { await primary.click(); await ann.waitForTimeout(400); }
  else if (await benPrimary.count()) { await benPrimary.click(); await ben.waitForTimeout(400); }
  else break;
  if (i % 3 === 2) { await snap(ann, `step-${i}-host`); await snap(ben, `step-${i}-guest`); }
  if (await ann.getByText(/wins|play again/i).count()) break;
}
await ann.waitForTimeout(1200);
await snap(ann, 'end-host');
await snap(ben, 'end-guest');
console.log(`took ${shot} pictures into ${out}`);
await browser.close();
