// End to end: two phones race to the finish line. The host opens the game page and starts a
// room, a guest joins with the code, the host shortens the track through the settings action,
// and then both of them answer every card correctly. The host taps first every time, so the
// host takes two spaces a card and the guest takes one, and the host crosses the line first.
//
// The test knows the answers because it holds the same deck the server drew from: it reads the
// flag off the card and looks the country up. That is the only way a scripted browser can be
// reliably right, and being right is the whole point of a race.
import { test, expect } from '@playwright/test';
import countries from '../../public/decks/countries.js';

const NAME_INPUT = '#name-input';
/** The track this race is shortened to, and how many cards the host needs at two a card. */
const TRACK = 8;

const byEmoji = new Map(countries.cards.map((card) => [card.emoji, card.answer]));
const byCode = new Map(countries.cards.map((card) => [card.id, card.answer]));

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

/** Which country the card on screen is asking about, read from its flag. */
async function answerOnScreen(page) {
  if (await page.locator('.stage-emoji').count()) {
    const emoji = ((await page.locator('.stage-emoji').first().textContent()) || '').trim();
    if (byEmoji.has(emoji)) return byEmoji.get(emoji);
  }
  const src = await page.locator('.stage-image').first().getAttribute('src');
  const code = src && src.match(/\/w320\/([a-z]{2})\.png/);
  return code ? byCode.get(code[1]) : null;
}

/**
 * Tap the right choice on card `n`. Both phones move at their own pace, so this waits for
 * this phone to be on the card it is being asked about and for its tiles to be live before
 * it reads the flag: answering the card you are looking at is the whole trick.
 */
async function answerRight(page, n) {
  await expect(page.getByText(`Card ${n}`)).toBeVisible({ timeout: 25_000 });
  await page.locator('.choices .choice:not([aria-disabled="true"])').first().waitFor({ timeout: 25_000 });
  const answer = await answerOnScreen(page);
  expect(answer, 'the deck should know this flag').toBeTruthy();
  const choices = page.locator('.choices .choice');
  const texts = (await choices.allTextContents()).map((text) => text.trim());
  const index = texts.indexOf(answer);
  expect(index, `"${answer}" should be one of ${texts.join(', ')}`).toBeGreaterThan(-1);
  await choices.nth(index).click();
}

/** Has the platform swapped the play screen for the results screen? */
async function done(page) {
  return (await page.getByRole('button', { name: /play again/i }).count()) > 0;
}

/** Where a page says this player has got to, from the count at the end of their lane. */
async function place(page) {
  const count = page.locator('.lane.is-mine .lane-count').first();
  const text = (await count.textContent()) || '';
  return Number(text.split(' ')[0]);
}

test('two phones race to the finish, and the faster answer pulls ahead', async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await (await browser.newContext()).newPage();
  const nina = await (await browser.newContext()).newPage();

  await host.goto('/g/flag-race');
  await host.getByRole('button', { name: /start a room/i }).click();
  await seat(host, 'Ann');
  await host.waitForURL(/\/r\/[A-Z]{4}/);
  const code = host.url().match(/\/r\/([A-Z]{4})/)[1];
  await expect(host.getByText('At the table')).toBeVisible();

  await nina.goto(`/r/${code}`);
  await seat(nina, 'Nina');
  await expect(nina.getByText('At the table')).toBeVisible();
  await expect(host.locator('.list-row', { hasText: 'Nina' })).toBeVisible();

  expect(await act(host, code, 'room/settings', { config: { trackLength: TRACK, seconds: 20 } })).toBe(200);
  await host.getByRole('button', { name: /^start game$/i }).click();

  // Both runners start at the beginning, and the lanes are really on screen.
  await expect(host.locator('.lanes')).toBeVisible({ timeout: 20_000 });
  await expect(host.locator('.lane')).toHaveCount(2);
  expect(await place(host)).toBe(0);

  let boosted = 0;
  for (let card = 1; card <= 8; card++) {
    // The host taps first every time, so the boost belongs to the host.
    await answerRight(host, card);
    await answerRight(nina, card);
    // Either the answer comes up with its sentence about the race, or that was the winning
    // card and the results screen has already taken over. The reveal stays for four seconds,
    // so it is waited for in one poll rather than two.
    await expect(async () => {
      const over = await done(host);
      const said = await host.getByText(/had it first and moves? two/).count();
      expect(over || said > 0).toBe(true);
    }).toPass({ timeout: 25_000 });
    if (await done(host)) break;
    boosted += 1;
  }
  expect(boosted, 'every card before the last says who had it first').toBeGreaterThan(0);

  // Four cards at two spaces each is the whole track, and the guest is half way.
  await expect(host.getByText(/wins|You win/)).toBeVisible({ timeout: 30_000 });
  await expect(nina.getByText(/wins|You win/)).toBeVisible({ timeout: 30_000 });
  await expect(host.getByText(/8 of 8/).first()).toBeVisible();
  await expect(host.getByRole('button', { name: /play again/i })).toBeVisible();
});
