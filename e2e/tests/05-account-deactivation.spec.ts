import { expect, test } from '@playwright/test';
import { ACCOUNTS, portalUrl, signIn } from './support';

test('deactivating an account signs the person out at once; reactivating lets them back in', async ({
  browser,
}) => {
  const student = await (await browser.newContext()).newPage();
  const admin = await (await browser.newContext()).newPage();
  await signIn(student, 'student', ACCOUNTS.student);

  await signIn(admin, 'admin', ACCOUNTS.admin, '/students');
  await admin.getByRole('button', { name: 'Deactivate Priya Sharma' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(admin.getByText('Priya Sharma has been deactivated and signed out.')).toBeVisible();

  // The student's next request is refused and the portal explains why.
  await student
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My appointments' })
    .click();
  await expect(student.getByText('Your session has ended. Please sign in again.')).toBeVisible();
  await student.getByLabel('Registration Number').fill(ACCOUNTS.student.loginId);
  await student.getByLabel('Password').fill(ACCOUNTS.student.password);
  await student.getByRole('button', { name: 'Sign in' }).click();
  await expect(student.getByRole('alert')).toContainText('deactivated');

  await admin.getByRole('button', { name: 'Reactivate Priya Sharma' }).click();
  await expect(admin.getByText('Priya Sharma can sign in again.')).toBeVisible();
  await signIn(student, 'student', ACCOUNTS.student);
  await expect(student).toHaveURL(portalUrl('student', '/'));

  // The admin's action is in the audit trail.
  await admin.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit log' }).click();
  await admin.getByLabel('Table').selectOption('users');
  await expect(admin.getByText(/users.*\(is_active\).*by Amy \(ADMIN001\)/).first()).toBeVisible();
});
