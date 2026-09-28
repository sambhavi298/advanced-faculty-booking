import { expect, test } from '@playwright/test';
import { ACCOUNTS, purpose, signIn } from './support';

test('a request travels from student to faculty and back, and the admin sees all of it', async ({
  browser,
}) => {
  const text = purpose('Doubt in BCNF decomposition');
  const student = await (await browser.newContext()).newPage();
  const faculty = await (await browser.newContext()).newPage();
  const admin = await (await browser.newContext()).newPage();

  // 1. The student finds Prof. K. Rao, picks the first free slot and sends the request.
  await signIn(student, 'student', ACCOUNTS.student);
  await student.getByRole('link', { name: 'Book an appointment' }).click();
  await student.getByRole('link', { name: 'View slots for Prof. K. Rao' }).click();
  await expect(student.getByRole('heading', { name: 'Book a slot' })).toBeVisible();
  await student.getByRole('group', { name: 'Times' }).getByRole('button').first().click();
  await student.getByLabel('3. Purpose of the meeting').fill('short');
  await student.getByRole('button', { name: 'Request appointment' }).click();
  await expect(student.getByText('Describe the purpose in at least 10 characters.')).toBeVisible();
  await student.getByLabel('3. Purpose of the meeting').fill(text);
  await student.getByRole('button', { name: 'Request appointment' }).click();
  await expect(student).toHaveURL(/\/appointments\?status=PENDING$/);
  await expect(student.getByText(text)).toBeVisible();

  // 2. The faculty member sees it in Requests and approves it with a note.
  await signIn(faculty, 'faculty', ACCOUNTS.rao, '/requests');
  const card = faculty.locator('article', { hasText: text });
  await card.getByRole('button', { name: 'Approve request from Priya Sharma' }).click();
  await faculty.getByLabel('Note for the student (optional)').fill('Bring your lecture notes.');
  await faculty.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(faculty.getByText('Approved. Priya Sharma has been notified.')).toBeVisible();
  await expect(faculty.locator('article', { hasText: text })).toHaveCount(0);

  // 3. The student is notified and sees where to meet.
  await student.reload();
  await expect(student.getByRole('button', { name: /Notifications, \d+ unread/ })).toBeVisible();
  await student.getByRole('tab', { name: /Approved/ }).click();
  const approved = student.locator('article', { hasText: text });
  await expect(approved).toContainText('Meet at Tech Park');
  await expect(approved).toContainText('Bring your lecture notes.');
  await student.getByRole('button', { name: /Notifications/ }).click();
  await expect(student.getByText('Appointment approved').first()).toBeVisible();

  // 4. The admin finds it in monitoring, and the audit trail names who approved it.
  await signIn(admin, 'admin', ACCOUNTS.admin, '/appointments');
  await admin.getByLabel('Student or faculty').fill('Priya');
  await expect(admin.getByRole('row', { name: new RegExp(text) })).toContainText('Approved');
  await admin.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit log' }).click();
  await admin.getByLabel('Table').selectOption('appointments');
  await admin.getByLabel('Action').selectOption('UPDATE');
  await expect(admin.getByText(/by Prof\. K\. Rao \(FAC200\)/).first()).toBeVisible();
});
