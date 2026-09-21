// End to end: two phones race along the track in Capital Race. One opens a room, the other
// joins with the code, and then they roll, move, answer, and carry on until somebody crosses
// the finish line or the budget runs out.
//
// The first answer is thrown deliberately, because a wrong answer passing the turn to the
// other player is the rule the whole game hangs on and it is worth seeing happen. After that
// the test answers correctly, which keeps one player rolling and gets a real game to a real
// finish inside the time a test may take. It knows the answers the honest way: the capitals
// deck is public content, so it fetches it and reads it, exactly as the creator screens do.
//
// The game's own settings cannot be changed per room yet, so the track is the default thirty
// spaces. When the budget runs out first, the test still asserts the two things that cannot
// be checked anywhere else: both tokens are on the board, and the turn moves between people.

import { test, expect } from '@playwright/test';

/** How far to play. Whichever runs out first ends the loop. */
const MAX_TURNS = 40;
const BUDGET_MS = 45_000;

/** The buttons in the action bar this test presses. Skipping somebody is not one of them. */
const BAR_LABELS = /^(Roll|Go again|Next player|See the results)$/;

/**
 * A click in the loop races the other phone's next poll, so a button can go while it is being
 * reached for. That is the game moving on, not a failure: give up quickly and look again.
 */
const REACH_MS = 4000;

test('two people race along the track and the turn moves between them', async ({ browser, request }) => {
  const answers = await capitalAnswers(request);

  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  // The host opens a room. A browser that has never been here is asked its name first.
  await host.goto('/g/capital-race');
  await host.getByRole('button', { name: 'Start a room' }).click();
  await seat(host, 'Wesley');
  await expect(host.locator('.code-text')).toBeVisible();
  const code = (await host.locator('.code-text').innerText()).trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  // The guest joins with the link.
  await guest.goto(`/r/${code}`);
  await seat(guest, 'Nina');
  await expect(host.getByText('Nina', { exact: true })).toBeVisible();

  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('.board')).toBeVisible();
  await expect(guest.locator('.board')).toBeVisible();

  // Two people at the table means two tokens on the board, in both browsers.
  await expect(host.locator('.board-token')).toHaveCount(2);
  await expect(guest.locator('.board-token')).toHaveCount(2);

  // The kit shuffles the seats, so either phone may be first. The loop drives whichever one
  // can act, and the turn line on the host's phone is what proves the turn moved.
  const startedWith = await turnLine(host);
  expect(startedWith, 'nobody was named as the first player').not.toEqual('');

  /** Which turn lines have been seen, so a turn that passes can be proved. */
  const seen = new Set([startedWith]);
  let missed = false;
  let turns = 0;
  const until = Date.now() + BUDGET_MS;

  while (turns < MAX_TURNS && Date.now() < until) {
    if (await isOver(host)) break;
    const acted = (await step(host, answers, missed)) || (await step(guest, answers, missed));
    if (!acted) { await host.waitForTimeout(300); continue; }
    if (acted === 'answered') missed = true;
    if (acted === 'bar') turns += 1;
    const line = await turnLine(host);
    if (line) seen.add(line);
  }

  expect(turns, 'nobody ever got a turn').toBeGreaterThan(0);
  expect(seen.size, 'the turn never passed to anyone else').toBeGreaterThan(1);

  if (await isOver(host)) {
    // Crossing the finish line ends the game, and the platform puts up the results.
    await expect(host.getByRole('link', { name: 'Pick another game' })).toBeVisible();
    await expect(host.locator('.display-hero')).toContainText('win');
  } else {
    // The race is still on, so the board is still there and still has both of them on it.
    await expect(host.locator('.board-token')).toHaveCount(2);
    await expect(guest.locator('.board-token')).toHaveCount(2);
  }

  await hostContext.close();
  await guestContext.close();
});

/** Give a name and take a seat. */
async function seat(page, name) {
  const input = page.locator('#name-input');
  await input.waitFor({ timeout: 10_000 });
  await input.fill(name);
  await page.locator('.sheet button[type="submit"]').first().click();
}

/**
 * Do the one thing this page can do right now, if it can do anything: answer the card in
 * front of it, tap a space or a category, or press the button in the action bar.
 * @returns {Promise<'' | 'answered' | 'chip' | 'bar'>}
 */
async function step(page, answers, missed) {
  const choices = page.locator('.choices button:not([disabled]):not([aria-disabled="true"])');
  if (await choices.count()) {
    await pickAnswer(page, choices, answers, missed);
    return 'answered';
  }
  const chips = page.locator('.chip-strip button');
  if (await chips.count()) {
    await reach(chips.first());
    return 'chip';
  }
  const button = page.locator('.actionbar button').filter({ hasText: BAR_LABELS });
  if (await button.count()) {
    await reach(button.first());
    return 'bar';
  }
  return '';
}

/** Click something that may have moved on already. */
async function reach(locator) {
  await locator.click({ timeout: REACH_MS }).catch(() => {});
}

/**
 * The first card is missed on purpose, so the turn has to pass; every card after it is
 * answered from the deck, so the race actually reaches the finish line.
 */
async function pickAnswer(page, choices, answers, missed) {
  const wanted = answers.get(await promptOf(page)) || '';
  const labels = (await choices.allInnerTexts()).map((label) => label.trim());
  const right = labels.indexOf(wanted);
  if (!missed) {
    const wrong = labels.findIndex((label) => label !== wanted);
    await reach(choices.nth(wrong >= 0 ? wrong : 0));
    return;
  }
  await reach(choices.nth(right >= 0 ? right : 0));
}

/** The question on screen: the card's own text, or the heading beside its picture. */
async function promptOf(page) {
  return page.evaluate(() => {
    const stage = document.querySelector('.stage-text');
    if (stage && stage.textContent.trim()) return stage.textContent.trim();
    const heading = document.querySelector('h2.center');
    return heading ? heading.textContent.trim() : '';
  });
}

/** Every capital in the deck, by the question that asks for it. Public content, fetched once. */
async function capitalAnswers(request) {
  const response = await request.get('/api/decks/capitals');
  expect(response.ok(), 'the capitals deck would not load').toBeTruthy();
  const body = await response.json();
  /** @type {Map<string, string>} */
  const answers = new Map();
  for (const card of (body.deck && body.deck.cards) || []) answers.set(card.prompt, card.answer);
  expect(answers.size).toBeGreaterThan(0);
  return answers;
}

/** "Your turn", "Nina's turn", or nothing when the board is not on screen. */
async function turnLine(page) {
  const line = page.locator('.turn-name');
  return (await line.count()) ? (await line.first().innerText()).trim() : '';
}

/** The platform swaps the game screen for the results screen when somebody wins. */
async function isOver(page) {
  return (await page.getByRole('link', { name: 'Pick another game' }).count()) > 0;
}
