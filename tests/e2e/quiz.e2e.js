// End to end: three phones play Flags of Europe. The host opens the game page and starts a room,
// two guests join with the code, the host shortens the game through the settings action, everyone
// answers every card, one guest reloads mid-game and lands back in the same round, a chat line
// travels between phones, and the results screen names a winner.
import { test, expect } from '@playwright/test';

const NAME_INPUT = '#name-input';

async function seat(page, name) {
  const input = page.locator(NAME_INPUT);
  await input.waitFor({ timeout: 5000 });
  await input.fill(name);
  await page.locator('.sheet button[type="submit"]').first().click();
}

/** Send a platform action from inside a page, using the seat it saved in localStorage. */
async function act(page, code, type, payload) {
  return page.evaluate(async ({ code, type, payload }) => {
    const saved = JSON.parse(localStorage.getItem(`parlor:room:${code}`) || '{}');
    const res = await fetch(`/api/rooms/${code}/act`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Player-Id': saved.playerId, 'X-Player-Secret': saved.secret },
      body: JSON.stringify({ id: `e2e-${Date.now()}-${Math.random()}`, type, payload }),
    });
    return res.status;
  }, { code, type, payload });
}

test('three phones play a short Flags of Europe, with a reload and a chat line', async ({ browser }) => {
  test.setTimeout(150_000);
  const host = await (await browser.newContext()).newPage();
  const nina = await (await browser.newContext()).newPage();
  const sam = await (await browser.newContext()).newPage();

  await host.goto('/g/flags-europe');
  await host.getByRole('button', { name: /start a room/i }).click();
  await seat(host, 'Ann');
  await host.waitForURL(/\/r\/[A-Z]{4}/);
  const code = host.url().match(/\/r\/([A-Z]{4})/)[1];
  await expect(host.getByText('At the table')).toBeVisible();

  /** @type {Array<[import('@playwright/test').Page, string]>} */
  const guests = [[nina, 'Nina'], [sam, 'Sam']];
  for (const [page, name] of guests) {
    await page.goto(`/r/${code}`);
    await seat(page, name);
    await expect(page.getByText('At the table')).toBeVisible();
  }
  await expect(host.locator('.list-row', { hasText: 'Sam' })).toBeVisible();

  expect(await act(host, code, 'room/settings', { config: { cards: 3, seconds: 8 } })).toBe(200);
  await host.getByRole('button', { name: /^start game$/i }).click();

  const pages = [host, nina, sam];
  for (let card = 1; card <= 3; card++) {
    for (const page of pages) {
      const choice = page.locator('.choices .choice:not([aria-disabled="true"])').first();
      await choice.waitFor({ timeout: 20_000 });
      await choice.click();
    }
    // Everyone answered, so the reveal comes early; the answer is now shown to all.
    await expect(host.locator('.choice.is-right')).toBeVisible({ timeout: 20_000 });
    if (card === 1) {
      await nina.reload();
      await expect(nina.locator('.choice.is-right, .choices .choice').first()).toBeVisible({ timeout: 20_000 });
    }
    if (card === 2) {
      await sam.getByRole('button', { name: /chat/i }).first().click();
      const box = sam.locator('.sheet .chat-compose input');
      await box.fill('This one is easy.');
      await box.press('Enter');
      await host.getByRole('button', { name: /chat/i }).first().click();
      await expect(host.locator('.sheet').getByText('This one is easy.')).toBeVisible({ timeout: 10_000 });
      // Close both sheets, or their backdrops swallow the next taps on the cards.
      for (const page of [host, sam]) {
        await page.locator('.sheet-backdrop').click({ position: { x: 10, y: 10 } });
        await expect(page.locator('.sheet')).toHaveCount(0);
      }
    }
    // The reveal moves on by itself after five seconds; wait for the next card before answering again.
    if (card < 3) await expect(host.getByText(`Card ${card + 1} of 3`)).toBeVisible({ timeout: 20_000 });
  }

  await expect(host.getByText(/wins|You win|tie/)).toBeVisible({ timeout: 30_000 });
  await expect(nina.getByText(/wins|You win|tie/)).toBeVisible({ timeout: 30_000 });
  await expect(host.getByRole('button', { name: /play again/i })).toBeVisible();
});
