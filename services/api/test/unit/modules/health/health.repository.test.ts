import type { Queryable } from '../../../../src/db/types';
import { HealthRepository } from '../../../../src/modules/health/health.repository';

function fakeDb(rows: unknown[]): Queryable & { query: jest.Mock } {
  return { query: jest.fn().mockResolvedValue({ rows }) };
}

describe('HealthRepository', () => {
  it('maps the server-info row to camelCase', async () => {
    const db = fakeDb([{ version_num: 180004, version: '18.4', name: 'afb' }]);

    await expect(new HealthRepository(db).getServerInfo()).resolves.toEqual({
      versionNum: 180004,
      version: '18.4',
      name: 'afb',
    });
    expect(db.query.mock.calls[0]?.[0]).toMatch(/server_version_num/);
  });

  it('fails loudly if PostgreSQL returns no row', async () => {
    await expect(new HealthRepository(fakeDb([])).getServerInfo()).rejects.toThrow(/no row/);
  });
});
