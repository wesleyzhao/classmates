// Two phones in a lobby and then a card: a line typed on one shows up on the other as a
// floating notice that opens the chat when tapped, never for your own lines, and goes away
// on its own, and the chat button in the top bar counts it until the chat is opened. The
// noise that goes with it cannot be heard from here; the notice and the badge can be seen.
import { test, expect } from '@playwright/test';

test('a chat line pops up on the other phone and opens the chat', async ({ browser }) => {
  const phone = { viewport: { width: 390, height: 844 } };
  const host = await (await browser.newContext(phone)).newPage();
  await host.goto('/g/flags-world');
  await host.getByRole('button', { name: 'Start a room' }).click();
  await host.locator('#name-input').fill('Ana');
  await host.getByRole('button', { name: 'Start the room' }).click();
  await host.waitForURL(/\/r\/[A-Z]{4}/);
  const code = host.url().split('/r/')[1];

  const guest = await (await browser.newContext(phone)).newPage();
  await guest.goto(`/r/${code}`);
  await guest.locator('#name-input').fill('Bo');
  await guest.getByRole('button', { name: 'Join the room' }).click();
  await expect(host.getByText('Bo', { exact: true })).toBeVisible();

  // Bo says something; Ana sees it float in, taps it, and finds the chat open on that line.
  await guest.getByRole('button', { name: /chat/i }).first().click();
  const box = guest.locator('.sheet .chat-compose input');
  await box.fill('Starting in a minute, waiting for Cy.');
  await box.press('Enter');
  const peek = host.locator('.chat-peek');
  await expect(peek).toBeVisible({ timeout: 6000 });
  await expect(peek).toContainText('Starting in a minute');
  // The chat button in the lobby's top bar counts it, and stops counting once the chat is open.
  await expect(host.locator('.topbar .badge')).toHaveText('1');
  await expect(host.getByRole('button', { name: 'Chat, 1 new' })).toBeVisible();
  await peek.click();
  await expect(host.locator('.topbar .badge')).toHaveCount(0);
  await expect(host.locator('.sheet').getByText('Starting in a minute, waiting for Cy.')).toBeVisible();
  await expect(peek).toHaveCount(0);
  await host.locator('.sheet-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(host.locator('.sheet')).toHaveCount(0);

  // Your own line never pops up for you.
  await host.getByRole('button', { name: /chat/i }).first().click();
  const mine = host.locator('.sheet .chat-compose input');
  await mine.fill('On my way.');
  await mine.press('Enter');
  await host.waitForTimeout(1200);
  await expect(host.locator('.chat-peek')).toHaveCount(0);
  await host.locator('.sheet-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(host.locator('.sheet')).toHaveCount(0);

  // During a card as well, and it leaves by itself.
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('.choices')).toBeVisible({ timeout: 10_000 });
  await expect(guest.locator('.choices')).toBeVisible({ timeout: 10_000 });
  await guest.getByRole('button', { name: /chat/i }).first().click();
  await guest.locator('.sheet .chat-compose input').fill('This one is easy.');
  await guest.locator('.sheet .chat-compose input').press('Enter');
  await expect(host.locator('.chat-peek')).toBeVisible({ timeout: 6000 });
  await expect(host.locator('.chat-peek')).toHaveCount(0, { timeout: 8000 });
});
