import { expect, test } from '@playwright/test';
import { ACCOUNTS, portalUrl, signIn } from './support';

test.describe('Signing in to each portal', () => {
  test('each portal accepts its own accounts and signs out again', async ({ page }) => {
    for (const [portal, account, heading] of [
      ['student', ACCOUNTS.student, 'Welcome back, Priya'],
      ['faculty', ACCOUNTS.rao, 'Welcome, Prof. K. Rao'],
      ['admin', ACCOUNTS.admin, 'System overview'],
    ] as const) {
      await signIn(page, portal, account);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    }
  });

  test('wrong passwords and other portals are refused with a clear message', async ({ page }) => {
    await page.goto(portalUrl('student'));
    await page.getByLabel('Registration Number').fill(ACCOUNTS.student.loginId);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Incorrect login ID or password.');

    await page.goto(portalUrl('faculty'));
    await page.getByLabel('Employee ID').fill(ACCOUNTS.student.loginId);
    await page.getByLabel('Password').fill(ACCOUNTS.student.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Student portal');
  });

  test('a deep link survives the login', async ({ page }) => {
    await page.goto(portalUrl('student', '/appointments?status=APPROVED'));
    await page.getByLabel('Registration Number').fill(ACCOUNTS.student.loginId);
    await page.getByLabel('Password').fill(ACCOUNTS.student.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'My appointments' })).toBeVisible();
    await expect(page).toHaveURL(/\/appointments\?status=APPROVED$/);
  });
});
