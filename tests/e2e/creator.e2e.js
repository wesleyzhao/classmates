// The whole creator, end to end, the way somebody actually uses it: make a deck of three
// cards by pasting them, make a quiz that draws from it, publish it, follow the link it gives
// back, open a room, get a second phone in, and start the game.
//
// The assertion at the end is the point of all of it: the card the host is looking at is the
// card the guest is looking at. Everything before it is the creator's own plumbing, and if any
// of it is wrong the run stops there rather than at a vague failure on the last line.
//
//   npx playwright test tests/e2e/creator.e2e.js

import { expect, test } from '@playwright/test';

/** Three cards, in the shape the paste box parses: question, answer, wrong answers. */
const PASTED = [
  'Which city has the Colosseum? | Rome | Athens; Cairo; Lisbon',
  'Which sea lies between Italy and Albania? | The Adriatic | The Baltic; The Aegean; The Irish Sea',
  'Which river runs through Vienna? | The Danube | The Rhine; The Loire; The Elbe',
].join('\n');

const DECK_TITLE = 'Three about Europe';
const GAME_TITLE = 'A quiz from my own deck';

test('a deck and a game made in the browser, then played on two phones', async ({ page, browser }) => {
  // ---------------------------------------------------------------- the deck
  await page.goto('/decks/new');
  await page.fill('#deck-title', DECK_TITLE);

  await page.getByRole('button', { name: 'Paste cards' }).click();
  await page.fill('#paste-box', PASTED);
  await page.getByRole('button', { name: 'Add these' }).click();

  await expect(page.getByText('3 cards', { exact: true })).toBeVisible();
  await expect(page.locator('input#deck-title')).toHaveValue(DECK_TITLE);

  await page.getByRole('button', { name: 'Publish deck' }).click();
  await expect(page).toHaveURL(/\/decks\/[A-Za-z0-9]{6,}/);
  await expect(page.getByText('This deck is published')).toBeVisible();

  // ---------------------------------------------------------------- the game
  await page.getByRole('link', { name: 'Make a game with it' }).click();
  await expect(page).toHaveURL(/\/create\?deck=/);

  // Step one: the quiz is the first kit, and it is already outlined.
  await expect(page.getByRole('button', { name: /Quiz/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next, choose the cards' }).click();

  // Step two: the deck this game came from is already chosen.
  const deckRow = page.getByRole('button', { name: new RegExp(DECK_TITLE) });
  await expect(deckRow).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next, settings and look' }).click();

  // Step three: three cards, five seconds each, and the host sets the pace.
  await page.fill('#f-cards', '3');
  await page.fill('#f-seconds', '5');
  await page.getByRole('switch', { name: 'Move on automatically' }).click();
  await page.fill('#f-title', GAME_TITLE);
  await page.getByRole('button', { name: 'Next, publish it' }).click();

  // Step four: the summary says what is about to be published.
  await expect(page.getByText(GAME_TITLE).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`${DECK_TITLE}, 3 cards in all`))).toBeVisible();
  await page.getByRole('button', { name: 'Publish game' }).click();

  await expect(page.getByText(`${GAME_TITLE} is published`)).toBeVisible();
  await expect(page.getByText('Keep this edit link. Anyone with it can change the game.')).toBeVisible();

  // ---------------------------------------------------------------- the room
  await page.getByRole('link', { name: 'Play it' }).click();
  await expect(page).toHaveURL(/\/g\//);
  await expect(page.getByRole('heading', { name: GAME_TITLE })).toBeVisible();

  await page.getByRole('button', { name: 'Start a room' }).click();
  await page.fill('#name-input', 'Wesley');
  await page.getByRole('button', { name: 'Start the room' }).click();

  await expect(page).toHaveURL(/\/r\/[A-Z]{4}/);
  const code = (page.url().match(/\/r\/([A-Z]{4})/) || [])[1];
  expect(code).toBeTruthy();

  // A second phone, with its own storage, joins with the code.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(`/r/${code}`);
  await guest.fill('#name-input', 'Nina');
  await guest.getByRole('button', { name: 'Join the room' }).click();
  await expect(guest.getByText('Waiting for Wesley to start.')).toBeVisible();

  // ---------------------------------------------------------------- the game
  await page.getByRole('button', { name: 'Start game' }).click();

  const hostPrompt = page.locator('.stage-text');
  await expect(hostPrompt).toBeVisible();
  const asked = (await hostPrompt.textContent()) || '';
  expect(PASTED).toContain(asked);

  // The same card, on the other phone. This is the whole point of the run.
  await expect(guest.locator('.stage-text')).toHaveText(asked);
  await expect(page.getByText('Card 1 of 3')).toBeVisible();

  await guestContext.close();
});
