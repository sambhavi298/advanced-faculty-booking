import { expect, test } from '@playwright/test';
import { ACCOUNTS, purpose, signIn } from './support';

/**
 * The headline demonstration: two browsers submit the same slot at the same moment. PostgreSQL's
 * exclusion constraint admits exactly one; the other browser is told the slot was just taken and is
 * shown fresh slots.
 */
test('two simultaneous requests for one slot: exactly one succeeds', async ({ browser }) => {
  const pages = await Promise.all(
    [0, 1].map(async () => {
      const page = await (await browser.newContext()).newPage();
      await signIn(page, 'student', ACCOUNTS.student, '/faculty');
      await page.getByRole('link', { name: 'View slots for Prof. K. Rao' }).click();
      await expect(page.getByRole('heading', { name: 'Book a slot' })).toBeVisible();
      return page;
    }),
  );

  // Both choose the same (first) free slot and describe their purpose.
  for (const [index, page] of pages.entries()) {
    await page.getByRole('group', { name: 'Times' }).getByRole('button').first().click();
    await page.getByLabel('3. Purpose of the meeting').fill(purpose(`Race attempt ${String(index + 1)}`));
  }
  const firstSlot = await pages[0]!
    .getByRole('group', { name: 'Times' })
    .getByRole('button')
    .first()
    .textContent();
  expect(
    await pages[1]!.getByRole('group', { name: 'Times' }).getByRole('button').first().textContent(),
  ).toBe(firstSlot);

  // Submit both at once, then see how each browser ends up.
  await Promise.all(pages.map((page) => page.getByRole('button', { name: 'Request appointment' }).click()));
  const outcomes = await Promise.all(
    pages.map((page) =>
      Promise.race([
        page.waitForURL(/\/appointments\?status=PENDING$/).then(() => 'booked' as const),
        page
          .getByText(/taken by another request|already have an appointment at this time/)
          .waitFor()
          .then(() => 'refused' as const),
      ]),
    ),
  );
  expect([...outcomes].sort()).toEqual(['booked', 'refused']);

  // The refused browser was shown fresh slots: the contested one is no longer offered.
  const refused = pages[outcomes.indexOf('refused')]!;
  await expect(
    refused.getByRole('group', { name: 'Times' }).getByRole('button', { name: firstSlot! }),
  ).toHaveCount(0);
});
