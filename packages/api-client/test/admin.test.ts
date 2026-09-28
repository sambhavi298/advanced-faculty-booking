import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../src/client';
import { createTokenStore } from '../src/token-store';
import { json, startFakeApi } from './support';

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
});

describe('admin endpoints', () => {
  it('call the documented routes with their filters', async () => {
    const api = await startFakeApi((_req, res) => {
      json(res, 200, {});
    });
    close = api.close;
    const client = createApiClient({ baseURL: api.baseURL, tokenStore: createTokenStore('k') });

    await client.admin.dashboard();
    await client.admin.students();
    await client.admin.students({ search: 'priya', batchId: 2 });
    await client.admin.faculty();
    await client.admin.faculty({ search: 'rao' });
    await client.admin.departments();
    await client.admin.setUserStatus(7, false);
    await client.admin.appointments();
    await client.admin.appointments({ status: 'PENDING', limit: 10, offset: 20 });
    await client.admin.audit();
    await client.admin.audit({ table: 'users', before: 99 });
    await client.admin.reports();
    await client.admin.reports('2026-09');
    await client.admin.refreshReports();

    expect(api.requests.map((r) => [r.method, r.url])).toEqual([
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/students'],
      ['GET', '/api/admin/students?search=priya&batchId=2'],
      ['GET', '/api/admin/faculty'],
      ['GET', '/api/admin/faculty?search=rao'],
      ['GET', '/api/admin/departments'],
      ['PATCH', '/api/admin/users/7/status'],
      ['GET', '/api/admin/appointments'],
      ['GET', '/api/admin/appointments?status=PENDING&limit=10&offset=20'],
      ['GET', '/api/admin/audit'],
      ['GET', '/api/admin/audit?table=users&before=99'],
      ['GET', '/api/admin/reports'],
      ['GET', '/api/admin/reports?month=2026-09'],
      ['POST', '/api/admin/reports/refresh'],
    ]);
    expect(api.requests[6]!.body).toEqual({ isActive: false });
  });
});
