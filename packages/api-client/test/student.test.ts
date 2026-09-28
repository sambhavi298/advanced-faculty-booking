import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../src/client';
import { createTokenStore } from '../src/token-store';
import { json, startFakeApi } from './support';

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
});

describe('dashboard and notification endpoints', () => {
  it('call the documented routes', async () => {
    const api = await startFakeApi((_req, res) => {
      json(res, 200, { unread: 0, notifications: [] });
    });
    close = api.close;
    const client = createApiClient({ baseURL: api.baseURL, tokenStore: createTokenStore('k') });

    await client.student.dashboard();
    await client.faculty.dashboard();
    await client.notifications.list();
    await client.notifications.list(5);
    await client.notifications.markAllRead();

    expect(api.requests.map((r) => [r.method, r.url])).toEqual([
      ['GET', '/api/student/dashboard'],
      ['GET', '/api/faculty/dashboard'],
      ['GET', '/api/notifications?limit=20'],
      ['GET', '/api/notifications?limit=5'],
      ['POST', '/api/notifications/read'],
    ]);
  });
});
