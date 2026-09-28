import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import bcrypt from 'bcrypt';
import type { Pool } from 'pg';
import { createCliLogger } from '../../../src/db/cli-logger';
import { DbCommandError, isDbCommand, runDbCommand, type DbCommandContext } from '../../../src/db/commands';
import { Migrator } from '../../../src/db/migrator';
import { migrationsDir, seedFile } from '../../../src/db/paths';
import { loadSeedFile, SeedError, seedDatabase, type SeedData } from '../../../src/db/seeder';
import { createTestPool, withIsolatedSchema } from '../../helpers/database';
import { silentLogger } from '../../helpers/logger';

function outputCollector() {
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  return { logger: createCliLogger(output), text: () => chunks.join('') };
}

describe('The seeded test database (built by global setup)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('contains exactly the four documented accounts', async () => {
    const result = await pool.query<{ login_id: string; full_name: string; role: string }>(
      'SELECT login_id, full_name, role FROM users ORDER BY id',
    );
    expect(result.rows).toEqual([
      { login_id: 'RA221100301001', full_name: 'Priya Sharma', role: 'STUDENT' },
      { login_id: 'FAC200', full_name: 'Prof. K. Rao', role: 'FACULTY' },
      { login_id: 'FAC201', full_name: 'Prof. S. Iyer', role: 'FACULTY' },
      { login_id: 'ADMIN001', full_name: 'Amy', role: 'ADMIN' },
    ]);
  });

  it.each([
    ['RA221100301001', 'Password123!'],
    ['FAC200', 'Password123!'],
    ['FAC201', 'Password123!'],
    ['ADMIN001', 'Admin123!'],
  ])(
    'stores only a bcrypt hash for %s, which verifies the documented password',
    async (loginId, password) => {
      const result = await pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE login_id = $1',
        [loginId],
      );
      const hash = result.rows[0]!.password_hash;
      expect(hash).not.toContain(password);
      await expect(bcrypt.compare(password, hash)).resolves.toBe(true);
      await expect(bcrypt.compare('wrong-password', hash)).resolves.toBe(false);
    },
  );

  it('seeds no appointments or notifications (no mock activity)', async () => {
    const result = await pool.query<{ appointments: number; notifications: number }>(
      'SELECT (SELECT count(*) FROM appointments) AS appointments, (SELECT count(*) FROM notifications) AS notifications',
    );
    expect(result.rows[0]).toEqual({ appointments: 0, notifications: 0 });
  });
});

describe('seedDatabase on an empty schema', () => {
  it('loads everything in one transaction, then skips on the second run', async () => {
    await withIsolatedSchema(async (pool) => {
      await new Migrator(pool, migrationsDir(), silentLogger()).migrate();
      const data = await loadSeedFile(seedFile());

      const first = await seedDatabase(pool, data, 4);
      expect(first).toEqual({
        seeded: true,
        counts: {
          departments: 1,
          batches: 2,
          students: 1,
          faculty: 2,
          admins: 1,
          facultyAvailability: 10,
          batchSchedule: 40,
        },
      });

      const second = await seedDatabase(pool, data, 4);
      expect(second.seeded).toBe(false);
      const users = await pool.query<{ n: number }>('SELECT count(*) AS n FROM users');
      expect(users.rows[0]!.n).toBe(4);
    });
  });

  it('rejects references to unknown records and leaves the database untouched', async () => {
    await withIsolatedSchema(async (pool) => {
      await new Migrator(pool, migrationsDir(), silentLogger()).migrate();
      const data: SeedData = await loadSeedFile(seedFile());
      const broken: SeedData = { ...data, students: [{ ...data.students[0]!, batch: 'NO-SUCH-BATCH' }] };

      await expect(seedDatabase(pool, broken, 4)).rejects.toThrow(
        new SeedError('Seed data references unknown batch "NO-SUCH-BATCH"'),
      );
      const counts = await pool.query<{ departments: number }>(
        'SELECT count(*) AS departments FROM departments',
      );
      expect(counts.rows[0]!.departments).toBe(0);
    });
  });
});

describe('loadSeedFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'afb-seed-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('validates the file and names the problem', async () => {
    const file = path.join(dir, 'seed.json');
    writeFileSync(file, JSON.stringify({ departments: [] }));
    await expect(loadSeedFile(file)).rejects.toThrow(SeedError);
    await expect(loadSeedFile(file)).rejects.toThrow(/Invalid seed file .*departments/s);
  });
});

describe('runDbCommand', () => {
  function context(pool: Pool, schema: string, overrides: Partial<DbCommandContext> = {}) {
    const collector = outputCollector();
    const ctx: DbCommandContext = {
      pool,
      logger: collector.logger,
      config: { env: 'test', bcryptCost: 4 },
      migrationsDir: migrationsDir(),
      seedFile: seedFile(),
      schema,
      ...overrides,
    };
    return { ctx, text: collector.text };
  }

  it('recognises only the documented commands', () => {
    expect(['migrate', 'status', 'seed', 'setup', 'reset', 'fresh'].every(isDbCommand)).toBe(true);
    expect(isDbCommand('drop')).toBe(false);
    expect(isDbCommand(undefined)).toBe(false);
  });

  it('setup migrates and seeds; status lists every migration; seed then skips', async () => {
    await withIsolatedSchema(async (pool, schema) => {
      const setup = context(pool, schema);
      await runDbCommand('setup', setup.ctx);
      expect(setup.text()).toMatch(/Applied migration {2}migration=0001_foundation\.sql/);
      expect(setup.text()).toMatch(
        /Seed data loaded {2}departments=1 batches=2 students=1 faculty=2 admins=1/,
      );

      const status = context(pool, schema);
      await runDbCommand('status', status.ctx);
      expect(status.text()).toMatch(/^0001_foundation {2}applied=true at=\d{4}-/m);
      expect(status.text()).toMatch(/^0007_reporting {2}applied=true/m);

      const seed = context(pool, schema);
      await runDbCommand('seed', seed.ctx);
      expect(seed.text()).toBe('Database already has users; seed skipped\n');

      const migrate = context(pool, schema);
      await runDbCommand('migrate', migrate.ctx);
      expect(migrate.text()).toBe('Database schema is up to date\n');
    });
  });

  it('status marks pending migrations', async () => {
    await withIsolatedSchema(async (pool, schema) => {
      const status = context(pool, schema);
      await runDbCommand('status', status.ctx);
      expect(status.text()).toMatch(/^0001_foundation {2}applied=false at=-$/m);
    });
  });

  it('fresh and reset rebuild or clear the schema', async () => {
    await withIsolatedSchema(async (pool, schema) => {
      await runDbCommand('fresh', context(pool, schema).ctx);
      const afterFresh = await pool.query<{ n: number }>('SELECT count(*) AS n FROM users');
      expect(afterFresh.rows[0]!.n).toBe(4);

      const reset = context(pool, schema);
      await runDbCommand('reset', reset.ctx);
      expect(reset.text()).toBe('WARN  Database reset: all tables, types and functions dropped\n');
      const remaining = await pool.query<{ n: number }>(
        'SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = $1',
        [schema],
      );
      expect(remaining.rows[0]!.n).toBe(0);
    });
  });

  it('refuses to reset a production database', async () => {
    await withIsolatedSchema(async (pool, schema) => {
      const production = context(pool, schema, { config: { env: 'production', bcryptCost: 12 } });
      await expect(runDbCommand('reset', production.ctx)).rejects.toThrow(DbCommandError);
      await expect(runDbCommand('fresh', production.ctx)).rejects.toThrow(
        'Refusing to reset a production database.',
      );
    });
  });
});
