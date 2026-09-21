// Two phones play Crazy Eights against the real server: one opens a room, the other joins
// with the code, and then they take turns until somebody wins or twelve turns have gone by.
//
// It is here for the two things a card game can get wrong that no unit test can see. The
// first is that a turn actually works end to end: tap a raised card, name a suit for an
// eight, draw and pass when nothing matches, and watch the hands change size. The second is
// hidden information: the cards in one browser must never appear in the other, by id or by
// name, because a hand that leaks is not a card game.

import { test, expect } from '@playwright/test';

/** How many turns to take before calling it a game. */
const TURNS = 12;

test('two people play a hand of Crazy Eights and never see each other cards', async ({ browser }) => {
  // Twelve turns is twelve poll round trips on two devices, and the default ninety seconds is
  // close enough to that on a busy machine to fail for no good reason.
  test.setTimeout(150_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  // The host opens a room. A browser that has never been here is asked its name first.
  await host.goto('/g/crazy-eights');
  await host.getByRole('button', { name: 'Start a room' }).click();
  await host.locator('#name-input').fill('Wesley');
  await host.getByRole('button', { name: 'Start the room' }).click();
  await expect(host.locator('.code-text')).toBeVisible();
  const code = (await host.locator('.code-text').innerText()).trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  // The guest joins with the link.
  await guest.goto(`/r/${code}`);
  await guest.locator('#name-input').fill('Nina');
  await guest.getByRole('button', { name: 'Join the room' }).click();
  await expect(host.getByText('Nina', { exact: true })).toBeVisible();

  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('.hand')).toBeVisible();
  await expect(guest.locator('.hand')).toBeVisible();
  expect((await heldBy(host)).length).toBeGreaterThan(0);

  await expectHandsAreSecret(host, guest);
  await expectHandsAreSecret(guest, host);

  // Play. Whoever is up plays a card they are allowed to play, or draws one and passes.
  const totals = [await handTotal(host, guest)];
  let turns = 0;
  for (let attempt = 0; attempt < TURNS * 3 && turns < TURNS; attempt++) {
    if (await isOver(host)) break;
    const page = await whoseTurn(host, guest);
    if (!page) continue;
    await takeTurn(page);
    turns += 1;
    totals.push(await handTotal(host, guest));
  }

  expect(turns, 'nobody ever got a turn').toBeGreaterThan(0);
  expect(new Set(totals).size, 'the hands never changed size').toBeGreaterThan(1);

  // Whatever happened in between, neither browser ever learned the other hand.
  if (!(await isOver(host))) {
    await expectHandsAreSecret(host, guest);
    await expectHandsAreSecret(guest, host);
  }

  await hostContext.close();
  await guestContext.close();
});

/** The card ids this browser is holding. Only your own hand is ever in your page. */
async function heldBy(page) {
  return page.locator('.hand [data-card]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-card')));
}

/** Both hands together. Every turn plays a card or draws one, so this number moves. */
async function handTotal(host, guest) {
  return (await heldBy(host)).length + (await heldBy(guest)).length;
}

/** Nothing about one player's hand, neither the ids nor the names, is in the other page. */
async function expectHandsAreSecret(mine, theirs) {
  const ids = await heldBy(mine);
  const names = await mine.locator('.hand [data-card]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  expect(ids.length).toBeGreaterThan(0);
  const page = await theirs.content();
  for (const id of ids) expect(page, `the card ${id} leaked`).not.toContain(`data-card="${id}"`);
  for (const name of names) expect(page, `the card ${name} leaked`).not.toContain(name);
}

/** The kit says "Your turn." to exactly one browser, once the server has caught up. */
async function whoseTurn(host, guest) {
  for (let wait = 0; wait < 12; wait++) {
    if (await isMyTurn(host)) return host;
    if (await isMyTurn(guest)) return guest;
    await host.waitForTimeout(400);
  }
  return null;
}

async function isMyTurn(page) {
  return page.getByRole('heading', { name: 'Your turn.' }).isVisible();
}

/** The platform swaps the game screen for the results screen when somebody wins. */
async function isOver(page) {
  return (await page.getByRole('link', { name: 'Pick another game' }).count()) > 0;
}

/**
 * One turn. A card you may play is a button in the fan, so tap the first one; an eight asks
 * for a suit before it goes anywhere. With nothing to play, draw from the action bar and
 * pass, which is the kit's own way out of a turn.
 */
async function takeTurn(page) {
  const card = page.locator('.hand button.card').first();
  const draw = page.locator('.actionbar button').filter({ hasText: /^Draw/ });
  const pass = page.locator('.actionbar button').filter({ hasText: /^Pass$/ });
  // The heading turns over before the poll that carries the hand, so wait for something to do.
  for (let wait = 0; wait < 20 && !(await card.count()) && !(await draw.count()); wait++) {
    await page.waitForTimeout(300);
  }

  if (await card.count()) {
    const id = await card.getAttribute('data-card');
    // The fan tilts each card about its bottom edge and lays the next card over its right
    // half, so the sure place to tap is low on the left strip: inside the card at any tilt and
    // never under the neighbour. Playwright's position is relative to the tilted card's
    // bounding box, which is wider than the card, hence the inset.
    const box = await card.boundingBox();
    const width = await card.evaluate((el) => el.offsetWidth);
    const inset = box ? Math.max(0, (box.width - width) / 2) : 0;
    await card.click({ position: { x: inset + 18, y: box ? box.height - 26 : 14 } });
    if (id && id.slice(0, -1) === '8') {
      await expect(page.locator('.suit-picker')).toBeVisible();
      await page.locator('.suit-picker button').first().click();
    }
  } else {
    await draw.click();
    // Drawing ends the turn outright when a two was played at you, and otherwise leaves a pass.
    for (let wait = 0; wait < 20; wait++) {
      if (!(await isMyTurn(page))) break;
      if (await pass.count()) { await pass.click(); break; }
      await page.waitForTimeout(300);
    }
  }
  await waitForTurnToPass(page);
}

/** A turn is only over when the server says so, which is the next poll, not the click. */
async function waitForTurnToPass(page) {
  for (let wait = 0; wait < 25; wait++) {
    if (!(await isMyTurn(page))) return;
    await page.waitForTimeout(300);
  }
}
