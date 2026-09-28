import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../src/client';
import { createTokenStore } from '../src/token-store';
import { json, startFakeApi } from './support';

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
});

describe('appointment endpoints', () => {
  it('call the documented routes with the documented bodies', async () => {
    const api = await startFakeApi((req, res) => {
      json(res, req.method === 'POST' ? 201 : 200, { echoed: `${req.method} ${req.url}` });
    });
    close = api.close;
    const client = createApiClient({ baseURL: api.baseURL, tokenStore: createTokenStore('k') });

    await client.appointments.create({
      facultyId: 2,
      startsAt: '2030-01-07T05:10:00.000Z',
      purpose: 'Discuss project',
    });
    await client.appointments.mine();
    await client.appointments.mine('PENDING');
    await client.appointments.cancel('a/b', 'Resolved');
    await client.appointments.approve('id-1', 'Bring notes');
    await client.appointments.reject('id-2');
    await client.appointments.pending();

    expect(api.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      [
        'POST',
        '/api/appointments',
        { facultyId: 2, startsAt: '2030-01-07T05:10:00.000Z', purpose: 'Discuss project' },
      ],
      ['GET', '/api/appointments/me', undefined],
      ['GET', '/api/appointments/me?status=PENDING', undefined],
      ['PATCH', '/api/appointments/a%2Fb/cancel', { reason: 'Resolved' }],
      ['PATCH', '/api/appointments/id-1/approve', { note: 'Bring notes' }],
      ['PATCH', '/api/appointments/id-2/reject', {}],
      ['GET', '/api/faculty/pending', undefined],
    ]);
  });
});
