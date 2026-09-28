import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../src/client';
import { createTokenStore } from '../src/token-store';
import { json, startFakeApi } from './support';

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
});

describe('faculty endpoints', () => {
  it('call the documented routes', async () => {
    const api = await startFakeApi((req, res) => {
      if (req.method === 'DELETE') {
        res.writeHead(204);
        res.end();
        return;
      }
      json(res, 200, {});
    });
    close = api.close;
    const client = createApiClient({ baseURL: api.baseURL, tokenStore: createTokenStore('k') });

    await client.faculty.list();
    await client.faculty.list({ search: 'rao', department: 'CSE' });
    await client.faculty.availability(2);
    await client.faculty.availability(2, { from: '2030-01-07', to: '2030-01-10' });
    await client.faculty.myAvailability();
    await client.faculty.replaceAvailability([{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }]);
    await client.faculty.addException({ kind: 'LEAVE', startsAt: 'a', endsAt: 'b' });
    await expect(client.faculty.removeException(7)).resolves.toBeUndefined();

    expect(api.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ['GET', '/api/faculty', undefined],
      ['GET', '/api/faculty?search=rao&department=CSE', undefined],
      ['GET', '/api/faculty/2/availability', undefined],
      ['GET', '/api/faculty/2/availability?from=2030-01-07&to=2030-01-10', undefined],
      ['GET', '/api/faculty/availability', undefined],
      [
        'PUT',
        '/api/faculty/availability',
        { windows: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] },
      ],
      ['POST', '/api/faculty/availability/exceptions', { kind: 'LEAVE', startsAt: 'a', endsAt: 'b' }],
      ['DELETE', '/api/faculty/availability/exceptions/7', undefined],
    ]);
  });
});
