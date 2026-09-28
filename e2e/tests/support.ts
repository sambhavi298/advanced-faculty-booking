import type { Appointment, FacultyAvailability, LoginResponse } from '@afb/types';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_PORT, PORTS } from '../playwright.config';

export type Portal = keyof typeof PORTS;

export const ACCOUNTS = {
  student: { loginId: 'RA221100301001', password: 'Password123!', name: 'Priya Sharma' },
  rao: { loginId: 'FAC200', password: 'Password123!', name: 'Prof. K. Rao' },
  admin: { loginId: 'ADMIN001', password: 'Admin123!', name: 'Amy' },
} as const;

const ID_LABELS: Record<Portal, string> = {
  student: 'Registration Number',
  faculty: 'Employee ID',
  admin: 'Admin ID',
};

export const portalUrl = (portal: Portal, path = '/') => `http://localhost:${String(PORTS[portal])}${path}`;
export const apiUrl = (path: string) => `http://localhost:${String(API_PORT)}/api${path}`;

/** Signs in through the portal's login form, exactly as a person would. */
export async function signIn(
  page: Page,
  portal: Portal,
  account: { loginId: string; password: string },
  path = '/',
): Promise<void> {
  await page.goto(portalUrl(portal, path));
  await page.getByLabel(ID_LABELS[portal]).fill(account.loginId);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/** A unique purpose text, so a test can find its own appointment among the others. */
export const purpose = (label: string) => `${label} — e2e ${String(Date.now())}`;

/** Test setup through the public API (not the UI): a bearer token for an account. */
export async function apiToken(
  request: APIRequestContext,
  account: { loginId: string; password: string },
): Promise<string> {
  const res = await request.post(apiUrl('/auth/login'), { data: account });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as LoginResponse).token;
}

/** The student's next free slots with Prof. K. Rao, as the API offers them. */
export async function freeSlots(request: APIRequestContext, token: string): Promise<FacultyAvailability> {
  const faculty = await request.get(apiUrl('/faculty?search=FAC200'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const [rao] = (await faculty.json()) as { id: number }[];
  const res = await request.get(apiUrl(`/faculty/${String(rao?.id)}/availability`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as FacultyAvailability;
}

/** Books the first free slot with Prof. K. Rao through the API. */
export async function bookThroughApi(request: APIRequestContext, text: string): Promise<Appointment> {
  const token = await apiToken(request, ACCOUNTS.student);
  const availability = await freeSlots(request, token);
  const slot = availability.days.flatMap((day) => day.slots)[0];
  expect(slot).toBeDefined();
  const res = await request.post(apiUrl('/appointments'), {
    headers: { Authorization: `Bearer ${token}` },
    data: { facultyId: availability.faculty.id, startsAt: slot?.startsAt, purpose: text },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as Appointment;
}

/** An instant as the 'YYYY-MM-DDTHH:MM' campus-time value a datetime-local input takes. */
export function campusInput(iso: string, offsetMinutes = 0): string {
  const shifted = new Date(Date.parse(iso) + (offsetMinutes + 330) * 60_000);
  return shifted.toISOString().slice(0, 16);
}
