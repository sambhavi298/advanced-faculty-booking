import { expect, test } from '@playwright/test';
import { ACCOUNTS, bookThroughApi, campusInput, purpose, signIn } from './support';

test('recording leave releases the appointments inside it and tells the student', async ({
  browser,
  request,
}) => {
  const text = purpose('Project discussion');
  const booked = await bookThroughApi(request, text);

  const faculty = await (await browser.newContext()).newPage();
  await signIn(faculty, 'faculty', ACCOUNTS.rao, '/availability');
  await faculty.getByLabel('Type').selectOption('LEAVE');
  await faculty.getByLabel('Starts').fill(campusInput(booked.startsAt));
  await faculty.getByLabel('Ends').fill(campusInput(booked.endsAt));
  await faculty.getByLabel('Reason (optional, shown to affected students)').fill('Medical leave');
  await faculty.getByRole('button', { name: 'Add period' }).click();
  await expect(faculty.getByText(/Leave recorded\. 1 appointment was released/)).toBeVisible();
  await expect(faculty.getByText('Medical leave')).toBeVisible();

  const student = await (await browser.newContext()).newPage();
  await signIn(student, 'student', ACCOUNTS.student, '/appointments?status=REJECTED');
  const card = student.locator('article', { hasText: text });
  await expect(card).toContainText('Medical leave');

  // Remove the leave again so later runs start from normal office hours.
  const remove = faculty.getByRole('button', { name: /^Remove leave from/ });
  await remove.first().click();
  await faculty.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(faculty.getByText('Leave removed. Those hours are bookable again.')).toBeVisible();
});
