import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { MigrationError, Migrator } from '../../../src/db/migrator';
import { withIsolatedSchema } from '../../helpers/database';
import { capturingLogger } from '../../helpers/logger';

async function tables(pool: Pool, schema: string): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
    [schema],
  );
  return result.rows.map((row) => row.table_name);
}

describe('Migrator against real PostgreSQL', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'afb-migrator-'));
    writeFileSync(path.join(dir, '0001_create_a.sql'), 'CREATE TABLE a (id int PRIMARY KEY);');
    writeFileSync(
      path.join(dir, '0002_create_b.sql'),
      'CREATE TABLE b (id int PRIMARY KEY REFERENCES a (id));',
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies pending migrations in order and records each one', async () => {
    await withIsolatedSchema(async (pool, schema) => {
      const { logger, lines } = capturingLogger();

      const applied = await new Migrator(pool, dir, logger).migrate();

      expect(applied.map((file) => file.fileName)).toEqual(['0001_create_a.sql', '0002_create_b.sql']);
      expect(await tables(pool, schema)).toEqual(['a', 'b', 'schema_migrations']);
      const recorded = await pool.query<{ version: string; execution_ms: number }>(
        'SELECT version, execution_ms FROM schema_migrations ORDER BY version',
      );
      expect(recorded.rows.map((row) => row.version)).toEqual(['0001', '0002']);
      expect(lines.filter((line) => line.msg === 'Applied migration')).toHaveLength(2);
    });
  });

  it('is idempotent: a second run applies nothing', async () => {
    await withIsolatedSchema(async (pool) => {
      const { logger, lines } = capturingLogger();
      const migrator = new Migrator(pool, dir, logger);
      await migrator.migrate();

      await expect(migrator.migrate()).resolves.toEqual([]);
      expect(lines.at(-1)).toMatchObject({ msg: 'Database schema is up to date' });
    });
  });

  it('reports status and applies only new files later', async () => {
    await withIsolatedSchema(async (pool) => {
      const migrator = new Migrator(pool, dir, capturingLogger().logger);
      await migrator.migrate();
      writeFileSync(path.join(dir, '0003_create_c.sql'), 'CREATE TABLE c (id int);');

      const status = await migrator.status();
      expect(status.map((row) => [row.version, row.name, row.applied])).toEqual([
        ['0001', 'create_a', true],
        ['0002', 'create_b', true],
        ['0003', 'create_c', false],
      ]);
      expect(status[0]!.appliedAt).toBeInstanceOf(Date);
      expect(status[2]!.appliedAt).toBeNull();

      expect((await migrator.migrate()).map((file) => file.version)).toEqual(['0003']);
    });
  });

  it('refuses to run when an applied migration was edited', async () => {
    await withIsolatedSchema(async (pool) => {
      const migrator = new Migrator(pool, dir, capturingLogger().logger);
      await migrator.migrate();
      writeFileSync(path.join(dir, '0001_create_a.sql'), 'CREATE TABLE a (id bigint PRIMARY KEY);');

      await expect(migrator.migrate()).rejects.toThrow(
        /0001_create_a\.sql was modified after it was applied/,
      );
      await expect(migrator.status()).rejects.toThrow(MigrationError);
    });
  });

  it('refuses to run when an applied migration file disappeared', async () => {
    await withIsolatedSchema(async (pool) => {
      const migrator = new Migrator(pool, dir, capturingLogger().logger);
      await migrator.migrate();
      unlinkSync(path.join(dir, '0002_create_b.sql'));

      await expect(migrator.migrate()).rejects.toThrow(
        'Migration 0002_create_b.sql was applied to this database but no longer exists.',
      );
    });
  });

  it('rolls back a failing migration completely and reports the line', async () => {
    await withIsolatedSchema(async (pool, schema) => {
      writeFileSync(
        path.join(dir, '0003_broken.sql'),
        'CREATE TABLE c (id int);\n\nCREATE TABLE d (id nonexistent_type);',
      );
      const migrator = new Migrator(pool, dir, capturingLogger().logger);

      await expect(migrator.migrate()).rejects.toThrow(
        'Migration 0003_broken.sql failed (line 3): type "nonexistent_type" does not exist',
      );
      // 0001 and 0002 committed; nothing from 0003 (not even table c) survived.
      expect(await tables(pool, schema)).toEqual(['a', 'b', 'schema_migrations']);
      expect((await migrator.status()).map((row) => row.applied)).toEqual([true, true, false]);
    });
  });

  it('serialises concurrent runs with an advisory lock', async () => {
    await withIsolatedSchema(async (pool) => {
      writeFileSync(path.join(dir, '0003_slow.sql'), 'SELECT pg_sleep(0.2); CREATE TABLE c (id int);');
      const first = new Migrator(pool, dir, capturingLogger().logger);
      const second = new Migrator(pool, dir, capturingLogger().logger);

      const [a, b] = await Promise.all([first.migrate(), second.migrate()]);

      // One process applied all three; the other waited, then found nothing to do.
      expect([a.length, b.length].sort()).toEqual([0, 3]);
    });
  });
});
