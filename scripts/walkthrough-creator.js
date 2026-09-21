// Walk the creator with a browser and screenshot each step: make a deck, then a quiz that uses
// it, publish, and look at "your games". For design review and a quick sanity check.
//   node scripts/walkthrough-creator.js http://127.0.0.1:3000 test-results/creator
import { chromium, webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:3000', out = 'test-results/creator'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
let n = 0;
const snap = async (name) => { n += 1; await page.screenshot({ path: `${out}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: true }); };

await page.goto(`${base}/decks/new`);
await page.getByLabel(/title/i).first().fill('Rivers of Europe');
await page.getByLabel(/description/i).first().fill('Three rivers, three cities.');
await snap('deck-empty');
await page.getByRole('button', { name: /paste cards/i }).click();
await page.locator('textarea').last().fill('Which river runs through Paris? | The Seine | The Loire; The Rhone; The Tiber\nWhich river runs through Rome? | The Tiber | The Po; The Arno; The Seine\nWhich river runs through Vienna? | The Danube | The Rhine; The Elbe; The Oder');
await page.getByRole('button', { name: /add these|add cards|import/i }).first().click().catch(() => {});
await snap('deck-cards');
await page.getByRole('button', { name: /publish deck/i }).click();
await page.getByText(/published/i).first().waitFor({ timeout: 10_000 });
await snap('deck-published');

await page.goto(`${base}/create`);
await snap('create-1');
await page.getByText('Quiz', { exact: true }).first().click();
await page.getByRole('button', { name: /next/i }).click();
await page.waitForTimeout(800);
await snap('create-2-decks');
await page.getByText('Rivers of Europe').first().click();
await snap('create-2-picked');
await page.getByRole('button', { name: /next/i }).click();
await page.waitForTimeout(500);
await page.getByLabel(/^title/i).first().fill('River quiz');
await page.getByLabel(/description/i).first().fill('Three rivers, one minute, no maps.');
await snap('create-3-settings');
await page.getByRole('button', { name: /next/i }).click();
await page.waitForTimeout(500);
await snap('create-4-publish');
await page.getByRole('button', { name: /publish game/i }).click();
await page.getByText(/edit link/i).first().waitFor({ timeout: 10_000 });
await snap('create-4-published');
await page.goto(`${base}/my`);
await page.waitForTimeout(500);
await snap('my-games');
console.log(`took ${n} pictures into ${out}`);
await browser.close();
