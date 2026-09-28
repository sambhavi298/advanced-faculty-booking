import { existsSync } from 'node:fs';
import path from 'node:path';
import { databaseDir, migrationsDir, seedFile } from '../../../src/db/paths';

describe('database paths', () => {
  it("default to the repository's database folder", () => {
    expect(databaseDir({})).toBe(path.resolve(__dirname, '../../../../../database'));
    expect(existsSync(path.join(migrationsDir({}), '0001_foundation.sql'))).toBe(true);
    expect(existsSync(seedFile({}))).toBe(true);
  });

  it('can be overridden with DATABASE_DIR', () => {
    const env = { DATABASE_DIR: '/srv/afb/database' };
    expect(databaseDir(env)).toBe('/srv/afb/database');
    expect(migrationsDir(env)).toBe(path.join('/srv/afb/database', 'migrations'));
    expect(seedFile(env)).toBe(path.join('/srv/afb/database', 'seeds', 'seed-data.json'));
  });

  it('uses process.env by default', () => {
    expect(databaseDir()).toBe(process.env.DATABASE_DIR ?? databaseDir({}));
    expect(migrationsDir()).toBe(path.join(databaseDir(), 'migrations'));
    expect(seedFile()).toBe(path.join(databaseDir(), 'seeds', 'seed-data.json'));
  });
});
