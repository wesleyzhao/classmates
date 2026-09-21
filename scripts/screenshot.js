// Screenshot pages at fixed viewport sizes, for design review.
//   node scripts/screenshot.js <baseUrl> <outDir> <path>:<WxH>[:name] ...
//   node scripts/screenshot.js http://localhost:3000 test-results/shots /:390x844:home /r/ABCD:1280x800:lobby-desktop
// Uses Playwright's Chromium by default; BROWSER=webkit renders with WebKit, which is closest to iOS Safari
// (system fonts such as New York and SF Rounded only show there). Files land as <outDir>/<name>.png.
import { chromium, webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base, out, ...specs] = process.argv.slice(2);
if (!base || !out || !specs.length) {
  console.error('usage: node scripts/screenshot.js <baseUrl> <outDir> <path>:<WxH>[:name] ...');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch();
for (const spec of specs) {
  const [path, size, label] = spec.split(':');
  const [w, h] = size.split('x').map(Number);
  const name = label || path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  await ctx.close();
  console.log(`${name}.png`);
}
await browser.close();
