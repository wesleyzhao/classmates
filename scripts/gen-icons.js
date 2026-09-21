// Render public/icon.svg to public/apple-touch-icon.png at 180x180.
//
//   node scripts/gen-icons.js
//
// iOS ignores SVG favicons when it saves a page to the home screen, so the one PNG has to
// exist as a file. Generating it from the same SVG (rather than drawing it twice) means the
// mark can only ever change in one place. Playwright's Chromium is already a dev dependency,
// so this costs no new packages. Run it again after editing icon.svg and commit the result.

import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SIZE = 180;
const source = fileURLToPath(new URL('../public/icon.svg', import.meta.url));
const target = fileURLToPath(new URL('../public/apple-touch-icon.png', import.meta.url));

const svg = await readFile(source, 'utf8');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
const page = await context.newPage();
// A data URL keeps the page origin-less: nothing external can load, so the render is the file alone.
await page.setContent(`<body style="margin:0">${svg}</body>`, { waitUntil: 'load' });
await page.waitForTimeout(150);   // give the font a moment to settle before the shot
const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
await browser.close();
await writeFile(target, png);
console.log(`apple-touch-icon.png (${SIZE}x${SIZE}, ${png.length} bytes)`);
